"""ffmpeg/ffprobe helpers: narration assembly, captions, final mux."""
from __future__ import annotations

import asyncio
import math
import os
import re
import shutil
from pathlib import Path

FFMPEG = shutil.which("ffmpeg") or "ffmpeg"
FFPROBE = shutil.which("ffprobe") or "ffprobe"

BEAT_GAP = 0.35   # breathing room after each narration beat (seconds)
END_HOLD = 1.2    # hold on the final frame after the last word


class MediaError(Exception):
    pass


async def _run(*args: str) -> str:
    proc = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        start_new_session=True,
    )
    try:
        out, _ = await proc.communicate()
    except asyncio.CancelledError:
        # Cancelling a job must also stop ffmpeg, which may still be writing its output.
        try:
            os.killpg(proc.pid, 9)
        except ProcessLookupError:
            pass
        await proc.wait()
        raise
    text = out.decode(errors="replace")
    if proc.returncode != 0:
        raise MediaError(f"{Path(args[0]).name} failed: {text[-1500:]}")
    return text


async def duration(path: Path) -> float:
    out = await _run(FFPROBE, "-v", "error", "-show_entries", "format=duration",
                     "-of", "default=noprint_wrappers=1:nokey=1", str(path))
    try:
        value = float(out.strip().splitlines()[-1])
    except (ValueError, IndexError) as e:
        raise MediaError(f"Could not read the duration of {path.name}.") from e
    if not math.isfinite(value) or value <= 0:
        raise MediaError(f"Invalid duration for {path.name}: {value}.")
    return value


def beat_durations(audio_durations: list[float]) -> list[float]:
    """Slot length for each beat: its audio plus a pause (longer hold at the end)."""
    n = len(audio_durations)
    return [round(d + (END_HOLD if i == n - 1 else BEAT_GAP), 3) for i, d in enumerate(audio_durations)]


async def build_narration(beat_files: list[Path], slots: list[float], out: Path) -> None:
    """Concatenate per-beat audio, padding each to its slot length so beats start on cue."""
    if not beat_files or len(beat_files) != len(slots):
        raise MediaError("Each narration beat needs one audio file and one timing slot.")
    if any(not math.isfinite(slot) or slot <= 0 for slot in slots):
        raise MediaError("Narration timing slots must be positive finite durations.")
    args = [FFMPEG, "-y", "-v", "error"]
    for f in beat_files:
        args += ["-i", str(f)]
    parts = []
    for i, slot in enumerate(slots):
        parts.append(f"[{i}:a]aresample=44100,aformat=channel_layouts=mono,apad=whole_dur={slot:.3f},"
                     f"atrim=0:{slot:.3f}[a{i}]")
    chain = ";".join(parts) + ";" + "".join(f"[a{i}]" for i in range(len(slots)))
    chain += f"concat=n={len(slots)}:v=0:a=1[out]"
    args += ["-filter_complex", chain, "-map", "[out]", "-c:a", "pcm_s16le", str(out)]
    await _run(*args)


def make_captions(beats: list[dict], slots: list[float], max_chars: int) -> list[dict]:
    """Short caption chunks with absolute timings, built from per-word timestamps."""
    captions = []
    offset = 0.0
    for beat, slot in zip(beats, slots):
        words = beat.get("words") or _estimate_words(beat["narration"], beat["audio_duration"])
        chunk: list[dict] = []

        def flush():
            if chunk:
                captions.append({
                    "start": round(offset + chunk[0]["start"], 3),
                    "end": round(offset + chunk[-1]["end"], 3),
                    "text": " ".join(w["word"] for w in chunk),
                })
                chunk.clear()

        for w in words:
            projected = len(" ".join(x["word"] for x in chunk + [w]))
            if chunk and projected > max_chars:
                flush()
            chunk.append(w)
            if re.search(r"[.!?;:]$", w["word"]) or (re.search(r",$", w["word"]) and projected > max_chars * 0.6):
                flush()
        flush()
        offset += slot

    # Let each caption linger until the next one starts (max 0.6s extra) to avoid flicker
    for a, b in zip(captions, captions[1:]):
        a["end"] = round(min(b["start"], a["end"] + 0.6), 3)
    if captions:
        captions[-1]["end"] = round(captions[-1]["end"] + 0.6, 3)
    return captions


def _estimate_words(text: str, dur: float) -> list[dict]:
    tokens = text.split()
    total = sum(len(t) + 1 for t in tokens) or 1
    t, words = 0.0, []
    for tok in tokens:
        d = dur * (len(tok) + 1) / total
        words.append({"word": tok, "start": t, "end": t + d})
        t += d
    return words


def write_srt(captions: list[dict], out: Path) -> None:
    def ts(x: float) -> str:
        ms = int(round(x * 1000))
        h, ms = divmod(ms, 3_600_000)
        m, ms = divmod(ms, 60_000)
        s, ms = divmod(ms, 1000)
        return f"{h:02}:{m:02}:{s:02},{ms:03}"

    lines = []
    for i, c in enumerate(captions, 1):
        lines += [str(i), f"{ts(c['start'])} --> {ts(c['end'])}", c["text"], ""]
    out.write_text("\n".join(lines))


async def mux(video: Path, audio: Path, out: Path) -> float:
    """Combine rendered video and narration. Extends whichever is shorter. Returns duration."""
    v, a = await duration(video), await duration(audio)
    total = max(v, a)
    args = [FFMPEG, "-y", "-v", "error", "-i", str(video), "-i", str(audio)]
    if a > v + 0.05:
        args += ["-filter_complex",
                 f"[0:v]tpad=stop_mode=clone:stop_duration={a - v + 0.1:.3f}[v];[1:a]apad[a]",
                 "-map", "[v]", "-map", "[a]",
                 "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p"]
    else:
        args += ["-filter_complex", "[1:a]apad[a]", "-map", "0:v", "-map", "[a]", "-c:v", "copy"]
    args += ["-t", f"{total:.3f}", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out)]
    await _run(*args)
    return total


async def thumbnail(video: Path, at: float, out: Path) -> None:
    await _run(FFMPEG, "-y", "-v", "error", "-ss", f"{at:.2f}", "-i", str(video),
               "-frames:v", "1", "-vf", "scale=640:-2", str(out))
