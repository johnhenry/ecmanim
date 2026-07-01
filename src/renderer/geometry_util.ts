// Renderer-agnostic geometry extraction: turn the mobject tree into flat vertex
// buffers (triangles for fills, segments for strokes, a list for text). The
// CPU CanvasRenderer rasterizes these; the WebGL ThreeRenderer uploads them.
// Positions are world [x,y,z]; the camera projection happens downstream.

import { bezier } from "../core/math/bezier.ts";

// Flatten a VMobject's subpaths into world-space polygon loops.
export function flattenMobject(mob) {
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

const avg = (pts) => {
  let x = 0, y = 0, z = 0;
  for (const p of pts) { x += p[0]; y += p[1]; z += p[2]; }
  const n = pts.length || 1;
  return [x / n, y / n, z / n];
};

// Collect GPU-ready buffers from the mobject tree. Colors are 0..1 RGB.
//   { opaque:{positions,colors}, transparent:[{alpha,positions,colors}],
//     lines:{positions,colors}, texts:[mob,...] }
export function collectBuffers(mobjects) {
  const opaque = { positions: [], colors: [] };
  const tBuckets = new Map(); // alpha(rounded) -> {alpha, positions, colors}
  const lines = { positions: [], colors: [] };
  const texts = [];
  const images = [];

  const pushTri = (target, a, b, c, ca, cb, cc) => {
    target.positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    target.colors.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
  };

  const walk = (m) => {
    if (m.points && m.points.length) {
      if (m._isText) {
        texts.push(m);
      } else if (m._isImage) {
        images.push(m);
      } else {
        const opacity = m.opacity ?? 1;
        const loops = flattenMobject(m);

        const fillAlpha = (m.fillOpacity ?? 0) * opacity;
        if (fillAlpha > 0 && m.fillColor) {
          let target = opaque;
          if (fillAlpha < 0.99) {
            const key = Math.round(fillAlpha * 100) / 100;
            if (!tBuckets.has(key)) tBuckets.set(key, { alpha: key, positions: [], colors: [] });
            target = tBuckets.get(key);
          }
          const base = [m.fillColor.r, m.fillColor.g, m.fillColor.b];
          const vc = m._vertexColors; // 0..255 per loop vertex, or undefined
          for (const loop of loops) {
            const n = loop.length;
            if (n < 3) continue;
            const center = avg(loop);
            const colorAt = (i) => vc ? [vc[i][0] / 255, vc[i][1] / 255, vc[i][2] / 255] : base;
            let cc = base;
            if (vc) {
              cc = [0, 0, 0];
              for (let i = 0; i < n; i++) { cc[0] += vc[i][0] / 255 / n; cc[1] += vc[i][1] / 255 / n; cc[2] += vc[i][2] / 255 / n; }
            }
            for (let i = 0; i < n - 1; i++) {
              pushTri(target, center, loop[i], loop[i + 1], cc, colorAt(i), colorAt(i + 1));
            }
          }
        }

        const strokeAlpha = (m.strokeOpacity ?? 1) * opacity;
        if ((m.strokeWidth ?? 0) > 0 && strokeAlpha > 0 && m.strokeColor) {
          const col = [m.strokeColor.r, m.strokeColor.g, m.strokeColor.b];
          for (const loop of loops) {
            for (let i = 0; i < loop.length - 1; i++) {
              const a = loop[i], b = loop[i + 1];
              lines.positions.push(a[0], a[1], a[2], b[0], b[1], b[2]);
              lines.colors.push(col[0], col[1], col[2], col[0], col[1], col[2]);
            }
          }
        }
      }
    }
    for (const s of m.submobjects) walk(s);
  };

  for (const m of mobjects) walk(m);
  return { opaque, transparent: [...tBuckets.values()], lines, texts, images };
}
