import { useEffect, useRef, useState } from "react";
import { api, type Settings, type Voice } from "../api";
import { Icon } from "./Icon";

export interface Keys {
  deepseek: string;
  elevenlabs: string;
}

interface Props {
  keys: Keys;
  onKeys: (k: Keys) => void;
  voices: Voice[];
  onVoices: (v: Voice[]) => void;
  settings: Settings;
  onSettings: (s: Settings) => void;
  onClose: () => void;
}

type Check = { state: "idle" | "busy" | "ok" | "error"; msg?: string };

export default function SettingsModal({ keys, onKeys, voices, onVoices, settings, onSettings, onClose }: Props) {
  const [draft, setDraft] = useState<Keys>(keys);
  const [show, setShow] = useState({ deepseek: false, elevenlabs: false });
  const [dsCheck, setDsCheck] = useState<Check>({ state: "idle" });
  const [elCheck, setElCheck] = useState<Check>({ state: "idle" });
  const modalRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const dsRequest = useRef(0);
  const elRequest = useRef(0);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modalRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== "Tab") return;
      const controls = Array.from(modalRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), a[href], [tabindex='0']") || []);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (e.shiftKey && (document.activeElement === first || !modalRef.current?.contains(document.activeElement))) {
        e.preventDefault(); last?.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !modalRef.current?.contains(document.activeElement))) {
        e.preventDefault(); first?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      dsRequest.current++;
      elRequest.current++;
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, []);

  const save = (next: Keys) => {
    if (next.deepseek !== draft.deepseek) { dsRequest.current++; setDsCheck({ state: "idle" }); }
    if (next.elevenlabs !== draft.elevenlabs) { elRequest.current++; setElCheck({ state: "idle" }); }
    setDraft(next);
    onKeys({ deepseek: next.deepseek.trim(), elevenlabs: next.elevenlabs.trim() });
  };

  const testDeepseek = async () => {
    const requestId = ++dsRequest.current;
    setDsCheck({ state: "busy" });
    try {
      const models = await api.checkDeepseek(draft.deepseek.trim());
      if (requestId !== dsRequest.current) return;
      setDsCheck({ state: "ok", msg: `Key works · models: ${models.join(", ") || "—"}` });
    } catch (e: any) {
      if (requestId === dsRequest.current) setDsCheck({ state: "error", msg: e.message });
    }
  };

  const loadVoices = async () => {
    const requestId = ++elRequest.current;
    setElCheck({ state: "busy" });
    try {
      const v = await api.voices(draft.elevenlabs.trim());
      if (requestId !== elRequest.current) return;
      onVoices(v);
      setElCheck({ state: "ok", msg: `Key works · ${v.length} voices loaded` });
      if (v.length && !v.some((x) => x.voice_id === settings.voice_id)) {
        onSettings({ ...settings, voice_id: v[0].voice_id, voice_name: v[0].name });
      }
    } catch (e: any) {
      if (requestId === elRequest.current) setElCheck({ state: "error", msg: e.message });
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="keys-title">
        <div className="modal-head">
          <h2 id="keys-title">
            <Icon name="key" size={18} /> API keys
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <p className="muted small">
          Keys are saved only in this browser and sent to your local EduVid server with each request. The server
          never writes them to disk.
        </p>

        <KeyField
          id="deepseek-key"
          label="DeepSeek API key"
          hint="Writes the script and the ManimGL animation code."
          link="https://platform.deepseek.com/api_keys"
          value={draft.deepseek}
          shown={show.deepseek}
          onToggle={() => setShow({ ...show, deepseek: !show.deepseek })}
          onChange={(v) => save({ ...draft, deepseek: v })}
          placeholder="sk-…"
          action={{ label: "Test key", onClick: testDeepseek, disabled: !draft.deepseek.trim() }}
          check={dsCheck}
        />

        <KeyField
          id="elevenlabs-key"
          label="ElevenLabs API key"
          hint="Generates the voiceover with word-level timing."
          link="https://elevenlabs.io/app/settings/api-keys"
          value={draft.elevenlabs}
          shown={show.elevenlabs}
          onToggle={() => setShow({ ...show, elevenlabs: !show.elevenlabs })}
          onChange={(v) => save({ ...draft, elevenlabs: v })}
          placeholder="sk_…"
          action={{ label: voices.length ? "Reload voices" : "Load voices", onClick: loadVoices, disabled: !draft.elevenlabs.trim() }}
          check={elCheck}
        />
        <p className="muted small">
          The ElevenLabs key needs <b>Text to Speech</b> access, plus <b>Voices: read</b> to list your voices.
          For YouTube videos without captions, also enable <b>Speech to Text</b> to transcribe the audio.
        </p>

        <div className="modal-foot">
          <button className="btn primary" onClick={onClose} disabled={!draft.deepseek.trim() || !draft.elevenlabs.trim()}>
            <Icon name="check" /> Done
          </button>
        </div>
      </div>
    </div>
  );
}

function KeyField(props: {
  id: string;
  label: string;
  hint: string;
  link: string;
  value: string;
  shown: boolean;
  placeholder: string;
  onToggle: () => void;
  onChange: (v: string) => void;
  action: { label: string; onClick: () => void; disabled: boolean };
  check: Check;
}) {
  const { id, label, hint, link, value, shown, placeholder, onToggle, onChange, action, check } = props;
  return (
    <div className="field">
      <div className="field-label">
        <label htmlFor={id}>{label}</label>
        <a href={link} target="_blank" rel="noreferrer" className="link small">
          Get a key <Icon name="external" size={12} />
        </a>
      </div>
      <div className="key-row">
        <div className="input-wrap">
          <input
            id={id}
            aria-describedby={`${id}-hint`}
            type={shown ? "text" : "password"}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
          />
          <button className="icon-btn inset" onClick={onToggle} aria-label={shown ? "Hide key" : "Show key"} type="button">
            <Icon name={shown ? "eyeOff" : "eye"} />
          </button>
        </div>
        <button className="btn" onClick={action.onClick} disabled={action.disabled || check.state === "busy"}>
          {check.state === "busy" ? <span className="spinner" /> : null}
          {action.label}
        </button>
      </div>
      <div id={`${id}-hint`} className="small muted">{hint}</div>
      {check.state === "ok" && <div className="note ok" role="status">{check.msg}</div>}
      {check.state === "error" && <div className="note error" role="alert">{check.msg}</div>}
    </div>
  );
}
