import type { JobSummary } from "../api";
import { Icon } from "./Icon";

export default function Library({ jobs, activeId, onOpen }: { jobs: JobSummary[]; activeId: string | null; onOpen: (id: string) => void }) {
  if (!jobs.length) return null;
  return (
    <section className="library">
      <h2>Your videos</h2>
      <div className="lib-grid">
        {jobs.map((j) => (
          <button key={j.id} className={`lib-item ${j.id === activeId ? "active" : ""}`} onClick={() => onOpen(j.id)}>
            <div className={`lib-thumb ${j.settings?.aspect === "9:16" ? "vertical" : ""}`}>
              {j.thumb_url ? (
                <img src={j.thumb_url} alt="" loading="lazy" />
              ) : (
                <div className="lib-placeholder">
                  {j.status === "running" || j.status === "queued" ? <span className="spinner" /> : <Icon name="film" size={22} />}
                </div>
              )}
              {j.duration ? <span className="lib-dur">{Math.round(j.duration)}s</span> : null}
              {j.status === "done" && (
                <span className="lib-play">
                  <Icon name="play" size={18} />
                </span>
              )}
            </div>
            <div className="lib-meta">
              <div className="lib-title">{j.title || j.source?.title || j.prompt || "New video"}</div>
              <div className="muted small">
                {j.status === "done" ? new Date(j.created_at * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : <span className={`badge ${j.status}`}>{j.status}</span>}
                <span className="lib-renderer"> · {j.renderer_used === "remotion" ? "Remotion" : "Manim"}</span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
