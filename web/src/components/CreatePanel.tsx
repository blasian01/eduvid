import { useEffect, useRef, useState } from "react";
import { api, store, type Health, type Renderer, type Settings, type Source, type Voice } from "../api";
import { Icon } from "./Icon";
import { DEFAULT_STYLES, STYLE_SWATCHES, standardStyle } from "../visualStyles";

const EXAMPLES = [
  "Why is the sky blue?",
  "How does compound interest snowball?",
  "What is a Fourier transform, intuitively?",
  "Why do odd numbers add up to perfect squares?",
  "How does public-key cryptography work?",
  "What is the Monty Hall problem?",
  "How do neural networks learn?",
  "Why can't you divide by zero?",
];

const TTS_MODELS = [
  { id: "eleven_v4", label: "Eleven v4 — highest quality, expressive" },
  { id: "eleven_v4_turbo", label: "Eleven v4 Turbo — expressive, faster" },
  { id: "eleven_v3", label: "Eleven v3 — expressive" },
  { id: "eleven_multilingual_v2", label: "Multilingual v2 — natural, reliable" },
  { id: "eleven_flash_v2_5", label: "Flash v2.5 — fastest, half the credits" },
];

type InputMode = "topic" | "article" | "youtube";
type ExtractionKind = "file" | "article_url" | "paste" | "youtube";
type RemotionMode = Exclude<Renderer, "manim">;
const INPUT_MODES: { id: InputMode; label: string }[] = [
  { id: "topic", label: "Topic" },
  { id: "article", label: "Article or paper" },
  { id: "youtube", label: "YouTube" },
];

function validYoutubeUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (!["https:", "http:"].includes(url.protocol)) return false;
    const host = url.hostname.toLowerCase();
    if (!["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be", "www.youtu.be"].includes(host)) return false;
    const parts = url.pathname.split("/").filter(Boolean);
    const id = host.endsWith("youtu.be") ? parts[0] : parts[0] === "watch" ? url.searchParams.get("v") : ["shorts", "embed", "live"].includes(parts[0]) ? parts[1] : null;
    return typeof id === "string" && /^[a-zA-Z0-9_-]{11}$/.test(id);
  } catch {
    return false;
  }
}

function validArticleUrl(value: string) {
  try {
    const url = new URL(value.trim());
    return ["http:", "https:"].includes(url.protocol) && Boolean(url.hostname);
  } catch {
    return false;
  }
}

// Match the server's prepurchase renderer selection using the visible topic/source title.
// The approved script can refine this choice later; explicit selections always win.
function autoUsesManim(settings: Settings, topic: string) {
  if (settings.content_mode === "math_science") return true;
  if (["storytelling", "infotainment"].includes(settings.content_mode)) return false;
  if (/\b(safety brief|safety overview|story|storytelling|infotainment|brochure)\b/i.test(topic)) return false;
  return /\b(transformers?|llms?|large language models?|neural networks?|self[- ]attention|attention mechanism|attention is all you need|attentionisallyouneed|calculus|algebra|geometry|mathematics|equations?|derivatives?|integrals?|matrices|quantum|physics|chemistry|molecules?|photosynthesis|probability)\b/i.test(topic);
}

interface Props {
  settings: Settings;
  onSettings: (s: Settings) => void;
  voices: Voice[];
  styles?: Record<string, { label: string; background: string }>;
  onGenerate: (prompt: string, sourceId?: string) => void;
  submitting: boolean;
  busy: boolean;
  error: string | null;
  keysReady: boolean;
  onOpenKeys: () => void;
  elevenlabsKey?: string;
  onClearError?: () => void;
  remotion?: Health["remotion"];
}

export default function CreatePanel({ settings, onSettings, voices, styles, onGenerate, submitting, busy, error, keysReady, onOpenKeys, elevenlabsKey, onClearError, remotion }: Props) {
  const [prompt, setPrompt] = useState(() => store.get("eduvid.draftPrompt", ""));
  const [inputMode, setInputMode] = useState<InputMode>("topic");
  const [articleFile, setArticleFile] = useState<File | null>(null);
  const articleFileRef = useRef<HTMLInputElement>(null);
  const [articleUrl, setArticleUrl] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [pastedTitle, setPastedTitle] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [source, setSource] = useState<Source | null>(null);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractionKind, setExtractionKind] = useState<ExtractionKind | null>(null);
  const extractionRequest = useRef(0);
  const extractionInFlight = useRef(false);
  const [advanced, setAdvanced] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [remotionMode, setRemotionMode] = useState<RemotionMode>(() => {
    if (settings.style !== "illustrated" && (settings.renderer === "auto" || settings.renderer === "remotion")) return settings.renderer;
    const saved = store.get<RemotionMode>("eduvid.remotionMode", "auto");
    return saved === "remotion" ? "remotion" : "auto";
  });
  const [lastStandardStyle, setLastStandardStyle] = useState(() => settings.style !== "illustrated" ? standardStyle(settings.style) : standardStyle(store.get("eduvid.standardStyle", "classic")));
  const [restoredStyle, setRestoredStyle] = useState<string | null>(null);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => onSettings({ ...settings, [k]: v });
  const updatePrompt = (v: string) => {
    setPrompt(v);
    store.set("eduvid.draftPrompt", v);
    onClearError?.();
  };

  const clearSource = () => {
    extractionRequest.current++;
    extractionInFlight.current = false;
    setExtracting(false);
    setExtractionKind(null);
    setSource(null);
    setSourceError(null);
    onClearError?.();
  };
  const changeInputMode = (next: InputMode) => {
    if (next === inputMode) return;
    clearSource();
    updatePrompt("");
    setArticleFile(null);
    setArticleUrl("");
    setPasteOpen(false);
    setPastedText("");
    setPastedTitle("");
    setYoutubeUrl("");
    setInputMode(next);
    if (next !== "topic" && settings.seconds < 60) set("seconds", 60);
  };

  useEffect(() => () => { extractionRequest.current++; extractionInFlight.current = false; }, []);

  const extractSource = async (kind: ExtractionKind = inputMode === "youtube" ? "youtube" : "file") => {
    if (extractionInFlight.current || submitting || inputMode === "topic") return;
    clearSource();
    if (kind === "file" && (!articleFile || !/\.(pdf|txt|md|docx|html?)$/i.test(articleFile.name))) {
      setSourceError("Choose a PDF, TXT, MD, DOCX, or HTML file.");
      return;
    }
    if (kind === "file" && articleFile?.size === 0) {
      setSourceError("This file is empty. Choose a file with readable text.");
      return;
    }
    if (kind === "article_url" && !validArticleUrl(articleUrl)) {
      setSourceError("Paste a public article or PDF link starting with https:// or http://.");
      return;
    }
    if (kind === "paste" && pastedText.trim().length < 80) {
      setSourceError("Paste at least 80 characters of article text so there is enough to explain.");
      return;
    }
    if (kind === "youtube" && !validYoutubeUrl(youtubeUrl)) {
      setSourceError("Paste a link to a YouTube video, such as youtube.com/watch?v=… or youtu.be/….");
      return;
    }
    const requestId = ++extractionRequest.current;
    extractionInFlight.current = true;
    setExtracting(true);
    setExtractionKind(kind);
    try {
      let extracted: Source;
      if (kind === "file") extracted = await api.article(articleFile!);
      else if (kind === "paste") {
        const filename = (pastedTitle.trim().replace(/[\\/:*?"<>|]/g, " ").slice(0, 120) || "Pasted article") + ".txt";
        extracted = await api.article(new File([pastedText.trim()], filename, { type: "text/plain" }));
      } else if (kind === "article_url") extracted = await api.articleUrl(articleUrl.trim());
      else extracted = await api.youtube(youtubeUrl.trim(), elevenlabsKey);
      if (requestId !== extractionRequest.current) return;
      setSource(extracted);
    } catch (e) {
      if (requestId === extractionRequest.current) setSourceError(e instanceof Error ? e.message : "Could not read this source. Please try again.");
    } finally {
      if (requestId === extractionRequest.current) { extractionInFlight.current = false; setExtracting(false); setExtractionKind(null); }
    }
  };

  const currentVoice = voices.find((v) => v.voice_id === settings.voice_id);
  const selectedRenderer = settings.style === "illustrated" ? "remotion" : settings.renderer || "auto";
  const remotionEnabled = selectedRenderer !== "manim";
  const selectRemotionMode = (mode: RemotionMode) => {
    setRemotionMode(mode);
    store.set("eduvid.remotionMode", mode);
    set("renderer", settings.style === "illustrated" ? "remotion" : mode);
  };
  const toggleRemotion = (enabled: boolean) => {
    if (!enabled && selectedRenderer !== "manim" && settings.style !== "illustrated") {
      setRemotionMode(selectedRenderer);
      store.set("eduvid.remotionMode", selectedRenderer);
    }
    if (!enabled && settings.style === "illustrated") {
      setRestoredStyle(lastStandardStyle);
      onSettings({ ...settings, renderer: "manim", style: lastStandardStyle });
    } else set("renderer", enabled ? remotionMode : "manim");
  };
  const chooseVisualStyle = (style: string) => {
    if (submitting) return;
    setRestoredStyle(null);
    if (style === "illustrated") {
      if (settings.style !== "illustrated") {
        const previous = standardStyle(settings.style);
        setLastStandardStyle(previous);
        store.set("eduvid.standardStyle", previous);
        if (selectedRenderer !== "manim") {
          setRemotionMode(selectedRenderer);
          store.set("eduvid.remotionMode", selectedRenderer);
        }
      }
      onSettings({ ...settings, style, renderer: "remotion" });
    } else {
      setLastStandardStyle(standardStyle(style));
      store.set("eduvid.standardStyle", standardStyle(style));
      onSettings({ ...settings, style, ...(settings.style === "illustrated" ? { renderer: remotionMode } : {}) });
    }
  };
  const autoManim = autoUsesManim(settings, `${prompt} ${source?.title || ""}`);
  const usesRemotion = selectedRenderer === "remotion" || (selectedRenderer === "auto" && !autoManim);
  const rendererUnavailable = usesRemotion && remotion?.available === false;
  const speedSupported = !["eleven_v4", "eleven_v4_turbo", "eleven_v3"].includes(settings.tts_model);
  useEffect(() => {
    setPreviewing(null);
    return () => {
      if (audioRef.current) {
        audioRef.current.onended = null;
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [settings.voice_id]);
  const previewVoice = () => {
    if (!currentVoice?.preview_url) return;
    audioRef.current?.pause();
    if (previewing === currentVoice.voice_id) {
      setPreviewing(null);
      return;
    }
    const a = new Audio(currentVoice.preview_url);
    audioRef.current = a;
    setPreviewing(currentVoice.voice_id);
    a.onended = () => setPreviewing(null);
    a.play().catch(() => setPreviewing(null));
  };

  const submit = () => {
    if (submitting || extracting || rendererUnavailable) return;
    if (inputMode === "topic") {
      if (prompt.trim().length >= 3) onGenerate(prompt.trim());
    } else if (source) {
      onGenerate(prompt.trim(), source.id);
    }
  };

  const styleList = { ...DEFAULT_STYLES, ...styles };

  return (
    <div className="card create">
      <h1 className="create-title">What should we explain?</h1>
      <div className="input-tabs" role="tablist" aria-label="Video input">
        {INPUT_MODES.map((mode, i) => (
          <button key={mode.id} id={`input-tab-${mode.id}`} type="button" role="tab" aria-selected={inputMode === mode.id} aria-controls="video-input-panel" tabIndex={inputMode === mode.id ? 0 : -1} className={inputMode === mode.id ? "on" : ""} disabled={submitting} onClick={() => changeInputMode(mode.id)} onKeyDown={(e) => {
            const direction = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
            if (!direction && e.key !== "Home" && e.key !== "End") return;
            e.preventDefault();
            const next = e.key === "Home" ? 0 : e.key === "End" ? INPUT_MODES.length - 1 : (i + direction + INPUT_MODES.length) % INPUT_MODES.length;
            changeInputMode(INPUT_MODES[next].id);
            (e.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined)?.focus();
          }}>{mode.label}</button>
        ))}
      </div>
      <div id="video-input-panel" role="tabpanel" aria-labelledby={`input-tab-${inputMode}`}>
      {inputMode === "article" && (
        <div className="source-input field">
          <label className="field-label" htmlFor="article-file">Upload an article or paper</label>
          <input id="article-file" ref={articleFileRef} type="file" accept=".pdf,.txt,.md,.docx,.html,.htm" disabled={submitting} aria-describedby="article-file-hint" onChange={(e) => { clearSource(); updatePrompt(""); setArticleUrl(""); setPasteOpen(false); setPastedText(""); setPastedTitle(""); setArticleFile(e.target.files?.[0] || null); }} />
          <div id="article-file-hint" className="small muted">PDF, TXT, Markdown, DOCX, or HTML. Choose a document with readable text.</div>
          <button className="btn" type="button" onClick={() => extractSource("file")} disabled={!articleFile || extracting || submitting}>{extracting && extractionKind === "file" ? <span className="spinner" /> : <Icon name="file" />} {extracting && extractionKind === "file" ? "Reading document…" : "Read document"}</button>
          <div className="source-divider">or use a link</div>
          <label className="field-label" htmlFor="article-url">Public article or PDF link</label>
          <input id="article-url" type="url" value={articleUrl} maxLength={4000} placeholder="https://example.com/article" disabled={submitting} onChange={(e) => { clearSource(); updatePrompt(""); setArticleFile(null); setPasteOpen(false); setPastedText(""); setPastedTitle(""); if (articleFileRef.current) articleFileRef.current.value = ""; setArticleUrl(e.target.value); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); extractSource("article_url"); } }} />
          <button className="btn" type="button" onClick={() => extractSource("article_url")} disabled={!articleUrl.trim() || extracting || submitting}>{extracting && extractionKind === "article_url" ? <span className="spinner" /> : <Icon name="external" />} {extracting && extractionKind === "article_url" ? "Reading article…" : "Read article link"}</button>
          <button className="disclosure paste-toggle" type="button" disabled={submitting} aria-expanded={pasteOpen} aria-controls="paste-article-panel" onClick={() => setPasteOpen(!pasteOpen)}><Icon name="chevron" size={14} /> Paste article text</button>
          {pasteOpen && <div id="paste-article-panel" className="paste-article-panel">
            <div className="field"><label className="field-label" htmlFor="pasted-article-title">Article title (optional)</label><input id="pasted-article-title" value={pastedTitle} maxLength={120} placeholder="e.g. AD60 safety overview" disabled={submitting} onChange={(e) => { clearSource(); setPastedTitle(e.target.value); }} /></div>
            <div className="field"><label className="field-label" htmlFor="pasted-article-text">Article text</label><textarea id="pasted-article-text" value={pastedText} rows={6} maxLength={180000} placeholder="Paste the article, paper, or brochure text here…" disabled={submitting} spellCheck={false} aria-describedby="pasted-article-hint" onChange={(e) => { clearSource(); updatePrompt(""); setArticleFile(null); setArticleUrl(""); if (articleFileRef.current) articleFileRef.current.value = ""; setPastedText(e.target.value); }} /><div id="pasted-article-hint" className="small muted">Useful for websites that block extraction. Include at least 80 characters of readable text.</div></div>
            <button className="btn" type="button" onClick={() => extractSource("paste")} disabled={pastedText.trim().length < 80 || extracting || submitting}>{extracting && extractionKind === "paste" ? <span className="spinner" /> : <Icon name="file" />} {extracting && extractionKind === "paste" ? "Reading pasted text…" : "Read pasted text"}</button>
          </div>}
        </div>
      )}
      {inputMode === "youtube" && (
        <div className="source-input field">
          <label className="field-label" htmlFor="youtube-url">YouTube video link</label>
          <input id="youtube-url" type="url" value={youtubeUrl} maxLength={2000} placeholder="https://www.youtube.com/watch?v=…" disabled={submitting} aria-describedby="youtube-hint" onChange={(e) => { clearSource(); updatePrompt(""); setYoutubeUrl(e.target.value); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); extractSource(); } }} />
          <div id="youtube-hint" className="small muted">Uses captions when available. Otherwise, ElevenLabs transcribes the audio using your Speech to Text access.</div>
          <button className="btn" type="button" onClick={() => extractSource("youtube")} disabled={!youtubeUrl.trim() || extracting || submitting}>{extracting ? <span className="spinner" /> : <Icon name="youtube" />} {extracting ? "Reading video…" : "Read video"}</button>
        </div>
      )}
      {sourceError && <div className="note error" role="alert"><Icon name="alert" /> {sourceError}</div>}
      {source && <SourceReview source={source} onClear={clearSource} />}
      <div className="prompt-box">
        {inputMode !== "topic" && <label className="field-label" htmlFor="video-prompt">Extra instructions (optional)</label>}
        <textarea
          id="video-prompt"
          aria-label={inputMode === "topic" ? "Learning topic and instructions" : "Extra instructions (optional)"}
          value={prompt}
          onChange={(e) => updatePrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
          }}
          placeholder={inputMode === "topic" ? "e.g. Explain why the Pythagorean theorem works with a visual proof, for high-schoolers" : "e.g. Focus on the main finding, use a simple analogy, and explain why it matters"}
          rows={inputMode === "topic" ? 4 : 2}
          maxLength={4000}
          disabled={submitting}
        />
        {inputMode === "topic" && <div className="examples">
          {EXAMPLES.map((ex) => (
            <button key={ex} className="chip" onClick={() => updatePrompt(ex)} type="button">
              {ex}
            </button>
          ))}
        </div>}
      </div>
      </div>

      <div className="field">
        <label className="field-label" htmlFor="content-mode">Explanation style</label>
        <select id="content-mode" value={settings.content_mode} onChange={(e) => set("content_mode", e.target.value as Settings["content_mode"])}>
          <option value="auto">Auto — match the material</option>
          <option value="math_science">Math & science — visual reasoning</option>
          <option value="storytelling">Storytelling — a story with a takeaway</option>
          <option value="infotainment">Infotainment — facts with a lively hook</option>
        </select>
      </div>

      <div className="field renderer-settings">
        <label className="toggle renderer-toggle">
          <input id="remotion-enabled" type="checkbox" role="switch" aria-label="Enable Remotion for new videos" checked={remotionEnabled} disabled={submitting} aria-describedby="renderer-hint" onChange={(e) => toggleRemotion(e.target.checked)} />
          <span className="track"><span className="thumb" /></span>
          Enable Remotion
          <span className="renderer-choice">{remotionEnabled ? "On" : "Off · Manim"}</span>
        </label>
        <label className="field-label" htmlFor="renderer-select">When Remotion is on</label>
        <select id="renderer-select" value={remotionEnabled ? selectedRenderer : remotionMode} disabled={submitting || !remotionEnabled || settings.style === "illustrated"} aria-describedby="renderer-hint" onChange={(e) => selectRemotionMode(e.target.value as RemotionMode)}>
          <option value="auto">Auto — choose by topic and explanation style</option>
          <option value="remotion" disabled={!remotion?.available}>Always use Remotion — animated cards & stories{remotion?.available ? "" : " (unavailable)"}</option>
        </select>
        <p className="muted small" id="renderer-hint">{!remotionEnabled ? "Remotion is off. Videos use Manim diagrams and visual animations." : rendererUnavailable ? "Remotion is unavailable. Turn it off to use Manim." : settings.style === "illustrated" ? "Illustrated Discovery uses Remotion. Turn Remotion off to return to a standard visual style." : selectedRenderer === "auto" ? `Auto uses ${autoManim ? "Manim for math & science" : "Remotion for general explainers, stories & infotainment"}; it matches the topic and source material.` : "Every new video uses Remotion animated layouts for facts, stories and takeaways."}</p>
      </div>

      <div className="opt-grid">
        <Segment
          label="Format"
          value={settings.aspect}
          onChange={(v) => set("aspect", v as Settings["aspect"])}
          options={[
            { value: "16:9", label: "16:9", sub: "YouTube" },
            { value: "9:16", label: "9:16", sub: "Shorts / Reels" },
          ]}
        />
        <Segment
          label="Length"
          value={String(settings.seconds)}
          onChange={(v) => set("seconds", Number(v))}
          options={[
            ...(inputMode === "topic" ? [{ value: "30", label: "30s" }, { value: "45", label: "45s" }] : []),
            { value: "60", label: "60s" },
            { value: "90", label: "90s" },
            { value: "120", label: "120s" },
          ]}
        />
      </div>

      <div className="field">
        <label className="field-label">Visual style</label>
        <div className="styles">
          {Object.entries(styleList).map(([key, s]) => (
            <button
              key={key}
              type="button"
              className={`style-card ${settings.style === key ? "selected" : ""}`}
              disabled={submitting || (key === "illustrated" && remotion?.available === false && settings.style !== "illustrated")}
              onClick={() => chooseVisualStyle(key)}
              aria-pressed={settings.style === key}
              aria-describedby={key === "illustrated" ? "illustrated-style-hint" : undefined}
            >
              <div className={`swatch${key === "illustrated" ? " illustrated" : ""}`} style={{ background: STYLE_SWATCHES[key]?.[0] }}>
                {key === "illustrated" ? <svg viewBox="0 0 44 30" aria-hidden="true"><circle cx="10" cy="8" r="4" fill="#FFD16B" /><circle cx="29" cy="19" r="8" fill="#FF746B" /><path d="M23 13q6-5 11 3l-3 2-4-1-1 5-5-3" fill="#42D6CE" /><ellipse cx="29" cy="19" rx="13" ry="4" transform="rotate(-25 29 19)" fill="none" stroke="#FFD16B" strokeWidth="1.5" /><circle cx="39" cy="7" r="1" fill="#42D6CE" /></svg> : (STYLE_SWATCHES[key] || []).slice(1).map((c, i) => (
                  <span key={c} style={{ background: c, transform: `translateX(${i * -6}px)` }} />
                ))}
              </div>
              <span>{s.label}</span>
            </button>
          ))}
        </div>
        <p className="muted small" id="illustrated-style-hint">{settings.style === "illustrated" ? "Illustrated worlds, visual metaphors and narrated motion. Requires Remotion." : "Standard themes work with both renderers. Illustrated Discovery requires Remotion."}</p>
        {restoredStyle && <p className="muted small" role="status">Illustrated Discovery requires Remotion. Restored {DEFAULT_STYLES[restoredStyle].label} with Remotion off.</p>}
      </div>

      <div className="opt-grid">
        <div className="field">
          <label className="field-label" htmlFor="voice-select">Voice</label>
          <div className="voice-row">
            {voices.length ? (
              <select
                id="voice-select"
                value={settings.voice_id}
                onChange={(e) => {
                  const v = voices.find((x) => x.voice_id === e.target.value);
                  onSettings({ ...settings, voice_id: e.target.value, voice_name: v?.name || e.target.value });
                }}
              >
                {voices.map((v) => (
                  <option key={v.voice_id} value={v.voice_id}>
                    {v.name}
                    {Object.values(v.labels).length ? ` — ${Object.values(v.labels).slice(0, 3).join(", ")}` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <button className="btn subtle grow" type="button" onClick={onOpenKeys}>
                {settings.voice_name} (default) · load your voices
              </button>
            )}
            <button
              className="icon-btn bordered"
              type="button"
              onClick={previewVoice}
              disabled={!currentVoice?.preview_url}
              title="Preview voice"
              aria-label="Preview voice"
            >
              <Icon name={previewing ? "stop" : "volume"} />
            </button>
          </div>
        </div>
        <Segment
          label="Quality"
          value={settings.quality}
          onChange={(v) => set("quality", v as Settings["quality"])}
          options={[
            { value: "480p", label: "480p", sub: "fast" },
            { value: "720p", label: "720p" },
            { value: "1080p", label: "1080p" },
          ]}
        />
      </div>

      <label className="toggle">
        <input type="checkbox" checked={settings.captions} onChange={(e) => set("captions", e.target.checked)} />
        <span className="track"><span className="thumb" /></span>
        Burn in captions <span className="muted small">(a .srt file is always included)</span>
      </label>

      <button className="disclosure" type="button" onClick={() => setAdvanced(!advanced)} aria-expanded={advanced}>
        <Icon name="chevron" size={14} /> Advanced
      </button>
      {advanced && (
        <div className="advanced">
          <div className="opt-grid">
            <div className="field">
              <label className="field-label" htmlFor="narration-language">Narration language</label>
              <input id="narration-language" value={settings.language} onChange={(e) => set("language", e.target.value)} placeholder="English" />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="speaking-speed">Speaking speed{speedSupported ? ` · ${settings.speed.toFixed(2)}×` : ""}</label>
              <input id="speaking-speed" type="range" min={0.8} max={1.2} step={0.05} value={speedSupported ? settings.speed : 1} disabled={!speedSupported} aria-describedby={!speedSupported ? "speaking-speed-note" : undefined} onChange={(e) => set("speed", Number(e.target.value))} />
              {!speedSupported && <div id="speaking-speed-note" className="small muted">Speaking pace is set by this model.</div>}
            </div>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="audience">Audience</label>
            <input id="audience" value={settings.audience} onChange={(e) => set("audience", e.target.value)} />
          </div>
          <div className="opt-grid">
            <div className="field">
              <label className="field-label" htmlFor="deepseek-model">DeepSeek model</label>
              <input id="deepseek-model" list="ds-models" value={settings.deepseek_model} onChange={(e) => set("deepseek_model", e.target.value)} />
              <datalist id="ds-models">
                <option value="deepseek-flash">Fast & cheap (recommended)</option>
                <option value="deepseek-v4-pro">Strongest — best animation code</option>
              </datalist>
            </div>
            <div className="field">
              <label className="field-label" htmlFor="tts-model">ElevenLabs model</label>
              <select id="tts-model" value={settings.tts_model} onChange={(e) => set("tts_model", e.target.value)}>
                {TTS_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="note error" role="alert">
          <Icon name="alert" /> {error}
        </div>
      )}

      <button className="btn primary big" onClick={submit} disabled={submitting || extracting || rendererUnavailable || (inputMode === "topic" ? prompt.trim().length < 3 : !source)} type="button">
        {submitting ? <span className="spinner" /> : <Icon name="sparkle" size={18} />}
        {keysReady ? (busy ? "Generate another video" : "Generate video") : "Add API keys to start"}
      </button>
      <div className="muted small center">⌘/Ctrl + Enter · usually 2–5 minutes</div>
    </div>
  );
}

function SourceReview({ source, onClear }: { source: Source; onClear: () => void }) {
  return (
    <div className="source-review" role="status" aria-label="Source review">
      <div className="source-review-head">
        <div><span className="source-ready"><Icon name="check" size={14} /> Source ready</span><h2>{source.title}</h2></div>
        <button className="icon-btn" type="button" onClick={onClear} aria-label="Clear source" title="Clear source"><Icon name="x" /></button>
      </div>
      <p className="small muted">{source.word_count.toLocaleString()} words · {source.text_chars.toLocaleString()} characters{source.duration ? ` · ${Math.round(source.duration)}s original video` : ""}</p>
      {source.url && /^https?:\/\//i.test(source.url) && <a className="link small source-link" href={source.url} target="_blank" rel="noreferrer">{source.type === "youtube" ? "Open original video" : "Open original article"} <Icon name="external" size={12} /></a>}
      <p className="source-excerpt" tabIndex={0} aria-label="Extracted source excerpt">{source.excerpt}</p>
      {Boolean(source.warnings.length) && <div className="note warning"><Icon name="alert" /><ul className="quality-issues">{source.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></div>}
      <p className="small muted">The video will use this source. Review the excerpt before generating.</p>
    </div>
  );
}

function Segment(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; sub?: string }[];
}) {
  return (
    <div className="field">
      <label className="field-label">{props.label}</label>
      <div className="segment" role="radiogroup" aria-label={props.label}>
        {props.options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={props.value === o.value}
            tabIndex={props.value === o.value || !props.options.some((option) => option.value === props.value) ? 0 : -1}
            className={props.value === o.value ? "on" : ""}
            onClick={() => props.onChange(o.value)}
            onKeyDown={(e) => {
              const direction = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
              if (!direction) return;
              e.preventDefault();
              const index = props.options.findIndex((option) => option.value === o.value);
              const next = (index + direction + props.options.length) % props.options.length;
              props.onChange(props.options[next].value);
              (e.currentTarget.parentElement?.children[next] as HTMLButtonElement | undefined)?.focus();
            }}
          >
            {o.label}
            {o.sub && <small>{o.sub}</small>}
          </button>
        ))}
      </div>
    </div>
  );
}
