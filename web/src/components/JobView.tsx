import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { api, store, type Health, type Job, type Renderer } from "../api";
import { Icon } from "./Icon";
import { DEFAULT_STYLES, standardStyle } from "../visualStyles";
const RemotionPreview = lazy(() => import("./RemotionPreview"));

interface Props {
  job: Job;
  deepseekKey: string;
  elevenlabsKey: string;
  onUpdate: (j: Job) => void;
  onClose: () => void;
  onDeleted: () => void;
  remotion?: Health["remotion"];
}

type Tab = "script" | "preview" | "code" | "log";

export default function JobView({ job, deepseekKey, elevenlabsKey, onUpdate, onClose, onDeleted, remotion }: Props) {
  const renderer = job.renderer_used || (job.remotion_plan ? "remotion" : "manim");
  const [tab, setTab] = useState<Tab>("script");
  const [editing, setEditing] = useState(false);
  const [draftCode, setDraftCode] = useState(job.code || "");
  const [actionError, setActionError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [animationStyle, setAnimationStyle] = useState<Exclude<Renderer, "auto">>(renderer);
  const [visualStyle, setVisualStyle] = useState(job.settings.style);
  const [lastStandardStyle, setLastStandardStyle] = useState(() => job.settings.style !== "illustrated" ? standardStyle(job.settings.style) : standardStyle(store.get(`eduvid.jobStandardStyle.${job.id}`, job.manim_style || "classic")));
  const [restoredStyle, setRestoredStyle] = useState<string | null>(null);
  const actionInFlight = useRef(false);
  const mounted = useRef(true);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const running = job.status === "queued" || job.status === "running";
  const awaitingScriptReview = (job.status === "error" || job.status === "cancelled") && Boolean(job.pending_script?.beats.length);
  const keysReady = Boolean(deepseekKey.trim() && elevenlabsKey.trim());
  const elapsed = useElapsed(job, running);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; clearTimeout(copyTimer.current); };
  }, []);
  useEffect(() => setVideoError(false), [job.video_url]);
  useEffect(() => setAnimationStyle(renderer), [renderer]);
  useEffect(() => setVisualStyle(job.settings.style), [job.settings.style]);
  useEffect(() => { if (awaitingScriptReview) setTab("script"); }, [awaitingScriptReview]);
  useEffect(() => { if (tab === "preview" && !job.remotion_plan) setTab("script"); }, [job.remotion_plan, tab]);

  useEffect(() => {
    if (!editing) setDraftCode(job.code || "");
  }, [job.code, editing]);

  useEffect(() => {
    setEditing(false);
    setActionError(null);
  }, [job.id]);

  // Follow the logs while the job runs
  useEffect(() => {
    if (running && job.stage === "test" && tab === "script") setTab("log");
  }, [running, job.stage]);

  const doAction = async (fn: () => Promise<unknown>) => {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setActionBusy(true);
    setActionError(null);
    try {
      await fn();
    } catch (e: any) {
      if (mounted.current) setActionError(e.message);
    } finally {
      actionInFlight.current = false;
      if (mounted.current) setActionBusy(false);
    }
  };

  const rerenderWithCode = () =>
    doAction(async () => {
      if (renderer === "remotion") {
        try {
          const parsed = JSON.parse(draftCode);
          if (parsed?.version !== 1 || !Array.isArray(parsed?.scenes)) throw new Error();
        } catch { throw new Error("Enter valid storyboard JSON with version 1 and a scenes list before re-rendering."); }
      }
      const j = await api.rerender(job.id, { code: draftCode, deepseek_key: deepseekKey.trim() || undefined, settings: { renderer } });
      if (!mounted.current) return;
      setEditing(false);
      onUpdate(j);
    });

  const regenerate = () =>
    doAction(async () => {
      const j = await api.rerender(job.id, { regenerate: true, deepseek_key: deepseekKey.trim(), settings: animationSettings });
      if (mounted.current) { setEditing(false); if (animationStyle !== renderer) setTab(animationStyle === "remotion" ? "preview" : "code"); onUpdate(j); }
    });

  const changeAnimationStyle = () =>
    doAction(async () => {
      if (needsManimGeneration && !deepseekKey.trim()) throw new Error("Add your DeepSeek API key to generate this video's Manim animation. The saved script and voiceover will be reused.");
      const j = await api.rerender(job.id, { settings: animationSettings, ...(needsManimGeneration ? { regenerate: true, deepseek_key: deepseekKey.trim() } : {}) });
      if (mounted.current) { setEditing(false); setTab(animationStyle === "remotion" ? "preview" : "code"); onUpdate(j); }
    });

  const resumeJob = (allowLongScript: boolean) =>
    doAction(async () => {
      const j = await api.resume(job.id, { deepseek_key: deepseekKey.trim(), elevenlabs_key: elevenlabsKey.trim(), ...(allowLongScript ? { allow_long_script: true } : {}) });
      if (mounted.current) { setEditing(false); onUpdate(j); }
    });
  const resume = () => resumeJob(false);
  const continueLongScript = () => {
    if (!awaitingScriptReview || !keysReady || running) return;
    return resumeJob(true);
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(job.code || "");
      if (!mounted.current) return;
      setCopied(true);
      clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      if (mounted.current) setActionError("Could not copy the animation data. Select it and copy manually.");
    }
  };

  const vertical = job.settings.aspect === "9:16";
  const canRerender = !running && !actionBusy && !awaitingScriptReview && Boolean(job.slots?.length);
  const canChangeStyle = canRerender && Boolean(job.script) && !editing;
  const styleChanged = visualStyle !== job.settings.style;
  const savedManimStyle = job.manim_style || (renderer === "manim" && job.settings.style !== "illustrated" ? job.settings.style : undefined);
  const needsManimGeneration = animationStyle === "manim" && (job.has_manim_code === false || visualStyle !== savedManimStyle);
  const animationSettings = { renderer: animationStyle, ...(styleChanged ? { style: visualStyle } : {}) };
  const canRegenerate = canRerender && !editing && Boolean(deepseekKey.trim()) && (animationStyle !== "remotion" || Boolean(remotion?.available));
  const chooseAnimationStyle = (next: Exclude<Renderer, "auto">) => {
    if (!canChangeStyle) return;
    setAnimationStyle(next);
    if (next === "manim" && visualStyle === "illustrated") {
      setVisualStyle(lastStandardStyle);
      setRestoredStyle(lastStandardStyle);
    }
  };
  const chooseVisualStyle = (next: string) => {
    if (!canChangeStyle) return;
    setRestoredStyle(null);
    if (next === "illustrated") setAnimationStyle("remotion");
    else {
      setLastStandardStyle(standardStyle(next));
      store.set(`eduvid.jobStandardStyle.${job.id}`, standardStyle(next));
    }
    setVisualStyle(next);
  };
  const previewReady = renderer === "remotion" && Boolean(job.remotion_plan);
  const detailTabs: Tab[] = ["script", ...(previewReady ? ["preview" as const] : []), "code", "log"];

  return (
    <div className="card job">
      <div className="job-head">
        <div className="job-title">
          <StatusBadge status={job.status} review={awaitingScriptReview} />
          <span className="renderer-badge">{renderer === "remotion" ? "Remotion" : "Manim"}</span>
          <h2>{job.title || "New video"}</h2>
          <p className="muted">{job.prompt || job.source?.title}</p>
          {job.source && <span className="muted small">{job.source.type === "youtube" ? "YouTube" : "Article / paper"} source · {job.source.title}</span>}
        </div>
        <div className="job-actions">
          {running ? (
            <button className="btn danger-ghost" disabled={actionBusy} onClick={() => doAction(() => api.cancel(job.id))}>
              <Icon name="stop" /> Cancel
            </button>
          ) : (
            <button
              className="icon-btn"
              title="Delete video"
              aria-label="Delete video"
              disabled={actionBusy}
              onClick={() => {
                if (confirm("Delete this video and its files?")) doAction(async () => { await api.remove(job.id); onDeleted(); });
              }}
            >
              <Icon name="trash" />
            </button>
          )}
          <button className="icon-btn" title="Close" aria-label="Close" onClick={onClose}>
            <Icon name="x" />
          </button>
        </div>
      </div>

      <Stepper job={job} elapsed={elapsed} />

      {job.status === "error" && job.error && !awaitingScriptReview && (
        <div className="note error pre" role="alert">
          <Icon name="alert" /> {job.error}
        </div>
      )}

      {awaitingScriptReview && (
        <div className="note warning script-review" role="status" aria-labelledby={`${job.id}-script-review-title`}>
          <Icon name="alert" />
          <div>
            <h3 id={`${job.id}-script-review-title`}>This draft still runs long</h3>
            <p>{job.length_warning ? `After ${job.length_warning.attempts} shortening attempts, the saved draft has ${job.length_warning.word_count} words (limit ${job.length_warning.word_limit}).` : "The saved draft is longer than the chosen video length."}</p>
            <p>{job.length_warning ? `Estimated narration is about ${Math.ceil(job.length_warning.estimated_seconds)}s, compared with ${job.length_warning.target_seconds}s requested. The finished video will likely be longer; actual speaking time may vary.` : `The finished video will likely exceed the requested ${job.settings.seconds}s.`}</p>
            <p>Review the saved draft in Script below. Continue anyway uses this draft to generate the video.</p>
            <button className="btn primary" onClick={continueLongScript} disabled={actionBusy || !keysReady} title="Use the saved longer draft and continue generating the video">
              {actionBusy ? <span className="spinner" /> : <Icon name="play" />} Continue anyway
            </button>
            {!keysReady && <p className="small">Add your API keys to continue with this draft.</p>}
          </div>
        </div>
      )}

      {(job.status === "error" || job.status === "cancelled") && !awaitingScriptReview && (
        <div className="resume-actions">
          <button className="btn primary" onClick={resume} disabled={actionBusy || !deepseekKey.trim() || !elevenlabsKey.trim()} title="Continue generation using the saved script and existing voice clips">
            {actionBusy ? <span className="spinner" /> : <Icon name="refresh" />} Resume generation
          </button>
          <span className="muted small">
            {!job.script ? "Starts again from the script." : job.script.beats.some((b) => b.audio_duration) ? "Reuses the saved script and recorded voice clips." : "Reuses the saved script."}
          </span>
        </div>
      )}

      {job.video_url && (
        <div className={`player ${vertical ? "vertical" : ""}`}>
          <video key={job.video_url} src={job.video_url} poster={job.thumb_url} controls playsInline preload="metadata" aria-label={job.title || "Generated explainer"} onError={() => setVideoError(true)} />
          {videoError && <div className="note error" role="alert">This video could not be played. Try downloading the MP4 or re-rendering it.</div>}
          {job.status === "done" && Boolean(job.quality_issues?.length) && (
            <div className="note warning" role="status">
              <Icon name="alert" />
              <div><b>Review this video before sharing</b><ul className="quality-issues">{job.quality_issues?.map((issue, i) => <li key={i}>{issue}</li>)}</ul></div>
            </div>
          )}
          <div className="player-actions">
            <a className="btn primary" href={job.video_url} download={`${slug(job.title || "explainer")}.mp4`}>
              <Icon name="download" /> Download MP4
            </a>
            {job.srt_url && (
              <a className="btn" href={job.srt_url} download={`${slug(job.title || "explainer")}.srt`}>
                <Icon name="download" /> Captions (.srt)
              </a>
            )}
            <button className="btn" onClick={regenerate} disabled={!canRegenerate} title="Keep the script & voiceover, ask DeepSeek for a fresh animation">
              <Icon name="wand" /> New animation
            </button>
            <span className="muted small">
              {job.duration != null ? `${job.duration.toFixed(1)}s · ` : ""}{job.settings.quality} · {job.settings.aspect}
            </span>
          </div>
        </div>
      )}

      {!job.video_url && Boolean(job.slots?.length) && <button className="btn" onClick={regenerate} disabled={!canRegenerate}><Icon name="wand" /> New animation</button>}
      {Boolean(job.script && job.slots?.length) && (
        <div className="animation-controls">
          <label className="toggle renderer-toggle">
            <input id={`${job.id}-remotion-enabled`} type="checkbox" role="switch" aria-label="Enable Remotion for this video" checked={animationStyle === "remotion"} disabled={!canChangeStyle || (animationStyle === "manim" && !remotion?.available && renderer !== "remotion")} aria-describedby={`${job.id}-animation-hint`} onChange={(e) => chooseAnimationStyle(e.target.checked ? "remotion" : "manim")} />
            <span className="track"><span className="thumb" /></span>
            Enable Remotion
            <span className="renderer-choice">{animationStyle === "remotion" ? "On" : "Off · Manim"}</span>
          </label>
          <label htmlFor={`${job.id}-animation-style`} className="small">Animation style</label>
          <select id={`${job.id}-animation-style`} value={animationStyle} disabled={!canChangeStyle} onChange={(e) => chooseAnimationStyle(e.target.value as Exclude<Renderer, "auto">)} aria-describedby={`${job.id}-animation-hint`}>
            <option value="remotion" disabled={!remotion?.available && renderer !== "remotion"}>Remotion — animated cards & stories{!remotion?.available && renderer !== "remotion" ? " (unavailable)" : ""}</option>
            <option value="manim">Manim — diagrams & visual math</option>
          </select>
          <div className="visual-theme-control">
            <label htmlFor={`${job.id}-visual-style`} className="small">Visual style</label>
            <select id={`${job.id}-visual-style`} value={visualStyle} disabled={!canChangeStyle} aria-describedby={`${job.id}-animation-hint`} onChange={(e) => chooseVisualStyle(e.target.value)}>
              {Object.entries(DEFAULT_STYLES).map(([value, theme]) => <option key={value} value={value} disabled={value === "illustrated" && !remotion?.available && job.settings.style !== "illustrated"}>{theme.label}</option>)}
            </select>
          </div>
          <button className="btn small" onClick={changeAnimationStyle} disabled={!canChangeStyle || (animationStyle === renderer && !styleChanged) || (animationStyle === "remotion" && !remotion?.available) || (needsManimGeneration && !deepseekKey.trim())}>Apply animation style</button>
          <p className="muted small" id={`${job.id}-animation-hint`}>{visualStyle === "illustrated" ? "Illustrated worlds, visual metaphors and narrated motion. Requires Remotion." : animationStyle === "remotion" ? "On uses Remotion animated cards and stories." : "Off uses Manim diagrams and visual animations."} Apply keeps the saved script and voiceover.{(animationStyle !== renderer || styleChanged) && animationStyle === "manim" ? needsManimGeneration ? " This video needs a new Manim animation, generated with DeepSeek." + (!deepseekKey.trim() ? " Add your DeepSeek API key to continue." : "") : " Reuses the saved Manim animation." : ""} New animation creates a fresh {animationStyle === "remotion" ? "Remotion" : "Manim"} animation.</p>
          {restoredStyle && <p className="muted small" role="status">Illustrated Discovery requires Remotion. Restored {DEFAULT_STYLES[restoredStyle].label} with Remotion off.</p>}
        </div>
      )}
      {actionError && <div className="note error" role="alert">{actionError}</div>}

      <div className="tabs" role="tablist" aria-label="Video details">
        {detailTabs.map((t) => (
          <button key={t} id={`${job.id}-tab-${t}`} role="tab" aria-controls={`${job.id}-panel-${t}`} aria-selected={tab === t} tabIndex={tab === t ? 0 : -1} className={tab === t ? "on" : ""} onClick={() => setTab(t)} onKeyDown={(e) => {
            const tabs = detailTabs;
            const direction = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
            if (!direction && e.key !== "Home" && e.key !== "End") return;
            e.preventDefault();
            const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1 : (tabs.indexOf(t) + direction + tabs.length) % tabs.length;
            setTab(tabs[next]);
            (e.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined)?.focus();
          }}>
            {t === "script" ? "Script" : t === "preview" ? "Preview" : t === "code" ? renderer === "remotion" ? "Storyboard" : "ManimGL code" : `Log (${job.logs.length})`}
          </button>
        ))}
      </div>

      <div id={`${job.id}-panel-${tab}`} role="tabpanel" aria-labelledby={`${job.id}-tab-${tab}`}>
      {tab === "script" && <ScriptView job={job} />}

      {tab === "preview" && (previewReady && job.remotion_plan ? <Suspense fallback={<p className="muted" role="status">Loading interactive preview…</p>}><RemotionPreview plan={job.remotion_plan} audioSrc={job.preview_audio_url} /></Suspense> : <p className="muted">The interactive preview will appear once the storyboard is ready.</p>)}

      {tab === "code" && (
        <div className="code-panel">
          {job.code ? (
            <>
              <div className="code-toolbar">
                <span className="muted small">{renderer === "remotion" ? "storyboard.json" : "scene.py"} · {job.code.split("\n").length} lines</span>
                <div className="spacer" />
                {!editing ? (
                  <>
                    <button className="btn small" onClick={copyCode}>
                      <Icon name="copy" /> {copied ? "Copied" : "Copy"}
                    </button>
                    <button className="btn small" onClick={() => { setActionError(null); setEditing(true); }} disabled={!canRerender}>
                      <Icon name="code" /> Edit & re-render
                    </button>
                  </>
                ) : (
                  <>
                    <button className="btn small" disabled={actionBusy} onClick={() => { setActionError(null); setEditing(false); setDraftCode(job.code || ""); }}>
                      Discard
                    </button>
                    <button className="btn small primary" onClick={rerenderWithCode} disabled={!canRerender || !draftCode.trim()}>
                      <Icon name="refresh" /> Re-render
                    </button>
                  </>
                )}
              </div>
              {editing ? (
                <textarea
                  className="code-editor"
                  aria-label={renderer === "remotion" ? "Animation storyboard JSON" : "ManimGL animation code"}
                  disabled={actionBusy}
                  value={draftCode}
                  onChange={(e) => setDraftCode(e.target.value)}
                  spellCheck={false}
                />
              ) : (
                <pre className="code"><code>{job.code}</code></pre>
              )}
              {editing && (
                <p className="muted small">
                  {renderer === "remotion" ? "Edit the scene headlines, details and layouts. Re-render checks the storyboard and keeps the existing narration." : <>Your edit is test-run first; if it errors and a DeepSeek key is set, DeepSeek auto-fixes it. To open it in ManimGL's live preview window, run <code>scripts/preview.sh {job.id}</code> in the project folder.</>}
                </p>
              )}
            </>
          ) : (
            <p className="muted">{renderer === "remotion" ? "The storyboard will appear here when the scenes are ready." : "The animation code will appear here once DeepSeek writes it."}</p>
          )}
        </div>
      )}

      {tab === "log" && <LogView job={job} />}
      </div>
    </div>
  );
}

function Stepper({ job, elapsed }: { job: Job; elapsed: string }) {
  return (
    <ol className="stepper">
      {job.steps.map((s, i) => (
        <li key={s.key} className={`step ${s.status}`}>
          <div className="step-marker">
            {s.status === "done" ? <Icon name="check" size={14} /> : s.status === "error" ? <Icon name="x" size={14} /> : s.status === "active" ? <span className="spinner small" /> : i + 1}
          </div>
          <div className="step-body">
            <div className="step-label">
              {s.label}
              {s.status === "active" && <span className="muted small"> · {elapsed}</span>}
            </div>
            {s.detail && <div className="step-detail">{s.detail}</div>}
            {s.status === "active" && s.progress > 0 && (
              <div className="bar">
                <span style={{ width: `${Math.round(s.progress * 100)}%` }} />
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function ScriptView({ job }: { job: Job }) {
  const pending = (job.status === "error" || job.status === "cancelled") ? job.pending_script : undefined;
  const script = pending || job.script;
  if (!script) return <p className="muted">{job.status === "queued" || job.status === "running" ? "DeepSeek is writing the script…" : "No script was generated. Resume generation to continue."}</p>;
  let t = 0;
  const slots = pending ? undefined : job.slots;
  return (
    <>
    {pending && <p className="saved-draft"><b>Saved draft: {pending.title}</b><br /><span className="muted small">Review the narration and scene ideas before continuing.</span></p>}
    <ol className="beats">
      {script.beats.map((b, i) => {
        const start = t;
        t += slots?.[i] ?? b.audio_duration ?? 0;
        return (
          <li key={i} className="beat">
            <div className="beat-time">{slots ? fmt(start) : `#${i + 1}`}</div>
            <div>
              <p className="narration">“{b.narration}”</p>
              {job.source && Boolean(b.source_refs?.length) && <p className="beat-source">Source: {b.source_refs?.join(" · ")}</p>}
              <p className="visual">
                <Icon name="film" size={13} /> {b.visual}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
    </>
  );
}

function LogView({ job }: { job: Job }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [job.logs.length]);
  const start = job.created_at;
  return (
    <div
      className="log"
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
    >
      {job.logs.map((l, i) => (
        <div key={i} className={`log-line ${l.level}`}>
          <span className="log-t">{fmt(Math.max(0, l.t - start))}</span>
          <span className="log-msg">{l.msg}</span>
        </div>
      ))}
      {!job.logs.length && <span className="muted">Waiting…</span>}
    </div>
  );
}

function StatusBadge({ status, review }: { status: Job["status"]; review?: boolean }) {
  if (review) return <span className="badge review">Review needed</span>;
  const label = { queued: "Queued", running: "Working", done: "Ready", error: "Failed", cancelled: "Cancelled" }[status];
  return <span className={`badge ${status}`}>{label}</span>;
}

function useElapsed(job: Job, running: boolean) {
  const [now, setNow] = useState(Date.now());
  const observed = useRef({ running, startedAt: Date.now() / 1000 });
  if (running && !observed.current.running) observed.current.startedAt = Date.now() / 1000;
  observed.current.running = running;
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [running]);
  return useMemo(() => {
    let start = job.run_started_at;
    if (!Number.isFinite(start)) {
      // Legacy servers have no attempt timestamp. Preserve their first-run timing,
      // but use new logs after the last finished attempt when a job is resumed.
      let terminal = -1;
      for (let i = job.logs.length - 1; i >= 0; i--) {
        if (/^(Done!|Error:|Job cancelled\.)/.test(job.logs[i].msg)) { terminal = i; break; }
      }
      start = terminal < 0 ? job.created_at : job.logs[terminal + 1]?.t ?? observed.current.startedAt;
    }
    return fmt(Math.max(0, now / 1000 - (start ?? job.created_at)));
  }, [now, job.run_started_at, job.created_at, job.logs]);
}

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function slug(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "explainer";
}
