"""Offline pipeline smoke test: real local speech, ManimGL, ffmpeg and captions.

Run from server/: .venv/bin/python tests/smoke_transformer.py --aspect 16:9
Provider responses are controlled fixtures, so this does NOT validate DeepSeek
or ElevenLabs service quality. Uses macOS's installed Samantha speech voice.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import media, pipeline

SCRIPT = {
    "title": "QA fixture: Transformers for LLMs",
    "beats": [
        {"narration": "How does a language model choose the next word? Many use a transformer, a network that builds context from a sequence of tokens.", "visual": "Reveal token boxes, then a question mark for the next token."},
        {"narration": "Tokens can be words or pieces of words. Each becomes a vector of numbers, with position information so the model can distinguish different orders.", "visual": "Transform token boxes into colored vector cells and add position labels."},
        {"narration": "Self attention compares queries with keys, then mixes values using weighted sums. A causal mask prevents each position from seeing future tokens.", "visual": "Draw attention links to earlier tokens, and cross out the future token."},
        {"narration": "Multiple attention heads learn different patterns in parallel. Their outputs combine, helping each token representation incorporate useful context.", "visual": "Show three parallel heads flowing into a combined representation."},
        {"narration": "Stacked attention and feed forward layers refine these representations. Residual connections and normalization help the information travel through the network.", "visual": "Build stacked attention and feed forward blocks with a residual path."},
        {"narration": "Finally, the model produces probabilities for the next token. It selects one, adds it to the sequence, and repeats. Learned patterns guide generation, without guaranteeing truth.", "visual": "Grow next-token probability bars and append the chosen token."},
    ],
}

SCENE = '''from manimlib import *
from edu_prelude import *

class ExplainerVideo(EduScene):
    def construct(self):
        narrow = FRAME_WIDTH < 8
        width = min(FRAME_WIDTH - 0.8, 10)
        def title(text):
            return Text(text, font_size=38 if narrow else 48).move_to(UP * 2.8)
        def box(text, color=BLUE_C):
            rect = RoundedRectangle(width=0.85 if narrow else 1.6, height=0.65, corner_radius=0.1)
            rect.set_stroke(color, 2).set_fill(color, 0.15)
            label = Text(text, font_size=24 if narrow else 32)
            if label.get_width() > rect.get_width() - 0.15:
                label.set_width(rect.get_width() - 0.15)
            return VGroup(rect, label)
        self.beat(0)
        heading = title("Transformers")
        self.play(Write(heading), run_time=1)
        tokens = VGroup(*(box(t) for t in ["The", "cat", "sat", "?"])).arrange(RIGHT, buff=0.15 if narrow else 0.4)
        self.play(LaggedStart(*(FadeIn(t) for t in tokens), lag_ratio=0.3), run_time=2)
        self.wait(1)
        self.play(Indicate(tokens[-1], color=YELLOW), run_time=1.5)
        self.beat(1)
        self.clear_stage()
        self.play(Write(title("Tokens + position")), run_time=1)
        groups = VGroup()
        for i in range(3):
            cells = VGroup(*(Square(side_length=0.3).set_stroke(BLUE_C, 1).set_fill([BLUE_C, TEAL, YELLOW][j], 0.4) for j in range(3))).arrange(DOWN, buff=0.08)
            label = Text(str(i + 1), font_size=26).next_to(cells, DOWN, buff=0.3)
            groups.add(VGroup(cells, label))
        groups.arrange(RIGHT, buff=0.55 if narrow else 1.5)
        self.play(LaggedStart(*(FadeIn(g) for g in groups), lag_ratio=0.4), run_time=3)
        self.play(groups.animate.shift(UP * 0.3), run_time=2)
        self.beat(2)
        self.clear_stage()
        self.play(Write(title("Causal attention")), run_time=1)
        tokens = VGroup(*(box(t) for t in ["The", "cat", "sat", "?"])).arrange(RIGHT, buff=0.15 if narrow else 0.4).shift(DOWN * 0.6)
        self.play(FadeIn(tokens), run_time=1)
        links = VGroup(*(CurvedArrow(tokens[2].get_top(), tokens[i].get_top(), angle=-PI/2).set_color(YELLOW) for i in [0, 1]))
        self.play(LaggedStart(*(ShowCreation(a) for a in links), lag_ratio=0.4), run_time=2.5)
        future = Cross(tokens[3]).set_stroke(RED_C, 4)
        self.play(ShowCreation(future), run_time=1)
        self.beat(3)
        self.clear_stage()
        self.play(Write(title("Multiple heads")), run_time=1)
        heads = VGroup(*(box(str(i+1), color) for i, color in enumerate([BLUE_C, TEAL, YELLOW]))).arrange(RIGHT, buff=0.35 if narrow else 1).shift(UP * 0.5)
        self.play(LaggedStart(*(FadeIn(h) for h in heads), lag_ratio=0.3), run_time=2)
        combined = box("Context", GREEN).move_to(DOWN * 1)
        arrows = VGroup(*(Arrow(h.get_bottom(), combined.get_top(), buff=0.15, thickness=3, fill_color=GREEN) for h in heads))
        self.play(*(GrowArrow(a) for a in arrows), run_time=2)
        self.play(FadeIn(combined), run_time=1)
        self.beat(4)
        self.clear_stage()
        self.play(Write(title("Stacked layers")), run_time=1)
        layers = VGroup()
        for text, color in [("Attention", BLUE_C), ("Feed forward", TEAL), ("Attention", BLUE_C), ("Feed forward", TEAL)]:
            rect = RoundedRectangle(width=min(width - 0.9, 4), height=0.58, corner_radius=0.08).set_stroke(color, 2).set_fill(color, 0.15)
            label = Text(text, font_size=24 if narrow else 30)
            layers.add(VGroup(rect, label))
        layers.arrange(DOWN, buff=0.2).move_to(UP * 0.3)
        self.play(LaggedStart(*(FadeIn(l) for l in layers), lag_ratio=0.35), run_time=3)
        path = Line(layers.get_corner(DR) + RIGHT * 0.2, layers.get_corner(UR) + RIGHT * 0.2).set_stroke(YELLOW, 3)
        self.play(ShowCreation(path), run_time=2)
        self.beat(5)
        self.clear_stage()
        self.play(Write(title("Predict + repeat")), run_time=1)
        bars = VGroup()
        for word, value, color in [("on", 1.5, GREEN), ("near", 0.8, BLUE_C), ("by", 0.4, TEAL)]:
            rect = Rectangle(width=0.5, height=value).set_stroke(color, 2).set_fill(color, 0.5)
            label = Text(word, font_size=24).next_to(rect, DOWN, buff=0.25)
            bars.add(VGroup(rect, label))
        bars.arrange(RIGHT, buff=0.6 if narrow else 1.1, aligned_edge=DOWN).move_to(UP * 0.6)
        self.play(LaggedStart(*(GrowFromEdge(b[0], DOWN) for b in bars), lag_ratio=0.3), run_time=2.5)
        self.play(*(FadeIn(b[1]) for b in bars), run_time=1)
        self.play(Indicate(bars[0], color=YELLOW), run_time=1.5)
        takeaway = Text("Patterns, not certainty", font_size=25 if narrow else 34).move_to(DOWN * 1.25)
        self.play(Write(takeaway), run_time=1.5)
        self.finish()
'''


async def main(aspect: str, quality: str) -> None:
    manager = pipeline.JobManager()
    cache = Path(__file__).resolve().parents[1] / "jobs" / "qa-local-speech"
    cache.mkdir(exist_ok=True)

    async def chat(*args, **kwargs):
        return json.dumps(SCRIPT) if kwargs.get("json_mode") else SCENE

    async def tts(key, voice, text, **kwargs):
        index = next(i for i, b in enumerate(SCRIPT["beats"]) if b["narration"] == text)
        aiff, mp3 = cache / f"beat_{index}.aiff", cache / f"beat_{index}.mp3"
        if not mp3.exists():
            proc = await asyncio.create_subprocess_exec("say", "-v", "Samantha", "-r", "155", "-o", str(aiff), text)
            if await proc.wait():
                raise RuntimeError("Local speech synthesis failed")
            await media._run(media.FFMPEG, "-y", "-v", "error", "-i", str(aiff), "-c:a", "libmp3lame", str(mp3))
        return mp3.read_bytes(), []

    with patch.object(pipeline.deepseek, "chat", chat), patch.object(pipeline.elevenlabs, "tts_with_timestamps", tts):
        job = manager.create(
            "OFFLINE QA FIXTURE: Explain the transformer used in autoregressive LLMs; tokens, position, causal self-attention, multiple heads, stacked layers and next-token probabilities.",
            {"aspect": aspect, "quality": quality, "voice_name": "Local Samantha fixture"},
            {"deepseek": "offline-fixture", "elevenlabs": "offline-fixture"},
        )
        print("JOB", job.id, flush=True)
        await job.task
        print(json.dumps({"id": job.id, "status": job.data["status"], "duration": job.data.get("duration"), "error": job.data.get("error"), "logs": job.data["logs"], "path": str(job.dir / "final.mp4")}, indent=2))
        if job.data["status"] != "done":
            raise SystemExit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--aspect", choices=["16:9", "9:16"], default="16:9")
    parser.add_argument("--quality", choices=["480p", "720p", "1080p"], default="480p")
    options = parser.parse_args()
    asyncio.run(main(options.aspect, options.quality))
