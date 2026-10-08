export const STYLE_SWATCHES: Record<string, string[]> = {
  classic: ["#0F1117", "#58C4DD", "#FFFF00", "#83C167"],
  neon: ["#05010D", "#00F5FF", "#FF2BD6", "#B6FF00"],
  chalkboard: ["#1E2B23", "#F4F1E8", "#F7D774", "#8EC9E8"],
  paper: ["#F7F5F0", "#1F2937", "#2563EB", "#DC2626"],
  illustrated: ["#171C4D", "#FF746B", "#42D6CE", "#FFD16B"],
};

export const DEFAULT_STYLES: Record<string, { label: string; hint?: string }> = {
  classic: { label: "3Blue1Brown classic" },
  neon: { label: "Neon glow" },
  chalkboard: { label: "Chalkboard" },
  paper: { label: "Clean paper (light)" },
  illustrated: { label: "Illustrated Discovery", hint: "Illustrated worlds, visual metaphors and narrated motion" },
};

export function standardStyle(value: unknown) {
  return typeof value === "string" && ["classic", "neon", "chalkboard", "paper"].includes(value) ? value : "classic";
}
