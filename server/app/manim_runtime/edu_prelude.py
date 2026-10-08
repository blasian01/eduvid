"""
Runtime helpers imported by every AI-generated ManimGL scene.

The server sets two environment variables before rendering:
  EDUVID_BEATS       JSON list of narration durations (seconds), one per beat
  EDUVID_LAYOUT_LOG  path where layout warnings are written as JSON

Generated scenes subclass EduScene and call `self.beat(i)` at the start of
each narration beat and `self.finish()` at the very end. `beat` pads with
waits so every beat starts exactly when its voiceover line starts.
"""
from __future__ import annotations

import json
import os

from manimlib import *  # noqa: F401,F403
from manimlib.camera.camera_frame import CameraFrame
from manimlib.mobject.svg.string_mobject import StringMobject
from manimlib.mobject.svg.text_mobject import Text as _BaseText

BEAT_DURATIONS: list[float] = json.loads(os.environ.get("EDUVID_BEATS", "[]"))
TOTAL_DURATION: float = float(sum(BEAT_DURATIONS))
_LAYOUT_LOG = os.environ.get("EDUVID_LAYOUT_LOG")
# [{"start": s, "end": s, "text": str}], absolute times. Empty list disables captions.
_CAPTIONS: list[dict] = json.loads(os.environ.get("EDUVID_CAPTIONS", "[]"))
_CAPTION_STYLE: dict = json.loads(os.environ.get("EDUVID_CAPTION_STYLE", "{}"))


def beat_start(index: int) -> float:
    return float(sum(BEAT_DURATIONS[:index]))


class Text(_BaseText):
    """Text that never comes out wider than the frame (e.g. long titles in 9:16 videos).

    Generated scenes import this module after manimlib, so this replaces manimlib's Text.
    """

    def __init__(self, text: str, *args, **kwargs):
        # ManimGL 1.7.2's StringMobject resets fill_color to WHITE after generic
        # Mobject color handling. Preserve the requested text color before that
        # step, while allowing explicit fill/stroke overrides and t2c accents.
        color = kwargs.get("color")
        if color is not None:
            kwargs.setdefault("fill_color", color)
            kwargs.setdefault("stroke_color", color)
            kwargs.setdefault("base_color", color)
        super().__init__(text, *args, **kwargs)
        max_width = FRAME_WIDTH - 0.6
        if self.get_width() > max_width:
            self.set_width(max_width)


class EduScene(Scene):
    def setup(self):
        super().setup()
        self._current_beat = -1
        self._issues: list[str] = []
        self._caption = None
        self._caption_idx = -1
        self._frames = 0
        self._finished = False

    def post_play(self):
        super().post_play()
        # Check stable states after every animation, including states later cleared
        # within the same beat. A last-frame-only dry run would miss those layouts.
        if self._current_beat >= 0:
            self._check_layout(f"beat {min(self._current_beat, len(BEAT_DURATIONS) - 1)}")

    # ---- helpers for generated code ---------------------------------------

    def clear_stage(self, run_time: float = 0.6, keep=()) -> None:
        """Fade out everything on screen (except captions and anything in `keep`)."""
        keep = set(map(id, keep))
        mobs = [
            m for m in self.mobjects
            if not isinstance(m, CameraFrame) and m is not self._caption and id(m) not in keep
        ]
        if mobs:
            self.play(*(FadeOut(m) for m in mobs), run_time=run_time)

    # ---- captions & progress ---------------------------------------------

    def update_frame(self, dt: float = 0, force_draw: bool = False) -> None:
        if _CAPTIONS and not self.skip_animations:
            self._sync_caption(self.time + dt)
        super().update_frame(dt, force_draw)

    def emit_frame(self) -> None:
        super().emit_frame()
        if not self.skip_animations:
            self._frames += 1
            if self._frames % 15 == 0:
                print(f"EDUVID_PROGRESS {self.time:.2f}", flush=True)

    def _sync_caption(self, t: float) -> None:
        idx = next((i for i, c in enumerate(_CAPTIONS) if c["start"] <= t < c["end"]), -1)
        if idx != self._caption_idx or (self._caption is not None and self._caption not in self.mobjects):
            if self._caption is not None and self._caption in self.mobjects:
                self.remove(self._caption)
            self._caption = self._make_caption(_CAPTIONS[idx]["text"]) if idx >= 0 else None
            self._caption_idx = idx
        if self._caption is not None and (not self.mobjects or self.mobjects[-1] is not self._caption):
            # Scene.add sorts by z_index before insertion order. Re-appending alone
            # leaves subtitles hidden behind generated objects with raised z_index.
            highest = max((m.z_index for m in self.mobjects if m is not self._caption), default=0)
            self._caption.set_z_index(highest + 1)
            self.add(self._caption)

    def _make_caption(self, text: str):
        size = _CAPTION_STYLE.get("font_size", 30)
        label = Text(text, font_size=size).set_fill(WHITE, 1)
        max_w = _CAPTION_STYLE.get("max_width", 12.0)
        if label.get_width() > max_w:
            label.set_width(max_w)
        pad_x, pad_y = 0.22 * size / 30, 0.14 * size / 30
        box = RoundedRectangle(
            width=label.get_width() + 2 * pad_x,
            height=label.get_height() + 2 * pad_y,
            corner_radius=0.12,
        ).set_fill(BLACK, 0.62).set_stroke(width=0)
        box.move_to(label)
        cap = VGroup(box, label)
        cap.move_to(UP * _CAPTION_STYLE.get("y", -3.4))
        cap.fix_in_frame()
        return cap

    # ---- timing -----------------------------------------------------------

    def beat(self, index: int) -> None:
        """Mark the start of narration beat `index` (0-based)."""
        expected = self._current_beat + 1
        if not isinstance(index, int) or isinstance(index, bool) or index != expected or index > len(BEAT_DURATIONS):
            raise ValueError(f"Expected self.beat({expected}), got self.beat({index}). Mark every beat once, in order.")
        if self._current_beat >= 0:
            self._check_layout(f"end of beat {self._current_beat}")
        target = beat_start(min(index, len(BEAT_DURATIONS)))
        remaining = target - self.time
        if remaining > 1e-3:
            if self._current_beat >= 0 and remaining > 1.0 and not any(True for _ in self._visible_top_level()):
                self._issues.append(
                    f"Blank stage: beat {self._current_beat} leaves {remaining:.1f}s of narration "
                    "with no diagram. Hold its visual until the next self.beat(i), then clear_stage()."
                )
            self.wait(remaining)
        elif remaining < -0.2 and self._current_beat >= 0:
            self._issues.append(
                f"Timing: beat {self._current_beat} animations ran {-remaining:.1f}s longer than "
                f"its narration ({BEAT_DURATIONS[self._current_beat]:.1f}s). Shorten run_times in that beat."
            )
        self._current_beat = index

    def beat_time_left(self) -> float:
        """Seconds remaining until the next beat starts."""
        return max(0.0, beat_start(self._current_beat + 1) - self.time)

    def finish(self) -> None:
        """Hold the final frame until the narration ends."""
        self.beat(len(BEAT_DURATIONS))
        self._finished = True
        self._write_log()

    def tear_down(self):
        self._check_layout("final frame")
        self._write_log()
        super().tear_down()
        if not self._finished:
            raise ValueError("End the scene with self.finish() after marking every narration beat.")

    # ---- layout checks ----------------------------------------------------

    def _visible_top_level(self):
        for mob in self.mobjects:
            if isinstance(mob, CameraFrame) or mob is self._caption:
                continue
            if not any(sm.has_points() for sm in mob.get_family()):
                continue
            yield mob

    def _check_layout(self, when: str) -> None:
        frame = self.frame
        try:
            if np.abs(frame.get_euler_angles()).max() > 1e-3:
                return  # 3D camera move; 2D bounds don't apply
        except Exception:
            pass
        cx, cy, _ = frame.get_center()
        hw, hh = frame.get_width() / 2, frame.get_height() / 2
        tol = 0.08
        # A zoomed or panned camera leaves things off-screen on purpose
        camera_moved = abs(hh * 2 - FRAME_HEIGHT) > 0.05 or abs(cx) > 0.05 or abs(cy) > 0.05

        texts = []
        for mob in self._visible_top_level():
            (x0, y0, _), _, (x1, y1, _) = mob.get_bounding_box()
            covers_frame = x0 <= cx - hw and x1 >= cx + hw and y0 <= cy - hh and y1 >= cy + hh
            is_background = isinstance(mob, NumberPlane) or covers_frame
            off_screen = x0 < cx - hw - tol or x1 > cx + hw + tol or y0 < cy - hh - tol or y1 > cy + hh + tol
            if off_screen and not is_background and not camera_moved:
                self._issues.append(
                    f"Off-screen at {when}: {self._describe(mob)} spans x=[{x0:.2f},{x1:.2f}] "
                    f"y=[{y0:.2f},{y1:.2f}] but the frame is x=[{cx-hw:.2f},{cx+hw:.2f}] "
                    f"y=[{cy-hh:.2f},{cy+hh:.2f}]."
                )
            caption_top = _CAPTION_STYLE.get("keep_above")
            if caption_top is not None and y0 < caption_top - tol and not is_background and not camera_moved:
                self._issues.append(
                    f"Caption overlap at {when}: {self._describe(mob)} extends to y={y0:.2f}; "
                    f"keep content above y={caption_top:.2f} to leave room for subtitles."
                )
            texts.extend(self._text_units(mob))

        for i in range(len(texts)):
            for j in range(i + 1, len(texts)):
                a, b = texts[i], texts[j]
                if self._overlap_ratio(a, b) > 0.15:
                    self._issues.append(
                        f"Overlapping text at {when}: {self._describe(a)} overlaps {self._describe(b)}."
                    )

    @classmethod
    def _text_units(cls, mob):
        """Text-like mobjects inside `mob`, without descending into them."""
        if isinstance(mob, (StringMobject, DecimalNumber)):
            glyphs = [sm for sm in mob.get_family() if sm.has_points()]
            if any(g.get_fill_opacity() > 0.05 for g in glyphs):
                yield mob
            return
        for sub in mob.submobjects:
            yield from cls._text_units(sub)

    @staticmethod
    def _overlap_ratio(a, b) -> float:
        (ax0, ay0, _), _, (ax1, ay1, _) = a.get_bounding_box()
        (bx0, by0, _), _, (bx1, by1, _) = b.get_bounding_box()
        w = min(ax1, bx1) - max(ax0, bx0)
        h = min(ay1, by1) - max(ay0, by0)
        if w <= 0 or h <= 0:
            return 0.0
        smaller = min((ax1 - ax0) * (ay1 - ay0), (bx1 - bx0) * (by1 - by0))
        return (w * h) / smaller if smaller > 1e-6 else 0.0

    @staticmethod
    def _describe(mob) -> str:
        if isinstance(mob, StringMobject):
            return f'{type(mob).__name__}("{mob.string[:40]}")'
        if isinstance(mob, DecimalNumber):
            return f"DecimalNumber({mob.get_value():g})"
        for sm in mob.get_family():
            if isinstance(sm, StringMobject):
                s = getattr(sm, "string", "")
                return f'{type(mob).__name__} containing "{s[:40]}"'
        return type(mob).__name__

    def _write_log(self) -> None:
        if not _LAYOUT_LOG:
            return
        seen, unique = set(), []
        for issue in self._issues:
            if issue not in seen:
                seen.add(issue)
                unique.append(issue)
        with open(_LAYOUT_LOG, "w") as f:
            json.dump({"issues": unique[:25], "final_time": self.time}, f)
