import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, store, type Health, type Job, type JobSummary, type Settings, type Voice } from "./api";
import CreatePanel from "./components/CreatePanel";
import JobView from "./components/JobView";
import Library from "./components/Library";
import SettingsModal, { type Keys } from "./components/SettingsModal";
import { Icon } from "./components/Icon";

const FALLBACK_SETTINGS: Settings = {
  aspect: "16:9",
  quality: "720p",
  seconds: 60,
  style: "classic",
  language: "English",
  audience: "curious teenagers and adults with no special background",
  captions: true,
  deepseek_model: "deepseek-flash",
  voice_id: "JBFqnCBsd6RMkjVDRZzb",
  voice_name: "George",
  tts_model: "eleven_v4",
  speed: 1,
  content_mode: "auto",
  renderer: "auto",
};

export default function App() {
  const [keys, setKeys] = useState<Keys>(() => store.get("eduvid.keys", { deepseek: "", elevenlabs: "" }));
  const [settings, setSettings] = useState<Settings>(() => ({ ...FALLBACK_SETTINGS, ...store.get("eduvid.settings", {}) }));
  const [voices, setVoices] = useState<Voice[]>(() => store.get("eduvid.voices", []));
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(() => store.get("eduvid.activeJob", null));
  const [job, setJob] = useState<Job | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pollNonce, setPollNonce] = useState(0);
  const jobPanelRef = useRef<HTMLDivElement>(null);
  const libraryScrollTarget = useRef<string | null>(null);
  const submitInFlight = useRef(false);
  const jobsRequest = useRef(0);

  const keysReady = Boolean(keys.deepseek.trim() && keys.elevenlabs.trim());

  useEffect(() => store.set("eduvid.keys", keys), [keys]);
  useEffect(() => store.set("eduvid.settings", settings), [settings]);
  useEffect(() => store.set("eduvid.voices", voices), [voices]);
  useEffect(() => store.set("eduvid.activeJob", activeId), [activeId]);

  useEffect(() => {
    let stop = false;
    const refresh = () => api.health().then((h) => {
      if (!stop) { setHealth(h); setHealthError(null); }
    }).catch((e) => { if (!stop) setHealthError(e.message); });
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => { stop = true; window.clearInterval(timer); };
  }, []);

  const refreshJobs = useCallback(() => {
    const requestId = ++jobsRequest.current;
    api.jobs().then((next) => {
      if (requestId !== jobsRequest.current) return;
      setJobs(next);
      setJobsError(null);
    }).catch((e) => {
      if (requestId === jobsRequest.current) setJobsError(e.message);
    });
  }, []);
  useEffect(() => {
    refreshJobs();
    const timer = window.setInterval(refreshJobs, 3000);
    return () => { window.clearInterval(timer); jobsRequest.current++; };
  }, [refreshJobs]);

  useEffect(() => {
    if (job?.id === activeId && libraryScrollTarget.current === activeId && activeId) {
      libraryScrollTarget.current = null;
      jobPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [job, activeId]);

  // Poll the active job while it is running.
  useEffect(() => {
    setJobError(null);
    if (!activeId) {
      setJob(null);
      return;
    }
    let stop = false;
    let timer: number | undefined;
    const tick = async () => {
      try {
        const j = await api.job(activeId);
        if (stop) return;
        setJob(j);
        setJobError(null);
        if (j.status === "queued" || j.status === "running") {
          timer = window.setTimeout(tick, 1000);
        } else {
          refreshJobs();
        }
      } catch (e) {
        if (!stop) {
          setJobError(e instanceof Error ? e.message : "Could not load this video.");
          if (e instanceof ApiError && e.status === 404) setJob(null);
          else timer = window.setTimeout(tick, 2000);
        }
      }
    };
    tick();
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
  }, [activeId, pollNonce, refreshJobs]);

  const kickPolling = (j: Job) => {
    setJob(j);
    setJobError(null);
    setActiveId(j.id);
    setPollNonce((n) => n + 1); // restart polling even if the id is unchanged
  };

  const generate = async (prompt: string, sourceId?: string) => {
    if (submitInFlight.current) return;
    if (!keysReady) {
      setSettingsOpen(true);
      return;
    }
    submitInFlight.current = true;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const j = await api.create({ prompt, source_id: sourceId, settings, deepseek_key: keys.deepseek, elevenlabs_key: keys.elevenlabs });
      kickPolling(j);
      refreshJobs();
      setTimeout(() => jobPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    } catch (e: any) {
      setSubmitError(e.message);
    } finally {
      submitInFlight.current = false;
      setSubmitting(false);
    }
  };

  const activeJob = job?.id === activeId ? job : null;
  const running = jobs.some((j) => j.status === "queued" || j.status === "running") ||
    (activeJob && (activeJob.status === "queued" || activeJob.status === "running"));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo" aria-hidden>
            <svg viewBox="0 0 64 64" width="30" height="30">
              <circle cx="26" cy="34" r="14" fill="none" stroke="var(--accent)" strokeWidth="5" />
              <path d="M34 18 L52 32 L34 46 Z" fill="var(--gold)" />
            </svg>
          </div>
          <div>
            <div className="brand-name">EduVid Studio</div>
            <div className="brand-sub">Short explainers from topics, papers & videos</div>
          </div>
        </div>
        <div className="topbar-right">
          {health && (
            <div className="sys-pills">
              <span className="pill ok" title="3Blue1Brown's animation engine">ManimGL {health.manimgl}</span>
              <span className={`pill ${health.remotion?.available ? "ok" : "muted"}`} title={health.remotion?.available ? "Animated cards and stories ready" : health.remotion?.reason || "Remotion availability is not reported by this server"}>
                Remotion {health.remotion?.available ? "ready" : "unavailable"}
              </span>
              <span className={`pill ${health.ffmpeg ? "ok" : "bad"}`}>ffmpeg</span>
              <span className={`pill ${health.latex ? "ok" : "muted"}`} title={health.latex ? "LaTeX equations enabled" : "No LaTeX: equations are drawn with unicode text"}>
                LaTeX {health.latex ? "on" : "off"}
              </span>
            </div>
          )}
          <button className={`btn ghost ${keysReady ? "" : "attention"}`} onClick={() => setSettingsOpen(true)}>
            <Icon name="key" /> API keys
            {!keysReady && <span className="dot-badge" />}
          </button>
        </div>
      </header>

      {healthError && (
        <div className="banner error">
          <Icon name="alert" /> {healthError}
        </div>
      )}

      <main className="layout">
        <section className="col-left">
          <CreatePanel
            settings={settings}
            onSettings={setSettings}
            voices={voices}
            styles={health?.styles}
            remotion={health?.remotion}
            onGenerate={generate}
            submitting={submitting}
            busy={Boolean(running)}
            error={submitError}
            keysReady={keysReady}
            elevenlabsKey={keys.elevenlabs}
            onClearError={() => setSubmitError(null)}
            onOpenKeys={() => setSettingsOpen(true)}
          />
        </section>
        <section className="col-right" ref={jobPanelRef}>
          {jobError && (
            <div className="note error" role="alert">
              <Icon name="alert" />
              <span>{jobError}</span>
              <button className="btn small" onClick={() => setPollNonce((n) => n + 1)}>Retry</button>
              <button className="icon-btn" aria-label="Close video" onClick={() => setActiveId(null)}><Icon name="x" /></button>
            </div>
          )}
          {activeJob ? (
            <JobView
              key={activeJob.id}
              job={activeJob}
              deepseekKey={keys.deepseek}
              elevenlabsKey={keys.elevenlabs}
              remotion={health?.remotion}
              onUpdate={kickPolling}
              onClose={() => setActiveId(null)}
              onDeleted={() => {
                setActiveId((current) => current === activeJob.id ? null : current);
                refreshJobs();
              }}
            />
          ) : activeId ? (
            <div className="card empty" role="status">{!jobError && <span className="spinner" />} {jobError ? "Video could not be loaded." : "Loading video…"}</div>
          ) : (
            <EmptyState />
          )}
        </section>
      </main>

      {jobsError && <div className="note error" role="alert"><Icon name="alert" /> Could not refresh your videos: {jobsError}</div>}
      <Library jobs={jobs} activeId={activeId} onOpen={(id) => { libraryScrollTarget.current = id; setActiveId(id); setPollNonce((n) => n + 1); }} />

      {settingsOpen && (
        <SettingsModal
          keys={keys}
          onKeys={setKeys}
          voices={voices}
          onVoices={setVoices}
          settings={settings}
          onSettings={setSettings}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="card empty">
      <div className="empty-art" aria-hidden>
        <svg viewBox="0 0 220 140" width="220" height="140">
          <defs>
            <linearGradient id="g1" x1="0" x2="1">
              <stop offset="0" stopColor="var(--accent)" />
              <stop offset="1" stopColor="var(--gold)" />
            </linearGradient>
          </defs>
          <path d="M10 120 C 60 120, 70 20, 110 20 S 160 120, 210 120" fill="none" stroke="url(#g1)" strokeWidth="4" strokeLinecap="round" className="draw" />
          <line x1="10" y1="120" x2="210" y2="120" stroke="var(--line)" strokeWidth="2" />
          <line x1="110" y1="10" x2="110" y2="130" stroke="var(--line)" strokeWidth="2" />
          <circle cx="110" cy="20" r="6" fill="var(--gold)" className="pulse" />
        </svg>
      </div>
      <h2>Your video will appear here</h2>
      <p>
        Start with a topic, upload an article or paper, or paste a YouTube link. Review the source,
        choose an explanation style, and turn the key ideas into a narrated animation.
      </p>
      <ol className="how">
        <li><b>Script</b> — hook, explanation, takeaway</li>
        <li><b>Voice</b> — one line per beat, timed to the word</li>
        <li><b>Animate</b> — Remotion scenes or ManimGL code, checked & auto-fixed</li>
        <li><b>Render</b> — MP4 with captions & subtitles file</li>
      </ol>
    </div>
  );
}
