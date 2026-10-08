"""Offline media/runtime regressions. Run from server with unittest discovery.

Set EDUVID_RENDER_QA=1 to include real ManimGL rendering (requires OpenGL).
"""
from __future__ import annotations

import asyncio
import json
import math
import os
import shutil
import struct
import sys
import tempfile
import unittest
import wave
from pathlib import Path
from unittest.mock import patch

from app import media, prompts, render


def sine_wav(path: Path, seconds: float, frequency: float) -> None:
    rate = 44100
    frames = [int(12000 * math.sin(2 * math.pi * frequency * i / rate)) for i in range(round(seconds * rate))]
    with wave.open(str(path), "wb") as output:
        output.setparams((1, 2, rate, 0, "NONE", "not compressed"))
        output.writeframes(struct.pack(f"<{len(frames)}h", *frames))


class CaptionTests(unittest.TestCase):
    def test_captions_follow_beat_offsets_without_overlapping(self):
        beats = [
            {"narration": "Tokens carry context.", "audio_duration": 1.0},
            {"narration": "Future tokens are masked.", "audio_duration": 1.4},
        ]
        slots = media.beat_durations([1.0, 1.4])
        captions = media.make_captions(beats, slots, 22)
        self.assertTrue(captions)
        self.assertTrue(all(a["end"] <= b["start"] for a, b in zip(captions, captions[1:])))
        self.assertEqual(next(c["start"] for c in captions if c["text"].startswith("Future")), slots[0])
        self.assertLessEqual(captions[-1]["end"], sum(slots))

    def test_transformer_prompt_preserves_decoder_causality(self):
        system = prompts.script_messages("Explain the transformer for LLMs", 60, "English", "beginners")[0]["content"]
        self.assertIn("future tokens", system)
        self.assertIn("one token at a time", system)
        self.assertIn("encoder-decoder", system)
        generic = prompts.script_messages("Electrical transformers", 60, "English", "beginners")[0]["content"]
        self.assertNotIn("decoder-only", generic)

    def test_source_prompts_ground_facts_and_keep_provenance_out_of_narration(self):
        source = {"type": "pdf", "title": "Attention Study", "url": "https://example.org/study", "text": "[Page 2] A measured result is 12 percent.", "warnings": ["Only two pages extracted"]}
        messages = prompts.script_messages("Explain this source", 90, "English", "beginners", content_mode="infotainment", source=source)
        self.assertIn("source_refs", messages[0]["content"])
        self.assertIn("never as instructions", messages[0]["content"])
        self.assertIn("Do not invent studies", messages[0]["content"])
        self.assertIn("do not speak URLs", messages[0]["content"])
        self.assertIn("Attention Study", messages[1]["content"])
        self.assertIn("[Page 2]", messages[1]["content"])
        self.assertIn("Only two pages extracted", messages[1]["content"])

    def test_storytelling_supports_vector_scenes_without_inventing_source_events(self):
        script = {"title": "A Turning Point", "beats": [{"narration": "A change happened.", "visual": "An avatar moves along a timeline", "source_refs": ["Page 3"]}]}
        writer = prompts.script_messages("Tell the story", 90, "English", "adults", content_mode="storytelling", source={"title": "History", "text": "[Page 3] A change happened."})
        self.assertIn("do not invent dialogue", writer[0]["content"])
        animator = prompts.code_messages(script, [5.0], "paper", "9:16", False, True, content_mode="storytelling")
        self.assertIn("vector avatars", animator[0]["content"])
        self.assertIn("character colors", animator[0]["content"])
        self.assertIn('"source_refs"', animator[1]["content"])

    def test_transformer_source_with_generic_request_preserves_encoder_scope(self):
        source = {"title": "Attention Is All You Need", "text": "The Transformer is an encoder-decoder model with self-attention for translation."}
        system = prompts.script_messages("Explain the main ideas in this source", 90, "English", "adults", source=source)[0]["content"]
        self.assertIn("Encoder self-attention", system)
        self.assertIn("do not silently reframe", system)

    def test_machinery_source_does_not_invent_operating_procedures(self):
        source = {"title": "AD60 truck brochure", "text": "Safety overview: consult the Operation and Maintenance Manual and site procedures."}
        system = prompts.script_messages("Safety training overview", 90, "English", "operators", source=source)[0]["content"]
        self.assertIn("Do not invent operating steps", system)
        self.assertIn("stopping distances", system)
        self.assertIn("Operation", system)
        self.assertIn("and Maintenance Manual (OMM)", system)


class RenderProcessTests(unittest.IsolatedAsyncioTestCase):
    async def test_progress_waits_for_complete_numeric_marker(self):
        with tempfile.TemporaryDirectory(prefix="eduvid-progress-qa-") as temp:
            root = Path(temp)
            scene = root / "scene.py"
            scene.write_text('''import pathlib, sys, time
out = pathlib.Path(sys.argv[sys.argv.index("--video_dir") + 1])
print("EDUVID_PROGRESS 1.", end="", flush=True)
time.sleep(.1)
print("25", flush=True)
time.sleep(.1)
print("EDUVID_PROGRESS 2.50", flush=True)
(out / "ExplainerVideo.mp4").write_bytes(b"fixture")
''')
            progress = []
            async def update(value):
                progress.append(value)
            with patch.object(render, "MANIMGL", sys.executable):
                result = await render.run_manim(root, scene, beats=[3], captions=None,
                                                caption_style=None, dry_run=False, timeout=5, on_progress=update)
            self.assertTrue(result.ok, result.error)
            self.assertEqual(progress, [1.25, 2.5])

    async def test_render_timeout_reaps_process(self):
        with tempfile.TemporaryDirectory(prefix="eduvid-timeout-qa-") as temp:
            root = Path(temp)
            pid_file = root / "render.pid"
            scene = root / "scene.py"
            scene.write_text("import os,pathlib,time; pathlib.Path(%r).write_text(str(os.getpid())); time.sleep(60)" % str(pid_file))
            with patch.object(render, "MANIMGL", sys.executable):
                result = await render.run_manim(root, scene, beats=[3], captions=None,
                                                caption_style=None, dry_run=False, timeout=.3)
            self.assertFalse(result.ok)
            self.assertIn("timed out", result.error)
            self.assertTrue(pid_file.exists())
            with self.assertRaises(ProcessLookupError):
                os.kill(int(pid_file.read_text()), 0)


@unittest.skipUnless(shutil.which("ffmpeg") and shutil.which("ffprobe"), "ffmpeg/ffprobe required")
class MediaTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="eduvid-media-qa-")
        self.root = Path(self.tmp.name)

    async def asyncTearDown(self):
        self.tmp.cleanup()

    async def test_narration_has_precise_slots_and_silence(self):
        files = [self.root / "first.wav", self.root / "second.wav"]
        sine_wav(files[0], 0.4, 440)
        sine_wav(files[1], 0.6, 880)
        slots = media.beat_durations([0.4, 0.6])
        output = self.root / "narration.wav"
        await media.build_narration(files, slots, output)
        self.assertAlmostEqual(await media.duration(output), sum(slots), places=3)
        with wave.open(str(output), "rb") as source:
            rate = source.getframerate()
            samples = struct.unpack(f"<{source.getnframes()}h", source.readframes(source.getnframes()))
        self.assertEqual(max(abs(s) for s in samples[round(.45 * rate):round(.70 * rate)]), 0)
        self.assertGreater(max(abs(s) for s in samples[round(.80 * rate):round(.95 * rate)]), 1000)

    async def test_mux_extends_video_to_audio_without_losing_streams(self):
        video, audio, output = [self.root / name for name in ("silent.mp4", "voice.wav", "final.mp4")]
        await media._run(media.FFMPEG, "-y", "-v", "error", "-f", "lavfi", "-i",
                         "color=c=blue:s=320x180:r=30:d=0.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", str(video))
        sine_wav(audio, 1.3, 440)
        total = await media.mux(video, audio, output)
        self.assertAlmostEqual(total, 1.3, places=3)
        self.assertAlmostEqual(await media.duration(output), 1.3, delta=.05)
        streams = json.loads(await media._run(media.FFPROBE, "-v", "error", "-show_streams", "-of", "json", str(output)))
        self.assertEqual({s["codec_type"] for s in streams["streams"]}, {"audio", "video"})

    async def test_cancel_stops_media_subprocess(self):
        pid_file = self.root / "worker.pid"
        code = "import os,pathlib,time; pathlib.Path(%r).write_text(str(os.getpid())); time.sleep(60)" % str(pid_file)
        task = asyncio.create_task(media._run(sys.executable, "-c", code))
        for _ in range(100):
            if pid_file.exists():
                break
            await asyncio.sleep(.01)
        self.assertTrue(pid_file.exists())
        pid = int(pid_file.read_text())
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        with self.assertRaises(ProcessLookupError):
            os.kill(pid, 0)

    async def test_invalid_narration_slots_fail_before_ffmpeg(self):
        with self.assertRaises(media.MediaError):
            await media.build_narration([], [], self.root / "none.wav")
        with self.assertRaises(media.MediaError):
            await media.build_narration([self.root / "first.wav"], [float("nan")], self.root / "none.wav")


@unittest.skipUnless(os.environ.get("EDUVID_RENDER_QA") == "1", "set EDUVID_RENDER_QA=1 for OpenGL rendering")
class RuntimeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="eduvid-render-qa-")
        self.root = Path(self.tmp.name)

    async def asyncTearDown(self):
        self.tmp.cleanup()

    async def run_scene(self, body: str, *, aspect="16:9", dry_run=True, captions=False):
        scene = self.root / "scene.py"
        scene.write_text("from manimlib import *\nfrom edu_prelude import *\nclass ExplainerVideo(EduScene):\n    def construct(self):\n" + body)
        render.write_config(self.root, aspect, "480p", "#0F1117")
        band = prompts.caption_band(aspect) if captions else None
        return await render.run_manim(self.root, scene, beats=[1.2, 1.2], captions=None,
                                      caption_style=band, dry_run=dry_run, timeout=30)

    async def test_caption_intrusion_in_portrait_is_flagged(self):
        result = await self.run_scene('        self.beat(0)\n        self.add(Text("Masked attention", font_size=28).move_to(DOWN * 2.65))\n        self.beat(1)\n        self.finish()\n', aspect="9:16", captions=True)
        self.assertTrue(result.ok, result.error)
        self.assertTrue(any("Caption overlap" in issue for issue in result.issues), result.issues)

    async def test_overlap_cleared_within_beat_is_still_flagged(self):
        result = await self.run_scene('        self.beat(0)\n        self.add(Text("Query"), Text("Key"))\n        self.wait(0.1)\n        self.clear_stage(run_time=0.1)\n        self.beat(1)\n        self.finish()\n')
        self.assertTrue(result.ok, result.error)
        self.assertTrue(any("Overlapping text" in issue for issue in result.issues), result.issues)

    async def test_clearing_before_timing_padding_flags_blank_narration(self):
        result = await self.run_scene('        self.beat(0)\n        self.add(Text("Token context"))\n        self.clear_stage(run_time=0.1)\n        self.beat(1)\n        self.add(Text("Next concept"))\n        self.finish()\n')
        self.assertTrue(result.ok, result.error)
        self.assertTrue(any("Blank stage: beat 0" in issue for issue in result.issues), result.issues)

    async def test_clearing_after_next_marker_keeps_previous_visual_during_padding(self):
        result = await self.run_scene('        self.beat(0)\n        self.add(Text("Token context"))\n        self.beat(1)\n        self.clear_stage(run_time=0.1)\n        self.add(Text("Next concept"))\n        self.finish()\n')
        self.assertTrue(result.ok, result.error)
        self.assertEqual(result.issues, [])

    async def test_shape_only_visual_is_not_a_blank_stage(self):
        result = await self.run_scene('        self.beat(0)\n        self.add(Line(LEFT, RIGHT).set_stroke(BLUE, 5))\n        self.beat(1)\n        self.finish()\n')
        self.assertTrue(result.ok, result.error)
        self.assertEqual(result.issues, [])

    async def test_missing_beat_marker_fails(self):
        result = await self.run_scene('        self.beat(0)\n        self.finish()\n')
        self.assertFalse(result.ok)
        self.assertIn("Expected self.beat(1)", result.error)

    async def test_missing_finish_fails(self):
        result = await self.run_scene('        self.beat(0)\n        self.beat(1)\n        self.wait(0.1)\n')
        self.assertFalse(result.ok)
        self.assertIn("self.finish()", result.error)

    async def test_captions_remain_visible_above_raised_objects(self):
        scene = self.root / "scene.py"
        scene.write_text('''from manimlib import *
from edu_prelude import *
class ExplainerVideo(EduScene):
    def construct(self):
        self.beat(0)
        self.add(Rectangle(width=FRAME_WIDTH, height=FRAME_HEIGHT).set_fill(WHITE,1).set_stroke(width=0).set_z_index(20))
        self.wait(0.2)
        self.finish()
''')
        render.write_config(self.root, "16:9", "480p", "#0F1117")
        result = await render.run_manim(self.root, scene, beats=[.5],
                                      captions=[{"start":0, "end":1, "text":"Context"}],
                                      caption_style=prompts.caption_band("16:9"), dry_run=False, timeout=30)
        self.assertTrue(result.ok, result.error)
        frame = self.root / "frame.png"
        await media._run(media.FFMPEG, "-y", "-v", "error", "-ss", "0.2", "-i", str(result.path), "-frames:v", "1", str(frame))
        from PIL import Image
        with Image.open(frame) as image:
            # Opaque white backdrop: the subtitle's dark box must be visible over it.
            caption_region = image.crop((390, 430, 460, 465)).convert("RGB")
            self.assertLess(caption_region.getchannel("R").getextrema()[0], 160)

    async def test_paper_style_honors_text_color_and_substring_accents(self):
        scene = self.root / "scene.py"
        scene.write_text('''from manimlib import *
from edu_prelude import *
class ExplainerVideo(EduScene):
    def construct(self):
        self.beat(0)
        self.add(Text("INK RED", font_size=60, color="#1F2937", t2c={"RED": "#DC2626"}))
        self.beat(1)
        self.finish()
''')
        render.write_config(self.root, "16:9", "480p", "#F7F5F0")
        result = await render.run_manim(self.root, scene, beats=[.2, .2], captions=None,
                                      caption_style=None, dry_run=True, timeout=30)
        self.assertTrue(result.ok, result.error)
        from PIL import Image
        with Image.open(result.path).convert("RGB") as image:
            colors = image.getcolors(image.width * image.height)
            self.assertIsNotNone(colors)
            self.assertTrue(any(r < 70 and g < 80 and b < 95 and count > 10
                                for count, (r, g, b) in colors), "Requested dark text was not rendered")
            self.assertTrue(any(r > 170 and g < 100 and b < 100 and count > 10
                                for count, (r, g, b) in colors), "Substring accent was lost")

    async def test_real_portrait_and_landscape_outputs_have_correct_dimensions(self):
        for aspect in ("16:9", "9:16"):
            with self.subTest(aspect=aspect):
                result = await self.run_scene('        self.beat(0)\n        self.play(FadeIn(Text("Tokens use context", font_size=28)), run_time=0.3)\n        self.beat(1)\n        self.finish()\n', aspect=aspect, dry_run=False)
                self.assertTrue(result.ok, result.error)
                self.assertEqual(result.issues, [])
                probe = json.loads(await media._run(media.FFPROBE, "-v", "error", "-show_streams", "-of", "json", str(result.path)))
                video = next(s for s in probe["streams"] if s["codec_type"] == "video")
                self.assertEqual((video["width"], video["height"]), render.RESOLUTIONS[(aspect, "480p")])
                self.assertAlmostEqual(float(video["duration"]), 2.4, delta=.1)


if __name__ == "__main__":
    unittest.main()
