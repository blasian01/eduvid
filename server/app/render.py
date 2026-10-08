"""Runs ManimGL (3b1b/manim) on generated scene files."""
from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Awaitable, Callable

RUNTIME_DIR = Path(__file__).parent / "manim_runtime"
MANIMGL = str(Path(sys.executable).parent / "manimgl")
SCENE_NAME = "ExplainerVideo"

RESOLUTIONS = {
    ("16:9", "480p"): (854, 480), ("16:9", "720p"): (1280, 720), ("16:9", "1080p"): (1920, 1080),
    ("9:16", "480p"): (540, 960), ("9:16", "720p"): (720, 1280), ("9:16", "1080p"): (1080, 1920),
}

_ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")
_NOISE = re.compile(r"pkg_resources|ApplePersistenceIgnoreState|import pkg_resources|it/s\]|\d+it \[")

# Generated code runs on your machine, so refuse anything that touches files, processes or the network.
_FORBIDDEN = [
    (r"\bimport\s+(os|sys|subprocess|shutil|socket|pathlib|glob|requests|httpx|urllib|ctypes|pickle)\b", "imports a system/network module"),
    (r"\bfrom\s+(os|sys|subprocess|shutil|socket|pathlib|glob|requests|httpx|urllib|ctypes|pickle)\b", "imports a system/network module"),
    (r"\b(os|sys|subprocess|shutil|socket)\s*\.", "uses os/sys/subprocess/shutil/socket"),
    (r"\b(open|eval|exec|compile|__import__|input|breakpoint)\s*\(", "calls open/eval/exec/__import__/input"),
    (r"\bimportlib\b|\bbuiltins\b|__builtins__|__subclasses__|__globals__", "uses Python internals"),
    (r"\b(SVGMobject|ImageMobject|TexturedSurface)\s*\(", "loads external image files"),
]


def lint_code(code: str) -> list[str]:
    problems = []
    for pattern, why in _FORBIDDEN:
        m = re.search(pattern, code)
        if m:
            problems.append(f"Forbidden: the code {why} (`{m.group(0)}`). Remove it; only manimlib/numpy drawing code is allowed.")
    if f"class {SCENE_NAME}" not in code:
        problems.append(f"Missing `class {SCENE_NAME}(EduScene)`.")
    if "from edu_prelude import" not in code:
        problems.append("Missing `from edu_prelude import *` (needed for EduScene).")
    return problems


def latex_available() -> bool:
    return bool(shutil.which("latex") and shutil.which("dvisvgm"))


_font_cache: str | None = None


def pick_font() -> str:
    global _font_cache
    if _font_cache is None:
        _font_cache = "Sans"
        try:
            import manimpango
            fonts = set(manimpango.list_fonts())
            for f in ("Avenir Next", "Helvetica Neue", "Inter", "Montserrat", "Segoe UI", "Ubuntu", "DejaVu Sans", "Arial"):
                if f in fonts:
                    _font_cache = f
                    break
        except Exception:
            pass
    return _font_cache


def write_config(job_dir: Path, aspect: str, quality: str, background: str) -> Path:
    w, h = RESOLUTIONS.get((aspect, quality), (1280, 720))
    cfg = job_dir / "manim_config.yml"
    cfg.write_text(
        "camera:\n"
        f"  resolution: ({w}, {h})\n"
        f'  background_color: "{background}"\n'
        "  fps: 30\n"
        "text:\n"
        f'  font: "{pick_font()}"\n'
        '  alignment: "LEFT"\n'
        "directories:\n"
        f'  base: "{job_dir}"\n'
    )
    return cfg


@dataclass
class RenderResult:
    ok: bool
    output: str = ""
    error: str = ""
    issues: list[str] = field(default_factory=list)
    final_time: float = 0.0
    path: Path | None = None


ProgressFn = Callable[[float], Awaitable[None]]


async def run_manim(
    job_dir: Path,
    scene_file: Path,
    *,
    beats: list[float],
    captions: list[dict] | None,
    caption_style: dict | None,
    dry_run: bool,
    timeout: float,
    on_progress: ProgressFn | None = None,
) -> RenderResult:
    out_dir = job_dir / ("dry" if dry_run else "render")
    shutil.rmtree(out_dir, ignore_errors=True)
    out_dir.mkdir(parents=True)
    layout_log = out_dir / "layout.json"

    env = dict(os.environ)
    env.update({
        "PYTHONPATH": str(RUNTIME_DIR),
        "PYTHONUNBUFFERED": "1",
        "EDUVID_BEATS": json.dumps(beats),
        "EDUVID_LAYOUT_LOG": str(layout_log),
        "EDUVID_CAPTIONS": json.dumps(captions or []),
        "EDUVID_CAPTION_STYLE": json.dumps(caption_style or {}),
    })
    args = [MANIMGL, str(scene_file), SCENE_NAME, "-w", "--config_file", str(job_dir / "manim_config.yml"),
            "--video_dir", str(out_dir), "--file_name", SCENE_NAME]
    if dry_run:
        args.insert(3, "-s")  # skip animations, save last frame: runs all code in ~seconds

    proc = await asyncio.create_subprocess_exec(
        *args, cwd=str(job_dir), env=env,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        start_new_session=True,
    )
    chunks: list[str] = []

    async def pump():
        assert proc.stdout
        buf = ""
        while True:
            data = await proc.stdout.read(4096)
            if not data:
                break
            text = data.decode(errors="replace")
            chunks.append(text)
            buf += text
            # Only parse complete markers: pipe reads can split a number mid-token.
            lines = re.split(r"[\r\n]", buf)
            buf = lines.pop()[-2000:]
            if on_progress:
                found = re.findall(r"EDUVID_PROGRESS (\d+(?:\.\d+)?)", "\n".join(lines))
                if found:
                    await on_progress(float(found[-1]))

    try:
        await asyncio.wait_for(asyncio.gather(pump(), proc.wait()), timeout=timeout)
    except asyncio.TimeoutError:
        _kill(proc)
        await proc.wait()
        return RenderResult(False, error=f"Rendering timed out after {int(timeout)} seconds "
                                         "(probably an infinite loop or very heavy updater).")
    except asyncio.CancelledError:
        _kill(proc)
        await proc.wait()
        raise

    output = _clean("".join(chunks))
    issues, final_time = [], 0.0
    if layout_log.exists():
        try:
            data = json.loads(layout_log.read_text())
            issues, final_time = data.get("issues", []), float(data.get("final_time", 0))
        except Exception:
            pass

    path = None
    for ext in ((".png",) if dry_run else (".mp4", ".mov")):
        cand = out_dir / f"{SCENE_NAME}{ext}"
        if cand.exists():
            path = cand
    failed = proc.returncode != 0 or "Traceback (most recent call last)" in output or path is None
    if failed:
        return RenderResult(False, output=output, error=_error_tail(output, scene_file.name), issues=issues)
    return RenderResult(True, output=output, issues=issues, final_time=final_time, path=path)


def _kill(proc: asyncio.subprocess.Process) -> None:
    try:
        os.killpg(proc.pid, 9)
    except Exception:
        try:
            proc.kill()
        except Exception:
            pass


def _clean(text: str) -> str:
    text = _ANSI.sub("", text).replace("\r", "\n")
    return "\n".join(l for l in text.splitlines() if l.strip() and not _NOISE.search(l) and "EDUVID_PROGRESS" not in l)


def _error_tail(output: str, scene_name: str) -> str:
    """The useful part of a traceback: from the first frame in the scene file to the end."""
    lines = output.splitlines()
    tb = next((i for i, l in enumerate(lines) if "Traceback (most recent call last)" in l), None)
    if tb is not None:
        lines = lines[tb:]
        first_scene = next((i for i, l in enumerate(lines) if scene_name in l), None)
        if first_scene is not None:
            lines = lines[:1] + lines[first_scene:]
    tail = "\n".join(lines[-45:])
    return tail or "Render failed without an error message."
