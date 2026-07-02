// Named style/theme presets and aspect-ratio presets — a lightweight layer above
// colors/config so a whole render can adopt a "look" (palette + background + font
// + stroke + pacing) or a social aspect ratio by name. Applied by the Node
// backend's render() alongside QUALITY_PRESETS. Isomorphic (pure data + helpers).

/** A named visual theme. `palette` is an ordered list of accent colors. */
export interface StylePreset {
  name: string;
  description?: string;
  background: string;
  palette: string[];
  /** Default font family for Text (when the backend supports it). */
  font?: string;
  /** Default stroke width for new VMobjects (roughly px at 1080p). */
  strokeWidth?: number;
  /** Playback pacing multiplier applied to default runTimes (1 = normal, <1 faster). */
  pacing?: number;
}

/** Seven presets in the spirit of scrollmark/showrunner's style system. */
export const STYLE_PRESETS: Record<string, StylePreset> = {
  "3b1b-dark": {
    name: "3b1b-dark",
    description: "Navy background with blue/teal/gold accents — the classic math look.",
    background: "#0e1116",
    palette: ["#58C4DD", "#83C167", "#FFD700", "#FC6255", "#C9A0DC"],
    font: "sans-serif",
    strokeWidth: 4,
    pacing: 1,
  },
  "bold-neon": {
    name: "bold-neon",
    description: "Near-black with saturated neon accents for punchy social clips.",
    background: "#08080c",
    palette: ["#39FF14", "#FF10F0", "#00E5FF", "#FFF01F", "#FF3131"],
    font: "sans-serif",
    strokeWidth: 6,
    pacing: 0.85,
  },
  "clean-corporate": {
    name: "clean-corporate",
    description: "White background, restrained blue/grey palette for explainers.",
    background: "#ffffff",
    palette: ["#2563EB", "#0F766E", "#64748B", "#DC2626", "#CA8A04"],
    font: "sans-serif",
    strokeWidth: 4,
    pacing: 1,
  },
  "light": {
    name: "light",
    description: "Light neutral background with primary accents.",
    background: "#f5f5f4",
    palette: ["#2563EB", "#16A34A", "#EA580C", "#7C3AED", "#DB2777"],
    font: "sans-serif",
    strokeWidth: 4,
    pacing: 1,
  },
  "midnight": {
    name: "midnight",
    description: "Deep indigo with cool accents.",
    background: "#0b1020",
    palette: ["#8B9CF6", "#5EEAD4", "#FDE68A", "#F9A8D4", "#93C5FD"],
    font: "sans-serif",
    strokeWidth: 4,
    pacing: 1,
  },
  "chalkboard": {
    name: "chalkboard",
    description: "Dark green board with chalky pastels.",
    background: "#12331f",
    palette: ["#FFF8E7", "#FFD8A8", "#A5D8FF", "#B2F2BB", "#FFC9C9"],
    font: "serif",
    strokeWidth: 5,
    pacing: 1.1,
  },
  "print": {
    name: "print",
    description: "White paper, black ink with muted accents (figures/PDF).",
    background: "#ffffff",
    palette: ["#111827", "#1D4ED8", "#B91C1C", "#047857", "#6D28D9"],
    font: "serif",
    strokeWidth: 3,
    pacing: 1,
  },
};

export interface AspectRatioPreset {
  label: string;
  pixelWidth: number;
  pixelHeight: number;
}

/** Common social/broadcast aspect ratios at sensible default resolutions. */
export const ASPECT_RATIO_PRESETS: Record<string, AspectRatioPreset> = {
  "16:9": { label: "landscape", pixelWidth: 1920, pixelHeight: 1080 },
  "9:16": { label: "vertical", pixelWidth: 1080, pixelHeight: 1920 },
  "1:1": { label: "square", pixelWidth: 1080, pixelHeight: 1080 },
  "4:3": { label: "classic", pixelWidth: 1440, pixelHeight: 1080 },
  "21:9": { label: "cinema", pixelWidth: 2560, pixelHeight: 1080 },
};

/** Resolve a style preset by name (case-insensitive). Returns undefined if unknown. */
export function resolveStyle(name?: string): StylePreset | undefined {
  if (!name) return undefined;
  return STYLE_PRESETS[name] ?? STYLE_PRESETS[name.toLowerCase()];
}

/**
 * Resolve pixel dimensions for an aspect ratio. With no `height` the preset's
 * default resolution is used; with `height` the width is derived from the ratio
 * (even/rounded) so aspect can combine with a quality tier.
 */
export function resolveAspectRatio(
  ratio?: string,
  height?: number,
): { pixelWidth: number; pixelHeight: number } | undefined {
  if (!ratio) return undefined;
  const preset = ASPECT_RATIO_PRESETS[ratio];
  if (!preset) {
    // Accept an arbitrary "W:H" ratio too.
    const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(ratio);
    if (!m) return undefined;
    const rw = Number(m[1]), rh = Number(m[2]);
    const h = height ?? 1080;
    return { pixelWidth: even(Math.round((h * rw) / rh)), pixelHeight: even(h) };
  }
  if (height == null) return { pixelWidth: preset.pixelWidth, pixelHeight: preset.pixelHeight };
  const rw = preset.pixelWidth, rh = preset.pixelHeight;
  return { pixelWidth: even(Math.round((height * rw) / rh)), pixelHeight: even(height) };
}

// Video encoders prefer even dimensions.
function even(n: number): number {
  return n % 2 === 0 ? n : n + 1;
}
