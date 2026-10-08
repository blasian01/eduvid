import type { VideoPlan } from "../../remotion/src/types";

export type StepStatus = "pending" | "active" | "done" | "error";
export type ContentMode = "auto" | "math_science" | "storytelling" | "infotainment";
export type Renderer = "auto" | "remotion" | "manim";

export interface Source {
  id: string;
  type: "article" | "youtube";
  title: string;
  text_chars: number;
  word_count: number;
  excerpt: string;
  url?: string | null;
  warnings: string[];
  duration?: number;
  transcript_method?: string;
}

export interface Step {
  key: string;
  label: string;
  status: StepStatus;
  detail: string;
  progress: number;
}

export interface LogLine {
  t: number;
  level: "info" | "warn" | "error" | "success";
  msg: string;
}

export interface Settings {
  aspect: "16:9" | "9:16";
  quality: "480p" | "720p" | "1080p";
  seconds: number;
  style: string;
  language: string;
  audience: string;
  captions: boolean;
  deepseek_model: string;
  voice_id: string;
  voice_name: string;
  tts_model: string;
  speed: number;
  content_mode: ContentMode;
  renderer: Renderer;
}

export interface Beat {
  narration: string;
  visual: string;
  audio_duration?: number;
  source_refs?: string[];
}

export interface Script {
  title: string;
  beats: Beat[];
}

export interface LengthWarning {
  word_count: number;
  word_limit: number;
  estimated_seconds: number;
  target_seconds: number;
  attempts: number;
  accepted?: boolean;
  message: string;
}

export interface Job {
  id: string;
  created_at: number;
  run_started_at?: number;
  prompt: string;
  title?: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  stage: string;
  error?: string | null;
  steps: Step[];
  logs: LogLine[];
  settings: Settings;
  script?: Script;
  pending_script?: Script;
  length_warning?: LengthWarning;
  slots?: number[];
  code?: string;
  video_url?: string;
  thumb_url?: string;
  srt_url?: string;
  duration?: number;
  quality_issues?: string[];
  source?: Source;
  renderer_used?: Exclude<Renderer, "auto">;
  has_manim_code?: boolean;
  manim_style?: string;
  remotion_plan?: VideoPlan;
  preview_audio_url?: string;
}

export type JobSummary = Pick<Job, "id" | "created_at" | "prompt" | "title" | "status" | "stage" | "error" | "video_url" | "thumb_url" | "duration" | "source" | "renderer_used"> & {
  settings: Pick<Settings, "aspect" | "quality" | "style">;
};

export interface Voice {
  voice_id: string;
  name: string;
  category?: string;
  preview_url?: string;
  labels: Record<string, string>;
}

export interface Health {
  ok: boolean;
  manimgl: string;
  ffmpeg: boolean;
  latex: boolean;
  font: string;
  styles: Record<string, { label: string; background: string }>;
  defaults: Settings;
  remotion?: { available: boolean; version: string | null; reason: string | null };
}

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { ...(typeof FormData !== "undefined" && init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(init?.headers || {}) },
    });
  } catch {
    throw new Error("Can't reach the EduVid server. Is it running? (npm run dev in the project folder)");
  }
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error page */
  }
  if (!res.ok) {
    const detail = data?.detail;
    const msg = typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((d: any) => d.msg).join("; ") : text;
    throw new ApiError(msg || `Request failed (${res.status})`, res.status);
  }
  if (text && data === null) throw new Error("The EduVid server returned an unexpected response. Please try again.");
  return data as T;
}

export const api = {
  health: () => request<Health>("/api/health"),
  jobs: () => request<{ jobs: JobSummary[] }>("/api/jobs").then((r) => r.jobs),
  job: (id: string) => request<Job>(`/api/jobs/${id}`),
  create: (body: { prompt?: string; source_id?: string; settings: Partial<Settings>; deepseek_key: string; elevenlabs_key: string }) =>
    request<Job>("/api/jobs", { method: "POST", body: JSON.stringify(body) }),
  article: (file: File) => {
    const body = new FormData();
    body.append("file", file);
    return request<Source>("/api/sources/article", { method: "POST", body });
  },
  articleUrl: (url: string) =>
    request<Source>("/api/sources/article-url", { method: "POST", body: JSON.stringify({ url }) }),
  youtube: (url: string, elevenlabsKey?: string) =>
    request<Source>("/api/sources/youtube", { method: "POST", body: JSON.stringify({ url, elevenlabs_key: elevenlabsKey?.trim() || undefined }) }),
  cancel: (id: string) => request(`/api/jobs/${id}/cancel`, { method: "POST" }),
  remove: (id: string) => request(`/api/jobs/${id}`, { method: "DELETE" }),
  rerender: (id: string, body: { code?: string; regenerate?: boolean; deepseek_key?: string; settings?: Partial<Settings> }) =>
    request<Job>(`/api/jobs/${id}/rerender`, { method: "POST", body: JSON.stringify(body) }),
  resume: (id: string, body: { deepseek_key: string; elevenlabs_key: string; allow_long_script?: boolean }) =>
    request<Job>(`/api/jobs/${id}/resume`, { method: "POST", body: JSON.stringify(body) }),
  voices: (elevenlabs_key: string) =>
    request<{ voices: Voice[] }>("/api/voices", { method: "POST", body: JSON.stringify({ elevenlabs_key }) }).then((r) => r.voices),
  checkDeepseek: (deepseek_key: string) =>
    request<{ models: string[] }>("/api/check-deepseek", { method: "POST", body: JSON.stringify({ deepseek_key }) }).then((r) => r.models),
};

/** localStorage that never throws (private windows, blocked storage). */
export const store = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};
