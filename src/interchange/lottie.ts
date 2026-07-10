// Lottie import/export (geometry). Maps a VMobject's cubic-Bézier subpaths to
// Lottie's shape model — vertices `v` with relative in/out tangents `i`/`o` and a
// closed flag `c` — and back. Enables exporting manim shapes to a format every
// web/iOS/Android Lottie player understands, and importing simple Lottie shapes.
//
// Scope: static geometry (round-trippable). Full-fidelity Lottie (fills/strokes
// keyframes, trim paths, mattes, text) is out of scope — use ThorVG-WASM for that.
// Lottie is y-down, manim y-up, so y is negated on export/import.

import { VMobject, VGroup } from "../mobject/VMobject.ts";

export interface LottieShapeKS { v: number[][]; i: number[][]; o: number[][]; c: boolean; }
export interface LottieShape { ty: "sh"; ks: { a: 0; k: LottieShapeKS }; }

/** Convert a VMobject's subpaths to Lottie shape objects (one per subpath). */
export function vmobjectToLottieShapes(vmob: VMobject, scale = 1): LottieShape[] {
  const shapes: LottieShape[] = [];
  for (const sp of vmob.getSubpaths()) {
    const nc = Math.floor((sp.length - 1) / 3);
    if (nc < 1) continue;
    const anchors: number[][] = [sp[0]];
    for (let k = 0; k < nc; k++) anchors.push(sp[3 * k + 3]);

    // Detect a closed subpath: last anchor ≈ first anchor.
    const first = anchors[0], last = anchors[anchors.length - 1];
    const closed = Math.hypot(first[0] - last[0], first[1] - last[1]) < 1e-6;
    const nVerts = closed ? anchors.length - 1 : anchors.length;

    const v: number[][] = [], iT: number[][] = [], oT: number[][] = [];
    for (let k = 0; k < nVerts; k++) {
      const a = anchors[k];
      v.push([a[0] * scale, -a[1] * scale]);
      // out tangent = control after anchor k (relative)
      const outCtrl = k < nc ? sp[3 * k + 1] : a;
      oT.push([(outCtrl[0] - a[0]) * scale, -(outCtrl[1] - a[1]) * scale]);
      // in tangent = control before anchor k (relative)
      const inCtrl = k > 0 ? sp[3 * k - 1] : (closed ? sp[3 * (nc - 1) + 2] : a);
      iT.push([(inCtrl[0] - a[0]) * scale, -(inCtrl[1] - a[1]) * scale]);
    }
    shapes.push({ ty: "sh", ks: { a: 0, k: { v, i: iT, o: oT, c: closed } } });
  }
  return shapes;
}

/** Convert a Lottie shape to a flat cubic-Bézier point list (for appendBezierPoints). */
export function lottieShapeToPoints(shape: LottieShape, scale = 1): number[][] {
  const { v, i: iT, o: oT, c } = shape.ks.k;
  const n = v.length;
  if (n === 0) return [];
  const pt = (p: number[]): number[] => [p[0] / scale, -p[1] / scale, 0];
  const anchor = (k: number) => pt(v[k]);
  const outCtrl = (k: number) => [v[k][0] + oT[k][0], v[k][1] + oT[k][1]];
  const inCtrl = (k: number) => [v[k][0] + iT[k][0], v[k][1] + iT[k][1]];

  const points: number[][] = [anchor(0)];
  const segs = c ? n : n - 1;
  for (let k = 0; k < segs; k++) {
    const next = (k + 1) % n;
    points.push(pt(outCtrl(k)), pt(inCtrl(next)), anchor(next));
  }
  return points;
}

/** Build a VMobject from Lottie shapes (each shape → a subpath). */
export function lottieShapesToVMobject(shapes: LottieShape[], scale = 1): VMobject {
  const mob = new VMobject();
  let first = true;
  for (const shape of shapes) {
    const pts = lottieShapeToPoints(shape, scale);
    if (pts.length) { mob.appendBezierPoints(pts, !first); first = false; }
  }
  return mob;
}

export interface LottieExportOptions { width?: number; height?: number; fps?: number; durationFrames?: number; scale?: number; }

/** Export a VMobject (or VGroup) as a complete static Lottie animation document. */
export function vmobjectToLottieJSON(mob: VMobject | VGroup, opts: LottieExportOptions = {}): Record<string, any> {
  const w = opts.width ?? 512, h = opts.height ?? 512, fps = opts.fps ?? 30;
  const dur = opts.durationFrames ?? 1;
  const scale = opts.scale ?? 100; // world units → lottie px
  // Collect shapes from the mobject family.
  const fam: VMobject[] = (mob as any).getFamily ? (mob as any).getFamily() : [mob as VMobject];
  const shapeGroups: any[] = [];
  for (const m of fam) {
    if (!m.points || m.points.length === 0) continue;
    const shapes = vmobjectToLottieShapes(m, scale);
    if (shapes.length) shapeGroups.push(...shapes);
  }
  return {
    v: "5.7.0", fr: fps, ip: 0, op: dur, w, h, nm: "ecmanim", ddd: 0,
    assets: [],
    layers: [{
      ddd: 0, ind: 1, ty: 4, nm: "shape", sr: 1,
      ks: { o: { a: 0, k: 100 }, p: { a: 0, k: [w / 2, h / 2, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } },
      shapes: [
        ...shapeGroups,
        { ty: "st", c: { a: 0, k: [1, 1, 1, 1] }, o: { a: 0, k: 100 }, w: { a: 0, k: 4 }, nm: "stroke" },
        { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, o: { a: 0, k: 100 } },
      ],
      ip: 0, op: dur, st: 0,
    }],
  };
}

/** Import a Lottie animation's shape layers as STATIC VMobjects (no
 *  animation — first-frame geometry only). For the real player, use
 *  `loadLottie` from src/mobject/lottie_mobject.ts, which supersedes the
 *  old `loadLottie` name this function carried before v0.7.0. */
export function loadLottieShapes(json: any, scale = 100): VMobject {
  const layers = json?.layers ?? [];
  const group = new VGroup();
  for (const layer of layers) {
    if (layer.ty !== 4) continue; // shape layer
    const shapes: LottieShape[] = (layer.shapes ?? []).filter((s: any) => s.ty === "sh");
    if (shapes.length) group.add(lottieShapesToVMobject(shapes, scale));
  }
  // If a single shape, return it directly for convenience.
  return group.submobjects.length === 1 ? (group.submobjects[0] as VMobject) : group;
}
