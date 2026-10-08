"""Minimal streaming client for the DeepSeek chat completions API (OpenAI-compatible)."""
from __future__ import annotations

import asyncio
import json
import re
from typing import Awaitable, Callable

import httpx

BASE_URL = "https://api.deepseek.com"


class DeepSeekError(Exception):
    pass


class DeepSeekTokenLimitError(DeepSeekError):
    """The provider exhausted its output budget before finishing the response."""


ProgressFn = Callable[[int, int], Awaitable[None] | None]


async def chat(
    api_key: str,
    model: str,
    messages: list[dict],
    *,
    json_mode: bool = False,
    thinking: bool = True,
    max_tokens: int = 16000,
    reasoning_effort: str = "high",
    on_progress: ProgressFn | None = None,
) -> str:
    """Stream a chat completion and return the final message content.

    `on_progress(reasoning_chars, content_chars)` is called as tokens arrive.
    """
    body: dict = {
        "model": model,
        "messages": messages,
        "stream": True,
        "max_tokens": max_tokens,
        "thinking": {"type": "enabled" if thinking else "disabled"},
    }
    if thinking:
        body["reasoning_effort"] = reasoning_effort
    else:
        body["temperature"] = 0.8
    if json_mode:
        body["response_format"] = {"type": "json_object"}

    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    timeout = httpx.Timeout(connect=20, read=300, write=30, pool=20)

    for attempt in range(4):
        content: list[str] = []
        reasoning_len = 0
        content_len = 0
        completed = False
        finish_reason = None
        try:
            async with httpx.AsyncClient(base_url=BASE_URL, timeout=timeout) as client:
                async with client.stream("POST", "/chat/completions", headers=headers, json=body) as resp:
                    if resp.status_code != 200:
                        text = (await resp.aread()).decode(errors="replace")
                        if resp.status_code in (429, 500, 502, 503, 504) and attempt < 3:
                            await asyncio.sleep(3 * (attempt + 1))
                            continue
                        raise DeepSeekError(_explain(resp.status_code, text))

                    last_report = 0
                    async for line in resp.aiter_lines():
                        if not line.startswith("data:"):
                            continue
                        data = line[5:].strip()
                        if data == "[DONE]":
                            completed = True
                            break
                        try:
                            chunk = json.loads(data)
                        except json.JSONDecodeError:
                            continue
                        for choice in chunk.get("choices", []):
                            if choice.get("finish_reason"):
                                finish_reason = choice["finish_reason"]
                                completed = True
                            delta = choice.get("delta") or {}
                            if delta.get("reasoning_content"):
                                reasoning_len += len(delta["reasoning_content"])
                            if delta.get("content"):
                                content.append(delta["content"])
                                content_len += len(delta["content"])
                        total = reasoning_len + content_len
                        if on_progress and total - last_report > 400:
                            last_report = total
                            r = on_progress(reasoning_len, content_len)
                            if asyncio.iscoroutine(r):
                                await r
        except (httpx.TransportError, httpx.TimeoutException) as e:
            if attempt < 3:
                await asyncio.sleep(3 * (attempt + 1))
                continue
            raise DeepSeekError(f"Network error talking to DeepSeek: {e}") from e

        if finish_reason == "length":
            raise DeepSeekTokenLimitError("DeepSeek's response was cut off at its token limit. Try a shorter or simpler video.")
        result = "".join(content).strip()
        if result and completed:
            return result
        if attempt < 3:
            continue  # DeepSeek occasionally returns empty content; retry
    raise DeepSeekError("DeepSeek returned an empty or incomplete response several times in a row.")


async def check_key(api_key: str) -> list[str]:
    """Return the model ids available to this key (raises DeepSeekError if the key is bad)."""
    try:
        async with httpx.AsyncClient(base_url=BASE_URL, timeout=20) as client:
            resp = await client.get("/models", headers={"Authorization": f"Bearer {api_key}"})
    except httpx.TransportError as e:
        raise DeepSeekError(f"Network error talking to DeepSeek: {e}") from e
    if resp.status_code != 200:
        raise DeepSeekError(_explain(resp.status_code, resp.text))
    try:
        return [m["id"] for m in resp.json().get("data", [])]
    except (ValueError, TypeError, KeyError, AttributeError) as e:
        raise DeepSeekError("DeepSeek returned an invalid model list. Try again.") from e


def _explain(status: int, text: str) -> str:
    try:
        msg = json.loads(text).get("error", {}).get("message") or text
    except Exception:
        msg = text
    msg = msg[:300]
    if status == 401:
        return "DeepSeek rejected the API key (401). Check the key in Settings."
    if status == 402:
        return "Your DeepSeek account has insufficient balance (402). Top up at platform.deepseek.com."
    if status == 400 and "model" in msg.lower():
        return f"DeepSeek doesn't recognise that model name: {msg}"
    return f"DeepSeek API error {status}: {msg}"


def parse_json(text: str) -> dict:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if fence:
        text = fence.group(1)
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end == -1:
        raise DeepSeekError("DeepSeek did not return JSON for the script.")
    try:
        value = json.loads(text[start:end + 1])
    except json.JSONDecodeError as e:
        raise DeepSeekError("DeepSeek returned invalid JSON for the script. Try generating it again.") from e
    if not isinstance(value, dict):
        raise DeepSeekError("DeepSeek did not return a script object.")
    return value


def extract_code(text: str) -> str:
    blocks = re.findall(r"```(?:python|py)?\s*\n(.*?)```", text, re.S)
    if blocks:
        code = max(blocks, key=len)
    elif "class ExplainerVideo" in text:
        code = text
    else:
        raise DeepSeekError("DeepSeek did not return any Python code.")
    return code.strip() + "\n"
