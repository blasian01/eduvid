/** Trusted storyboard data shared by server rendering and the browser preview. */
export const TEMPLATE_NAMES = ['hero', 'cards', 'steps', 'comparison', 'timeline', 'diagram', 'story', 'takeaway'] as const;
export type TemplateName = typeof TEMPLATE_NAMES[number];

export const ICON_NAMES = ['truck', 'shield', 'brake', 'person', 'warning', 'lock', 'camera', 'fire', 'check', 'book', 'brain', 'spark', 'leaf', 'water', 'clock', 'arrow'] as const;
export type IconName = typeof ICON_NAMES[number];
export type VisualStyle = 'classic' | 'neon' | 'chalkboard' | 'paper' | 'illustrated';

export const ILLUSTRATION_SUBJECTS = ['space', 'planet', 'atom', 'cell', 'nature', 'network', 'attention', 'machine', 'city', 'people', 'journey', 'abstract', 'notes'] as const;
export const ILLUSTRATION_MOTIONS = ['orbit', 'pulse', 'flow', 'grow', 'assemble', 'compare', 'transform'] as const;
export const CONTENT_KINDS = ['exercise', 'tokens', 'embedding', 'attention-mix', 'generation', 'process', 'bridge', 'causal-attention', 'notes'] as const;
export const EXERCISE_NAMES = ['crunch', 'leg-raise', 'plank', 'side-plank', 'flutter-kick', 'bicycle', 'russian-twist', 'mountain-climber', 'heel-touch', 'sit-up', 'standing', 'core', 'hip-dip', 'star-crunch', 'crunch-reach', 'plank-up-down', 'reverse-crunch', 'hollow-hold', 'lying'] as const;
export const CONTENT_LAYOUTS = ['single', 'sequence', 'comparison', 'collection'] as const;
export const CONTENT_ICON_NAMES = [...ICON_NAMES, 'plate', 'calendar', 'bridge', 'computer', 'token', 'vector', 'muscle', 'mat', 'note', 'question', 'building', 'plant'] as const;
export type ContentIconName = typeof CONTENT_ICON_NAMES[number];
/** A specific picture selected from approved narration, timed by recorded words. */
export interface IllustrationShot {
  cue: string;
  kind: typeof CONTENT_KINDS[number];
  exercise?: typeof EXERCISE_NAMES[number];
  text?: string;
  labels?: string[];
  layout?: typeof CONTENT_LAYOUTS[number];
  objects?: {icon: ContentIconName; label: string}[];
  /** Scene-relative times are computed by the server, never purchased again. */
  startFrame: number;
  durationInFrames: number;
}
export interface IllustrationPlan {
  subject: typeof ILLUSTRATION_SUBJECTS[number];
  motion: typeof ILLUSTRATION_MOTIONS[number];
  mode: 'schematic' | 'metaphor';
  /** Short concepts present in the corresponding narration, never extra claims. */
  labels?: string[];
  shots?: IllustrationShot[];
}

export interface SceneItem {
  label: string;
  detail?: string;
  icon?: IconName;
}

export interface ScenePlan {
  template: TemplateName;
  headline: string;
  kicker?: string;
  body?: string;
  items: SceneItem[];
  footer?: string;
  illustration?: IllustrationPlan;
}

export interface RemotionScene extends ScenePlan {
  startFrame: number;
  durationInFrames: number;
}

export interface CaptionCue {
  startFrame: number;
  endFrame: number;
  text: string;
}

export interface VideoPlan {
  version: 1;
  title: string;
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  style: VisualStyle;
  scenes: RemotionScene[];
  captions: CaptionCue[];
}

export interface ExplainerProps {
  plan: VideoPlan;
  audioSrc?: string;
}
