// Renders a scene's mobjects onto a Canvas-2D context. This module is
// isomorphic: the same code drives a browser <canvas> and a Node
// @napi-rs/canvas surface. It knows nothing about video or the DOM.

import { partialBezier, bezier } from "../core/math/bezier.js";
import { ZBuffer } from "./zbuffer.js";
import { Color } from "../core/color.js";

const to255 = (c) => [
  Math.round(Math.max(0, Math.min(1, c.r)) * 255),
  Math.round(Math.max(0, Math.min(1, c.g)) * 255),
  Math.round(Math.max(0, Math.min(1, c.b)) * 255),
];

const parseHexColor = (str) => to255(Color.parse(str));

// Average of a point list — a cheap face/mobject center for depth sorting.
function centroid(points) {
  let x = 0, y = 0, z = 0;
  for (const p of points) { x += p[0]; y += p[1]; z += p[2]; }
  const n = points.length || 1;
  return [x / n, y / n, z / n];
}

export class Camera {
  constructor(config = {}) {
    this.pixelWidth = config.pixelWidth ?? 1920;
    this.pixelHeight = config.pixelHeight ?? 1080;
    this.frameHeight = config.frameHeight ?? 8;
    this.frameWidth = config.frameWidth ?? (this.frameHeight * this.pixelWidth) / this.pixelHeight;
    this.frameCenter = config.frameCenter ?? [0, 0, 0];
    this.background = config.background ?? "#000000";
  }

  // World coordinates -> pixel coordinates (y is flipped: world y-up).
  toPixel(p) {
    const cx = p[0] - this.frameCenter[0];
    const cy = p[1] - this.frameCenter[1];
    return [
      (cx / this.frameWidth + 0.5) * this.pixelWidth,
      (0.5 - cy / this.frameHeight) * this.pixelHeight,
    ];
  }

  // Convert a manim stroke width (roughly px at 1080p) to this resolution.
  strokeScale() {
    return this.pixelHeight / 1080;
  }
}

export class CanvasRenderer {
  constructor(ctx, camera) {
    this.ctx = ctx;
    this.camera = camera;
  }

  clear() {
    const { ctx, camera } = this;
    ctx.save();
    ctx.fillStyle = camera.background;
    ctx.fillRect(0, 0, camera.pixelWidth, camera.pixelHeight);
    ctx.restore();
  }

  renderScene(mobjects) {
    // With a 3D camera, use the depth-buffered rasterizer so interpenetrating
    // surfaces resolve per pixel (painter sorting can't). 2D uses vector fills.
    if (typeof this.camera.projectionDepth === "function" && !this.camera.disableZBuffer) {
      this.renderScene3D(mobjects);
      return;
    }
    this.clear();
    this.renderMobjects(mobjects);
  }

  // --- 3D depth-buffered path --------------------------------------------
  renderScene3D(mobjects) {
    const { ctx, camera } = this;
    if (!this._zb) this._zb = new ZBuffer(camera.pixelWidth, camera.pixelHeight);
    this._zb.resize(camera.pixelWidth, camera.pixelHeight);
    const bg = parseHexColor(camera.background);
    this._zb.clear(bg[0], bg[1], bg[2]);

    // Collect the drawable family; text is deferred to a vector overlay.
    const texts = [];
    const draw = (m) => {
      if (m.points && m.points.length) {
        if (m._isText) texts.push(m);
        else this._rasterMobject(m);
      }
      for (const s of m.submobjects) draw(s);
    };
    for (const m of mobjects) draw(m);

    this._zb.blitTo(ctx);
    for (const t of texts) this.drawText(t);
  }

  _projectVertex(p) {
    const [x, y] = this.camera.toPixel(p);
    return { x, y, z: this.camera.projectionDepth(p) };
  }

  // Flatten a VMobject's subpaths into world-space polygon loops.
  _flatten(mob) {
    const seg = mob._straightPath ? 1 : 6;
    const loops = [];
    for (const sp of mob.getSubpaths()) {
      const nc = Math.floor((sp.length - 1) / 3);
      if (nc < 1) continue;
      const loop = [sp[0]];
      for (let i = 0; i < nc; i++) {
        const a = sp[3 * i], c1 = sp[3 * i + 1], c2 = sp[3 * i + 2], b = sp[3 * i + 3];
        for (let k = 1; k <= seg; k++) loop.push(seg === 1 ? b : bezier(a, c1, c2, b, k / seg));
      }
      loops.push(loop);
    }
    return loops;
  }

  _rasterMobject(mob) {
    const zb = this._zb;
    const opacity = mob.opacity ?? 1;
    const loops = this._flatten(mob);

    const fillAlpha = (mob.fillOpacity ?? 0) * opacity;
    if (fillAlpha > 0 && mob.fillColor) {
      const rgb = to255(mob.fillColor);
      for (const loop of loops) {
        const n = loop.length;
        if (n < 3) continue;
        const c = this._projectVertex(centroid(loop));
        const proj = loop.map((p) => this._projectVertex(p));
        for (let i = 0; i < n; i++) {
          zb.triangle(c, proj[i], proj[(i + 1) % n], rgb, fillAlpha);
        }
      }
    }

    const strokeAlpha = (mob.strokeOpacity ?? 1) * opacity;
    const strokeWidth = mob.strokeWidth ?? 0;
    if (strokeWidth > 0 && strokeAlpha > 0 && mob.strokeColor) {
      const rgb = to255(mob.strokeColor);
      const halfWidth = (strokeWidth * this.camera.strokeScale()) / 2;
      // Bias edges toward the viewer so grid lines sit atop coplanar faces.
      const bias = 0.02 * (this.camera.focalDistance ?? 20) / 20 + 0.01;
      for (const loop of loops) {
        const proj = loop.map((p) => this._projectVertex(p));
        for (let i = 0; i < proj.length - 1; i++) {
          zb.line(proj[i], proj[i + 1], halfWidth, rgb, strokeAlpha, bias);
        }
      }
    }
  }

  renderMobjects(mobjects) {
    // Draw in z-index order, stable for equal z. With a 3D camera, break ties by
    // painter's depth (far faces first) so surfaces self-occlude correctly.
    const camera3d = typeof this.camera.projectionDepth === "function" ? this.camera : null;
    const flat = [];
    let seq = 0;
    const collect = (m, inheritedZ) => {
      const z = m.zIndex ?? inheritedZ;
      if (m.points && m.points.length) {
        const depth = camera3d ? camera3d.projectionDepth(centroid(m.points)) : 0;
        flat.push({ mob: m, z, depth, seq: seq++ });
      }
      for (const s of m.submobjects) collect(s, z);
    };
    for (const m of mobjects) collect(m, 0);
    // Ascending depth = far -> near (nearer draws last, on top).
    flat.sort((a, b) => (a.z - b.z) || (a.depth - b.depth) || (a.seq - b.seq));
    for (const { mob } of flat) {
      if (mob._isText) this.drawText(mob);
      else this.drawVMobject(mob);
    }
  }

  drawText(mob) {
    const { ctx, camera } = this;
    const alpha = (mob.fillOpacity ?? 1) * (mob.opacity ?? 1);
    if (alpha <= 0) return;
    const box = mob.getBoundingBox();
    const center = mob.getCenter();
    const fontHeightWorld = mob.currentFontHeight();
    const fontPx = fontHeightWorld / camera.frameHeight * camera.pixelHeight;
    const lines = mob.text.split("\n");
    const lineStepPx = fontPx * 1.2;

    ctx.save();
    ctx.font = `${mob.slant === "italic" ? "italic " : ""}${mob.weight} ${fontPx}px ${mob.font}`;
    ctx.fillStyle = mob.fillColor.toRGBAString(alpha);
    ctx.textAlign = mob.align === "left" ? "left" : mob.align === "right" ? "right" : "center";
    ctx.textBaseline = "middle";

    // Typewriter reveal: clip to a fraction of the box width.
    const reveal = mob.revealFraction ?? 1;
    const [px0] = camera.toPixel([box.min[0], 0, 0]);
    const [px1] = camera.toPixel([box.max[0], 0, 0]);
    const [, pyTop] = camera.toPixel([0, box.max[1], 0]);
    const [, pyBot] = camera.toPixel([0, box.min[1], 0]);
    if (reveal < 1) {
      ctx.beginPath();
      ctx.rect(px0, pyTop - 4, (px1 - px0) * reveal, (pyBot - pyTop) + 8);
      ctx.clip();
    }

    const anchorX = mob.align === "left" ? box.min[0] : mob.align === "right" ? box.max[0] : center[0];
    const [cx] = camera.toPixel([anchorX, 0, 0]);
    const [, cyTop] = camera.toPixel([0, box.max[1], 0]);
    lines.forEach((line, i) => {
      const y = cyTop + lineStepPx * (i + 0.5);
      ctx.fillText(line, cx, y);
    });
    ctx.restore();
  }

  // Trace a VMobject's subpaths into the current path, honoring strokeEnd for
  // progressive drawing (Create/Write).
  tracePath(mob, proportion = 1) {
    const { ctx, camera } = this;
    const subpaths = mob.getSubpaths();
    const totalCurves = subpaths.reduce((n, sp) => n + Math.max(0, Math.floor((sp.length - 1) / 3)), 0);
    const drawCurves = totalCurves * Math.max(0, Math.min(1, proportion));
    let drawn = 0;

    for (const sp of subpaths) {
      const nc = Math.floor((sp.length - 1) / 3);
      if (nc < 1) continue;
      if (drawn >= drawCurves) break;
      const [sx, sy] = camera.toPixel(sp[0]);
      ctx.moveTo(sx, sy);
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
        ctx.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
        drawn += 1;
      }
    }
  }

  drawVMobject(mob) {
    const { ctx, camera } = this;
    if (mob.points.length === 0) return;

    const proportion = mob.strokeEnd ?? 1;

    // Fill (only meaningful when the whole path is present).
    const fillOpacity = mob.fillOpacity ?? 0;
    if (fillOpacity > 0 && proportion >= 1) {
      ctx.beginPath();
      this.tracePath(mob, 1);
      ctx.closePath();
      ctx.fillStyle = mob.fillColor.toRGBAString(fillOpacity * (mob.opacity ?? 1));
      ctx.fill("evenodd");
    }

    // Stroke.
    const strokeOpacity = mob.strokeOpacity ?? 1;
    const strokeWidth = mob.strokeWidth ?? 0;
    if (strokeWidth > 0 && strokeOpacity > 0) {
      ctx.beginPath();
      this.tracePath(mob, proportion);
      ctx.strokeStyle = mob.strokeColor.toRGBAString(strokeOpacity * (mob.opacity ?? 1));
      ctx.lineWidth = strokeWidth * camera.strokeScale();
      ctx.lineJoin = mob.lineJoin ?? "round";
      ctx.lineCap = mob.lineCap ?? "round";
      ctx.stroke();
    }
  }
}
