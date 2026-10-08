"""Illustrated teaching, trusted visual data and renderer/theme round trips; no providers."""
from __future__ import annotations

import copy
import importlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

from app import deepseek, pipeline, prompts, remotion

WORK = Path("/Users/bronsonwoods/Documents/Codex/2026-10-07/ther/work")


def storyboard():
    return {"version": 1, "scenes": [{"template": "hero", "headline": "Context changes the representation",
                                     "items": [{"label": "Context", "icon": "brain"}]}]}


class IllustratedDataQA(unittest.TestCase):
    def test_illustrated_auto_overrides_math_but_standard_routing_stays_unchanged(self):
        settings = pipeline.normalize_settings({"style": "illustrated", "renderer": "auto", "content_mode": "math_science"})
        self.assertEqual(pipeline.resolve_renderer(settings, "Transformer LLM attention"), "remotion")
        self.assertEqual(pipeline.resolve_renderer({**settings, "renderer": "remotion"}), "remotion")
        for style in ("classic", "neon", "chalkboard", "paper"):
            self.assertEqual(pipeline.resolve_renderer({"style": style, "renderer": "auto", "content_mode": "math_science"}), "manim")
        with self.assertRaisesRegex(ValueError, "requires Remotion"):
            pipeline.normalize_settings({"style": "illustrated", "renderer": "manim"})
        with self.assertRaisesRegex(ValueError, "requires Remotion"):
            pipeline.resolve_renderer({"style": "illustrated", "renderer": "manim"})

    def test_illustration_is_strict_plain_data_and_never_clips_qualified_labels(self):
        value = storyboard()
        value["scenes"][0]["illustration"] = {"subject": "attention", "motion": "pulse", "mode": "schematic",
                                            "labels": ["Earlier tokens only", "Optional equipment may vary"]}
        self.assertEqual(remotion.validate_storyboard(value, 1), value)
        for change in ({"subject": "external-image"}, {"motion": "execute"}, {"mode": "photorealistic"},
                       {"asset": "/etc/passwd"}, {"labels": ["x" * 41]}, {"labels": ["https://example.com"]},
                       {"labels": ["<script>run()</script>"]}, {"labels": ["bad\x00text"]},
                       {"labels": ["1", "2", "3", "4", "5"]}, {"labels": [True]}, {"labels": [""]}):
            invalid = copy.deepcopy(value)
            invalid["scenes"][0]["illustration"].update(change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                remotion.validate_storyboard(invalid, 1)
        invalid = copy.deepcopy(value)
        del invalid["scenes"][0]["illustration"]["mode"]
        with self.assertRaises(ValueError):
            remotion.validate_storyboard(invalid, 1)

    def test_inference_chooses_concepts_without_inventing_motion_or_truncating_claims(self):
        for narration, subject, motion in (("Transformers use tokens and self-attention.", "abstract", "pulse"),
                                           ("Cells contain DNA.", "cell", "pulse"),
                                           ("Atoms contain electrons.", "atom", "pulse"),
                                           ("Planets orbit a star.", "planet", "orbit"),
                                           ("Trees collect light in their leaves.", "nature", "pulse"),
                                           ("A secondary engine shutoff is listed.", "machine", "pulse"),
                                           ("The machine does not assemble itself.", "machine", "pulse"),
                                           ("Plants grow only if enough light is available.", "nature", "pulse")):
            scene = {"items": [{"label": "A complete short concept"}, {"label": "x" * 39 + " not standard"}]}
            illustration = remotion.infer_illustration({"narration": narration}, scene)
            self.assertEqual((illustration["subject"], illustration["motion"]), (subject, motion))
            self.assertEqual(illustration["labels"], ["A complete short concept"])

    def test_saved_storyboard_enrichment_preserves_input_and_timing(self):
        original = storyboard()
        before = copy.deepcopy(original)
        script = {"title": "Context", "beats": [{"narration": "Transformers use earlier tokens to form context."}]}
        settings = {**pipeline.DEFAULT_SETTINGS, "renderer": "remotion", "style": "illustrated"}
        plan = remotion.assemble_plan(original, script, [3.25], [], settings)
        self.assertEqual(original, before)
        self.assertEqual(plan["style"], "illustrated")
        self.assertEqual(plan["scenes"][0]["illustration"]["subject"], "abstract")
        self.assertEqual(plan["durationInFrames"], round(3.25 * 30))
        classic = remotion.assemble_plan(original, script, [3.25], [], {**settings, "style": "classic"})
        self.assertNotIn("illustration", classic["scenes"][0])

    def test_preset_capabilities_preserve_text_and_choose_notes_causal_mask_and_honest_metaphor(self):
        value = {"version": 1, "scenes": [
            {"template": "cards", "headline": "A stated concept", "items": [],
             "illustration": {"subject": subject, "motion": "pulse", "mode": "schematic", "labels": ["A complete qualified label"]}}
            for subject in ("abstract", "network", "abstract", "journey", "attention")]}
        script = {"beats": [
            {"narration": "Think of matching a question to relevant notes in a filing cabinet. It is a metaphor, not a person."},
            {"narration": "Decoder self-attention masks future tokens: each position can use itself and earlier tokens only."},
            {"narration": "The model predicts probabilities for the next token."},
            {"narration": "Generation repeats in a loop."},
            {"narration": "Decoder attention does not mask future tokens in this counterexample."},
        ]}
        before = copy.deepcopy(value)
        normalized = remotion.with_illustrations(value, script)
        self.assertEqual(value, before)
        self.assertEqual([(s["illustration"]["subject"], s["illustration"]["mode"]) for s in normalized["scenes"]],
                         [("notes", "metaphor"), ("attention", "schematic"), ("abstract", "metaphor"),
                          ("journey", "metaphor"), ("abstract", "metaphor")])
        for original, actual in zip(before["scenes"], normalized["scenes"]):
            self.assertEqual({k: v for k, v in original.items() if k != "illustration"},
                             {k: v for k, v in actual.items() if k != "illustration"})
            self.assertEqual(original["illustration"]["labels"], actual["illustration"]["labels"])
        self.assertEqual(remotion.with_illustrations(normalized, script), normalized)
        self.assertEqual(remotion.infer_illustration(script["beats"][0], {"items": []})["subject"], "notes")
        for narration in ("If a decoder masks future tokens, earlier tokens remain.",
                          "Imagine a decoder masks future tokens.", "Decoder attention may mask future tokens.",
                          "Does decoder attention mask future tokens?", "A decoder without a mask can use future tokens."):
            illustration = remotion.with_illustrations({"version": 1, "scenes": [before["scenes"][4]]},
                                                       {"beats": [{"narration": narration}]})["scenes"][0]["illustration"]
            self.assertEqual((illustration["subject"], illustration["motion"], illustration["mode"]),
                             ("abstract", "pulse", "metaphor"), narration)

    def test_physical_worlds_need_their_narrated_topic_and_preserve_real_science_safety_and_story(self):
        value = storyboard()
        value["scenes"][0]["illustration"] = {"subject": "atom", "motion": "assemble", "mode": "schematic",
                                             "labels": ["Embedding", "Position info: method varies"]}
        before = copy.deepcopy(value)
        tokens = {"beats": [{"narration": "Text becomes tokens. Each embedding is a list of numbers; position methods vary by model."}]}
        normalized = remotion.with_illustrations(value, tokens)
        self.assertEqual({k: v for k, v in normalized["scenes"][0]["illustration"].items() if k != "shots"},
                         {**value["scenes"][0]["illustration"], "subject": "abstract", "mode": "metaphor"})
        self.assertEqual(value, before)
        for subject in remotion.PHYSICAL_ILLUSTRATION_TOPICS:
            value["scenes"][0]["illustration"]["subject"] = subject
            result = remotion.with_illustrations(value, tokens)["scenes"][0]["illustration"]
            self.assertEqual((result["subject"], result["mode"]), ("abstract", "metaphor"), subject)
            self.assertEqual(result["labels"], before["scenes"][0]["illustration"]["labels"])
        for subject, narration in (("atom", "An atomic nucleus contains protons and neutrons."),
                                   ("cell", "Cells contain DNA."), ("planet", "The fictional planet has two moons."),
                                   ("space", "Stars form in galaxies."), ("nature", "The forest contains trees and wildlife."),
                                   ("machine", "The parking brake engages if hydraulic pressure is lost."),
                                   ("city", "The story takes place in a village."), ("people", "The characters become friends.")):
            value["scenes"][0]["illustration"]["subject"] = subject
            result = remotion.with_illustrations(value, {"beats": [{"narration": narration}]})["scenes"][0]["illustration"]
            self.assertEqual((result["subject"], result["mode"]), (subject, "schematic"), narration)
        self.assertEqual(remotion.infer_illustration({"narration": "An atomic nucleus contains protons."}, {"items": []})["subject"], "atom")
        for subject, narration in (("space", "Embeddings occupy a vector space."),
                                   ("machine", "Machine learning compares numerical representations."),
                                   ("cell", "Spreadsheet cells store numbers."), ("nature", "Decision trees classify numbers."),
                                   ("atom", "Text becomes atomic tokens.")):
            value["scenes"][0]["illustration"]["subject"] = subject
            result = remotion.with_illustrations(value, {"beats": [{"narration": narration}]})["scenes"][0]["illustration"]
            self.assertEqual((result["subject"], result["mode"]), ("abstract", "metaphor"), narration)

    def test_teaching_prompt_adds_mechanism_and_scope_within_existing_word_budget(self):
        standard = prompts.script_messages("Explain atoms", 120, "English", "beginners")[0]["content"]
        illustrated = prompts.script_messages("Explain atoms", 120, "English", "beginners", style="illustrated")[0]["content"]
        self.assertIn("Do not exceed 323 words", standard)
        self.assertIn("Do not exceed 323 words", illustrated)
        self.assertIn("Within the existing word budget and beat count", illustrated)
        self.assertIn("concrete visual metaphor", illustrated)
        self.assertIn("causal mechanism", illustrated)
        self.assertIn("scope or a useful counterexample", illustrated)
        self.assertIn("Do not claim this script received expert research", illustrated)
        self.assertIn("narration itself MUST introduce one concrete metaphor", illustrated)
        self.assertIn("metaphor's limit in the spoken explanation", illustrated)
        self.assertIn("coverage checklist", illustrated)
        self.assertIn("Respect the requested approximate narration length", illustrated)
        transformer = prompts.script_messages("Transformer LLM, based on the original paper", 90, "English", "beginners", style="illustrated")[0]["content"]
        self.assertIn("say the contrast", transformer)
        self.assertIn("explicitly in the narration", transformer)
        self.assertNotIn("Illustrated Discovery teaching approach", standard)

    def test_planner_and_audit_cover_misleading_metaphors_and_illustration_labels(self):
        script = {"title": "Attention", "beats": [{"narration": "Attention combines value vectors; weights alone do not prove understanding."}]}
        original = storyboard()
        original["scenes"][0]["illustration"] = {"subject": "attention", "motion": "flow", "mode": "schematic",
                                               "labels": ["Human understanding"]}
        planner = json.dumps(remotion.planner_messages(script, "math_science", "illustrated", None))
        review = json.dumps(remotion.faithfulness_messages(script, original, None, "illustrated"))
        self.assertIn("EVERY scene an illustration", planner)
        self.assertIn("physical trajectory", planner)
        self.assertIn("notes draws an original filing cabinet", planner)
        self.assertIn("network draws generic connected nodes/layers", planner)
        self.assertIn("current and earlier tokens only", review)
        self.assertIn("unsupported mechanism", review)
        self.assertIn("Nonliteral depictions", review)
        self.assertIn("illustration.labels[0]", review)
        corrected = copy.deepcopy(original)
        corrected["scenes"][0]["illustration"]["labels"] = ["Value vectors"]
        envelope = {"audit": [{"scene": 1, "headline_scope": "The heading concerns context, not human understanding.",
                               "issues": [{"field": "illustration.labels[0]", "reason": "The narration explicitly limits the understanding claim."}]}],
                    "storyboard": corrected}
        result, _ = remotion.validate_faithfulness_review(envelope, original, 1)
        self.assertEqual(result["scenes"][0]["illustration"]["labels"], ["Value vectors"])
        with self.assertRaisesRegex(ValueError, "did not correct"):
            remotion.validate_faithfulness_review({**envelope, "storyboard": original}, original, 1)


class IllustratedPipelineQA(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=WORK)
        self.root = patch.object(pipeline, "JOBS_DIR", Path(self.tmp.name))
        self.root.start()
        self.available = patch.object(remotion, "ensure_available")
        self.available.start()
        self.manager = pipeline.JobManager()

    async def asyncTearDown(self):
        tasks = [job.task for job in self.manager.jobs.values() if job.task and not job.task.done()]
        for task in tasks:
            task.cancel()
        if tasks:
            import asyncio
            await asyncio.gather(*tasks, return_exceptions=True)
        self.root.stop()
        self.available.stop()
        self.tmp.cleanup()

    def job(self, renderer="remotion", style="classic"):
        job = pipeline.Job({"id": "qa-illustrated", "prompt": "Explain transformer context", "title": "Context", "created_at": 1,
                            "status": "done", "settings": {**pipeline.DEFAULT_SETTINGS, "renderer": renderer, "style": style},
                            "renderer_used": renderer, "logs": [], "script": {"title": "Context", "beats": [
                                {"narration": "Transformers combine earlier tokens to form context.", "visual": "Tokens and context.", "audio_duration": 1.5}]},
                            "slots": [2.7], "captions": [], "steps": [{"key": k, "label": label, "status": "done"} for k, label in pipeline.STEPS]})
        job.save()
        (job.dir / "narration.wav").write_bytes(b"purchased narration")
        (job.dir / "audio").mkdir()
        (job.dir / "audio/beat_00.mp3").write_bytes(b"purchased clip")
        self.manager.jobs[job.id] = job
        return job

    async def test_invalid_manim_combination_rejects_create_and_rerender_before_mutation_or_voice(self):
        with patch.object(pipeline, "run_full", AsyncMock()) as run:
            with self.assertRaisesRegex(ValueError, "requires Remotion"):
                self.manager.create("Explain atoms", {"renderer": "manim", "style": "illustrated"}, {})
            run.assert_not_awaited()
            self.assertEqual(list(Path(self.tmp.name).iterdir()), [])
        job = self.job("manim")
        before = copy.deepcopy(job.data)
        with self.assertRaisesRegex(ValueError, "requires Remotion"):
            self.manager.rerender(job, {}, None, False, {"renderer": "manim", "style": "illustrated"})
        self.assertEqual(job.data, before)
        self.assertIsNone(job.task)

    async def test_keyless_illustrated_conversion_and_saved_manim_theme_round_trip_preserve_audio(self):
        job = self.job("manim", "paper")
        python = "class ExplainerVideo(EduScene): pass\n"
        (job.dir / "scene.py").write_text(python)
        with patch.object(pipeline, "stage_test", AsyncMock()), patch.object(pipeline, "stage_render_and_mix", AsyncMock()), \
             patch.object(pipeline, "stage_voice", AsyncMock()) as voice, patch.object(deepseek, "chat", AsyncMock()) as chat:
            self.manager.rerender(job, {}, None, False, {"renderer": "remotion", "style": "illustrated"})
            await job.task
            self.assertEqual(job.data["renderer_used"], "remotion")
            self.assertEqual(job.data["remotion_plan"]["style"], "illustrated")
            self.assertEqual(job.data["remotion_plan"]["scenes"][0]["illustration"]["subject"], "abstract")
            self.assertEqual(pipeline.public_job(job)["manim_style"], "paper")
            self.assertEqual(job.summary()["manim_style"], "paper")
            self.manager.rerender(job, {}, None, False, {"renderer": "manim", "style": "paper"})
            await job.task
        self.assertEqual(job.data["code"], python)
        self.assertEqual((job.dir / "narration.wav").read_bytes(), b"purchased narration")
        self.assertEqual((job.dir / "audio/beat_00.mp3").read_bytes(), b"purchased clip")
        chat.assert_not_awaited()
        voice.assert_not_awaited()

    async def test_style_only_override_reroutes_auto_math_job_and_script_receives_teaching_style(self):
        job = self.job("manim")
        job.data["settings"]["renderer"] = "auto"
        settings, renderer = pipeline._rerender_settings(job, {"style": "illustrated"})
        self.assertEqual(renderer, "remotion")
        raw = json.dumps({"title": "Context", "beats": [{"narration": "Earlier tokens provide context.", "visual": "Token diagram"}]})
        chat = AsyncMock(return_value=raw)
        with patch.object(deepseek, "chat", chat):
            await pipeline.stage_script(job, "unused", settings)
        self.assertIn("Illustrated Discovery teaching approach", chat.await_args.args[2][0]["content"])
        self.assertTrue(chat.await_args.kwargs["thinking"])
        self.assertEqual(chat.await_args.kwargs["reasoning_effort"], "high")
        self.assertEqual(chat.await_args.kwargs["max_tokens"], 12000)
        with patch.object(deepseek, "chat", chat):
            await pipeline.stage_script(job, "unused", {**settings, "style": "classic"})
        self.assertFalse(chat.await_args.kwargs["thinking"])
        self.assertEqual(chat.await_args.kwargs["max_tokens"], 4000)

    async def test_manim_unknown_or_changed_theme_requires_key_before_mutating_saved_video(self):
        job = self.job("remotion", "illustrated")
        (job.dir / "scene.py").write_text("class ExplainerVideo(EduScene): pass\n")
        for known in (None, "paper"):
            if known:
                job.data["manim_style"] = known
            else:
                job.data.pop("manim_style", None)
            before = copy.deepcopy(job.data)
            with self.subTest(known=known), self.assertRaisesRegex(ValueError, "different or unknown saved Manim theme"):
                self.manager.rerender(job, {}, None, False, {"renderer": "manim", "style": "classic"})
            self.assertEqual(job.data, before)
            self.assertIsNone(job.task)

    async def test_legacy_actual_manim_matching_theme_reuses_code_without_key_and_records_theme(self):
        job = self.job("manim", "paper")
        python = "class ExplainerVideo(EduScene): pass\n"
        (job.dir / "scene.py").write_text(python)
        self.assertNotIn("manim_style", job.data)
        with patch.object(pipeline, "stage_code", AsyncMock()) as code, patch.object(deepseek, "chat", AsyncMock()) as chat, \
             patch.object(pipeline, "stage_test", AsyncMock()), patch.object(pipeline, "stage_render_and_mix", AsyncMock()):
            self.manager.rerender(job, {}, None, False, {"renderer": "manim", "style": "paper"})
            await job.task
        code.assert_not_awaited()
        chat.assert_not_awaited()
        self.assertEqual(job.data["manim_style"], "paper")
        self.assertNotIn("manim_regeneration_pending", job.data)
        self.assertEqual((job.dir / "scene.py").read_text(), python)
        self.assertEqual((job.dir / "narration.wav").read_bytes(), b"purchased narration")

    async def test_manim_changed_theme_auto_regenerates_with_key_then_matching_reuse_stays_keyless(self):
        job = self.job("remotion", "illustrated")
        original = "class ExplainerVideo(EduScene): pass\n"
        (job.dir / "scene.py").write_text(original)
        job.data["manim_style"] = "paper"

        async def regenerate(target, key, settings):
            self.assertEqual(key, "unused-test-key")
            self.assertEqual(settings["style"], "classic")
            target.data["manim_style"] = settings["style"]
            target.data["code"] = original
            target.data.pop("manim_regeneration_pending", None)

        with patch.object(pipeline, "stage_code", AsyncMock(side_effect=regenerate)) as code, \
             patch.object(pipeline, "stage_test", AsyncMock()), patch.object(pipeline, "stage_render_and_mix", AsyncMock()), \
             patch.object(pipeline, "stage_voice", AsyncMock()) as voice, patch.object(deepseek, "chat", AsyncMock()) as chat:
            self.manager.rerender(job, {"deepseek": "unused-test-key"}, None, False, {"renderer": "manim", "style": "classic"})
            await job.task
            self.manager.rerender(job, {}, None, False, {"renderer": "manim", "style": "classic"})
            await job.task
        code.assert_awaited_once()
        voice.assert_not_awaited()
        chat.assert_not_awaited()
        self.assertEqual(job.data["manim_style"], "classic")
        self.assertEqual((job.dir / "narration.wav").read_bytes(), b"purchased narration")
        self.assertEqual((job.dir / "audio/beat_00.mp3").read_bytes(), b"purchased clip")

    async def test_failed_manim_regeneration_resume_plans_new_code_instead_of_reusing_old_theme(self):
        job = self.job("remotion", "illustrated")
        old_code = "class ExplainerVideo(EduScene): pass\n"
        new_code = "class ExplainerVideo(EduScene):\n    def construct(self): pass\n"
        (job.dir / "scene.py").write_text(old_code)
        job.data["manim_style"] = "paper"
        with patch.object(deepseek, "chat", AsyncMock(side_effect=deepseek.DeepSeekError("Provider unavailable"))):
            self.manager.rerender(job, {"deepseek": "unused"}, None, False, {"renderer": "manim", "style": "classic"})
            await job.task
        self.assertEqual(job.data["status"], "error")
        self.assertTrue(job.data["manim_regeneration_pending"])
        self.assertTrue(json.loads((job.dir / "job.json").read_text())["manim_regeneration_pending"])
        self.assertEqual((job.dir / "scene.py").read_text(), old_code)
        self.assertEqual(job.data["manim_style"], "paper")
        self.assertFalse(pipeline.public_job(job)["has_manim_code"])
        self.assertFalse(job.summary()["has_manim_code"])
        before = copy.deepcopy(job.data)
        with self.assertRaisesRegex(ValueError, "DeepSeek API key"):
            self.manager.resume(job, {})
        self.assertEqual(job.data, before)
        chat = AsyncMock(return_value="```python\n" + new_code + "```")
        with patch.object(deepseek, "chat", chat), patch.object(pipeline, "stage_voice", AsyncMock()) as voice, \
             patch.object(pipeline, "stage_test", AsyncMock()), patch.object(pipeline, "stage_render_and_mix", AsyncMock()):
            self.manager.resume(job, {"deepseek": "unused"})
            await job.task
        self.assertEqual(job.data["status"], "done")
        chat.assert_awaited_once()
        self.assertTrue(voice.await_args.kwargs["reuse_existing"])
        self.assertIsNone(voice.await_args.args[1])
        self.assertEqual((job.dir / "scene.py").read_text(), new_code)
        self.assertEqual(job.data["manim_style"], "classic")
        self.assertNotIn("manim_regeneration_pending", job.data)
        self.assertNotIn("manim_regeneration_pending", json.loads((job.dir / "job.json").read_text()))
        self.assertTrue(pipeline.public_job(job)["has_manim_code"])
        self.assertEqual((job.dir / "narration.wav").read_bytes(), b"purchased narration")
        self.assertEqual((job.dir / "audio/beat_00.mp3").read_bytes(), b"purchased clip")
        # A later render failure after successful generation can reuse this code.
        job.data["status"] = "error"
        with patch.object(deepseek, "chat", AsyncMock()) as no_chat, patch.object(pipeline, "stage_voice", AsyncMock()), \
             patch.object(pipeline, "stage_test", AsyncMock()), patch.object(pipeline, "stage_render_and_mix", AsyncMock()):
            self.manager.resume(job, {})
            await job.task
        self.assertEqual(job.data["status"], "done")
        no_chat.assert_not_awaited()

    async def test_illustrated_planner_review_keeps_strict_visual_data_and_faithfulness_audit(self):
        job = self.job(style="illustrated")
        plan = storyboard()
        plan["scenes"][0]["illustration"] = {"subject": "attention", "motion": "pulse", "mode": "schematic", "labels": ["Context"]}
        envelope = {"audit": [{"scene": 1, "headline_scope": "The heading describes context formed from earlier tokens.", "issues": []}], "storyboard": plan}
        chat = AsyncMock(side_effect=[json.dumps(plan), json.dumps(envelope)])
        with patch.object(deepseek, "chat", chat):
            await pipeline.stage_storyboard(job, "unused", job.data["settings"])
        self.assertEqual(chat.await_count, 2)
        self.assertEqual(chat.await_args_list[0].kwargs["max_tokens"], 12000)
        self.assertEqual(chat.await_args_list[1].kwargs["max_tokens"], 24000)
        self.assertTrue(chat.await_args_list[1].kwargs["thinking"])
        self.assertEqual(chat.await_args_list[1].kwargs["reasoning_effort"], "low")
        self.assertIn("Audit each illustration", chat.await_args.args[2][0]["content"])
        self.assertEqual(job.data["storyboard_review"]["status"], "ai_reviewed")
        review_input = json.loads(chat.await_args.args[2][1]["content"])["storyboard_to_review"]
        actual = json.loads((job.dir / "storyboard.json").read_text())["scenes"][0]["illustration"]
        self.assertEqual(actual, review_input["scenes"][0]["illustration"])
        self.assertEqual((actual["subject"], actual["motion"], actual["mode"]), ("abstract", "pulse", "metaphor"))
        self.assertEqual(actual["labels"], plan["scenes"][0]["illustration"]["labels"])
        normalization = job.data["storyboard_review"]["illustration_normalization"]
        self.assertTrue(normalization["before_review"])
        self.assertTrue(normalization["after_review"])
        self.assertTrue(job.data["storyboard_review"]["manual_review_recommended"])
        self.assertEqual((job.dir / "narration.wav").read_bytes(), b"purchased narration")

    async def test_api_bad_semantic_shot_rejects_before_saved_job_mutation(self):
        main = importlib.import_module("app.main")
        job = self.job(style="illustrated")
        pipeline._store_storyboard(job, storyboard())
        before = copy.deepcopy(job.data)
        files = {path.name: path.read_bytes() for path in job.dir.iterdir() if path.is_file()}
        bad = storyboard()
        bad["scenes"][0]["illustration"] = {"subject": "abstract", "motion": "pulse", "mode": "metaphor", "shots": [
            {"cue": "earlier tokens", "kind": "exercise", "exercise": "plank"}]}
        with patch.object(main, "manager", self.manager), patch.object(deepseek, "chat", AsyncMock()) as chat:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app), base_url="http://test") as client:
                response = await client.post(f"/api/jobs/{job.id}/rerender", json={"code": json.dumps(bad)})
        self.assertEqual(response.status_code, 422)
        self.assertIn("exercise shot", response.json()["detail"].lower())
        self.assertEqual(job.data, before)
        self.assertEqual({path.name: path.read_bytes() for path in job.dir.iterdir() if path.is_file()}, files)
        self.assertIsNone(job.task)
        chat.assert_not_awaited()

    async def test_notes_and_causal_mask_normalize_before_review_and_remain_in_saved_plan(self):
        job = self.job(style="illustrated")
        job.data["script"]["beats"] = [
            {"narration": "Think of matching a question to notes in a filing cabinet. This is a metaphor, not a person.", "visual": "Query/key/value notes."},
            {"narration": "Decoder self-attention masks future tokens. Each position can use itself and earlier tokens only.", "visual": "Current and earlier token edges."},
        ]
        job.data["slots"] = [2.7, 2.7]
        plan = {"version": 1, "scenes": [copy.deepcopy(storyboard()["scenes"][0]) for _ in range(2)]}
        for scene in plan["scenes"]:
            scene["illustration"] = {"subject": "network", "motion": "pulse", "mode": "schematic", "labels": ["A stated concept"]}
        normalized = remotion.with_illustrations(plan, job.data["script"])
        envelope = {"audit": [{"scene": i + 1, "headline_scope": "The heading covers this narrated concept.", "issues": []} for i in range(2)],
                    "storyboard": normalized}
        with patch.object(deepseek, "chat", AsyncMock(side_effect=[json.dumps(plan), json.dumps(envelope)])) as chat:
            await pipeline.stage_storyboard(job, "unused", job.data["settings"])
        review_input = json.loads(chat.await_args.args[2][1]["content"])["storyboard_to_review"]
        self.assertEqual(review_input, normalized)
        self.assertEqual(json.loads((job.dir / "storyboard.json").read_text()), normalized)
        self.assertEqual([s["illustration"]["subject"] for s in job.data["remotion_plan"]["scenes"]], ["notes", "attention"])
        self.assertFalse(job.data["storyboard_review"]["illustration_normalization"]["after_review"])
        self.assertEqual(chat.await_count, 2)


if __name__ == "__main__":
    unittest.main()
