// Watermark overlay for rendered video (Node/ffmpeg): burn a text or image
// watermark into a finished video via an ffmpeg filter, in place. Node-only.

export type WatermarkPosition =
  | "top-left" | "top-right" | "bottom-left" | "bottom-right" | "center";

export interface WatermarkConfig {
  /** Watermark text (drawtext). */
  text?: string;
  /** Watermark image path (overlay). Takes precedence over text if both set. */
  image?: string;
  position?: WatermarkPosition;
  opacity?: number;     // 0..1 (default 0.6)
  fontSize?: number;    // px for text (default 36)
  color?: string;       // text color (default white)
  margin?: number;      // px from the edge (default 24)
}

function posExpr(position: WatermarkPosition, margin: number, kind: "text" | "image"): { x: string; y: string } {
  // For drawtext the box is text_w/text_h; for overlay it's overlay_w/overlay_h.
  const w = kind === "text" ? "text_w" : "overlay_w";
  const h = kind === "text" ? "text_h" : "overlay_h";
  const m = margin;
  switch (position) {
    case "top-left": return { x: `${m}`, y: `${m}` };
    case "top-right": return { x: `W-${w}-${m}`, y: `${m}` };
    case "bottom-left": return { x: `${m}`, y: `H-${h}-${m}` };
    case "center": return { x: `(W-${w})/2`, y: `(H-${h})/2` };
    case "bottom-right":
    default: return { x: `W-${w}-${m}`, y: `H-${h}-${m}` };
  }
}

/** Apply a watermark to `videoPath` in place (via a temp file + rename). */
export async function applyWatermark(videoPath: string, config: WatermarkConfig): Promise<void> {
  const { spawn } = await import("node:child_process");
  const { renameSync, existsSync } = await import("node:fs");
  const position = config.position ?? "bottom-right";
  const opacity = config.opacity ?? 0.6;
  const margin = config.margin ?? 24;
  const tmp = videoPath.replace(/(\.[^.]+)$/, ".wm$1");

  let args: string[];
  if (config.image) {
    const { x, y } = posExpr(position, margin, "image");
    // Scale the logo alpha by opacity, then overlay.
    const filter = `[1:v]format=rgba,colorchannelmixer=aa=${opacity}[wm];[0:v][wm]overlay=${x}:${y}`;
    args = ["-y", "-i", videoPath, "-i", config.image, "-filter_complex", filter, "-c:a", "copy", tmp];
  } else {
    const { x, y } = posExpr(position, margin, "text");
    const text = (config.text ?? "").replace(/[\\:']/g, (c) => "\\" + c);
    const color = config.color ?? "white";
    const fontSize = config.fontSize ?? 36;
    const draw = `drawtext=text='${text}':fontcolor=${color}@${opacity}:fontsize=${fontSize}:x=${x}:y=${y}:box=0`;
    args = ["-y", "-i", videoPath, "-vf", draw, "-c:a", "copy", tmp];
  }

  await new Promise<void>((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-v", "error", ...args], { stdio: ["ignore", "inherit", "inherit"] });
    ff.on("error", reject);
    ff.on("close", (code: number) => (code === 0 ? resolve() : reject(new Error("watermark ffmpeg exited " + code))));
  });
  if (existsSync(tmp)) renameSync(tmp, videoPath);
}
