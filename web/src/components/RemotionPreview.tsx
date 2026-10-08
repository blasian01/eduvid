import { useRef } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { EduVidExplainer } from "../../../remotion/src/Explainer";
import type { VideoPlan } from "../../../remotion/src/types";

export default function RemotionPreview({ plan, audioSrc }: { plan: VideoPlan; audioSrc?: string }) {
  const player = useRef<PlayerRef>(null);
  if (![plan.width, plan.height, plan.fps, plan.durationInFrames].every((n) => Number.isFinite(n) && n > 0) || !Number.isInteger(plan.durationInFrames) || !Array.isArray(plan.scenes) || !plan.scenes.length) {
    return <div className="note error" role="alert">The storyboard preview is incomplete. Try re-rendering this video.</div>;
  }
  const vertical = plan.height > plan.width;
  return (
    <div className="storyboard-preview">
      <div className={`preview-frame ${vertical ? "vertical" : ""}`} aria-label="Interactive video preview">
        <Player
          key={JSON.stringify([plan, audioSrc])}
          ref={player}
          component={EduVidExplainer}
          inputProps={{ plan, audioSrc }}
          durationInFrames={plan.durationInFrames}
          compositionWidth={plan.width}
          compositionHeight={plan.height}
          fps={plan.fps}
          style={{ width: "100%", aspectRatio: `${plan.width} / ${plan.height}` }}
          controls
          showVolumeControls={Boolean(audioSrc)}
          showPlaybackRateControl
          autoPlay={false}
          errorFallback={() => <div className="preview-error" role="alert">This preview could not play. The MP4 above is still available when rendering is complete.</div>}
        />
      </div>
      <p className="muted small">Play, pause or scrub through the saved storyboard.{!audioSrc && " Narration will be available when voice processing finishes."}</p>
      <div className="preview-scenes" aria-label="Jump to a scene">
        {plan.scenes.map((scene, i) => (
          <button key={i} className="btn small" title={scene.headline} onClick={() => player.current?.seekTo(scene.startFrame)}>{i + 1}. {scene.headline}</button>
        ))}
      </div>
    </div>
  );
}
