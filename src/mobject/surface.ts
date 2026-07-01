// 3D surfaces for the projection-camera renderer. A Surface is a grid of quad
// faces (each a filled VMobject), Lambertian-shaded by face normal and painter-
// depth-sorted by the renderer when a 3D camera is active — the same CPU
// approach manim's Cairo renderer uses. No GPU/WebGL.

import { VMobject, VGroup } from "./VMobject.ts";
import { Color } from "../core/color.ts";
import * as V from "../core/math/vector.ts";

const DEFAULT_LIGHT = V.normalize([-1, -1, 1]); // upper-left, toward viewer
const AMBIENT = 0.35;
const DIFFUSE = 0.65;

// A single quad face carrying its unshaded base color.
class Face extends VMobject {
  constructor(corners, baseColor, config) {
    super(config);
    this.baseColor = Color.parse(baseColor);
    this.setPointsAsCorners([...corners, corners[0]]);
    this.fillColor = Color.parse(baseColor);
    this.fillOpacity = config.fillOpacity ?? 1;
    this.strokeColor = Color.parse(config.strokeColor ?? baseColor);
    this.strokeWidth = config.strokeWidth ?? 0.5;
    this.strokeOpacity = config.strokeOpacity ?? (this.strokeWidth > 0 ? 1 : 0);
  }
}

export class Surface extends VGroup {
  // func: (u, v) -> [x, y, z]
  constructor(func, config = {}) {
    super();
    this.func = func;
    this.uRange = config.uRange ?? [0, 1];
    this.vRange = config.vRange ?? [0, 1];
    const res = config.resolution ?? 24;
    this.resolution = Array.isArray(res) ? res : [res, res];
    this.fillOpacity = config.fillOpacity ?? 1;
    // manim's Surface is checkerboarded by default; keep solids solid when an
    // explicit fill/colorFunc is given.
    this.checkerboard = config.checkerboardColors ?? config.checkerboard ??
      ((config.fillColor == null && config.color == null && config.colorFunc == null)
        ? ["#29ABCA", "#1C758A"] : null);
    this.baseFill = config.fillColor ?? config.color ?? "#29ABCA";
    this.colorFunc = config.colorFunc ?? null; // (u,v,point) -> color
    this.lightDirection = config.lightDirection ? V.normalize(config.lightDirection) : DEFAULT_LIGHT;
    this.shade = config.shade ?? true;
    // Smooth (Gouraud) shading interpolates per-vertex lighting across each face,
    // removing the faceted look. On by default; set smooth:false for flat faces.
    this.smooth = config.smooth ?? true;
    this._faceConfig = {
      fillOpacity: this.fillOpacity,
      strokeColor: config.strokeColor ?? "#00000055",
      strokeWidth: config.strokeWidth ?? 0.5,
      strokeOpacity: config.strokeOpacity,
    };

    this._build();
    if (this.shade) {
      this.applyShading(this.lightDirection);
      if (this.smooth) this.applySmoothShading(this.lightDirection);
    }
    if (config.point) this.moveTo(config.point);
  }

  // Analytic-ish surface normal at (u, v) via numerical partial derivatives.
  _normalAt(u, v) {
    const e = 1e-4;
    const du = V.sub(this.func(u + e, v), this.func(u - e, v));
    const dv = V.sub(this.func(u, v + e), this.func(u, v - e));
    const n = V.cross(du, dv);
    const len = V.length(n);
    return len < 1e-9 ? [0, 0, 1] : V.scale(n, 1 / len);
  }

  _build() {
    const [nu, nv] = this.resolution;
    const [u0, u1] = this.uRange;
    const [v0, v1] = this.vRange;
    const uAt = (i) => u0 + (u1 - u0) * (i / nu);
    const vAt = (j) => v0 + (v1 - v0) * (j / nv);
    const defaultChecker = this.checkerboard ?? ["#29ABCA", "#1C758A"];

    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const ua = uAt(i), ub = uAt(i + 1);
        const va = vAt(j), vb = vAt(j + 1);
        const corners = [
          this.func(ua, va),
          this.func(ub, va),
          this.func(ub, vb),
          this.func(ua, vb),
        ];
        let color;
        if (this.colorFunc) color = this.colorFunc(ua, va, corners[0]);
        else if (this.checkerboard) color = defaultChecker[(i + j) % 2];
        else color = this.baseFill;
        const face = new Face(corners, color, this._faceConfig);
        face._uv = [[ua, va], [ub, va], [ub, vb], [ua, vb]]; // corner params
        this.add(face);
      }
    }
  }

  // Per-vertex (Gouraud) shading: light each corner by its smooth surface normal
  // and hand the renderer per-vertex colors so lighting interpolates across the
  // face. Shared grid vertices get the same normal -> seamless smooth surface.
  applySmoothShading(lightDir = this.lightDirection) {
    const light = V.normalize(lightDir);
    const center = this.getCenter();
    for (const face of this.submobjects) {
      if (!face._uv) continue;
      const base = face.baseColor;
      const colors = face._uv.map(([u, v], k) => {
        let n = this._normalAt(u, v);
        // Orient outward from the surface center for consistent lit/unlit sides.
        const corner = this.func(u, v);
        if (V.dot(n, V.sub(corner, center)) < 0) n = V.neg(n);
        const b = Math.min(1, AMBIENT + DIFFUSE * Math.max(0, V.dot(n, light)));
        return [base.r * b * 255, base.g * b * 255, base.b * b * 255];
      });
      // The flattened face loop is [P0,P1,P2,P3,P0]; match with a closing color.
      face._vertexColors = [colors[0], colors[1], colors[2], colors[3], colors[0]];
    }
    return this;
  }

  // Re-shade every face using its outward normal vs the light direction. Called
  // at build; call again after deforming the surface to keep lighting correct.
  applyShading(lightDir = this.lightDirection) {
    const light = V.normalize(lightDir);
    const center = this.getCenter();
    for (const face of this.submobjects) {
      const p = face.points;
      if (p.length < 7) continue;
      const a = p[0], b = p[3], c = p[6]; // three anchors of the quad
      let n = V.normalize(V.cross(V.sub(b, a), V.sub(c, a)));
      // Orient outward from the surface center so lit/unlit sides are consistent.
      const faceCenter = face.getCenter();
      if (V.dot(n, V.sub(faceCenter, center)) < 0) n = V.neg(n);
      const brightness = Math.min(1, AMBIENT + DIFFUSE * Math.max(0, V.dot(n, light)));
      const base = face.baseColor;
      face.fillColor = new Color(base.r * brightness, base.g * brightness, base.b * brightness, base.a);
    }
    return this;
  }

  setFillOpacity(o) {
    for (const f of this.submobjects) f.fillOpacity = o;
    this.fillOpacity = o;
    return this;
  }
}

export const ParametricSurface = Surface;

export class Sphere extends Surface {
  constructor(config = {}) {
    const r = config.radius ?? 1;
    const func = (u, v) => [
      r * Math.sin(u) * Math.cos(v),
      r * Math.sin(u) * Math.sin(v),
      r * Math.cos(u),
    ];
    super(func, {
      uRange: [0, Math.PI],
      vRange: [0, 2 * Math.PI],
      resolution: config.resolution ?? [18, 36],
      fillColor: config.fillColor ?? config.color ?? "#58C4DD",
      ...config,
    });
    this.radius = r;
  }
}

export class Torus extends Surface {
  constructor(config = {}) {
    const R = config.majorRadius ?? 3; // manim default major/minor = 3/1
    const r = config.minorRadius ?? 1;
    const func = (u, v) => [
      (R + r * Math.cos(v)) * Math.cos(u),
      (R + r * Math.cos(v)) * Math.sin(u),
      r * Math.sin(v),
    ];
    super(func, {
      uRange: [0, 2 * Math.PI],
      vRange: [0, 2 * Math.PI],
      resolution: config.resolution ?? [36, 18],
      fillColor: config.fillColor ?? config.color ?? "#9A72AC",
      ...config,
    });
  }
}

export class Cylinder extends Surface {
  constructor(config = {}) {
    const r = config.radius ?? 1;
    const h = config.height ?? 2;
    const func = (u, v) => [r * Math.cos(u), r * Math.sin(u), v];
    super(func, {
      uRange: [0, 2 * Math.PI],
      vRange: [-h / 2, h / 2],
      resolution: config.resolution ?? [36, 8],
      fillColor: config.fillColor ?? config.color ?? "#83C167",
      ...config,
    });
  }
}

export class Cone extends Surface {
  constructor(config = {}) {
    const r = config.baseRadius ?? 1;
    const h = config.height ?? 1; // manim Cone default height = 1
    // v in [0,1] from apex (z=h) to base (z=0).
    const func = (u, v) => [r * v * Math.cos(u), r * v * Math.sin(u), h * (1 - v)];
    super(func, {
      uRange: [0, 2 * Math.PI],
      vRange: [0, 1],
      resolution: config.resolution ?? [36, 8],
      fillColor: config.fillColor ?? config.color ?? "#FF862F",
      ...config,
    });
  }
}

// Axis-aligned box built from 6 flat quad faces (each shaded by its normal).
export class Box extends VGroup {
  constructor(config = {}) {
    super();
    const w = (config.width ?? 2) / 2;
    const h = (config.height ?? 2) / 2;
    const d = (config.depth ?? 2) / 2;
    const color = config.fillColor ?? config.color ?? "#58C4DD";
    const light = config.lightDirection ? V.normalize(config.lightDirection) : DEFAULT_LIGHT;
    const faceCfg = {
      // manim Cube/Prism defaults: fill_opacity 0.75, stroke_width 0.
      fillOpacity: config.fillOpacity ?? 0.75,
      strokeColor: config.strokeColor ?? "#00000066",
      strokeWidth: config.strokeWidth ?? 0,
    };
    // Corner helper.
    const c = (sx, sy, sz) => [sx * w, sy * h, sz * d];
    // Each face: 4 corners in CCW order (outward normal) + outward normal.
    const faces = [
      { pts: [c(1, -1, -1), c(1, 1, -1), c(1, 1, 1), c(1, -1, 1)], n: [1, 0, 0] },
      { pts: [c(-1, 1, -1), c(-1, -1, -1), c(-1, -1, 1), c(-1, 1, 1)], n: [-1, 0, 0] },
      { pts: [c(-1, 1, -1), c(-1, 1, 1), c(1, 1, 1), c(1, 1, -1)], n: [0, 1, 0] },
      { pts: [c(-1, -1, 1), c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1)], n: [0, -1, 0] },
      { pts: [c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1)], n: [0, 0, 1] },
      { pts: [c(-1, 1, -1), c(1, 1, -1), c(1, -1, -1), c(-1, -1, -1)], n: [0, 0, -1] },
    ];
    for (const f of faces) {
      const brightness = Math.min(1, AMBIENT + DIFFUSE * Math.max(0, V.dot(f.n, light)));
      const base = Color.parse(color);
      const shaded = new Color(base.r * brightness, base.g * brightness, base.b * brightness, base.a);
      const face = new Face(f.pts, shaded, faceCfg);
      face.fillColor = shaded;
      this.add(face);
    }
    if (config.point) this.moveTo(config.point);
  }
}

export class Cube extends Box {
  constructor(config = {}) {
    const s = config.sideLength ?? 2;
    super({ ...config, width: s, height: s, depth: s });
  }
}
