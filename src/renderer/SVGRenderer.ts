// A second render backend that walks the same mobjects[] tree the
// CanvasRenderer walks and emits an SVG document (one per frame) instead of
// drawing to a canvas. This yields resolution-independent, tiny, editable
// vector output, matching what manim's Cairo backend can emit.
//
// Geometry mirrors CanvasRenderer exactly: every world point is projected
// through `camera.toPixel`, the mobject tree is flattened + sorted in the same
// painter's order, and stroke widths are scaled by `camera.strokeScale()`.
//
// Isomorphic: no node-only imports. Importable in Node and the browser.

import { partialBezier } from "../core/math/bezier.ts";
import { Color } from "../core/color.ts";
import type { Camera } from "./CanvasRenderer.ts";
import type { Mobject } from "../mobject/Mobject.ts";

export interface SVGRenderOptions {
  /** Decimal places for coordinates, default 2. */
  precision?: number;
  /** Fill a background <rect>; default null = transparent. */
  background?: string | null;
}

// Resolve a mobject color-ish field to a CSS rgb/rgba string. Mirrors
// CanvasRenderer's use of `color.toRGBAString(alpha)` when present, else falls
// back to Color.parse. Returns "none" for a null/undefined color.
function colorToCss(color: any, alpha: number): string {
  if (color == null) return "none";
  if (typeof color.toRGBAString === "function") return color.toRGBAString(alpha);
  return Color.parse(color).toRGBAString(alpha);
}

// Escape text destined for SVG element content / attribute values.
function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Average of a point list — a cheap mobject center for 3D depth sorting.
function centroid(points: number[][]): number[] {
  let x = 0, y = 0, z = 0;
  for (const p of points) { x += p[0]; y += p[1]; z += (p[2] ?? 0); }
  const n = points.length || 1;
  return [x / n, y / n, z / n];
}

export class SVGRenderer {
  camera: Camera;
  precision: number;
  background: string | null;
  // Per-renderToString-call gradient <defs>, so a gradient-filled VMobject
  // (mob.gradientColors, set e.g. by SVGMobject's <linearGradient> import or
  // VMobject.setColorByGradient) doesn't silently flatten to a solid color
  // on this export path -- mirrors CanvasRenderer._buildGradient's
  // bounding-box + sheenDirection approach, emitted as real SVG markup.
  private _gradientDefs: string[] = [];
  private _gradientCounter = 0;

  constructor(camera: Camera, opts: SVGRenderOptions = {}) {
    this.camera = camera;
    this.precision = opts.precision ?? 2;
    this.background = opts.background ?? null;
  }

  // Register a <linearGradient> def for `mob` (if it carries gradientColors)
  // and return its `url(#id)` fill reference, or null if not gradient-filled.
  private gradientFillRef(mob: any): string | null {
    const colors: any[] = mob.gradientColors;
    if (!colors || colors.length === 0) return null;
    const { camera } = this;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const p of mob.points) {
      const [x, y] = camera.toPixel(p);
      minx = Math.min(minx, x); miny = Math.min(miny, y);
      maxx = Math.max(maxx, x); maxy = Math.max(maxy, y);
    }
    if (!isFinite(minx)) return null;
    const dir = mob.sheenDirection ?? [-1, 1, 0];
    const dx = dir[0];
    const dy = -(dir[1] ?? 0); // world y-up -> pixel y-down, mirroring CanvasRenderer
    const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
    const hw = (maxx - minx) / 2 || 1, hh = (maxy - miny) / 2 || 1;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const id = `grad${this._gradientCounter++}`;
    const n = colors.length;
    const stops = colors
      .map((c, i) => `<stop offset="${this.n(n === 1 ? 0 : i / (n - 1))}" stop-color="${colorToCss(c, 1)}"/>`)
      .join("");
    this._gradientDefs.push(
      `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" ` +
      `x1="${this.n(cx - ux * hw)}" y1="${this.n(cy - uy * hh)}" ` +
      `x2="${this.n(cx + ux * hw)}" y2="${this.n(cy + uy * hh)}">${stops}</linearGradient>`,
    );
    return `url(#${id})`;
  }

  // Round a number to `precision` decimals, stripping a trailing ".00". Guards
  // against NaN/Infinity so they never reach the output string.
  private n(v: number): string {
    if (!Number.isFinite(v)) v = 0;
    const p = this.precision;
    const r = Number(v.toFixed(p));
    // Number(...).toString() trims trailing zeros and avoids "-0".
    return (Object.is(r, -0) ? 0 : r).toString();
  }

  // Render the current scene state to a complete standalone SVG document.
  renderToString(mobjects: any[]): string {
    // Sync the viewport to an animatable camera frame (no-op when unset).
    this.camera.preRender?.();
    const { camera } = this;
    const W = camera.pixelWidth;
    const H = camera.pixelHeight;

    this._gradientDefs = [];
    this._gradientCounter = 0;

    const body: string[] = [];
    if (this.background != null) {
      body.push(
        `<rect x="0" y="0" width="${this.n(W)}" height="${this.n(H)}" fill="${escapeXml(this.background)}"/>`,
      );
    }

    // Painter's order: flatten the tree, sort by zIndex (then depth, then
    // sequence) exactly like CanvasRenderer.renderMobjects. With a 3D camera we
    // still project every point via toPixel (documented vector approximation;
    // no per-pixel z-buffer in vector mode) and break ties by painter depth.
    const camera3d = typeof (camera as any).projectionDepth === "function" ? camera : null;
    const flat: Array<{ mob: any; z: number; depth: number; seq: number }> = [];
    let seq = 0;
    const collect = (m: any, inheritedZ: number) => {
      const z = m.zIndex ?? inheritedZ;
      if (m.points && m.points.length) {
        const depth = camera3d ? (camera3d as any).projectionDepth(centroid(m.points)) : 0;
        flat.push({ mob: m, z, depth, seq: seq++ });
      }
      const subs = m.submobjects ?? [];
      for (const s of subs) collect(s, z);
    };
    for (const m of mobjects) collect(m, 0);
    flat.sort((a, b) => (a.z - b.z) || (a.depth - b.depth) || (a.seq - b.seq));

    for (const { mob } of flat) {
      let el: string | null = null;
      try {
        if (mob._isText) el = this.drawText(mob);
        else if (mob._isImage) el = this.drawImage(mob);
        else el = this.drawVMobject(mob);
      } catch {
        // Never throw on a single mobject — skip it and continue.
        el = null;
      }
      if (el) body.push(el);
    }

    const defs = this._gradientDefs.length ? `<defs>${this._gradientDefs.join("")}</defs>` : "";
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${this.n(W)}" height="${this.n(H)}" ` +
      `viewBox="0 0 ${this.n(W)} ${this.n(H)}">` +
      defs +
      body.join("") +
      `</svg>`
    );
  }

  /** SceneRenderer-shaped alias for renderToString(), satisfying the shared
   *  interface in scene_renderer.ts. Purely delegating -- renderToString()
   *  remains the primary, unchanged public method. */
  renderFrame(mobjects: Mobject[]): string {
    return this.renderToString(mobjects);
  }

  // Build SVG path data for a VMobject, honoring strokeEnd (proportion) using
  // partialBezier — mirrors CanvasRenderer.tracePath exactly.
  private tracePathData(mob: any, proportion = 1): string {
    const { camera } = this;
    const subpaths: number[][][] = mob.getSubpaths ? mob.getSubpaths() : [];
    const totalCurves = subpaths.reduce(
      (n, sp) => n + Math.max(0, Math.floor((sp.length - 1) / 3)),
      0,
    );
    const drawCurves = totalCurves * Math.max(0, Math.min(1, proportion));
    let drawn = 0;
    const out: string[] = [];

    for (const sp of subpaths) {
      const nc = Math.floor((sp.length - 1) / 3);
      if (nc < 1) continue;
      if (drawn >= drawCurves) break;
      const [sx, sy] = camera.toPixel(sp[0]);
      out.push(`M${this.n(sx)} ${this.n(sy)}`);
      for (let i = 0; i < nc; i++) {
        if (drawn >= drawCurves) break;
        let a = sp[3 * i], c1 = sp[3 * i + 1], c2 = sp[3 * i + 2], b = sp[3 * i + 3];
        const remaining = drawCurves - drawn;
        if (remaining < 1) {
          [a, c1, c2, b] = partialBezier(a, c1, c2, b, 0, remaining);
        }
        const p1 = camera.toPixel(c1);
        const p2 = camera.toPixel(c2);
        const p3 = camera.toPixel(b);
        out.push(
          `C${this.n(p1[0])} ${this.n(p1[1])} ${this.n(p2[0])} ${this.n(p2[1])} ` +
          `${this.n(p3[0])} ${this.n(p3[1])}`,
        );
        drawn += 1;
      }
    }
    return out.join("");
  }

  // Emit an SVG <path> for a VMobject. Mirrors drawVMobject's style reads and
  // maps them to SVG paint attributes.
  drawVMobject(mob: any): string | null {
    if (!mob.points || mob.points.length === 0) return null;

    const proportion = mob.strokeEnd ?? 1;
    const opacity = mob.opacity ?? 1;
    const lineJoin = mob.lineJoin ?? "round";
    const lineCap = mob.lineCap ?? "round";

    // Fill is only meaningful when the whole path is present (mirrors Canvas:
    // fill draws with proportion 1 only when strokeEnd >= 1).
    const fillOpacity = mob.fillOpacity ?? 0;
    const hasFill = fillOpacity > 0 && proportion >= 1;

    const strokeOpacity = mob.strokeOpacity ?? 1;
    const strokeWidth = mob.strokeWidth ?? 0;
    const hasStroke = strokeWidth > 0 && strokeOpacity > 0;

    if (!hasFill && !hasStroke) return null;

    // Fill uses the full path; stroke uses the (possibly partial) path. When
    // both are present with the same proportion they share one <path>; when the
    // stroke is truncated we emit a separate stroked path so the fill stays
    // whole (matching Canvas, which fills at 1 and strokes at proportion).
    // NOTE: build `attrs` only inside the branch that actually returns it --
    // gradientFillRef() has a side effect (registers a <defs> entry), so
    // computing it here unconditionally and then falling through to the
    // "otherwise" block below (which computes its own fill paint) would
    // register a duplicate, unused gradient def and use the wrong one.
    if (hasStroke && proportion >= 1) {
      // Single path carries both fill and stroke.
      const attrs: string[] = [];
      if (hasFill) {
        const fillPaint = this.gradientFillRef(mob) ?? colorToCss(mob.fillColor, 1);
        attrs.push(`fill="${fillPaint}"`);
        attrs.push(`fill-opacity="${this.n(fillOpacity * opacity)}"`);
        attrs.push(`fill-rule="nonzero"`);
      } else {
        attrs.push(`fill="none"`);
      }
      attrs.push(`stroke="${colorToCss(mob.strokeColor, 1)}"`);
      attrs.push(`stroke-width="${this.n(strokeWidth * this.camera.strokeScale())}"`);
      attrs.push(`stroke-opacity="${this.n(strokeOpacity * opacity)}"`);
      attrs.push(`stroke-linejoin="${escapeXml(lineJoin)}"`);
      attrs.push(`stroke-linecap="${escapeXml(lineCap)}"`);
      const d = this.tracePathData(mob, 1);
      if (!d) return null;
      return `<path ${attrs.join(" ")} d="${d}"/>`;
    }

    // Otherwise: fill path (whole) then, if any, a truncated stroke path.
    const parts: string[] = [];
    if (hasFill) {
      const dFill = this.tracePathData(mob, 1);
      if (dFill) {
        const fillPaint = this.gradientFillRef(mob) ?? colorToCss(mob.fillColor, 1);
        parts.push(
          `<path fill="${fillPaint}" ` +
          `fill-opacity="${this.n(fillOpacity * opacity)}" fill-rule="nonzero" ` +
          `stroke="none" d="${dFill}"/>`,
        );
      }
    }
    if (hasStroke) {
      const dStroke = this.tracePathData(mob, proportion);
      if (dStroke) {
        parts.push(
          `<path fill="none" ` +
          `stroke="${colorToCss(mob.strokeColor, 1)}" ` +
          `stroke-width="${this.n(strokeWidth * this.camera.strokeScale())}" ` +
          `stroke-opacity="${this.n(strokeOpacity * opacity)}" ` +
          `stroke-linejoin="${escapeXml(lineJoin)}" ` +
          `stroke-linecap="${escapeXml(lineCap)}" d="${dStroke}"/>`,
        );
      }
    }
    return parts.length ? parts.join("") : null;
  }

  // Emit an SVG <text> (one <tspan> per line) for a raster Text mobject.
  // Mirrors drawText's font sizing, family, weight, slant, fill, alignment and
  // anchor math.
  drawText(mob: any): string | null {
    const { camera } = this;
    const alpha = (mob.fillOpacity ?? 1) * (mob.opacity ?? 1);
    if (alpha <= 0) return null;

    const box = mob.getBoundingBox();
    const center = mob.getCenter();
    const fontHeightWorld = mob.currentFontHeight();
    const fontPx = (fontHeightWorld / camera.frameHeight) * camera.pixelHeight;
    const lines = String(mob.text ?? "").split("\n");
    const lineStepPx = fontPx * 1.2;

    const anchor = mob.align === "left" ? "start" : mob.align === "right" ? "end" : "middle";
    const anchorX = mob.align === "left" ? box.min[0] : mob.align === "right" ? box.max[0] : center[0];
    const [cx] = camera.toPixel([anchorX, 0, 0]);
    const [, cyTop] = camera.toPixel([0, box.max[1], 0]);

    const fill = colorToCss(mob.fillColor, alpha);
    const fontStyle = mob.slant === "italic" ? "italic" : "normal";
    const fontWeight = mob.weight ?? "normal";
    const fontFamily = mob.font ?? "sans-serif";

    const tspans = lines
      .map((line: string, i: number) => {
        const y = cyTop + lineStepPx * (i + 0.5);
        return `<tspan x="${this.n(cx)}" y="${this.n(y)}">${escapeXml(line)}</tspan>`;
      })
      .join("");

    return (
      `<text text-anchor="${anchor}" dominant-baseline="middle" ` +
      `font-family="${escapeXml(fontFamily)}" font-size="${this.n(fontPx)}" ` +
      `font-weight="${escapeXml(String(fontWeight))}" font-style="${fontStyle}" ` +
      `fill="${fill}">${tspans}</text>`
    );
  }

  // Emit an SVG <image> for an ImageMobject, positioned by the projected bbox of
  // mob.points (min/max toPixel), mirroring drawImage. Falls back to a
  // placeholder <rect> when no data URL is obtainable — never throws.
  drawImage(mob: any): string | null {
    if (!mob.points || !mob.points.length) return null;
    const { camera } = this;
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (const p of mob.points) {
      const [x, y] = camera.toPixel(p);
      minx = Math.min(minx, x); miny = Math.min(miny, y);
      maxx = Math.max(maxx, x); maxy = Math.max(maxy, y);
    }
    if (!Number.isFinite(minx)) return null;
    const w = maxx - minx;
    const h = maxy - miny;
    const opacity = mob.opacity ?? 1;

    const href = this.imageHref(mob);
    if (href) {
      return (
        `<image x="${this.n(minx)}" y="${this.n(miny)}" ` +
        `width="${this.n(w)}" height="${this.n(h)}" opacity="${this.n(opacity)}" ` +
        `href="${escapeXml(href)}" preserveAspectRatio="none"/>`
      );
    }
    // Placeholder — keep the layout slot without throwing on an un-encodable image.
    return (
      `<rect x="${this.n(minx)}" y="${this.n(miny)}" ` +
      `width="${this.n(w)}" height="${this.n(h)}" opacity="${this.n(opacity)}" ` +
      `fill="none" stroke="#888888" stroke-width="1"/>`
    );
  }

  // Try to obtain a data URL for an ImageMobject. `mob.src` may already be a
  // data URL or a path; `mob.image` may be a canvas/bitmap with toDataURL.
  private imageHref(mob: any): string | null {
    const src = mob.src;
    if (typeof src === "string" && (src.startsWith("data:") || /^https?:\/\//.test(src) || src.length)) {
      return src;
    }
    const img = mob.image;
    if (img && typeof img.toDataURL === "function") {
      try {
        return img.toDataURL();
      } catch {
        return null;
      }
    }
    return null;
  }
}

// Convenience: build a Camera + SVGRenderer and return the SVG for a mobject
// list. Accepts either a pre-built `camera` or Camera config fields.
export function mobjectsToSVG(
  mobjects: any[],
  opts: SVGRenderOptions & {
    pixelWidth?: number;
    pixelHeight?: number;
    frameHeight?: number;
    frameWidth?: number;
    frameCenter?: number[];
    camera?: any;
  } = {},
): string {
  let camera = opts.camera;
  if (!camera) {
    // Lazily import Camera to keep this module's top-level import graph minimal;
    // but CanvasRenderer's Camera is already imported for types, so use it.
    camera = new CameraCtor({
      pixelWidth: opts.pixelWidth,
      pixelHeight: opts.pixelHeight,
      frameHeight: opts.frameHeight,
      frameWidth: opts.frameWidth,
      frameCenter: opts.frameCenter,
    });
  }
  const renderer = new SVGRenderer(camera, {
    precision: opts.precision,
    background: opts.background,
  });
  return renderer.renderToString(mobjects);
}

// Value-level import of Camera for mobjectsToSVG. Kept as a separate binding so
// the type-only `import type { Camera }` above stays erasable.
import { Camera as CameraCtor } from "./CanvasRenderer.ts";
