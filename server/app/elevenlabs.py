"""ElevenLabs text-to-speech with character timestamps, plus voice listing."""
from __future__ import annotations

import asyncio
import base64
import binascii
import json
import math

import httpx

BASE_URL = "https://api.elevenlabs.io"


class ElevenLabsError(Exception):
    pass


def _voice_settings(model_id: str, speed: float) -> dict:
    """Only send settings supported by the selected synthesis model."""
    if model_id == "eleven_v3":
        return {"stability": 0.5}
    if model_id in ("eleven_v4", "eleven_v4_turbo"):
        return {"stability": 0.5, "similarity_boost": 0.8}
    return {"stability": 0.45, "similarity_boost": 0.8, "style": 0.0,
            "use_speaker_boost": True, "speed": speed}


async def list_voices(api_key: str) -> list[dict]:
    voices: list[dict] = []
    token = None
    async with httpx.AsyncClient(base_url=BASE_URL, timeout=30) as client:
        for _ in range(5):  # up to 500 voices
            params = {"page_size": 100}
            if token:
                params["next_page_token"] = token
            try:
                resp = await client.get("/v2/voices", headers={"xi-api-key": api_key}, params=params)
            except httpx.TransportError as e:
                raise ElevenLabsError(f"Network error talking to ElevenLabs: {e}") from e
            if resp.status_code != 200:
                raise ElevenLabsError(_explain(resp.status_code, resp.text))
            data = resp.json()
            for v in data.get("voices", []):
                labels = v.get("labels") or {}
                voices.append({
                    "voice_id": v["voice_id"],
                    "name": v.get("name", v["voice_id"]),
                    "category": v.get("category"),
                    "preview_url": v.get("preview_url"),
                    "labels": {k: labels[k] for k in ("gender", "accent", "age", "descriptive", "use_case") if labels.get(k)},
                })
            token = data.get("next_page_token")
            if not data.get("has_more") or not token:
                break
    return voices


async def tts_with_timestamps(
    api_key: str,
    voice_id: str,
    text: str,
    *,
    model_id: str,
    previous_text: str | None = None,
    next_text: str | None = None,
    speed: float = 1.0,
) -> tuple[bytes, list[dict]]:
    """Synthesize `text`. Returns (mp3 bytes, word timings [{word, start, end}])."""
    body: dict = {
        "text": text,
        "model_id": model_id,
        "voice_settings": _voice_settings(model_id, speed),
    }
    if previous_text:
        body["previous_text"] = previous_text
    if next_text:
        body["next_text"] = next_text

    url = f"/v1/text-to-speech/{voice_id}/with-timestamps"
    params = {"output_format": "mp3_44100_128"}
    headers = {"xi-api-key": api_key, "Content-Type": "application/json"}

    async with httpx.AsyncClient(base_url=BASE_URL, timeout=httpx.Timeout(120, connect=20)) as client:
        for attempt in range(4):
            try:
                resp = await client.post(url, params=params, headers=headers, json=body)
            except (httpx.TransportError, httpx.TimeoutException) as e:
                if attempt < 3:
                    await asyncio.sleep(2 * (attempt + 1))
                    continue
                raise ElevenLabsError(f"Network error talking to ElevenLabs: {e}") from e
            if resp.status_code == 200:
                break
            if resp.status_code in (400, 422) and ("previous_text" in body or "next_text" in body):
                # Some models don't accept continuity context; retry without it.
                body.pop("previous_text", None)
                body.pop("next_text", None)
                continue
            if resp.status_code in (429, 500, 502, 503, 504) and attempt < 3:
                await asyncio.sleep(3 * (attempt + 1))
                continue
            raise ElevenLabsError(_explain(resp.status_code, resp.text))
        else:
            raise ElevenLabsError("ElevenLabs request failed repeatedly.")

    try:
        data = resp.json()
        audio = base64.b64decode(data["audio_base64"], validate=True)
        if not audio:
            raise ValueError("empty audio")
    except (ValueError, TypeError, KeyError, binascii.Error) as e:
        raise ElevenLabsError("ElevenLabs returned invalid or empty audio. Try generating it again.") from e
    words = _words_from_alignment(data.get("alignment"))
    if not words:
        words = _words_from_alignment(data.get("normalized_alignment"))
    return audio, words


def _words_from_alignment(al: dict | None) -> list[dict]:
    if not isinstance(al, dict):
        return []
    chars = al.get("characters") or []
    starts = al.get("character_start_times_seconds") or []
    ends = al.get("character_end_times_seconds") or []
    if not all(isinstance(values, list) for values in (chars, starts, ends)) or not len(chars) == len(starts) == len(ends):
        return []
    previous_start = 0.0
    for ch, start, end in zip(chars, starts, ends):
        if not isinstance(ch, str) or not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            return []
        if not math.isfinite(start) or not math.isfinite(end) or start < previous_start or end < start:
            return []
        previous_start = start
    words, cur, w_start, w_end = [], "", None, None
    for ch, s, e in zip(chars, starts, ends):
        if ch.isspace():
            if cur:
                words.append({"word": cur, "start": w_start, "end": w_end})
            cur, w_start = "", None
            continue
        if not cur:
            w_start = s
        cur += ch
        w_end = e
    if cur:
        words.append({"word": cur, "start": w_start, "end": w_end})
    return words


def _explain(status: int, text: str) -> str:
    detail = text
    error_code = ""
    try:
        d = json.loads(text).get("detail")
        if isinstance(d, dict):
            error_code = str(d.get("status") or "")
            detail = d.get("message") or d.get("status") or json.dumps(d)
        elif isinstance(d, list):
            detail = "; ".join(x.get("msg", str(x)) for x in d)
        elif d:
            detail = str(d)
    except Exception:
        pass
    detail = detail[:300]
    if status == 402 or "quota" in (error_code + " " + detail).lower():
        return f"ElevenLabs quota/plan limit reached: {detail}"
    if status == 401:
        return f"ElevenLabs rejected the API key (401): {detail}"
    if status == 404:
        return f"ElevenLabs voice not found (404). Pick another voice. {detail}"
    return f"ElevenLabs API error {status}: {detail}"
