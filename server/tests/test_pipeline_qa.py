"""Offline regression coverage for job lifecycle, validation and provider failures."""
from __future__ import annotations

import asyncio
import base64
import importlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

from app import deepseek, elevenlabs, pipeline, render

# Scratch space for per-test temp dirs, inside the repo and git-ignored.
WORK = Path(__file__).resolve().parent / ".work"
WORK.mkdir(exist_ok=True)


class PipelineQA(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        WORK.mkdir(parents=True, exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(dir=WORK)
        self.jobs_patch = patch.object(pipeline, "JOBS_DIR", Path(self.tmp.name))
        self.jobs_patch.start()
        # Existing provider/lifecycle tests isolate the newly added local renderer
        # dependency; dedicated Remotion tests verify browser preflight behavior.
        self.browser_patch = patch.object(pipeline.remotion, "ensure_browser", AsyncMock())
        self.available_patch = patch.object(pipeline.remotion, "ensure_available")
        self.browser_patch.start()
        self.available_patch.start()
        self.manager = pipeline.JobManager()

    async def asyncTearDown(self):
        tasks = [job.task for job in self.manager.jobs.values() if job.task and not job.task.done()]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self.jobs_patch.stop()
        self.browser_patch.stop()
        self.available_patch.stop()
        self.tmp.cleanup()

    def make_job(self, beats=None):
        job = pipeline.Job({
            "id": "qa-transformer", "created_at": 1.0, "prompt": "How transformers power LLMs",
            "settings": dict(pipeline.DEFAULT_SETTINGS), "status": "queued", "logs": [],
            "script": {"title": "Transformers", "beats": beats or [
                {"narration": "Attention compares tokens.", "visual": "Token links", "audio_duration": 1.0}
            ]},
            "slots": [2.2], "captions": [],
            "steps": [{"key": key, "label": label, "status": "pending", "detail": "", "progress": 0}
                      for key, label in pipeline.STEPS],
        })
        job.save()
        self.manager.jobs[job.id] = job
        return job

    def make_source(self):
        return {
            "id": "1234567890abcdef1234567890abcdef", "type": "article", "title": "Attention paper",
            "text": "PRIVATE_ARTICLE_SENTINEL: attention mixes values using query and key scores.",
            "url": None, "excerpt": "Attention paper overview", "warnings": [], "text_chars": 85, "word_count": 12,
        }

    async def test_delete_running_job_does_not_recreate_directory(self):
        async def hold(job, keys):
            await asyncio.Event().wait()
        with patch.object(pipeline, "run_full", hold):
            job = self.manager.create("How transformers power LLMs", {}, {})
            await asyncio.sleep(0)
            self.manager.delete(job)
            await job.task
            self.assertFalse(job.dir.exists())
            self.assertIsNone(self.manager.get(job.id))

    async def test_cancel_before_task_starts_persists_cancelled_state(self):
        runner = AsyncMock()
        with patch.object(pipeline, "run_full", runner):
            job = self.manager.create("How transformers power LLMs", {}, {})
            self.manager.cancel(job)
            await asyncio.gather(job.task, return_exceptions=True)
        self.assertEqual(job.data["status"], "cancelled")
        self.assertEqual(json.loads((job.dir / "job.json").read_text())["status"], "cancelled")
        runner.assert_not_called()

    async def test_successful_job_reaches_done(self):
        with patch.object(pipeline, "run_full", AsyncMock()):
            job = self.manager.create("How transformers power LLMs", {}, {})
            await job.task
        self.assertEqual(job.data["status"], "done")
        self.assertEqual(job.data["stage"], "done")

    async def test_each_accepted_run_persists_its_own_start_without_resetting_creation_or_logs(self):
        with patch.object(pipeline.time, "time", return_value=100), patch.object(pipeline, "run_full", AsyncMock()):
            job = self.manager.create("How transformers power LLMs", {}, {})
            await job.task
        self.assertEqual(job.data["created_at"], 100)
        self.assertEqual(pipeline.public_job(job)["run_started_at"], 100)
        (job.dir / "narration.wav").write_bytes(b"saved narration")
        (job.dir / "scene.py").write_text("saved animation")
        job.data["manim_style"] = "classic"
        old_logs = list(job.data["logs"])
        with patch.object(pipeline.time, "time", return_value=200), patch.object(pipeline, "run_rerender", AsyncMock()):
            self.manager.rerender(job, {}, None, False, None)
            self.assertEqual(job.data["run_started_at"], 200)
            self.assertEqual(job.data["created_at"], 100)
            self.assertEqual(job.data["logs"], old_logs)
            self.assertEqual(json.loads((job.dir / "job.json").read_text())["run_started_at"], 200)
            await job.task
        audio = job.dir / "audio"
        audio.mkdir()
        job.data["script"] = {"title": "Transformers", "beats": [{"narration": "Attention compares tokens."}]}
        (audio / "beat_00.mp3").write_bytes(b"saved clip")
        job.data["status"] = "error"
        old_logs = list(job.data["logs"])
        with patch.object(pipeline.time, "time", return_value=300), patch.object(pipeline, "run_resume", AsyncMock()):
            self.manager.resume(job, {})
            self.assertEqual(job.data["run_started_at"], 300)
            self.assertEqual(job.data["created_at"], 100)
            self.assertEqual(job.data["logs"][:len(old_logs)], old_logs)
            self.assertEqual(json.loads((job.dir / "job.json").read_text())["run_started_at"], 300)
            await job.task

    async def test_rejected_rerender_does_not_reset_run_timer(self):
        job = self.make_job()
        job.data["run_started_at"] = 1
        (job.dir / "narration.wav").touch()
        with self.assertRaises(ValueError):
            self.manager.rerender(job, {}, " ", False, None)
        self.assertEqual(job.data["run_started_at"], 1)

    async def test_failed_job_exposes_error_and_marks_active_step(self):
        async def fail(job, keys):
            job.step("voice", "active", "Recorded 2/5 lines")
            raise elevenlabs.ElevenLabsError("Quota exhausted")
        with patch.object(pipeline, "run_full", fail):
            job = self.manager.create("How transformers power LLMs", {}, {})
            await job.task
        self.assertEqual(job.data["status"], "error")
        self.assertEqual(job.data["error"], "Quota exhausted")
        voice = next(step for step in job.data["steps"] if step["key"] == "voice")
        self.assertEqual(voice["status"], "error")
        self.assertEqual(voice["detail"], "Failed — see the error below", "in-progress text must not linger")

    async def test_cancelled_and_interrupted_steps_do_not_keep_in_progress_text(self):
        started = asyncio.Event()
        async def hang(job, keys):
            job.step("script", "active", "Asking deepseek-flash for a 60s script…")
            started.set()
            await asyncio.Event().wait()
        with patch.object(pipeline, "run_full", hang):
            job = self.manager.create("How transformers power LLMs", {}, {})
            await started.wait()
            self.manager.cancel(job)
            await asyncio.gather(job.task, return_exceptions=True)
        self.assertEqual(next(s for s in job.data["steps"] if s["key"] == "script")["detail"], "Cancelled")

        # A job left "running" on disk is shown as interrupted after a restart.
        data = json.loads((job.dir / "job.json").read_text())
        data["status"] = "running"
        next(s for s in data["steps"] if s["key"] == "script").update(status="active", detail="Asking…")
        (job.dir / "job.json").write_text(json.dumps(data))
        reloaded = pipeline.JobManager().get(job.id)
        script = next(s for s in reloaded.data["steps"] if s["key"] == "script")
        self.assertEqual((reloaded.data["status"], script["status"], script["detail"]),
                         ("error", "error", "Interrupted by a server restart"))

    async def test_invalid_settings_rejected_before_scheduling(self):
        for settings in ({"seconds": "banana"}, {"aspect": {}}, {"quality": "4K"}, {"style": "missing"},
                         {"speed": float("nan")}, {"speed": 4}, {"captions": "false"}, {"voice_id": "   "}):
            with self.subTest(settings=settings), self.assertRaises(ValueError):
                self.manager.create("How transformers power LLMs", settings, {})
        self.assertEqual(list(Path(self.tmp.name).iterdir()), [])

    async def test_blank_prompt_rejected_before_scheduling(self):
        with self.assertRaises(ValueError):
            self.manager.create("    ", {}, {})

    async def test_unknown_settings_are_not_persisted(self):
        with patch.object(pipeline, "run_full", AsyncMock()):
            job = self.manager.create("How transformers power LLMs", {"extra": "value", "seconds": "60"}, {})
            await job.task
        self.assertNotIn("extra", job.data["settings"])
        self.assertEqual(job.data["settings"]["seconds"], 60)

    async def test_rerender_validates_without_mutating_completed_job(self):
        job = self.make_job()
        job.data["status"] = "done"
        (job.dir / "narration.wav").touch()
        (job.dir / "scene.py").write_text("working code")
        with self.assertRaises(ValueError):
            self.manager.rerender(job, {}, "working code", False, {"quality": "4K"})
        self.assertEqual(job.data["status"], "done")
        self.assertEqual(job.data["settings"]["quality"], "720p")
        with self.assertRaises(ValueError):
            self.manager.rerender(job, {}, "   ", False, None)

    async def test_resume_reuses_valid_clips_and_records_only_missing_line(self):
        job = self.make_job([{"narration": "Saved line."}, {"narration": "Missing line."}])
        audio_dir = job.dir / "audio"
        audio_dir.mkdir()
        saved = audio_dir / "beat_00.mp3"
        saved.write_bytes(b"saved purchased recording")
        tts = AsyncMock(return_value=(b"new missing recording", []))
        with patch.object(elevenlabs, "tts_with_timestamps", tts), \
             patch.object(pipeline.media, "duration", AsyncMock(return_value=1.5)), \
             patch.object(pipeline.media, "build_narration", AsyncMock()):
            await pipeline.stage_voice(job, "unused", job.data["settings"], reuse_existing=True)
        self.assertEqual(saved.read_bytes(), b"saved purchased recording")
        self.assertEqual((audio_dir / "beat_01.mp3").read_bytes(), b"new missing recording")
        self.assertEqual(tts.await_count, 1)
        self.assertEqual(tts.await_args.args[2], "Missing line.")
        self.assertEqual(job.data["script"]["beats"][0]["audio_duration"], 1.5)
        self.assertTrue(any("Reused 1/2" in entry["msg"] for entry in job.data["logs"]))

    async def test_resume_all_valid_clips_needs_no_voice_key(self):
        job = self.make_job()
        audio_dir = job.dir / "audio"
        audio_dir.mkdir()
        saved = audio_dir / "beat_00.mp3"
        saved.write_bytes(b"saved recording")
        tts = AsyncMock()
        with patch.object(elevenlabs, "tts_with_timestamps", tts), \
             patch.object(pipeline.media, "duration", AsyncMock(return_value=1.5)), \
             patch.object(pipeline.media, "build_narration", AsyncMock()):
            await pipeline.stage_voice(job, None, job.data["settings"], reuse_existing=True)
        tts.assert_not_awaited()
        self.assertEqual(saved.read_bytes(), b"saved recording")

    async def test_resume_invalid_clip_is_validated_before_new_request(self):
        job = self.make_job()
        audio_dir = job.dir / "audio"
        audio_dir.mkdir()
        (audio_dir / "beat_00.mp3").write_bytes(b"invalid")
        tts = AsyncMock(return_value=(b"replacement recording", []))
        with patch.object(elevenlabs, "tts_with_timestamps", tts), \
             patch.object(pipeline.media, "duration", AsyncMock(side_effect=[pipeline.media.MediaError("invalid"), 1.5])), \
             patch.object(pipeline.media, "build_narration", AsyncMock()):
            await pipeline.stage_voice(job, "unused", job.data["settings"], reuse_existing=True)
        self.assertEqual(tts.await_count, 1)
        self.assertTrue(any("could not be reused" in entry["msg"] for entry in job.data["logs"]))

    async def test_resume_reuses_script_and_code_then_completes_remaining_stages(self):
        job = self.make_job()
        scene = job.dir / "scene.py"
        scene.write_text("saved working animation")
        script, voice, code, test, mix = (AsyncMock() for _ in range(5))
        with patch.object(pipeline, "stage_script", script), patch.object(pipeline, "stage_voice", voice), \
             patch.object(pipeline, "stage_code", code), patch.object(pipeline, "stage_test", test), \
             patch.object(pipeline, "stage_render_and_mix", mix):
            await pipeline.run_resume(job, {"deepseek": "unused", "elevenlabs": "unused"})
        script.assert_not_awaited()
        code.assert_not_awaited()
        self.assertTrue(voice.await_args.kwargs["reuse_existing"])
        test.assert_awaited_once()
        mix.assert_awaited_once()
        self.assertEqual(job.data["code"], "saved working animation")
        self.assertEqual(scene.read_text(), "saved working animation")

    async def test_resume_preserves_existing_long_script(self):
        job = self.make_job([{"narration": " ".join(["transformer"] * 196)}])
        with patch.object(pipeline, "stage_voice", AsyncMock()), patch.object(pipeline, "stage_code", AsyncMock()), \
             patch.object(pipeline, "stage_test", AsyncMock()), patch.object(pipeline, "stage_render_and_mix", AsyncMock()):
            await pipeline.run_resume(job, {"deepseek": "unused", "elevenlabs": "unused"})
        self.assertEqual(len(job.data["script"]["beats"][0]["narration"].split()), 196)
        self.assertTrue(any("preserve recorded narration" in entry["msg"] for entry in job.data["logs"]))

    async def test_resume_manager_checks_state_and_keys_before_scheduling(self):
        job = self.make_job()
        job.data.update(status="error", quality_issues=["old warning"])
        with self.assertRaisesRegex(ValueError, "DeepSeek"):
            self.manager.resume(job, {})
        self.assertEqual(job.data["status"], "error")
        with self.assertRaisesRegex(ValueError, "ElevenLabs"):
            self.manager.resume(job, {"deepseek": "unused"})
        with patch.object(pipeline, "run_resume", AsyncMock()):
            self.manager.resume(job, {"deepseek": "unused", "elevenlabs": "unused"})
            self.assertEqual(job.data["quality_issues"], [])
            await job.task
        self.assertEqual(job.data["status"], "done")
        with self.assertRaisesRegex(RuntimeError, "Only failed or cancelled"):
            self.manager.resume(job, {"deepseek": "unused", "elevenlabs": "unused"})

    async def test_script_over_word_budget_gets_one_revision_before_voice(self):
        job = self.make_job()
        raw = lambda n: json.dumps({"title": "Transformers", "beats": [{"narration": " ".join(["word"] * n)}]})
        chat = AsyncMock(side_effect=[raw(196), raw(145)])
        with patch.object(deepseek, "chat", chat):
            await pipeline.stage_script(job, "unused", job.data["settings"])
        self.assertEqual(chat.await_count, 2)
        self.assertIn("hard limit of 161", chat.await_args.args[2][-1]["content"])
        self.assertEqual(len(job.data["script"]["beats"][0]["narration"].split()), 145)

    async def test_script_still_over_budget_stops_before_paid_voice(self):
        job = self.make_job()
        raw = json.dumps({"beats": [{"narration": " ".join(["word"] * 196)}]})
        voice = AsyncMock()
        chat = AsyncMock(return_value=raw)
        with patch.object(deepseek, "chat", chat), patch.object(pipeline, "stage_voice", voice):
            with self.assertRaisesRegex(RuntimeError, "No voiceover was purchased"):
                await pipeline.run_full(job, {"deepseek": "unused", "elevenlabs": "unused"})
        self.assertEqual(chat.await_count, 4)
        voice.assert_not_awaited()
        self.assertEqual(job.data["pending_script"]["beats"][0]["narration"], " ".join(["word"] * 196))
        self.assertEqual(job.data["length_warning"]["attempts"], 3)
        self.assertEqual(job.data["length_warning"]["word_count"], 196)
        self.assertEqual(job.data["length_warning"]["word_limit"], 161)
        self.assertIn("pending_script", json.loads((job.dir / "job.json").read_text()))

    async def test_third_shortening_has_stronger_target_and_can_recover_before_voice(self):
        job = self.make_job()
        job.data["settings"]["seconds"] = 120
        raw = lambda n: json.dumps({"title": "Summary", "beats": [{"narration": " ".join(["word"] * n), "source_refs": ["01:20"]}]})
        chat = AsyncMock(side_effect=[raw(599), raw(566), raw(349), raw(310)])
        voice = AsyncMock()
        with patch.object(deepseek, "chat", chat), patch.object(pipeline, "stage_voice", voice), \
             patch.object(pipeline, "stage_code", AsyncMock()), patch.object(pipeline, "stage_test", AsyncMock()), \
             patch.object(pipeline, "stage_render_and_mix", AsyncMock()):
            await pipeline.run_full(job, {"deepseek": "unused", "elevenlabs": "unused"})
        self.assertEqual(chat.await_count, 4)
        voice.assert_awaited_once()
        self.assertIn("exact maximum for this revision is 192", chat.await_args.args[2][0]["content"])
        self.assertIn("beat 1: 349 -> 192", chat.await_args.args[2][-1]["content"])
        self.assertEqual(len(job.data["script"]["beats"][0]["narration"].split()), 310)
        self.assertNotIn("pending_script", job.data)

    async def test_pending_draft_requires_explicit_continue_and_missing_keys_leave_it_unchanged(self):
        job = self.make_job()
        job.data.pop("script")
        job.data.update(status="error", pending_script={"title": "Long draft", "beats": [
            {"narration": "Equipment may vary. " + " ".join(["word"] * 193), "source_refs": ["Page 10"]}]},
            length_warning={"word_count": 196, "word_limit": 161, "estimated_seconds": 80, "target_seconds": 60, "attempts": 3})
        pending = json.loads(json.dumps(job.data["pending_script"]))
        with self.assertRaisesRegex(ValueError, "DeepSeek"):
            self.manager.resume(job, {}, allow_long_script=True)
        with self.assertRaisesRegex(ValueError, "ElevenLabs"):
            self.manager.resume(job, {"deepseek": "unused"}, allow_long_script=True)
        self.assertEqual(job.data["pending_script"], pending)
        self.assertNotIn("script", job.data)
        with patch.object(pipeline, "run_resume", AsyncMock()):
            self.manager.resume(job, {"deepseek": "unused", "elevenlabs": "unused"})
            self.assertNotIn("script", job.data)
            self.assertNotIn("pending_script", job.data)
            self.assertNotIn("length_warning", job.data)
            self.assertNotIn("long_script_accepted", job.data)
            await job.task

    async def test_explicit_continue_promotes_pending_draft_and_archives_unrelated_paid_clips(self):
        job = self.make_job()
        job.data["status"] = "error"
        job.data["pending_script"] = {"title": "Accepted draft", "beats": [{
            "narration": "Equipment may vary. " + " ".join(["word"] * 193), "source_refs": ["Page 10"]}]}
        job.data["length_warning"] = {"word_count": 196, "word_limit": 161, "estimated_seconds": 80,
                                      "target_seconds": 60, "attempts": 3, "accepted": False}
        audio = job.dir / "audio"
        audio.mkdir()
        (audio / "beat_00.mp3").write_bytes(b"old unrelated purchased clip")
        (job.dir / "narration.wav").write_bytes(b"old unrelated voiceover")
        (job.dir / "scene.py").write_text("old unrelated animation")
        tts = AsyncMock(return_value=(b"new matching recording", []))
        with patch.object(elevenlabs, "tts_with_timestamps", tts), \
             patch.object(pipeline.media, "duration", AsyncMock(return_value=10)), \
             patch.object(pipeline.media, "build_narration", AsyncMock()), patch.object(pipeline, "stage_code", AsyncMock()), \
             patch.object(pipeline, "stage_test", AsyncMock()), patch.object(pipeline, "stage_render_and_mix", AsyncMock()):
            self.manager.resume(job, {"deepseek": "unused", "elevenlabs": "unused"}, allow_long_script=True)
            self.assertEqual(job.data["script"]["title"], "Accepted draft")
            self.assertTrue(job.data["long_script_accepted"])
            self.assertTrue(job.data["length_warning"]["accepted"])
            self.assertNotIn("pending_script", job.data)
            self.assertFalse((job.dir / "scene.py").exists())
            await job.task
        tts.assert_awaited_once()
        self.assertEqual(tts.await_args.args[2], job.data["script"]["beats"][0]["narration"])
        self.assertEqual(job.data["script"]["beats"][0]["source_refs"], ["Page 10"])
        self.assertEqual((audio / "beat_00.mp3").read_bytes(), b"new matching recording")
        archive = next(job.dir.glob("previous-draft-*"))
        self.assertEqual((archive / "audio/beat_00.mp3").read_bytes(), b"old unrelated purchased clip")
        self.assertEqual((archive / "narration.wav").read_bytes(), b"old unrelated voiceover")
        self.assertTrue(any("User selected Continue anyway" in entry["msg"] for entry in job.data["logs"]))

    async def test_historical_failed_job_without_pending_draft_cannot_continue_anyway(self):
        job = self.make_job()
        job.data["status"] = "error"
        with self.assertRaisesRegex(ValueError, "no valid saved draft"):
            self.manager.resume(job, {"deepseek": "unused", "elevenlabs": "unused"}, allow_long_script=True)

    async def test_pending_review_api_exposes_draft_and_requires_literal_explicit_continue(self):
        main = importlib.import_module("app.main")
        job = self.make_job()
        job.data.pop("script")
        job.data.update(status="error", pending_script={"title": "Review this draft", "beats": [{
            "narration": "Equipment varies. " + " ".join(["word"] * 194), "source_refs": ["Page 10"], "words": ["private alignment"]}]},
            length_warning={"word_count": 196, "word_limit": 161, "estimated_seconds": 80,
                            "target_seconds": 60, "attempts": 3, "accepted": False, "message": "Approximate 80 seconds."})
        with patch.object(main, "manager", self.manager), patch.object(pipeline, "run_resume", AsyncMock()):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
                review = (await client.get(f"/api/jobs/{job.id}")).json()
                self.assertEqual(review["length_warning"]["attempts"], 3)
                self.assertEqual(review["pending_script"]["beats"][0]["source_refs"], ["Page 10"])
                self.assertNotIn("words", review["pending_script"]["beats"][0])
                self.assertNotIn("script", review)
                keys = {"deepseek_key": "unused", "elevenlabs_key": "unused"}
                rejected = await client.post(f"/api/jobs/{job.id}/resume", json={**keys, "allow_long_script": "true"})
                self.assertEqual(rejected.status_code, 422)
                self.assertIn("pending_script", job.data)
                accepted = await client.post(f"/api/jobs/{job.id}/resume", json={**keys, "allow_long_script": True})
                self.assertEqual(accepted.status_code, 200)
                self.assertEqual(accepted.json()["script"]["title"], "Review this draft")
                self.assertTrue(accepted.json()["length_warning"]["accepted"])
                self.assertNotIn("pending_script", accepted.json())
                await job.task

    async def test_second_shortening_recovers_live_120_second_budget_before_voice(self):
        job = self.make_job()
        job.data["settings"]["seconds"] = 120
        raw = lambda n: json.dumps({"title": "Twelve use cases", "beats": [
            {"narration": " ".join(["word"] * (n // 2)), "source_refs": ["00:10"]},
            {"narration": " ".join(["word"] * (n - n // 2)), "source_refs": ["01:20"]}]})
        chat = AsyncMock(side_effect=[raw(360), raw(350), raw(210)])
        voice = AsyncMock()
        with patch.object(deepseek, "chat", chat), patch.object(pipeline, "stage_voice", voice), \
             patch.object(pipeline, "stage_code", AsyncMock()), patch.object(pipeline, "stage_test", AsyncMock()), \
             patch.object(pipeline, "stage_render_and_mix", AsyncMock()):
            await pipeline.run_full(job, {"deepseek": "unused", "elevenlabs": "unused"})
        self.assertEqual(chat.await_count, 3)
        voice.assert_awaited_once()
        final_prompt = chat.await_args.args[2][-1]["content"]
        self.assertIn("hard limit of 323", final_prompt)
        self.assertIn("at most 216 words", final_prompt)
        self.assertIn("exceeded the limit by 27 words", final_prompt)
        self.assertIn("beat 1: 175 -> 108", final_prompt)
        self.assertIn("beat 2: 175 -> 108", final_prompt)
        self.assertIn("never cut a sentence", final_prompt)
        self.assertEqual(sum(len(beat["narration"].split()) for beat in job.data["script"]["beats"]), 210)
        self.assertEqual(job.data["script"]["beats"][1]["source_refs"], ["01:20"])
        for call in chat.await_args_list:
            self.assertEqual(call.kwargs["max_tokens"], 4000)
            self.assertFalse(call.kwargs["thinking"])
        first_revision_system = chat.await_args_list[1].args[2][0]["content"]
        final_revision_system = chat.await_args_list[2].args[2][0]["content"]
        self.assertIn("exact maximum for this revision is 323", first_revision_system)
        self.assertIn("exact maximum for this revision is 216", final_revision_system)
        self.assertIn("splitting narration on whitespace", final_revision_system)
        self.assertIn("supersede the initial approximate duration", final_revision_system)
        revised_draft = json.loads(chat.await_args_list[2].args[2][-2]["content"])
        self.assertEqual(len(revised_draft["beats"][0]["narration"].split()), 175)

    async def test_in_budget_english_script_needs_no_shortening(self):
        job = self.make_job()
        chat = AsyncMock(return_value=json.dumps({"beats": [{"narration": "Attention compares token relationships."}]}))
        with patch.object(deepseek, "chat", chat):
            await pipeline.stage_script(job, "unused", job.data["settings"])
        self.assertEqual(chat.await_count, 1)

    async def test_second_source_revision_preserves_context_and_stays_bounded(self):
        source = self.make_source()
        with patch.object(pipeline, "run_full", AsyncMock()):
            job = self.manager.create("Explain the main concepts", {"seconds": 120}, {}, source)
            await job.task
        raw = lambda n: json.dumps({"title": "Attention", "beats": [{
            "narration": " ".join(["word"] * n), "source_refs": ["Attention paper"]}]})
        chat = AsyncMock(side_effect=[raw(360), raw(360), raw(350), raw(270)])
        with patch.object(deepseek, "chat", chat):
            await pipeline.stage_script(job, "unused", job.data["settings"])
        self.assertEqual(chat.await_count, 4)  # draft, source review, at most two shortenings
        self.assertIn("Review the draft", chat.await_args_list[1].args[2][-1]["content"])
        final_prompt = chat.await_args.args[2][-1]["content"]
        self.assertIn("equipment-variation caveats and source_refs", final_prompt)
        self.assertIn("main learning concepts", final_prompt)
        self.assertEqual(job.data["script"]["beats"][0]["source_refs"], ["Attention paper"])
        for call in chat.await_args_list:
            self.assertIn(source["text"], call.args[2][1]["content"])

    async def test_unsegmented_languages_do_not_use_english_word_budget(self):
        job = self.make_job()
        job.data["settings"]["language"] = "Chinese"
        chat = AsyncMock(return_value=json.dumps({"beats": [{"narration": "注意力比较词元。" * 40}]}))
        with patch.object(deepseek, "chat", chat):
            await pipeline.stage_script(job, "unused", job.data["settings"])
        self.assertEqual(chat.await_count, 1)
        self.assertTrue(any("without reliable whitespace word counts" in entry["msg"] for entry in job.data["logs"]))

    async def test_animation_token_cutoff_gets_one_direct_code_fallback(self):
        job = self.make_job()
        job.data["animation_thinking"] = True
        complete = "```python\nfrom edu_prelude import *\nclass ExplainerVideo(EduScene):\n    def construct(self):\n        self.beat(0)\n```"
        chat = AsyncMock(side_effect=[deepseek.DeepSeekTokenLimitError("token limit"), complete])
        with patch.object(deepseek, "chat", chat):
            await pipeline.stage_code(job, "unused", job.data["settings"])
        self.assertEqual(chat.await_count, 2)
        initial, fallback = chat.await_args_list
        self.assertTrue(initial.kwargs["thinking"])
        self.assertEqual(initial.kwargs["reasoning_effort"], "low")
        self.assertEqual(initial.kwargs["max_tokens"], 16000)
        self.assertFalse(fallback.kwargs["thinking"])
        self.assertEqual(fallback.kwargs["max_tokens"], 16000)
        self.assertIn("full replacement scene", fallback.args[2][-1]["content"])
        self.assertFalse(job.data["animation_thinking"])
        self.assertIn("class ExplainerVideo", (job.dir / "scene.py").read_text())
        self.assertFalse(json.loads((job.dir / "job.json").read_text())["animation_thinking"])

    async def test_animation_fix_reuses_direct_code_mode_after_cutoff(self):
        job = self.make_job()
        job.data["animation_thinking"] = False
        chat = AsyncMock(return_value="```python\nclass ExplainerVideo(EduScene):\n    pass\n```")
        with patch.object(deepseek, "chat", chat):
            await pipeline._ask_fix(job, "unused", job.data["settings"], "Fix the scene error")
        self.assertEqual(chat.await_count, 1)
        self.assertFalse(chat.await_args.kwargs["thinking"])

    async def test_direct_code_fallback_is_bounded_if_it_also_truncates(self):
        job = self.make_job()
        job.data["animation_thinking"] = True
        chat = AsyncMock(side_effect=deepseek.DeepSeekTokenLimitError("token limit"))
        with patch.object(deepseek, "chat", chat):
            with self.assertRaises(deepseek.DeepSeekTokenLimitError):
                await pipeline.stage_code(job, "unused", job.data["settings"])
        self.assertEqual(chat.await_count, 2)
        self.assertFalse(job.data["animation_thinking"])

    async def test_flash_starts_directly_with_code_without_reasoning(self):
        job = self.make_job()
        chat = AsyncMock(return_value="```python\nclass ExplainerVideo(EduScene):\n    pass\n```")
        with patch.object(deepseek, "chat", chat):
            await pipeline.stage_code(job, "unused", job.data["settings"])
            await pipeline._ask_fix(job, "unused", job.data["settings"], "Fix layout")
        self.assertEqual(chat.await_count, 2)
        self.assertTrue(all(call.kwargs["thinking"] is False for call in chat.await_args_list))
        self.assertFalse(job.data["animation_thinking"])
        self.assertFalse(json.loads((job.dir / "job.json").read_text())["animation_thinking"])

    async def test_pro_defaults_to_low_reasoning_effort(self):
        job = self.make_job()
        job.data["settings"]["deepseek_model"] = "deepseek-v4-pro"
        chat = AsyncMock(return_value="```python\nclass ExplainerVideo(EduScene):\n    pass\n```")
        with patch.object(deepseek, "chat", chat):
            await pipeline.stage_code(job, "unused", job.data["settings"])
        self.assertEqual(chat.await_count, 1)
        self.assertTrue(chat.await_args.kwargs["thinking"])
        self.assertEqual(chat.await_args.kwargs["reasoning_effort"], "low")
        self.assertTrue(job.data["animation_thinking"])

    async def test_explicit_direct_code_override_is_retained_for_pro(self):
        job = self.make_job()
        job.data["settings"]["deepseek_model"] = "deepseek-v4-pro"
        job.data["animation_thinking"] = False
        chat = AsyncMock(return_value="```python\nclass ExplainerVideo(EduScene):\n    pass\n```")
        with patch.object(deepseek, "chat", chat):
            await pipeline.stage_code(job, "unused", job.data["settings"])
        self.assertEqual(chat.await_count, 1)
        self.assertFalse(chat.await_args.kwargs["thinking"])

    async def test_animation_auth_error_does_not_purchase_fallback(self):
        job = self.make_job()
        chat = AsyncMock(side_effect=deepseek.DeepSeekError("API key rejected"))
        with patch.object(deepseek, "chat", chat):
            with self.assertRaisesRegex(deepseek.DeepSeekError, "key rejected"):
                await pipeline.stage_code(job, "unused", job.data["settings"])
        self.assertEqual(chat.await_count, 1)

    async def test_resuming_legacy_token_cutoff_skips_further_reasoning(self):
        job = self.make_job()
        job.data.update(status="error", error="DeepSeek's response was cut off at its token limit.")
        with patch.object(pipeline, "run_resume", AsyncMock()):
            self.manager.resume(job, {"deepseek": "unused", "elevenlabs": "unused"})
            await job.task
        self.assertFalse(job.data["animation_thinking"])

    async def test_new_default_voice_model_does_not_replace_saved_job_model(self):
        self.assertEqual(pipeline.DEFAULT_SETTINGS["tts_model"], "eleven_v4")
        job = self.make_job()
        job.data["settings"]["tts_model"] = "eleven_multilingual_v2"
        job.data["status"] = "error"
        with patch.object(pipeline, "run_resume", AsyncMock()):
            self.manager.resume(job, {"deepseek": "unused", "elevenlabs": "unused"})
            await job.task
        self.assertEqual(job.data["settings"]["tts_model"], "eleven_multilingual_v2")

    async def test_source_job_allows_blank_instructions_and_saves_immutable_snapshot(self):
        source = self.make_source()
        original_text = source["text"]
        with patch.object(pipeline, "run_full", AsyncMock()):
            job = self.manager.create("", {"seconds": 120, "content_mode": "storytelling"}, {}, source=source)
            source["text"] = "The import registry changed after the job was created."
            await job.task
        snapshot = json.loads((job.dir / "source.json").read_text())
        self.assertEqual(snapshot["text"], original_text)
        self.assertEqual(job.data["settings"]["seconds"], 120)
        self.assertEqual(job.data["settings"]["content_mode"], "storytelling")
        self.assertNotIn("text", job.data["source"])
        self.assertNotIn("PRIVATE_ARTICLE_SENTINEL", (job.dir / "job.json").read_text())
        self.assertNotIn("PRIVATE_ARTICLE_SENTINEL", json.dumps(pipeline.public_job(job)))
        self.assertNotIn("PRIVATE_ARTICLE_SENTINEL", json.dumps(job.summary()))

    async def test_source_job_requires_actual_extracted_text(self):
        source = self.make_source()
        source["text"] = "  "
        with self.assertRaisesRegex(ValueError, "no extracted text"):
            self.manager.create("", {}, {}, source=source)
        self.assertEqual(list(Path(self.tmp.name).iterdir()), [])

    async def test_content_modes_validate_and_default_to_auto(self):
        self.assertEqual(pipeline.normalize_settings({})["content_mode"], "auto")
        for mode in ("auto", "math_science", "storytelling", "infotainment"):
            with self.subTest(mode=mode):
                self.assertEqual(pipeline.normalize_settings({"content_mode": mode})["content_mode"], mode)
        with self.assertRaisesRegex(ValueError, "content_mode"):
            pipeline.normalize_settings({"content_mode": "unsupported"})

    async def test_source_script_revision_keeps_saved_context_and_mode_without_logging_full_text(self):
        source = self.make_source()
        with patch.object(pipeline, "run_full", AsyncMock()):
            job = self.manager.create("Focus on the core mechanism", {"content_mode": "math_science"}, {}, source=source)
            await job.task
        raw = lambda n: json.dumps({"title": "Attention", "beats": [{
            "narration": " ".join(["word"] * n), "source_refs": ["Attention paper"],
        }]})
        chat = AsyncMock(side_effect=[raw(196), raw(196), raw(145)])
        def source_messages(topic, seconds, language, audience, *, content_mode, source, style):
            self.assertEqual(content_mode, "math_science")
            self.assertEqual(style, "classic")
            return [{"role": "system", "content": "Ground narration in: " + source["text"]},
                    {"role": "user", "content": topic}]
        with patch.object(pipeline.prompts, "script_messages", source_messages), patch.object(deepseek, "chat", chat):
            await pipeline.stage_script(job, "unused", job.data["settings"])
        self.assertEqual(chat.await_count, 3)
        self.assertIn("Review the draft", chat.await_args_list[1].args[2][-1]["content"])
        self.assertIn("while shortening", chat.await_args_list[2].args[2][-1]["content"])
        for call in chat.await_args_list:
            self.assertIn("PRIVATE_ARTICLE_SENTINEL", call.args[2][0]["content"])
        self.assertNotIn("PRIVATE_ARTICLE_SENTINEL", json.dumps(job.data["logs"]))
        self.assertEqual(pipeline.public_job(job)["script"]["beats"][0]["source_refs"], ["Attention paper"])

    async def test_resume_loads_source_snapshot_without_import_registry(self):
        source = self.make_source()
        with patch.object(pipeline, "run_full", AsyncMock()):
            job = self.manager.create("", {}, {}, source=source)
            await job.task
        job.data["status"] = "error"
        source["text"] = "changed registry content"
        script = AsyncMock(return_value=json.dumps({"beats": [{"narration": "Attention mixes values."}]}))
        def source_messages(topic, seconds, language, audience, *, content_mode, source, style):
            self.assertIn("PRIVATE_ARTICLE_SENTINEL", source["text"])
            self.assertEqual(style, "classic")
            return [{"role": "user", "content": source["text"]}]
        with patch.object(pipeline.prompts, "script_messages", source_messages), patch.object(deepseek, "chat", script), \
             patch.object(pipeline, "stage_voice", AsyncMock()), patch.object(pipeline, "stage_code", AsyncMock()), \
             patch.object(pipeline, "stage_test", AsyncMock()), patch.object(pipeline, "stage_render_and_mix", AsyncMock()):
            self.manager.resume(job, {"deepseek": "unused", "elevenlabs": "unused"})
            await job.task
        self.assertEqual(job.data["status"], "done")
        self.assertEqual(script.await_count, 2)

    async def test_source_faithfulness_review_corrects_universal_feature_claim_before_voice(self):
        source = self.make_source()
        source.update(title="AD60 brochure", text="The AD60 brochure describes braking and safety features. "
                      "Equipment may vary by region and individual specification; some equipment is optional. "
                      "Consult the applicable machine Operation and Maintenance Manual.")
        with patch.object(pipeline, "run_full", AsyncMock()):
            job = self.manager.create("Make a source-faithful safety brief", {}, {}, source=source)
            await job.task
        draft = {"title": "Safety", "beats": [{"narration": "These safety features are built into every machine.",
                  "visual": "All trucks share the same features", "source_refs": ["AD60 brochure"]}]}
        corrected = {"title": "Safety", "beats": [{
            "narration": "The brochure describes safety features, but equipment can vary by region and specification. "
                         "Consult the applicable machine Operation and Maintenance Manual.",
            "visual": "Listed features with a label: Equipment varies", "source_refs": ["AD60 brochure"],
        }]}
        order = []
        async def chat(*args, **kwargs):
            phase = "draft" if not order else "review"
            order.append(phase)
            if phase == "review":
                self.assertIn("equipment", args[2][-1]["content"].lower())
                self.assertIn("do not invent or infer operating", args[2][-1]["content"])
                self.assertIn("Equipment may vary", args[2][1]["content"])
                self.assertTrue(kwargs["json_mode"])
                self.assertFalse(kwargs["thinking"])
                self.assertEqual(kwargs["max_tokens"], 4000)
            return json.dumps(draft if phase == "draft" else corrected)
        async def voice(job, key, settings):
            order.append("voice")
            self.assertEqual(job.data["script"], corrected)
            self.assertNotIn("built into every machine", json.dumps(job.data["script"]))
        with patch.object(deepseek, "chat", chat), patch.object(pipeline, "stage_voice", voice), \
             patch.object(pipeline, "stage_code", AsyncMock()), patch.object(pipeline, "stage_test", AsyncMock()), \
             patch.object(pipeline, "stage_render_and_mix", AsyncMock()):
            await pipeline.run_full(job, {"deepseek": "unused", "elevenlabs": "unused"})
        self.assertEqual(order, ["draft", "review", "voice"])
        self.assertEqual(job.data["source_review"]["status"], "completed")
        self.assertGreaterEqual(job.data["source_review"]["duration_seconds"], 0)

    async def test_failed_source_review_prevents_paid_voice_and_does_not_accept_unchecked_script(self):
        with patch.object(pipeline, "run_full", AsyncMock()):
            job = self.manager.create("Safety brief", {}, {}, source=self.make_source())
            await job.task
        draft = json.dumps({"beats": [{"narration": "This feature is standard on every machine."}]})
        voice = AsyncMock()
        chat = AsyncMock(side_effect=[draft, deepseek.DeepSeekError("Review service unavailable")])
        with patch.object(deepseek, "chat", chat), patch.object(pipeline, "stage_voice", voice):
            with self.assertRaisesRegex(deepseek.DeepSeekError, "Review service unavailable"):
                await pipeline.run_full(job, {"deepseek": "unused", "elevenlabs": "unused"})
        self.assertEqual(chat.await_count, 2)
        voice.assert_not_awaited()
        self.assertNotIn("script", job.data)

    async def test_resuming_recorded_source_script_does_not_review_or_purchase_new_script(self):
        job = self.make_job()
        source = self.make_source()
        job.data["source"] = pipeline.source_metadata(source)
        (job.dir / "source.json").write_text(json.dumps(source))
        (job.dir / "scene.py").write_text("saved code")
        chat = AsyncMock()
        with patch.object(deepseek, "chat", chat), patch.object(pipeline, "stage_voice", AsyncMock()), \
             patch.object(pipeline, "stage_test", AsyncMock()), patch.object(pipeline, "stage_render_and_mix", AsyncMock()):
            await pipeline.run_resume(job, {"deepseek": "unused", "elevenlabs": "unused"})
        chat.assert_not_awaited()

    async def test_resume_missing_source_snapshot_fails_before_scheduling(self):
        job = self.make_job()
        job.data.update(status="error", source={"id": "missing", "title": "Missing paper"})
        with self.assertRaisesRegex(RuntimeError, "saved source text"):
            self.manager.resume(job, {"deepseek": "unused", "elevenlabs": "unused"})
        self.assertIsNone(job.task)
        self.assertEqual(job.data["status"], "error")

    def test_script_source_references_must_be_readable_strings(self):
        raw = json.dumps({"beats": [{"narration": "Attention mixes values.", "source_refs": [123]}]})
        with self.assertRaisesRegex(RuntimeError, "invalid source references"):
            pipeline._parse_script(raw)

    async def test_voice_failure_cancels_and_settles_sibling_requests(self):
        job = self.make_job([{"narration": "one"}, {"narration": "two"}, {"narration": "three"}])
        started, settled = asyncio.Event(), asyncio.Event()
        async def tts(key, voice, text, **kwargs):
            if text == "one":
                await started.wait()
                raise elevenlabs.ElevenLabsError("Voice request failed")
            started.set()
            try:
                await asyncio.Event().wait()
            finally:
                settled.set()
        with patch.object(elevenlabs, "tts_with_timestamps", tts):
            with self.assertRaises(elevenlabs.ElevenLabsError):
                await asyncio.wait_for(pipeline.stage_voice(job, "unused", job.data["settings"]), 1)
        self.assertTrue(settled.is_set())
        self.assertEqual(list((job.dir / "audio").iterdir()), [])

    async def test_invalid_script_shape_has_readable_error(self):
        job = self.make_job()
        with patch.object(deepseek, "chat", AsyncMock(return_value='{"beats": ["broken"]}')):
            with self.assertRaisesRegex(RuntimeError, "invalid beat structure"):
                await pipeline.stage_script(job, "unused", job.data["settings"])

    async def test_dry_run_checks_caption_band_and_exposes_warnings(self):
        job = self.make_job()
        (job.dir / "scene.py").write_text("working code")
        manim = AsyncMock(return_value=render.RenderResult(True, issues=["Caption overlap: label"]))
        with patch.object(render, "lint_code", return_value=[]), patch.object(render, "run_manim", manim):
            await pipeline.stage_test(job, None, job.data["settings"])
        self.assertIsNotNone(manim.await_args.kwargs["caption_style"])
        self.assertIsNone(manim.await_args.kwargs["captions"])
        self.assertEqual(job.data["quality_issues"], ["Caption overlap: label"])
        self.assertIn("warning", next(step for step in job.data["steps"] if step["key"] == "test")["detail"])

    async def test_failed_optional_layout_polish_preserves_working_code(self):
        job = self.make_job()
        scene = job.dir / "scene.py"
        scene.write_text("working code")
        with patch.object(render, "lint_code", return_value=[]), \
             patch.object(render, "run_manim", AsyncMock(return_value=render.RenderResult(True, issues=["Off-screen label"]))), \
             patch.object(pipeline, "_ask_fix", AsyncMock(side_effect=deepseek.DeepSeekError("Network unavailable"))):
            await pipeline.stage_test(job, "unused", job.data["settings"])
        self.assertEqual(scene.read_text(), "working code")
        self.assertEqual(job.data["quality_issues"], ["Off-screen label"])

    async def test_final_render_warnings_are_saved_for_review(self):
        job = self.make_job()
        with patch.object(render, "run_manim", AsyncMock(return_value=render.RenderResult(
                True, path=job.dir / "render.mp4", issues=["Timing: beat 0 overran"]))), \
             patch.object(pipeline.media, "mux", AsyncMock(return_value=2.2)), \
             patch.object(pipeline.media, "thumbnail", AsyncMock()):
            await pipeline.stage_render_and_mix(job, job.data["settings"])
        self.assertEqual(job.data["quality_issues"], ["Timing: beat 0 overran"])
        self.assertTrue(any("Final render has" in entry["msg"] for entry in job.data["logs"]))

    async def test_api_rejects_bad_input_and_blank_keys(self):
        main = importlib.import_module("app.main")
        with patch.object(main, "manager", self.manager):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
                keys = {"deepseek_key": "unused", "elevenlabs_key": "unused"}
                for body in ({**keys, "prompt": "    "}, {**keys, "prompt": "Transformer", "settings": {"seconds": "banana"}}):
                    self.assertEqual((await client.post("/api/jobs", json=body)).status_code, 422)
                self.assertEqual((await client.post("/api/check-deepseek", json={"deepseek_key": "   "})).status_code, 400)
                self.assertEqual((await client.post("/api/voices", json={"elevenlabs_key": "   "})).status_code, 400)
                for path in ("/api/does-not-exist", "/api/jobs/..%2f..%2fREADME.md"):
                    response = await client.get(path)
                    self.assertEqual(response.status_code, 404, path)
                    self.assertTrue(response.headers["content-type"].startswith("application/json"), path)

    async def test_resume_api_returns_job_and_rejects_missing_needed_keys(self):
        main = importlib.import_module("app.main")
        job = self.make_job()
        job.data["status"] = "error"
        with patch.object(main, "manager", self.manager), patch.object(pipeline, "run_resume", AsyncMock()):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
                self.assertEqual((await client.post(f"/api/jobs/{job.id}/resume", json={})).status_code, 400)
                response = await client.post(f"/api/jobs/{job.id}/resume", json={
                    "deepseek_key": "unused", "elevenlabs_key": "unused",
                })
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["id"], job.id)
                self.assertEqual(response.json()["status"], "queued")
                await job.task

    async def test_source_backed_create_api_allows_omitted_prompt_and_returns_metadata_only(self):
        main = importlib.import_module("app.main")
        source = self.make_source()
        with patch.object(main, "manager", self.manager), patch.object(main.sources, "get_source", return_value=source), \
             patch.object(pipeline, "run_full", AsyncMock()):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
                response = await client.post("/api/jobs", json={"source_id": source["id"],
                    "deepseek_key": "unused", "elevenlabs_key": "unused", "settings": {"seconds": 120}})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["source"]["id"], source["id"])
                self.assertNotIn("text", response.json()["source"])
                self.assertNotIn("PRIVATE_ARTICLE_SENTINEL", response.text)
                await self.manager.get(response.json()["id"]).task

    async def test_source_lookup_failure_is_returned_before_any_job_is_created(self):
        main = importlib.import_module("app.main")
        with patch.object(main, "manager", self.manager), patch.object(main.sources, "get_source", side_effect=
                main.sources.SourceError("Source not found", status_code=404)):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
                response = await client.post("/api/jobs", json={"source_id": "1234567890abcdef1234567890abcdef",
                    "deepseek_key": "unused", "elevenlabs_key": "unused"})
                self.assertEqual(response.status_code, 404)
        self.assertEqual(self.manager.jobs, {})


class ProviderQA(unittest.IsolatedAsyncioTestCase):
    def client(self, handler):
        original = httpx.AsyncClient
        return patch("httpx.AsyncClient", side_effect=lambda **kwargs: original(
            **kwargs, transport=httpx.MockTransport(handler)))

    async def test_deepseek_complete_stream(self):
        event = {"choices": [{"delta": {"content": "working code"}, "finish_reason": "stop"}]}
        with self.client(lambda request: httpx.Response(200, text="data: " + json.dumps(event) + "\n\ndata: [DONE]\n")):
            self.assertEqual(await deepseek.chat("unused", "unused", [], thinking=False), "working code")

    async def test_deepseek_truncated_stream_is_rejected(self):
        event = {"choices": [{"delta": {"content": "half a scene"}, "finish_reason": "length"}]}
        with self.client(lambda request: httpx.Response(200, text="data: " + json.dumps(event) + "\n\ndata: [DONE]\n")):
            with self.assertRaisesRegex(deepseek.DeepSeekTokenLimitError, "token limit"):
                await deepseek.chat("unused", "unused", [], thinking=False)

    async def test_deepseek_low_effort_and_explicit_nonthinking_request_payloads(self):
        bodies = []
        def respond(request):
            bodies.append(json.loads(request.content))
            event = {"choices": [{"delta": {"content": "code"}, "finish_reason": "stop"}]}
            return httpx.Response(200, text="data: " + json.dumps(event) + "\n\ndata: [DONE]\n")
        with self.client(respond):
            await deepseek.chat("unused", "unused", [], thinking=True, reasoning_effort="low")
            await deepseek.chat("unused", "unused", [], thinking=False)
        self.assertEqual(bodies[0]["reasoning_effort"], "low")
        self.assertEqual(bodies[0]["thinking"], {"type": "enabled"})
        self.assertEqual(bodies[1]["thinking"], {"type": "disabled"})
        self.assertNotIn("reasoning_effort", bodies[1])

    async def test_deepseek_unfinished_stream_is_not_accepted(self):
        event = {"choices": [{"delta": {"content": "half a scene"}}]}
        with self.client(lambda request: httpx.Response(200, text="data: " + json.dumps(event) + "\n")):
            with self.assertRaisesRegex(deepseek.DeepSeekError, "incomplete"):
                await deepseek.chat("unused", "unused", [], thinking=False)

    async def test_key_check_network_error_is_readable(self):
        def fail(request):
            raise httpx.ConnectError("offline", request=request)
        with self.client(fail), self.assertRaisesRegex(deepseek.DeepSeekError, "Network error"):
            await deepseek.check_key("unused")
        with self.client(fail), self.assertRaisesRegex(elevenlabs.ElevenLabsError, "Network error"):
            await elevenlabs.list_voices("unused")

    async def test_elevenlabs_invalid_audio_is_readable(self):
        with self.client(lambda request: httpx.Response(200, json={"audio_base64": "invalid base64!"})):
            with self.assertRaisesRegex(elevenlabs.ElevenLabsError, "invalid or empty audio"):
                await elevenlabs.tts_with_timestamps("unused", "unused", "Attention", model_id="unused")

    async def test_elevenlabs_valid_audio_with_missing_alignment_uses_caption_fallback(self):
        audio = b"test audio"
        with self.client(lambda request: httpx.Response(200, json={"audio_base64": base64.b64encode(audio).decode()})):
            self.assertEqual(await elevenlabs.tts_with_timestamps("unused", "unused", "Attention", model_id="unused"), (audio, []))

    async def test_elevenlabs_request_settings_match_model_capabilities(self):
        expected = {
            "eleven_v4": {"stability": 0.5, "similarity_boost": 0.8},
            "eleven_v4_turbo": {"stability": 0.5, "similarity_boost": 0.8},
            "eleven_v3": {"stability": 0.5},
            "eleven_multilingual_v2": {"stability": 0.45, "similarity_boost": 0.8, "style": 0.0,
                                       "use_speaker_boost": True, "speed": 1.15},
        }
        bodies = []
        def respond(request):
            bodies.append(json.loads(request.content))
            return httpx.Response(200, json={"audio_base64": base64.b64encode(b"test audio").decode()})
        with self.client(respond):
            for model in expected:
                await elevenlabs.tts_with_timestamps("unused", "unused", "Attention compares tokens.",
                                                     model_id=model, speed=1.15)
        for body in bodies:
            with self.subTest(model=body["model_id"]):
                self.assertEqual(body["voice_settings"], expected[body["model_id"]])

    def test_invalid_alignment_does_not_create_partial_or_negative_captions(self):
        for alignment in (
            {"characters": ["a", "b"], "character_start_times_seconds": [0], "character_end_times_seconds": [1]},
            {"characters": ["a"], "character_start_times_seconds": [-1], "character_end_times_seconds": [1]},
            {"characters": ["a"], "character_start_times_seconds": [2], "character_end_times_seconds": [1]},
            {"characters": ["a"], "character_start_times_seconds": [0], "character_end_times_seconds": [float("nan")]},
        ):
            with self.subTest(alignment=alignment):
                self.assertEqual(elevenlabs._words_from_alignment(alignment), [])

    def test_valid_alignment_groups_word_timings(self):
        self.assertEqual(elevenlabs._words_from_alignment({
            "characters": list("a b"), "character_start_times_seconds": [0, 0.1, 0.2],
            "character_end_times_seconds": [0.1, 0.2, 0.3],
        }), [{"word": "a", "start": 0, "end": 0.1}, {"word": "b", "start": 0.2, "end": 0.3}])

    def test_malformed_script_json_has_readable_error(self):
        with self.assertRaisesRegex(deepseek.DeepSeekError, "invalid JSON"):
            deepseek.parse_json('{"beats": broken}')

    def test_elevenlabs_quota_401_does_not_blame_valid_key(self):
        error = elevenlabs._explain(401, json.dumps({"detail": {
            "status": "quota_exceeded", "message": "You have 36 credits remaining; 121 credits are required.",
        }}))
        self.assertIn("quota/plan limit", error)
        self.assertIn("36 credits", error)
        self.assertNotIn("rejected the API key", error)
        self.assertIn("rejected the API key", elevenlabs._explain(401, json.dumps({"detail": {"status": "invalid_api_key"}})))


if __name__ == "__main__":
    unittest.main()
