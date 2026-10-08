"""Remotion data, dispatch and cancellation regressions; no paid providers."""
from __future__ import annotations

import asyncio
import copy
import importlib
import json
import signal
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

from app import deepseek, pipeline, remotion

WORK = Path("/Users/bronsonwoods/Documents/Codex/2026-10-07/ther/work")


def storyboard(count=1):
    return {"version": 1, "scenes": [{"template": "cards", "headline": f"Approved point {i + 1}",
                                     "items": [{"label": "Equipment varies", "detail": "Confirm the machine specification.", "icon": "shield"}]}
                                    for i in range(count)]}


def reviewed_storyboard(plan, issues=None):
    return {"audit": [{"scene": i + 1, "headline_scope": "A neutral heading for the approved concepts shown in this scene.",
                        "issues": (issues or {}).get(i + 1, [])} for i in range(len(plan["scenes"]))], "storyboard": plan}


class DataQA(unittest.TestCase):
    def test_availability_reports_missing_node_and_dependency_version(self):
        with tempfile.TemporaryDirectory(dir=WORK) as directory:
            root = Path(directory)
            with patch.object(remotion, "ROOT", root), patch.object(remotion.shutil, "which", return_value=None):
                state = remotion.availability()
                self.assertFalse(state["available"])
                self.assertIn("Node.js", state["reason"])
            (root / "src").mkdir()
            (root / "src/index.ts").write_text("// trusted composition")
            (root / "render.mjs").write_text("// trusted runner")
            for name in ("@remotion/renderer", "@remotion/bundler", "remotion"):
                package = root / "node_modules" / name / "package.json"
                package.parent.mkdir(parents=True)
                package.write_text('{"version":"4.0.534"}')
            with patch.object(remotion, "ROOT", root), patch.object(remotion.shutil, "which", return_value="/usr/bin/node"):
                self.assertEqual(remotion.availability(), {"available": True, "version": "4.0.534", "reason": None})

    def test_strict_data_rejects_executable_or_unknown_fields(self):
        for mutation in (lambda v: v.update(component="()=>fetch('http://secret')"),
                         lambda v: v["scenes"][0].update(html="<script>"),
                         lambda v: v["scenes"][0]["items"][0].update(asset="/etc/passwd"),
                         lambda v: v["scenes"][0].update(startFrame=0)):
            value = storyboard()
            mutation(value)
            with self.subTest(value=value), self.assertRaises(ValueError):
                remotion.validate_storyboard(value, 1)

    def test_wrong_format_and_beat_count_are_rejected(self):
        for value in ("class ExplainerVideo: pass", "export default () => <div/>", {"version": True, "scenes": []}, storyboard(2)):
            with self.subTest(value=value), self.assertRaises(ValueError):
                remotion.validate_storyboard(value, 1)

    def test_limits_reject_instead_of_truncating_negation_or_caveats(self):
        for field, maximum in (("headline", 80), ("body", 180), ("kicker", 50), ("footer", 100)):
            value = storyboard()
            value["scenes"][0][field] = "x" * maximum + " not standard"
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "exceeds"):
                remotion.validate_storyboard(value, 1)
        for field, maximum in (("label", 60), ("detail", 120)):
            value = storyboard()
            value["scenes"][0]["items"][0][field] = "x" * (maximum + 1)
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "exceeds"):
                remotion.validate_storyboard(value, 1)

    def test_plain_text_and_allowed_icons_only(self):
        for text in ("<img src=x>", "https://example.org/image.png", "javascript:alert(1)", "bad\x00data"):
            value = storyboard()
            value["scenes"][0]["headline"] = text
            with self.subTest(text=text), self.assertRaises(ValueError):
                remotion.validate_storyboard(value, 1)
        value = storyboard()
        value["scenes"][0]["items"] *= 5
        with self.assertRaisesRegex(ValueError, "four"):
            remotion.validate_storyboard(value, 1)
        value = storyboard()
        value["scenes"][0]["items"][0]["icon"] = "external-logo"
        with self.assertRaisesRegex(ValueError, "icon"):
            remotion.validate_storyboard(value, 1)

    def test_plan_owns_timing_dimensions_captions_and_frame_rounding(self):
        script = {"title": "Safety brief", "beats": [{}, {}]}
        settings = {**pipeline.DEFAULT_SETTINGS, "renderer": "remotion", "aspect": "9:16", "style": "chalkboard"}
        plan = remotion.assemble_plan(storyboard(2), script, [1.117, 2.233],
                                     [{"start": 0.0, "end": 0.011, "text": "First"},
                                      {"start": 0.011, "end": 0.023, "text": "Second"}], settings)
        self.assertEqual((plan["width"], plan["height"], plan["fps"]), (720, 1280, 30))
        self.assertEqual(plan["style"], "chalkboard")
        self.assertEqual(plan["scenes"][1]["startFrame"], plan["scenes"][0]["durationInFrames"])
        self.assertEqual(sum(scene["durationInFrames"] for scene in plan["scenes"]), plan["durationInFrames"])
        self.assertEqual(plan["durationInFrames"], round(3.35 * 30))
        self.assertEqual(plan["captions"][0]["endFrame"], plan["captions"][1]["startFrame"])

    def test_bad_slots_and_caption_timing_fail_before_node(self):
        script = {"title": "Safety brief", "beats": [{}]}
        for slots in ([], [float("nan")], [-1], [True]):
            with self.subTest(slots=slots), self.assertRaises(ValueError):
                remotion.assemble_plan(storyboard(), script, slots, [], pipeline.DEFAULT_SETTINGS)
        for captions in ([{"start": -1, "end": 1, "text": "bad"}],
                         [{"start": 1, "end": 1, "text": "bad"}],
                         [{"start": 0, "end": 2.01, "text": "bad"}],
                         [{"start": 0, "end": 1.5, "text": "A"}, {"start": 1, "end": 2, "text": "B"}],
                         [{"start": 0, "end": 1, "text": "x" * 201}]):
            with self.subTest(captions=captions), self.assertRaises(ValueError):
                remotion.assemble_plan(storyboard(), script, [2], captions, pipeline.DEFAULT_SETTINGS)

    def test_long_title_is_generic_without_changing_saved_script(self):
        script = {"title": "x" * 201, "beats": [{}]}
        plan = remotion.assemble_plan(storyboard(), script, [2], [], pipeline.DEFAULT_SETTINGS)
        self.assertEqual(plan["title"], "Explainer")
        self.assertEqual(len(script["title"]), 201)

    def test_disabled_captions_omit_cues_and_all_quality_aspects_have_even_dimensions(self):
        for quality in ("480p", "720p", "1080p"):
            for aspect in ("16:9", "9:16"):
                settings = {**pipeline.DEFAULT_SETTINGS, "quality": quality, "aspect": aspect, "captions": False}
                plan = remotion.assemble_plan(storyboard(), {"title": "Safety", "beats": [{}]}, [2],
                                              [{"start": 0, "end": 1, "text": "Caption"}], settings)
                self.assertEqual(plan["captions"], [])
                self.assertEqual(plan["width"] % 2, 0)
                self.assertEqual(plan["height"] % 2, 0)
                self.assertLess(abs(plan["width"] / plan["height"] - (16 / 9 if aspect == "16:9" else 9 / 16)), 0.02)

    def test_fallback_uses_complete_approved_narration_and_qualifications(self):
        text = "The brochure lists braking equipment. Equipment may vary by region and machine specification."
        result = remotion.fallback_storyboard({"title": "Safety", "beats": [{"narration": text}]})
        self.assertEqual(result["scenes"][0]["body"], text)
        longer = "A" * 190 + " equipment is not standard on every machine."
        result = remotion.fallback_storyboard({"beats": [{"narration": longer}]})
        self.assertEqual(result["scenes"][0]["headline"], "Key point 1")
        self.assertEqual(result["scenes"][0]["body"], "Follow the narrated explanation.")

    def test_planner_uses_approved_claims_and_source_provenance_not_document_text(self):
        script = {"title": "Safety", "beats": [{"narration": "Equipment varies.", "source_refs": ["Page 10"]}]}
        messages = remotion.planner_messages(script, "infotainment", "paper", {"title": "CAT brochure", "text": "PRIVATE_DOCUMENT"})
        encoded = json.dumps(messages)
        self.assertIn("Equipment varies", encoded)
        self.assertIn("Page 10", encoded)
        self.assertNotIn("PRIVATE_DOCUMENT", encoded)
        self.assertIn("operating procedures", encoded)
        self.assertIn("independent features", encoded)
        self.assertIn("items array is mandatory", encoded)
        self.assertIn("headline in at most 8 words and <=50 characters", encoded)
        self.assertIn("item label in at most 5 words and <=36 characters", encoded)
        self.assertIn("Do not include a body field", encoded)
        self.assertIn("each selected claim must remain complete and accurate", encoded)
        self.assertIn("Do not turn a conditional claim into an unconditional label", encoded)
        self.assertIn("Complete schema example", encoded)
        example = messages[0]["content"].split("approved content): ", 1)[1].split(". Select distinctive", 1)[0]
        example = remotion.validate_storyboard(json.loads(example), 2)
        self.assertTrue(all("body" not in scene for scene in example["scenes"]))

    def test_auto_routes_math_and_general_topics_with_legacy_preservation(self):
        for topic, mode, expected in (("Transformer LLM attention", "auto", "manim"),
                                      ("Attention Is All You Need", "auto", "manim"),
                                      ("AttentionIsAllYouNeed", "auto", "manim"),
                                      ("Braking and spring grades", "auto", "remotion"),
                                      ("A safety brief about physics equipment", "auto", "remotion"),
                                      ("Quantum history story", "storytelling", "remotion"),
                                      ("Quantum trivia", "infotainment", "remotion"),
                                      ("Numbers", "math_science", "manim")):
            with self.subTest(topic=topic):
                self.assertEqual(pipeline.resolve_renderer({"renderer": "auto", "content_mode": mode}, topic), expected)
        self.assertEqual(pipeline.resolve_renderer({"content_mode": "storytelling"}, "History"), "manim")
        self.assertEqual(pipeline.normalize_settings({})["renderer"], "auto")
        with self.assertRaises(ValueError):
            pipeline.normalize_settings({"renderer": "jsx"})

    def test_faithfulness_review_covers_sources_and_safety_without_extra_document_text(self):
        story = {"title": "A friendship", "beats": [{"narration": "Two friends walk through a forest."}]}
        self.assertFalse(remotion.needs_faithfulness_review(story, None))
        self.assertTrue(remotion.needs_faithfulness_review(story, {"title": "An article"}))
        self.assertTrue(remotion.needs_faithfulness_review(story, None, "Make a machine safety briefing"))
        self.assertTrue(remotion.needs_faithfulness_review({"beats": [{"source_refs": ["Page 10"]}]}, None))
        script = {"title": "Safety", "beats": [
            {"narration": "The parking brake engages if hydraulic pressure is lost."},
            {"narration": "The system applies the brake if the operator exits without setting it."},
            {"narration": "The ground-level switch and separately listed frame lock are independent features."}]}
        source = {"title": "Brochure", "text": "PRIVATE_DOCUMENT"}
        messages = remotion.faithfulness_messages(script, storyboard(3), source)
        self.assertEqual(json.loads(messages[1]["content"])["approved_script"], script)
        encoded = json.dumps(messages)
        self.assertNotIn("PRIVATE_DOCUMENT", encoded)
        self.assertIn("brake engages when hydraulic pressure is lost", encoded)
        self.assertIn("do not say it releases", encoded)
        self.assertIn("without setting the parking brake", encoded)
        self.assertIn("Evaluate each heading as a standalone claim", encoded)
        self.assertIn("every heading modifier against every displayed feature", encoded)
        self.assertIn("Ground-level safety features", encoded)
        self.assertIn("Independent features must stay independent", encoded)

    def test_review_requires_complete_scope_audit_and_corrects_flagged_fields(self):
        original = storyboard()
        original["scenes"][0]["headline"] = "Ground-level safety features"
        envelope = reviewed_storyboard(original, {1: [{"field": "headline", "reason": "Only the switch is described at ground level."}]})
        with self.assertRaisesRegex(ValueError, "did not correct"):
            remotion.validate_faithfulness_review(envelope, original, 1)
        envelope["storyboard"] = copy.deepcopy(original)
        envelope["storyboard"]["scenes"][0]["headline"] = "Safety features"
        clean, audit = remotion.validate_faithfulness_review(envelope, original, 1)
        self.assertEqual(clean["scenes"][0]["headline"], "Safety features")
        self.assertEqual(audit[0]["issues"][0]["field"], "headline")
        for bad in ({"audit": [], "storyboard": storyboard()}, storyboard(),
                    {"audit": [{"scene": 2, "headline_scope": "A heading", "issues": []}], "storyboard": storyboard()}):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                remotion.validate_faithfulness_review(bad, original, 1)


class PipelineQA(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=WORK)
        self.patch = patch.object(pipeline, "JOBS_DIR", Path(self.tmp.name))
        self.patch.start()
        self.available = patch.object(remotion, "ensure_available")
        self.available.start()
        self.browser = patch.object(remotion, "ensure_browser", AsyncMock())
        self.browser_mock = self.browser.start()
        self.manager = pipeline.JobManager()

    async def asyncTearDown(self):
        tasks = [job.task for job in self.manager.jobs.values() if job.task and not job.task.done()]
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self.patch.stop()
        self.available.stop()
        self.browser.stop()
        self.tmp.cleanup()

    def job(self, renderer="remotion"):
        job = pipeline.Job({"id": "qa-remotion", "prompt": "Safety brief", "title": "Safety", "created_at": 1,
                            "status": "error", "settings": {**pipeline.DEFAULT_SETTINGS, "renderer": renderer},
                            "renderer_used": renderer, "logs": [], "script": {"title": "Safety", "beats": [
                                {"narration": "Equipment varies by region.", "visual": "Machine specification", "audio_duration": 1.5}]},
                            "slots": [2.7], "captions": [],
                            "steps": [{"key": k, "label": label, "status": "pending"} for k, label in pipeline.STEPS]})
        job.save()
        (job.dir / "narration.wav").write_bytes(b"purchased narration")
        audio = job.dir / "audio"
        audio.mkdir()
        (audio / "beat_00.mp3").write_bytes(b"purchased clip")
        self.manager.jobs[job.id] = job
        return job

    async def test_missing_remotion_rejects_create_before_task_or_voice_purchase(self):
        with patch.object(remotion, "ensure_available", side_effect=remotion.RemotionError("Not installed. No voiceover was purchased.")), \
             patch.object(pipeline, "run_full", AsyncMock()) as runner:
            with self.assertRaisesRegex(RuntimeError, "No voiceover"):
                self.manager.create("A safety brief", {}, {})
        runner.assert_not_awaited()
        self.assertEqual(self.manager.jobs, {})
        self.assertEqual(list(Path(self.tmp.name).iterdir()), [])

    async def test_source_title_classifies_before_script_or_voice(self):
        source = {"id": "qa-source", "title": "Attention Is All You Need", "text": "Queries and keys."}
        with patch.object(pipeline, "run_full", AsyncMock()):
            job = self.manager.create("", {}, {}, source)
            self.assertEqual(job.data["renderer_used"], "manim")
            await job.task

    async def test_full_generation_prepares_browser_before_voice(self):
        job = self.job()
        order = []
        async def browser(): order.append("browser")
        async def voice(*args): order.append("voice")
        with patch.object(remotion, "ensure_browser", browser), patch.object(pipeline, "stage_voice", voice), \
             patch.object(pipeline, "stage_script", AsyncMock()), patch.object(pipeline, "stage_code", AsyncMock()), \
             patch.object(pipeline, "stage_test", AsyncMock()), patch.object(pipeline, "stage_render_and_mix", AsyncMock()):
            await pipeline.run_full(job, {"deepseek": "unused", "elevenlabs": "unused"})
        self.assertEqual(order, ["browser", "voice"])

    async def test_browser_failure_stops_before_narration_purchase(self):
        job = self.job()
        voice = AsyncMock()
        with patch.object(remotion, "ensure_browser", AsyncMock(side_effect=remotion.RemotionError("Browser unavailable"))), \
             patch.object(pipeline, "stage_script", AsyncMock()), patch.object(pipeline, "stage_voice", voice):
            with self.assertRaisesRegex(RuntimeError, "Browser unavailable"):
                await pipeline.run_full(job, {"deepseek": "unused", "elevenlabs": "unused"})
        voice.assert_not_awaited()

    async def test_planner_direct_json_once_and_retry_invalid_data_once(self):
        job = self.job()
        wrong = storyboard()
        wrong["scenes"][0]["headline"] = "x" * 81
        chat = AsyncMock(side_effect=[json.dumps(wrong), json.dumps(storyboard()), json.dumps(reviewed_storyboard(storyboard()))])
        with patch.object(deepseek, "chat", chat):
            await pipeline.stage_code(job, "unused", job.data["settings"])
        self.assertEqual(chat.await_count, 3)
        repair_call = chat.await_args_list[1]
        self.assertEqual(json.loads(repair_call.args[2][-2]["content"]), wrong)
        self.assertEqual(repair_call.args[2][-2]["role"], "assistant")
        self.assertIn("headline exceeds 80", repair_call.args[2][-1]["content"])
        self.assertIn("items:[]", repair_call.args[2][-1]["content"])
        self.assertFalse(repair_call.kwargs["thinking"])
        self.assertEqual(repair_call.kwargs["max_tokens"], 4000)
        self.assertTrue(chat.await_args.kwargs["thinking"])
        self.assertEqual(chat.await_args.kwargs["max_tokens"], 24000)
        self.assertEqual(json.loads(job.data["code"]), storyboard())
        self.assertNotIn("startFrame", json.loads(job.data["code"])["scenes"][0])
        self.assertIn("startFrame", job.data["remotion_plan"]["scenes"][0])
        self.assertTrue((job.dir / "remotion-plan.json").is_file())
        self.assertFalse((job.dir / "scene.py").exists())
        self.assertEqual(json.loads((job.dir / "storyboard-candidate-1.json").read_text()), wrong)
        self.assertEqual(json.loads((job.dir / "storyboard-candidate-2.json").read_text()), storyboard())

    async def test_planner_repair_identifies_all_overlong_fields_without_truncating_claims(self):
        job = self.job()
        wrong = storyboard()
        wrong["scenes"][0].update(body="The system may not be installed. " * 8, footer="Confirm the specification. " * 5)
        wrong["scenes"][0]["items"][0]["label"] = "Optional equipment is not standard. " * 3
        chat = AsyncMock(side_effect=[json.dumps(wrong), json.dumps(storyboard()), json.dumps(reviewed_storyboard(storyboard()))])
        with patch.object(deepseek, "chat", chat):
            await pipeline.stage_code(job, "unused", job.data["settings"])
        repair = chat.await_args_list[1].args[2][-1]["content"]
        for path in ("scenes[0].body", "scenes[0].footer", "scenes[0].items[0].label"):
            self.assertIn(path, repair)
        self.assertIn("Do not include any body fields", repair)
        self.assertIn("retaining their conditions and caveats", repair)
        self.assertEqual(json.loads(chat.await_args_list[1].args[2][-2]["content"]), wrong)
        self.assertEqual(json.loads((job.dir / "storyboard-candidate-1.json").read_text()), wrong)
        self.assertEqual(json.loads(job.data["code"]), storyboard())

    async def test_source_or_safety_plan_is_reviewed_once_and_corrected_before_storage(self):
        job = self.job()
        job.data["script"]["beats"][0]["narration"] = "The brake engages if hydraulic pressure is lost. Equipment may vary."
        unsafe = storyboard()
        unsafe["scenes"][0]["items"] = [{"label": "Parking brake", "detail": "Releases if hydraulic pressure is lost."}]
        corrected = storyboard()
        corrected["scenes"][0]["items"] = [{"label": "Parking brake", "detail": "Engages if hydraulic pressure is lost. Equipment may vary."}]
        reviewed = reviewed_storyboard(corrected, {1: [{"field": "items[0].detail", "reason": "Pressure loss engages this brake; it does not release it."}]})
        chat = AsyncMock(side_effect=[json.dumps(unsafe), json.dumps(reviewed)])
        with patch.object(deepseek, "chat", chat), patch.object(pipeline, "stage_voice", AsyncMock()) as voice:
            await pipeline.stage_code(job, "unused", job.data["settings"])
        self.assertEqual(chat.await_count, 2)
        payload = json.loads(chat.await_args.args[2][1]["content"])
        self.assertEqual(payload["storyboard_to_review"], unsafe)
        self.assertIn("engages if hydraulic pressure is lost", payload["approved_script"]["beats"][0]["narration"])
        self.assertEqual(json.loads(job.data["code"]), corrected)
        self.assertEqual(json.loads((job.dir / "storyboard-review-candidate.json").read_text()), reviewed)
        self.assertEqual(job.data["storyboard_review"]["status"], "ai_reviewed")
        self.assertTrue(job.data["storyboard_review"]["changed"])
        self.assertTrue(job.data["storyboard_review"]["manual_review_recommended"])
        self.assertEqual(job.data["storyboard_review"]["audit"], reviewed["audit"])
        self.assertTrue(chat.await_args.kwargs["thinking"])
        self.assertEqual(chat.await_args.kwargs["reasoning_effort"], "high")
        self.assertEqual(chat.await_args.kwargs["max_tokens"], 24000)
        self.assertNotIn("storyboard_fallback_warning", job.data)
        voice.assert_not_awaited()
        self.assertEqual((job.dir / "narration.wav").read_bytes(), b"purchased narration")

    async def test_failed_review_falls_back_once_to_original_qualified_narration(self):
        job = self.job()
        for failure in ('{"version":1,"scenes":[]}', deepseek.DeepSeekError("Review unavailable")):
            job.data["script"]["beats"][0]["narration"] = "The brake engages if hydraulic pressure is lost. Equipment may vary."
            chat = AsyncMock(side_effect=[json.dumps(storyboard()), failure])
            with self.subTest(failure=failure), patch.object(deepseek, "chat", chat):
                await pipeline.stage_code(job, "unused", job.data["settings"])
            self.assertEqual(chat.await_count, 2)
            self.assertIn("The brake engages if hydraulic pressure is lost. Equipment may vary.", job.data["code"])
            self.assertEqual(job.data["storyboard_review"]["status"], "fallback")
            self.assertIn(job.data["storyboard_fallback_warning"], job.data["quality_issues"])

    async def test_unsourced_story_keeps_one_planner_request(self):
        job = self.job()
        job.data["prompt"] = "Tell a friendship story"
        job.data["script"] = {"title": "Two friends", "beats": [{"narration": "They walk through a forest."}]}
        chat = AsyncMock(return_value=json.dumps(storyboard()))
        with patch.object(deepseek, "chat", chat):
            await pipeline.stage_code(job, "unused", job.data["settings"])
        self.assertEqual(chat.await_count, 1)
        self.assertEqual(job.data["storyboard_review"]["status"], "not_required")

    async def test_two_invalid_plans_fall_back_without_dropping_approved_qualification(self):
        job = self.job()
        chat = AsyncMock(return_value='{"version":1,"scenes":[]}')
        with patch.object(deepseek, "chat", chat):
            await pipeline.stage_code(job, "unused", job.data["settings"])
        self.assertEqual(chat.await_count, 2)
        self.assertIn("Equipment varies by region.", job.data["code"])

    async def test_no_key_fallback_and_public_preview_preserve_audio(self):
        job = self.job()
        chat = AsyncMock()
        with patch.object(deepseek, "chat", chat):
            await pipeline.stage_code(job, None, job.data["settings"])
        chat.assert_not_awaited()
        public = pipeline.public_job(job)
        self.assertEqual(public["renderer_used"], "remotion")
        self.assertIn("remotion_plan", public)
        self.assertIn("narration.wav", public["preview_audio_url"])
        self.assertEqual((job.dir / "narration.wav").read_bytes(), b"purchased narration")

    async def test_resume_remotion_needs_no_keys_and_reuses_paid_clips(self):
        job = self.job()
        voice = AsyncMock()
        with patch.object(pipeline, "stage_voice", voice), patch.object(pipeline, "stage_test", AsyncMock()), \
             patch.object(pipeline, "stage_render_and_mix", AsyncMock()), patch.object(deepseek, "chat", AsyncMock()) as chat:
            self.manager.resume(job, {})
            await job.task
        self.assertEqual(job.data["status"], "done")
        self.assertTrue(voice.await_args.kwargs["reuse_existing"])
        self.assertIsNone(voice.await_args.args[1])
        chat.assert_not_awaited()
        self.assertEqual((job.dir / "audio/beat_00.mp3").read_bytes(), b"purchased clip")

    async def test_switch_both_directions_reuses_saved_python_and_storyboard(self):
        job = self.job("manim")
        python = "class ExplainerVideo(EduScene): pass"
        (job.dir / "scene.py").write_text(python)
        original_audio = (job.dir / "narration.wav").read_bytes()
        with patch.object(pipeline, "stage_test", AsyncMock()), patch.object(pipeline, "stage_render_and_mix", AsyncMock()), \
             patch.object(pipeline, "stage_voice", AsyncMock()) as voice, patch.object(deepseek, "chat", AsyncMock()) as chat:
            self.manager.rerender(job, {}, None, False, {"renderer": "remotion"})
            await job.task
            saved_storyboard = job.data["code"]
            self.assertEqual(job.data["renderer_used"], "remotion")
            self.assertIn("remotion_plan", pipeline.public_job(job))
            self.manager.rerender(job, {}, None, False, {"renderer": "manim"})
            self.assertEqual(pipeline.public_job(job)["code"], python)
            self.assertNotIn("remotion_plan", pipeline.public_job(job))
            self.assertNotIn("preview_audio_url", pipeline.public_job(job))
            await job.task
            self.assertEqual(job.data["code"], python)
            self.manager.rerender(job, {}, None, False, {"renderer": "remotion"})
            await job.task
            self.assertEqual(job.data["code"], saved_storyboard)
        voice.assert_not_awaited()
        chat.assert_not_awaited()
        self.assertEqual((job.dir / "scene.py").read_text(), python)
        self.assertEqual((job.dir / "narration.wav").read_bytes(), original_audio)

    async def test_wrong_renderer_edits_fail_without_mutating_job(self):
        job = self.job("manim")
        before = copy.deepcopy(job.data)
        with self.assertRaisesRegex(ValueError, "storyboard JSON"):
            self.manager.rerender(job, {}, "class ExplainerVideo: pass", False, {"renderer": "remotion"})
        self.assertEqual(before, job.data)
        with self.assertRaisesRegex(ValueError, "Python"):
            self.manager.rerender(job, {}, json.dumps(storyboard()), False, {"renderer": "manim"})
        self.assertEqual(before, job.data)

    async def test_native_remotion_to_manim_missing_key_fails_before_mutation(self):
        job = self.job()
        pipeline._store_storyboard(job, storyboard())
        before = copy.deepcopy(job.data)
        self.assertFalse(pipeline.public_job(job)["has_manim_code"])
        self.assertFalse(job.summary()["has_manim_code"])
        with self.assertRaisesRegex(ValueError, "DeepSeek API key.*existing narration will be reused"):
            self.manager.rerender(job, {}, None, False, {"renderer": "manim"})
        self.assertEqual(job.data, before)
        self.assertIsNone(job.task)

    async def test_api_native_remotion_to_manim_auto_plans_when_key_supplied_and_reuses_narration(self):
        main = importlib.import_module("app.main")
        job = self.job()
        pipeline._store_storyboard(job, storyboard())
        original_script = copy.deepcopy(job.data["script"])
        # A blank file is not a saved animation that can be reused.
        (job.dir / "scene.py").write_text(" \n")
        python = "class ExplainerVideo(EduScene): pass\n"

        async def make_scene(target, key, settings):
            self.assertEqual(settings["renderer"], "manim")
            self.assertEqual(key, "unused-test-key")
            (target.dir / "scene.py").write_text(python)
            target.data["code"] = python
            target.data["manim_style"] = settings["style"]
            target.data.pop("manim_regeneration_pending", None)

        with patch.object(main, "manager", self.manager), patch.object(pipeline, "stage_code", AsyncMock(side_effect=make_scene)) as code, \
             patch.object(pipeline, "stage_test", AsyncMock()), patch.object(pipeline, "stage_render_and_mix", AsyncMock()), \
             patch.object(pipeline, "stage_voice", AsyncMock()) as voice, patch.object(deepseek, "chat", AsyncMock()) as chat:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
                before = copy.deepcopy(job.data)
                missing = await client.post(f"/api/jobs/{job.id}/rerender", json={"settings": {"renderer": "manim"}})
                self.assertEqual(missing.status_code, 422)
                self.assertEqual(job.data, before)
                response = await client.post(f"/api/jobs/{job.id}/rerender",
                                             json={"settings": {"renderer": "manim"}, "deepseek_key": "unused-test-key"})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["renderer_used"], "manim")
                self.assertFalse(response.json()["has_manim_code"])
                await job.task
        code.assert_awaited_once()
        voice.assert_not_awaited()
        chat.assert_not_awaited()
        self.assertEqual(job.data["script"], original_script)
        self.assertEqual((job.dir / "narration.wav").read_bytes(), b"purchased narration")
        self.assertEqual((job.dir / "audio/beat_00.mp3").read_bytes(), b"purchased clip")
        self.assertTrue(pipeline.public_job(job)["has_manim_code"])
        self.assertTrue(job.summary()["has_manim_code"])
        self.assertEqual(job.data["code"], python)

    async def test_native_remotion_switch_reuses_saved_manim_or_explicit_edit_without_key(self):
        job = self.job()
        pipeline._store_storyboard(job, storyboard())
        original = "class ExplainerVideo(EduScene): pass\n"
        edited = "class ExplainerVideo(EduScene):\n    def construct(self): pass\n"
        (job.dir / "scene.py").write_text(original)
        job.data["manim_style"] = "classic"
        with patch.object(pipeline, "stage_code", AsyncMock()) as code, patch.object(pipeline, "stage_test", AsyncMock()), \
             patch.object(pipeline, "stage_render_and_mix", AsyncMock()), patch.object(pipeline, "stage_voice", AsyncMock()) as voice:
            self.manager.rerender(job, {}, None, False, {"renderer": "manim"})
            await job.task
            self.assertEqual(job.data["code"], original)
            (job.dir / "scene.py").unlink()
            self.manager.rerender(job, {}, edited, False, {"renderer": "manim"})
            await job.task
        self.assertEqual(job.data["code"], edited)
        self.assertEqual((job.dir / "scene.py").read_text(), edited)
        self.assertEqual((job.dir / "narration.wav").read_bytes(), b"purchased narration")
        code.assert_not_awaited()
        voice.assert_not_awaited()

    async def test_resume_switch_to_saved_manim_needs_no_generation_keys(self):
        job = self.job()
        await pipeline.stage_code(job, None, job.data["settings"])
        python = "class ExplainerVideo(EduScene): pass"
        (job.dir / "scene.py").write_text(python)
        with patch.object(pipeline, "run_resume", AsyncMock()):
            self.manager.resume(job, {}, {"renderer": "manim"})
            public = pipeline.public_job(job)
            self.assertEqual(public["renderer_used"], "manim")
            self.assertEqual(public["code"], python)
            self.assertNotIn("remotion_plan", public)
            self.assertNotIn("preview_audio_url", public)
            await job.task

    async def test_legacy_disk_job_retains_manim_and_dynamic_labels(self):
        job = self.job("manim")
        job.data["settings"].pop("renderer")
        job.data.pop("renderer_used")
        job.data["settings"]["content_mode"] = "storytelling"
        job.save()
        loaded = pipeline.JobManager().get(job.id)
        self.assertEqual(loaded.data["renderer_used"], "manim")
        self.assertIn("ManimGL", next(x["label"] for x in loaded.data["steps"] if x["key"] == "code"))
        self.assertEqual(loaded.summary()["renderer_used"], "manim")

    async def test_validation_and_render_dispatch_to_remotion_then_mux(self):
        job = self.job()
        await pipeline.stage_code(job, None, job.data["settings"])
        result = remotion.Result(True, path=job.dir / "remotion-silent.mp4", issues=[])
        runner = AsyncMock(return_value=result)
        with patch.object(remotion, "run", runner), patch.object(pipeline.render, "run_manim", AsyncMock()) as manim, \
             patch.object(pipeline.media, "mux", AsyncMock(return_value=2.7)) as mux, patch.object(pipeline.media, "thumbnail", AsyncMock()):
            await pipeline.stage_test(job, None, job.data["settings"])
            await pipeline.stage_render_and_mix(job, job.data["settings"])
        self.assertEqual(runner.await_count, 2)
        self.assertEqual(runner.await_args_list[0].kwargs["validate_dir"], job.dir / "remotion-validation")
        self.assertNotIn("validate_dir", runner.await_args_list[1].kwargs)
        manim.assert_not_awaited()
        self.assertEqual(mux.await_args.args[1], job.dir / "narration.wav")
        self.assertEqual(job.data["duration"], 2.7)

    async def test_validate_failure_never_marks_job_done(self):
        job = self.job()
        await pipeline.stage_code(job, None, job.data["settings"])
        with patch.object(remotion, "run", AsyncMock(return_value=remotion.Result(False, error="Text overflows"))):
            await self.manager._guard(job, lambda: pipeline.stage_test(job, None, job.data["settings"]))
        self.assertEqual(job.data["status"], "error")
        self.assertIn("Text overflows", job.data["error"])

    async def test_fallback_warning_survives_clean_validation_and_manual_edit_clears_it(self):
        job = self.job()
        await pipeline.stage_code(job, None, job.data["settings"])
        warning = job.data["storyboard_fallback_warning"]
        result = remotion.Result(True, path=job.dir / "remotion-silent.mp4", issues=[])
        with patch.object(remotion, "run", AsyncMock(return_value=result)), \
             patch.object(pipeline.media, "mux", AsyncMock(return_value=2.7)), patch.object(pipeline.media, "thumbnail", AsyncMock()):
            await pipeline.stage_test(job, None, job.data["settings"])
            await pipeline.stage_render_and_mix(job, job.data["settings"])
            self.assertIn(warning, job.data["quality_issues"])
            self.manager.rerender(job, {}, json.dumps(storyboard()), False, None)
            await job.task
        self.assertNotIn("storyboard_fallback_warning", job.data)
        self.assertEqual(job.data["quality_issues"], [])

    async def test_api_health_and_keyless_renderer_switch(self):
        main = importlib.import_module("app.main")
        job = self.job("manim")
        with patch.object(main, "manager", self.manager), patch.object(remotion, "availability", return_value={"available": True, "version": "4.0.534", "reason": None}), \
             patch.object(pipeline, "run_rerender", AsyncMock()):
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
                health = (await client.get("/api/health")).json()
                self.assertTrue(health["remotion"]["available"])
                response = await client.post(f"/api/jobs/{job.id}/rerender", json={"settings": {"renderer": "remotion"}})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["renderer_used"], "remotion")
                await job.task

    async def test_api_manual_storyboard_edit_replaces_old_review_metadata_without_provider_calls(self):
        main = importlib.import_module("app.main")
        job = self.job()
        pipeline._store_storyboard(job, storyboard())
        old_review = {"status": "ai_reviewed", "model": "previous-model", "changed": True,
                      "against": "approved_narration", "manual_review_recommended": True, "audit": [{"scene": 1}]}
        job.data["storyboard_review"] = dict(old_review)
        job.save()
        edited = storyboard()
        edited["scenes"][0]["headline"] = "Check the equipment specification"
        with patch.object(main, "manager", self.manager), patch.object(pipeline, "stage_test", AsyncMock()), \
             patch.object(pipeline, "stage_render_and_mix", AsyncMock()), \
             patch.object(pipeline, "stage_voice", AsyncMock()) as voice, patch.object(deepseek, "chat", AsyncMock()) as chat:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
                invalid = await client.post(f"/api/jobs/{job.id}/rerender", json={"code": "not JSON"})
                self.assertEqual(invalid.status_code, 422)
                self.assertEqual(job.data["storyboard_review"], old_review)
                response = await client.post(f"/api/jobs/{job.id}/rerender", json={"code": json.dumps(edited)})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()["storyboard_review"],
                                 {"status": "user_edited", "manual_review_recommended": True})
                await job.task
        self.assertEqual(json.loads(job.data["code"]), edited)
        self.assertEqual(job.data["storyboard_review"]["status"], "user_edited")
        self.assertEqual(json.loads((job.dir / "job.json").read_text())["storyboard_review"], job.data["storyboard_review"])
        self.assertEqual((job.dir / "narration.wav").read_bytes(), b"purchased narration")
        voice.assert_not_awaited()
        chat.assert_not_awaited()


class BridgeQA(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=WORK)
        self.root = Path(self.tmp.name)

    async def asyncTearDown(self):
        self.tmp.cleanup()

    def process(self, event, returncode=0):
        stream = asyncio.StreamReader()
        stream.feed_data((json.dumps({"progress": 0.4}) + "\n" + json.dumps(event) + "\n").encode())
        stream.feed_eof()
        proc = AsyncMock()
        proc.stdout = stream
        proc.returncode = returncode
        proc.pid = 999999
        proc.wait = AsyncMock(return_value=returncode)
        return proc

    async def test_cli_validation_uses_boolean_flag_and_output_directory(self):
        proc = self.process({"ok": True, "path": str(self.root / "report.json"), "issues": []})
        with patch.object(remotion, "ensure_available"), patch.object(asyncio, "create_subprocess_exec", AsyncMock(return_value=proc)) as create:
            result = await remotion.run(self.root / "plan.json", self.root / "silent.mp4", validate_dir=self.root / "validation")
        args = create.await_args.args
        self.assertEqual(args[args.index("--output") + 1], str(self.root / "validation"))
        self.assertEqual(args[-1], "--validate")
        self.assertTrue(result.ok)

    async def test_progress_and_expected_output_are_required(self):
        output = self.root / "silent.mp4"
        output.write_bytes(b"video")
        proc = self.process({"ok": True, "path": str(output), "issues": ["Review note"]})
        progress = AsyncMock()
        with patch.object(remotion, "ensure_available"), patch.object(asyncio, "create_subprocess_exec", AsyncMock(return_value=proc)):
            result = await remotion.run(self.root / "plan.json", output, on_progress=progress)
        self.assertTrue(result.ok)
        self.assertEqual(result.issues, ["Review note"])
        progress.assert_awaited_once_with(0.4)
        output.unlink()
        proc = self.process({"ok": True, "path": str(output), "issues": []})
        with patch.object(remotion, "ensure_available"), patch.object(asyncio, "create_subprocess_exec", AsyncMock(return_value=proc)):
            result = await remotion.run(self.root / "plan.json", output)
        self.assertFalse(result.ok)
        self.assertIn("expected video", result.error)

    async def test_failure_reports_runner_phase_and_material_issues(self):
        proc = self.process({"ok": False, "phase": "open-browser", "error": "Target closed", "issues": []}, returncode=1)
        with patch.object(remotion, "ensure_available"), patch.object(asyncio, "create_subprocess_exec", AsyncMock(return_value=proc)):
            result = await remotion.run(self.root / "plan.json", self.root / "silent.mp4")
        self.assertFalse(result.ok)
        self.assertIn("Remotion open-browser: Target closed", result.error)

    async def test_cancellation_first_signals_graceful_shutdown_and_waits(self):
        stream = asyncio.StreamReader()
        proc = AsyncMock(stdout=stream, pid=999999)
        proc.wait = AsyncMock(return_value=-15)
        with patch.object(remotion, "ensure_available"), patch.object(asyncio, "create_subprocess_exec", AsyncMock(return_value=proc)), \
             patch.object(remotion.os, "killpg") as kill:
            task = asyncio.create_task(remotion.run(self.root / "plan.json", self.root / "silent.mp4"))
            await asyncio.sleep(0)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
        kill.assert_called_once_with(proc.pid, signal.SIGTERM)
        proc.wait.assert_awaited_once()

    async def test_timeout_returns_readable_failure_after_stopping_node(self):
        stream = asyncio.StreamReader()
        proc = AsyncMock(stdout=stream, pid=999999)
        proc.wait = AsyncMock(return_value=-15)
        with patch.object(remotion, "ensure_available"), patch.object(asyncio, "create_subprocess_exec", AsyncMock(return_value=proc)), \
             patch.object(remotion.os, "killpg") as kill:
            result = await remotion.run(self.root / "plan.json", self.root / "silent.mp4", timeout=0.001)
        self.assertFalse(result.ok)
        self.assertIn("timed out", result.error)
        kill.assert_called_once_with(proc.pid, signal.SIGTERM)


if __name__ == "__main__":
    unittest.main()
