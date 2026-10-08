"""Content-specific illustrations, source cue semantics and recorded timing; no providers."""
from __future__ import annotations

import copy
import json
import unittest

from app import pipeline, remotion


def script(narration):
    return {"title": "A narrated concept", "beats": [{"narration": narration, "audio_duration": 20.0}]}


def storyboard(shots):
    return {"version": 1, "scenes": [{"template": "cards", "headline": "A narrated concept", "items": [],
                                     "illustration": {"subject": "abstract", "motion": "pulse", "mode": "metaphor", "shots": shots}}]}


def process(cue, label="A concept", icon="book", layout="single"):
    return {"cue": cue, "kind": "process", "layout": layout, "objects": [{"icon": icon, "label": label}]}


class IllustrationShotQA(unittest.TestCase):
    def test_planner_example_demonstrates_separate_item_and_content_icon_scopes_and_array_bounds(self):
        approved = script("The narrator discusses a meal. The schedule repeats daily.")
        sample = remotion.validate_storyboard(remotion.ILLUSTRATED_SCOPE_EXAMPLE, 1, approved)
        self.assertEqual(sample["scenes"][0]["items"][0]["icon"], "book")
        self.assertEqual([shot["objects"][0]["icon"] for shot in sample["scenes"][0]["illustration"]["shots"]], ["plate", "calendar"])
        rules = remotion.planner_messages(approved, "auto", "illustrated", None)[0]["content"]
        self.assertIn("ONLY inside a process shot's objects[].icon", rules)
        self.assertIn("illustration.labels has at most4 labels, even if this beat has12shots", rules)
        self.assertIn("The only array permitted up to12 entries is illustration.shots", rules)
        standard = remotion.planner_messages(approved, "auto", "classic", None)[0]["content"]
        self.assertNotIn("Complete icon/array scope example", standard)

    def test_strict_raw_schema_rejects_timing_code_invalid_limits_and_wrong_kind_fields(self):
        valid = storyboard([process("Nutrition matters.", "Nutrition", "plate")])
        self.assertEqual(remotion.validate_storyboard(valid, 1, script("Nutrition matters.")), valid)
        for change in ({"startFrame": 0}, {"durationInFrames": 30}, {"asset": "/etc/passwd"},
                       {"kind": "execute"}, {"exercise": "plank"}, {"text": "invented example"},
                       {"cue": "x" * 401}, {"cue": "<script>run()</script>"}, {"labels": ["x" * 41]},
                       {"labels": ["1", "2", "3", "4", "5"]}, {"objects": [{"icon": "external-image", "label": "Nutrition"}]},
                       {"objects": [{"icon": "plate", "label": "Nutrition", "action": "execute"}]},
                       {"objects": []}, {"layout": "sequence", "objects": [{"icon": "book", "label": "Nutrition"}]},
                       {"layout": "comparison"}):
            value = copy.deepcopy(valid)
            value["scenes"][0]["illustration"]["shots"][0].update(change)
            with self.subTest(change=change), self.assertRaises(ValueError):
                remotion.validate_storyboard(value, 1, script("Nutrition matters."))
        for count in (0, 13):
            with self.assertRaises(ValueError):
                remotion.validate_storyboard(storyboard([process("Nutrition matters.")] * count), 1)
        self.assertIn("plate", remotion.SHOT_OBJECT_ICONS)
        self.assertNotIn("plate", remotion.ICONS)

    def test_source_cue_preserves_full_paper_qualification_with_separate_visible_text_limits(self):
        cue = ("In the paper's experiments, with the same model size and training tokens, BitNet b1.58 matches "
               "its sixteen-bit baseline on perplexity and end-task scores starting from three billion parameters.")
        self.assertEqual(len(cue), 193)
        raw = storyboard([process(cue, "Reported comparison", "computer")])
        self.assertEqual(remotion.validate_storyboard(raw, 1, script(cue)), raw)
        self.assertEqual(remotion._fallback_cue(cue, 0, len(cue)), cue)
        rules = remotion.planner_messages(script(cue), "math_science", "illustrated", None)[0]["content"]
        self.assertIn("<=400 characters", rules)
        self.assertEqual(remotion.LIMITS["body"], 180)
        self.assertEqual(remotion.LIMITS["illustration_label"], 40)
        too_long = cue + " " + "Additional source qualifications remain part of the reported comparison. " * 3
        self.assertGreater(len(too_long.strip()), 400)
        with self.assertRaisesRegex(ValueError, "shot_cue exceeds 400"):
            remotion.validate_storyboard(storyboard([process(too_long.strip())]), 1, script(too_long.strip()))
        with self.assertRaisesRegex(ValueError, "bounded narration cue"):
            remotion._fallback_cue(too_long.strip(), 0, len(too_long.strip()))

    def test_exact_unique_ordered_cues_and_pose_variant_are_checked_against_approved_narration(self):
        narration = "The circuit uses leg raises, star crunches, side planks, then a plank."
        valid = [{"cue": "leg raises", "kind": "exercise", "exercise": "leg-raise"},
                 {"cue": "star crunches", "kind": "exercise", "exercise": "star-crunch"},
                 {"cue": "side planks", "kind": "exercise", "exercise": "side-plank"}]
        self.assertEqual(remotion.validate_storyboard(storyboard(valid), 1, script(narration))["scenes"][0]["illustration"]["shots"], valid)
        for shots in ([valid[1], valid[0]], [valid[0], valid[0]],
                      [{"cue": "not spoken", "kind": "exercise", "exercise": "leg-raise"}],
                      [{"cue": "star crunches", "kind": "exercise", "exercise": "crunch"}],
                      [{"cue": "side planks", "kind": "exercise", "exercise": "plank"}],
                      [{"cue": "leg", "kind": "exercise", "exercise": "leg-raise"}]):
            with self.subTest(shots=shots), self.assertRaises(ValueError):
                remotion.validate_storyboard(storyboard(shots), 1, script(narration))
        for narration, cue, exercise in (("Avoid doing planks.", "planks", "plank"),
                                          ("Don't do leg raises.", "leg raises", "leg-raise"),
                                          ("We crunch the numbers.", "crunch", "crunch"),
                                          ("Flags flutter in the wind.", "flutter", "flutter-kick"),
                                          ("The core concept is probability.", "core", "core"),
                                          ("A CPU core processes signals.", "core", "core"),
                                          ("This software core computes abs(x).", "abs", "core"),
                                          ("The truck has ABS brakes.", "ABS", "core"),
                                          ("The model is lying.", "lying", "lying"),
                                          ("Standing waves travel through space.", "Standing", "standing"),
                                          ("I might do leg raises.", "leg raises", "leg-raise")):
            with self.subTest(narration=narration), self.assertRaises(ValueError):
                remotion.validate_storyboard(storyboard([{"cue": cue, "kind": "exercise", "exercise": exercise}]), 1, script(narration))
        # 'Not true rest' qualifies rest, rather than denying the actual side plank.
        remotion.validate_storyboard(storyboard([{"cue": "Side planks", "kind": "exercise", "exercise": "side-plank"}]),
                                     1, script("Side planks are called active rest, not true rest."))

    def test_nonunique_exercise_cue_only_expands_the_single_actual_positive_variant(self):
        narration = "The circuit uses flutters, planks, hip dips, and side planks."
        raw = storyboard([{"cue": "planks", "kind": "exercise", "exercise": "plank", "labels": ["Plank"]}])
        before = copy.deepcopy(raw)
        normalized = remotion.validate_storyboard(raw, 1, script(narration))
        shot = normalized["scenes"][0]["illustration"]["shots"][0]
        self.assertNotEqual(shot["cue"], "planks")
        self.assertIn(shot["cue"], narration)
        self.assertEqual(narration.count(shot["cue"]), 1)
        self.assertEqual({k: v for k, v in shot.items() if k != "cue"}, {k: v for k, v in before["scenes"][0]["illustration"]["shots"][0].items() if k != "cue"})
        self.assertEqual(raw, before)
        beat = script(narration)["beats"][0]
        beat["words"] = [{"word": word, "start": i * .5, "end": i * .5 + .4} for i, word in enumerate(narration.split())]
        first = process("flutters", "Flutters", "muscle")
        plan = remotion.assemble_plan(storyboard([first, before["scenes"][0]["illustration"]["shots"][0]]),
                                     {"title": "Workout", "beats": [beat]}, [21], [], {**pipeline.DEFAULT_SETTINGS, "style": "illustrated"})
        self.assertEqual(plan["scenes"][0]["illustration"]["shots"][1]["startFrame"], narration.split().index("planks,") * 15)
        for narration, cue, exercise in (("The circuit uses planks, then more planks.", "planks", "plank"),
                                          ("The circuit uses planks and side planks.", "planks", "side-plank"),
                                          ("The circuit uses planks and side planks.", "regular planks", "plank"),
                                          ("The circuit uses planks and side planks.", "plank", "plank"),
                                          ("Avoid planks; use side planks instead.", "planks", "plank")):
            with self.subTest(narration=narration, cue=cue, exercise=exercise), self.assertRaises(ValueError):
                remotion.validate_storyboard(storyboard([{"cue": cue, "kind": "exercise", "exercise": exercise}]), 1, script(narration))
        side = storyboard([{"cue": "side planks", "kind": "exercise", "exercise": "side-plank"}])
        self.assertEqual(remotion.validate_storyboard(side, 1, script("The circuit uses planks and side planks.")), side)

    def test_tokens_require_real_example_and_other_mechanisms_are_not_licensed_by_topic_keywords(self):
        narration = 'The model sees "The cat sat on the ..." and predicts the next token.'
        remotion.validate_storyboard(storyboard([{"cue": "The cat sat on the ...", "kind": "tokens", "text": '"The cat sat on the"'}]), 1, script(narration))
        with self.assertRaisesRegex(ValueError, "actual example"):
            remotion.validate_storyboard(storyboard([{"cue": "The cat sat on the ...", "kind": "tokens", "text": "The dog ran"}]), 1, script(narration))
        for narration, cue, kind in (("Attention compares a query to keys.", "query", "attention-mix"),
                                     ("A query compares to keys, but weights do not mix value vectors.", "query", "attention-mix"),
                                     ("The model might append tokens and repeat.", "append", "generation"),
                                     ("A model predicts a probability for each token.", "predicts", "generation"),
                                     ("Decoder attention does not mask future tokens.", "Decoder attention does not mask future tokens.", "causal-attention"),
                                     ("Decoder attention may mask future tokens.", "Decoder attention may mask future tokens.", "causal-attention"),
                                     ("Decoder self-attention masks future tokens. Multiple heads work in parallel.", "Multiple heads", "causal-attention"),
                                     ("Numerical vectors represent data.", "vectors", "notes"),
                                     ("An actual bridge carries traffic.", "bridge", "bridge")):
            with self.subTest(kind=kind, narration=narration), self.assertRaises(ValueError):
                remotion.validate_storyboard(storyboard([{"cue": cue, "kind": kind}]), 1, script(narration))
        cue = "A query compares with keys; weights mix value vectors."
        remotion.validate_storyboard(storyboard([{"cue": cue, "kind": "attention-mix"}]), 1, script(cue))

    def test_independent_process_features_never_gain_arrows_and_layout_counts_are_strict(self):
        narration = "A switch and a steering lock are independent safety features."
        shot = process(narration, "Switch", "shield", "collection")
        shot["objects"].append({"icon": "lock", "label": "Steering lock"})
        remotion.validate_storyboard(storyboard([shot]), 1, script(narration))
        shot["layout"] = "sequence"
        with self.assertRaisesRegex(ValueError, "explicit narrated order"):
            remotion.validate_storyboard(storyboard([shot]), 1, script(narration))
        for layout, count in (("single", 2), ("comparison", 1), ("comparison", 3)):
            shot = process("A stated concept.", "Concept", layout=layout)
            shot["objects"] *= count
            with self.subTest(layout=layout, count=count), self.assertRaises(ValueError):
                remotion.validate_storyboard(storyboard([shot]), 1)
        shot = process("Text becomes tokens, then vectors.", "Tokens", "token", "sequence")
        shot["objects"].append({"icon": "vector", "label": "Vectors"})
        remotion.validate_storyboard(storyboard([shot]), 1, script(shot["cue"]))

    def test_fallback_covers_all_nine_workout_actions_without_inventing_variants(self):
        narration = "It builds one continuous circuit: leg raises, flutters, planks, hip dips, star crunches, reaches, side planks, a hold, and mountain climbers."
        value = remotion.fallback_storyboard(script(narration), style="illustrated")
        shots = value["scenes"][0]["illustration"]["shots"]
        self.assertEqual([shot.get("exercise", shot["objects"][0]["label"] if "objects" in shot else None) for shot in shots],
                         ["leg-raise", "flutter-kick", "plank", "hip-dip", "star-crunch", "reaches", "side-plank", "a hold", "mountain-climber"])
        self.assertNotIn("Key point", value["scenes"][0]["headline"])
        self.assertEqual(value["scenes"][0]["headline"], "continuous circuit")
        self.assertNotIn("body", value["scenes"][0])
        self.assertNotIn("hollow-hold", [shot.get("exercise") for shot in shots])
        self.assertNotIn("crunch-reach", [shot.get("exercise") for shot in shots])
        self.assertTrue(all(shot["cue"] in narration for shot in shots))
        beat = script(narration)["beats"][0]
        beat["words"] = [{"word": word, "start": i * .5, "end": i * .5 + .4} for i, word in enumerate(narration.split())]
        beat["audio_duration"] = 20
        plan = remotion.assemble_plan(value, {"title": "Circuit", "beats": [beat]}, [21], [], {**pipeline.DEFAULT_SETTINGS, "style": "illustrated"})
        timed = plan["scenes"][0]["illustration"]["shots"]
        plank_word = narration.split().index("planks,")
        self.assertEqual(timed[2]["startFrame"], round(plank_word * .5 * 30))
        self.assertEqual(timed[0]["startFrame"], 0)
        self.assertEqual(sum(shot["durationInFrames"] for shot in timed), 630)
        for previous, following in zip(timed, timed[1:]):
            self.assertEqual(previous["startFrame"] + previous["durationInFrames"], following["startFrame"])

    def test_multiple_pose_fallback_heading_uses_spoken_group_phrase_without_inventing_one(self):
        for narration, expected in (("This workout circuit uses leg raises, planks and side planks.", "circuit"),
                                    ("Switching positions in this workout means leg raises then planks.", "Switching positions"),
                                    ("This workout uses leg raises then planks.", "leg raises · planks")):
            with self.subTest(narration=narration):
                scene = remotion.fallback_storyboard(script(narration), style="illustrated")["scenes"][0]
                self.assertEqual(scene["headline"], expected)
                self.assertIn(scene["headline"].split(" · ")[0], narration)
        single = "The workout circuit starts with leg raises."
        scene = remotion.fallback_storyboard(script(single), style="illustrated")["scenes"][0]
        self.assertEqual(scene["headline"], "leg raises")

    def test_transformer_fallback_changes_world_at_actual_spoken_subtopics_and_keeps_truth_caveat(self):
        mixed = "Decoder self-attention masks future tokens: each position can use itself and earlier tokens only. Multiple heads learn different comparisons in parallel, and feed-forward layers update each representation. The original paper's translation model used an encoder and decoder; modern models like GPT are decoder-only."
        value = remotion.fallback_storyboard(script(mixed), style="illustrated")
        shots = value["scenes"][0]["illustration"]["shots"]
        self.assertEqual([shot["kind"] for shot in shots], ["causal-attention", "process", "process", "process"])
        self.assertIn("Multiple heads", shots[1]["cue"])
        self.assertIn("feed-forward", shots[2]["cue"])
        self.assertEqual(shots[3]["layout"], "comparison")
        beat = script(mixed)["beats"][0]
        beat["words"] = [{"word": word, "start": i * .3, "end": i * .3 + .25} for i, word in enumerate(mixed.split())]
        plan = remotion.assemble_plan(value, {"title": "Transformer", "beats": [beat]}, [21], [], {**pipeline.DEFAULT_SETTINGS, "style": "illustrated"})
        timed = plan["scenes"][0]["illustration"]["shots"]
        for shot, cue_word in zip(timed[1:], ["Multiple", "feed-forward", "The"]):
            index = next(i for i, word in enumerate(mixed.split()) if word == cue_word)
            self.assertEqual(shot["startFrame"], round(index * .3 * 30))
        generation = "So generation is a loop: build context, predict one token at a time, append it, repeat. Plausible text isn't guaranteed truth."
        shots = remotion.fallback_storyboard(script(generation), style="illustrated")["scenes"][0]["illustration"]["shots"]
        self.assertEqual([shot["kind"] for shot in shots], ["generation", "process"])
        self.assertEqual(shots[-1]["objects"][0], {"icon": "question", "label": "Plausible text isn't guaranteed truth."})

    def test_embedding_position_are_separate_and_legitimate_existing_worlds_remain(self):
        narration = "First, text becomes tokens: words or parts of words. Each token becomes an embedding—a list of numbers, not a definition. Because order matters, position information is mixed in, and the exact method varies by model."
        shots = remotion.fallback_storyboard(script(narration), style="illustrated")["scenes"][0]["illustration"]["shots"]
        self.assertEqual([shot["kind"] for shot in shots], ["tokens", "embedding", "process"])
        self.assertEqual(shots[-1]["layout"], "collection")
        self.assertIn("Method varies by model", [obj["label"] for obj in shots[-1]["objects"]])
        for narration, world in (("Cells contain DNA.", "cell"), ("Planets orbit a star.", "planet"), ("Trees collect sunlight.", "nature")):
            scene = remotion.fallback_storyboard(script(narration), style="illustrated")["scenes"][0]
            self.assertEqual(scene["illustration"]["subject"], world)
            self.assertNotIn("shots", scene["illustration"])
        shots = remotion.fallback_storyboard(script("Think of your core as a rope bridge. Muscles aren't separate cables, and nutrition matters."), style="illustrated")["scenes"][0]["illustration"]["shots"]
        self.assertEqual([shot["kind"] for shot in shots], ["bridge", "process"])
        self.assertEqual(shots[-1]["objects"][0]["icon"], "plate")

    def test_legacy_missing_or_malformed_words_have_bounded_contiguous_estimated_timing(self):
        source = script("Text becomes tokens, then vectors.")
        raw = storyboard([process("Text", "Text", "book"), process("vectors", "Vectors", "vector")])
        before = copy.deepcopy(raw)
        for words in (None, [{"word": "wrong", "start": float("nan"), "end": 1}],
                      [{"word": word, "start": -1, "end": 0} for word in source["beats"][0]["narration"].split()]):
            source["beats"][0]["words"] = words
            plan = remotion.assemble_plan(raw, source, [21], [], {**pipeline.DEFAULT_SETTINGS, "style": "illustrated"})
            shots = plan["scenes"][0]["illustration"]["shots"]
            self.assertEqual(shots[0]["startFrame"], 0)
            self.assertGreater(shots[1]["startFrame"], 0)
            self.assertEqual(sum(shot["durationInFrames"] for shot in shots), 630)
        self.assertEqual(raw, before)

    def test_review_field_paths_cover_shot_semantics_and_require_a_flagged_change(self):
        original = storyboard([{"cue": "Side planks", "kind": "exercise", "exercise": "plank"}])
        corrected = copy.deepcopy(original)
        corrected["scenes"][0]["illustration"]["shots"][0]["exercise"] = "side-plank"
        envelope = {"audit": [{"scene": 1, "headline_scope": "The scene concerns the stated side plank.", "issues": [
            {"field": "illustration.shots[0].exercise", "reason": "A standard plank substitutes a different pose."}]}], "storyboard": corrected}
        result, _ = remotion.validate_faithfulness_review(envelope, original, 1)
        self.assertEqual(result, corrected)
        with self.assertRaisesRegex(ValueError, "did not correct"):
            remotion.validate_faithfulness_review({**envelope, "storyboard": original}, original, 1)
        messages = json.dumps(remotion.faithfulness_messages(script("Side planks are active rest, not true rest."), original, None, "illustrated"), ensure_ascii=False)
        self.assertIn("actual cue and its local sentence", messages)
        self.assertIn("Keep the audit compact", messages)
        self.assertIn("1–12 shots", messages)

    def test_explicit_source_transformation_allows_arrows_but_denied_or_independent_concepts_do_not(self):
        cue = "Ternary weights turn multiplication into addition."
        shot = {"cue": cue, "kind": "process", "layout": "sequence", "labels": ["Ternary weights"],
                "objects": [{"icon": "arrow", "label": "Multiplication"}, {"icon": "arrow", "label": "Addition"}]}
        raw = storyboard([shot])
        before = copy.deepcopy(raw)
        self.assertEqual(remotion.validate_storyboard(raw, 1, script(cue)), raw)
        self.assertEqual(remotion.with_illustrations(raw, script(cue)), raw)
        self.assertEqual(raw, before)
        ordered = copy.deepcopy(raw)
        ordered["scenes"][0]["illustration"]["shots"][0]["cue"] = "Each input times its weight, then added up."
        self.assertEqual(remotion.validate_storyboard(ordered, 1, script(ordered["scenes"][0]["illustration"]["shots"][0]["cue"])), ordered)
        for rejected in ("Ternary weights do not turn multiplication into addition.",
                         "Ternary weights might turn multiplication into addition.",
                         "If weights turn multiplication into addition, compare the results.",
                         "Weights and activations are independent source concepts.",
                         "Weights turn these many separate unrelated source concept words today into examples."):
            with self.subTest(cue=rejected), self.assertRaisesRegex(ValueError, "explicit narrated order"):
                remotion.validate_storyboard(storyboard([{**shot, "cue": rejected}]), 1, script(rejected))

    def test_fallback_consistency_and_strength_do_not_imply_fitness_or_calendar_outside_that_domain(self):
        for narration in ("Consistency of the algorithm matters.", "The network signal strength changes.",
                          "A CPU core executes instructions.", "This software core computes abs(x).", "Standing waves oscillate."):
            shots = remotion.fallback_storyboard(script(narration), style="illustrated")["scenes"][0]["illustration"].get("shots", [])
            self.assertFalse(any(shot["kind"] == "exercise" for shot in shots), narration)
            icons = [obj["icon"] for shot in shots for obj in shot.get("objects", [])]
            self.assertNotIn("muscle", icons, narration)
            self.assertNotIn("calendar", icons, narration)


if __name__ == "__main__":
    unittest.main()
