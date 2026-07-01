// 3D surfaces for the projection-camera renderer. A Surface is a grid of quad
// faces (each a filled VMobject), Lambertian-shaded by face normal and painter-
// depth-sorted by the renderer when a 3D camera is active — the same CPU
// approach manim's Cairo renderer uses. No GPU/WebGL.

import { VMobject, VGroup } from "./VMobject.js";
import { Color } from "../core/color.js";
import * as V from "../core/math/vector.js";

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
    this.checkerboard = config.checkerboardColors ?? config.checkerboard ?? null;
    this.baseFill = config.fillColor ?? config.color ?? "#29ABCA";
    this.colorFunc = config.colorFunc ?? null; // (u,v,point) -> color
    this.lightDirection = config.lightDirection ? V.normalize(config.lightDirection) : DEFAULT_LIGHT;
    this.shade = config.shade ?? true;
    this._faceConfig = {
      fillOpacity: this.fillOpacity,
      strokeColor: config.strokeColor ?? "#00000055",
      strokeWidth: config.strokeWidth ?? 0.5,
      strokeOpacity: config.strokeOpacity,
    };

    this._build();
    if (this.shade) this.applyShading(this.lightDirection);
    if (config.point) this.moveTo(config.point);
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
        this.add(face);
      }
    }
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
    const R = config.majorRadius ?? 2;
    const r = config.minorRadius ?? 0.6;
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
    const h = config.height ?? 2;
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
      fillOpacity: config.fillOpacity ?? 1,
      strokeColor: config.strokeColor ?? "#00000066",
      strokeWidth: config.strokeWidth ?? 1,
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
