// GeometryFigure: a textbook-style geometric figure built from a declarative
// spec (see geometry_spec.ts): triangles (right, isosceles, equilateral, ...),
// quadrilaterals (square ... kite, trapezoids), regular/general polygons and
// polyhedra, with the standard marks (congruent ticks, angle arcs, parallel
// chevrons, right-angle squares), optional labels, diagonals, altitude, squares
// on triangle sides and circles, and addressable parts.
//
//   const fig = new GeometryFigure({ type: "rhombus" });
//   await scene.play(fig.reveal());
//   await scene.play(fig.highlight("ticks"));
//   fig.part("AB")!.anchor;           // [x, y, 0]
//
// Planar figures are ordinary mobjects (move/scale them freely). Solids are
// drawn as a projected 3D view whose faces/edges are rebuilt by `setTime(t)`
// (a pure function of t: seek-safe); the figure tracks its own affine frame so
// moving/scaling it keeps spinning correctly.

import { VMobject, VGroup } from "./VMobject.ts";
import { Line, DashedLine, Dot, Polygon, Arc } from "./geometry.ts";
import { MathTex } from "./mathtex.ts";
import { Text } from "./text/Text.ts";
import { Tetrahedron, Octahedron, Icosahedron, Dodecahedron } from "./polyhedra.ts";
import { Animation, Create, Write, FadeIn } from "../animation/Animation.ts";
import { GrowFromCenter } from "../animation/extra.ts";
import { AnimationGroup, LaggedStart, Succession } from "../animation/composition.ts";
import { thereAndBack } from "../animation/rate_functions.ts";
import { Color } from "../core/color.ts";
import {
  normalizeShapeSpec, planarLayout, marksPlan, shapePartNames, resolvePartName, solidCounts, sideName, altitudeSpec, shapeCategory,
} from "./geometry_spec.ts";
import type { ShapeSpec, ShapeType, PlanarLayout } from "./geometry_spec.ts";

export interface GeometryFigureConfig {
  /** Largest extent of the figure (planar: bounding box; solid: diameter) in world units. Default 3. */
  size?: number;
  color?: string;
  strokeWidth?: number;
  fillOpacity?: number;
  markColor?: string;
  labelColor?: string;
  /** Default type when the spec has none (default "right-triangle"). */
  fallbackType?: ShapeType;
}

export interface FigurePart {
  name: string;
  kind: "vertex" | "side" | "angle" | "group" | "square" | "line" | "face" | "edge" | "circle";
  /** The mobjects that make up the part (some may be invisible placeholders). */
  mobs: VMobject[];
  /** A good point to aim at / attach to (current world position). */
  anchor: number[];
  center: number[];
  width: number;
  height: number;
  /** How a pointer should target it: at `anchor` ("point") or at the nearest point of the box ("box"). */
  aim: "point" | "box";
}

const HIGHLIGHT = "#FFFF00";
const SIDE_COLORS = { a: "#83C167", b: "#FF8A8A", c: "#FFD166" } as const;
const FACE_PALETTE = ["#58C4DD", "#83C167", "#FFD166", "#FF8A8A", "#C39BF0", "#7FD6C2"];
const D2R = Math.PI / 180;

type P2 = [number, number];
const sub = (p: P2, q: P2): P2 => [p[0] - q[0], p[1] - q[1]];
const add = (p: P2, q: P2): P2 => [p[0] + q[0], p[1] + q[1]];
const mul = (p: P2, k: number): P2 => [p[0] * k, p[1] * k];
const len = (p: P2) => Math.hypot(p[0], p[1]);
const unit = (p: P2): P2 => { const l = len(p) || 1; return [p[0] / l, p[1] / l]; };
const perp = (p: P2): P2 => [-p[1], p[0]];
const p3 = (p: P2): [number, number, number] => [p[0], p[1], 0];

interface SolidData { verts: number[][]; faces: number[][]; edges: Array<[number, number]> }

function solidData(spec: ShapeSpec, size: number): SolidData {
  let verts: number[][];
  let faces: number[][];
  const t = spec.type;
  if (t === "tetrahedron" || t === "octahedron" || t === "icosahedron" || t === "dodecahedron") {
    const P = t === "tetrahedron" ? new Tetrahedron() : t === "octahedron" ? new Octahedron() : t === "icosahedron" ? new Icosahedron() : new Dodecahedron();
    verts = P.vertexCoords.map((v) => [v[0], v[1], v[2]]);
    faces = P.facesList.map((f) => [...f]);
  } else if (t === "cube" || t === "cuboid") {
    const w = (t === "cuboid" ? spec.w ?? 2 : 2) / 2, h = (t === "cuboid" ? spec.h ?? 1.4 : 2) / 2, d = (t === "cuboid" ? spec.d ?? 1.2 : 2) / 2;
    verts = [[-w, -h, -d], [w, -h, -d], [w, h, -d], [-w, h, -d], [-w, -h, d], [w, -h, d], [w, h, d], [-w, h, d]];
    faces = [[4, 5, 6, 7], [1, 0, 3, 2], [5, 1, 2, 6], [0, 4, 7, 3], [7, 6, 2, 3], [0, 1, 5, 4]];
  } else {
    const n = spec.n ?? (t === "prism" ? 3 : 4);
    const ring = (y: number) => Array.from({ length: n }, (_, i) => [Math.cos((2 * Math.PI * i) / n), y, Math.sin((2 * Math.PI * i) / n)]);
    if (t === "prism") {
      verts = [...ring(-0.9), ...ring(0.9)];
      faces = [Array.from({ length: n }, (_, i) => i), Array.from({ length: n }, (_, i) => n + i)];
      for (let i = 0; i < n; i++) faces.push([i, (i + 1) % n, n + ((i + 1) % n), n + i]);
    } else {
      verts = [...ring(-0.7), [0, 1.1, 0]];
      faces = [Array.from({ length: n }, (_, i) => i)];
      for (let i = 0; i < n; i++) faces.push([i, (i + 1) % n, n]);
    }
  }
  // Centre and scale so the circumscribed radius is size / 2.
  const c = [0, 1, 2].map((k) => verts.reduce((s, v) => s + v[k], 0) / verts.length);
  verts = verts.map((v) => [v[0] - c[0], v[1] - c[1], v[2] - c[2]]);
  const R = Math.max(...verts.map((v) => Math.hypot(v[0], v[1], v[2]))) || 1;
  verts = verts.map((v) => v.map((x) => (x / R) * (size / 2)));
  // Orient every face outward (counter-clockwise seen from outside).
  faces = faces.map((f) => {
    const [a, b, cc] = [verts[f[0]], verts[f[1]], verts[f[2]]];
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [cc[0] - a[0], cc[1] - a[1], cc[2] - a[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const fc = [0, 1, 2].map((k) => f.reduce((s, i) => s + verts[i][k], 0) / f.length);
    return n[0] * fc[0] + n[1] * fc[1] + n[2] * fc[2] < 0 ? [...f].reverse() : f;
  });
  const seen = new Set<string>();
  const edges: Array<[number, number]> = [];
  for (const f of faces) for (let i = 0; i < f.length; i++) {
    const a = f[i], b = f[(i + 1) % f.length];
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (!seen.has(key)) { seen.add(key); edges.push([Math.min(a, b), Math.max(a, b)]); }
  }
  return { verts, faces, edges };
}

function setSegments(m: VMobject, p: number[], q: number[], dashed: boolean): void {
  m.points = [];
  m.subpathStarts = [];
  const mk = (a: number[], b: number[]) => {
    m.subpathStarts.push(m.points.length);
    m.points.push([...a], [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3, 0], [a[0] + (2 * (b[0] - a[0])) / 3, a[1] + (2 * (b[1] - a[1])) / 3, 0], [...b]);
  };
  if (!dashed) { mk(p, q); return; }
  const n = 7;
  for (let i = 0; i < n; i++) {
    const a0 = i / n, a1 = a0 + 0.55 / n;
    mk([p[0] + (q[0] - p[0]) * a0, p[1] + (q[1] - p[1]) * a0, 0], [p[0] + (q[0] - p[0]) * a1, p[1] + (q[1] - p[1]) * a1, 0]);
  }
}

export class GeometryFigure extends VGroup {
  spec: ShapeSpec;
  /** Messages from spec normalisation (invalid params replaced by defaults, ...). */
  notes: string[];
  size: number;
  layout: PlanarLayout | null = null;
  /** Local-to-world affine frame (origin, +x, +y) kept in sync with group transforms. */
  private _frame: number[][] = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  private _cfg: Required<Pick<GeometryFigureConfig, "size" | "color" | "strokeWidth" | "markColor" | "labelColor">> & GeometryFigureConfig;
  private _parts = new Map<string, FigurePart>();
  private _partMobs = new Map<string, { kind: FigurePart["kind"]; mobs: VMobject[]; aim: "point" | "box"; anchor?: () => number[] }>();
  // staged groups for reveal()
  private _stage = { fill: [] as VMobject[], sides: [] as VMobject[], dots: [] as VMobject[], marks: [] as VMobject[], labels: [] as VMobject[], squares: [] as Array<{ shape: VMobject; label?: VMobject }>, solid: [] as VMobject[] };
  // solid state
  private _solid: SolidData | null = null;
  private _faceMobs: VMobject[] = [];
  private _edgeMobs: VMobject[] = [];
  private _vertDots: VMobject[] = [];
  private _time = 0;
  /** Solids: reveal progress 0..1 (1 = fully shown); scales every element's opacity. */
  private _ra = 1;
  private _frameReady = false;

  constructor(rawSpec: unknown, config: GeometryFigureConfig = {}) {
    super();
    const norm = normalizeShapeSpec(rawSpec, config.fallbackType ?? "right-triangle");
    this.spec = norm.spec;
    this.notes = norm.notes;
    this.size = config.size ?? 3;
    this._cfg = { ...config, size: this.size, color: config.color ?? "#58C4DD", strokeWidth: config.strokeWidth ?? 5, markColor: config.markColor ?? "#E8EDF5", labelColor: config.labelColor ?? "#FFFFFF" };
    if (shapeCategory(this.spec.type) === "solid") this._buildSolid(); else this._buildPlanar();
    this._frameReady = true;
  }

  // --- transforms keep the affine frame in sync ----------------------------------
  applyToPoints(fn: (p: number[]) => number[]): this {
    super.applyToPoints(fn);
    if (this._frameReady) this._frame = this._frame.map((p) => fn(p));
    return this;
  }

  /** Names of every addressable part. */
  partNames(): string[] { return shapePartNames(this.spec); }

  /**
   * A part by name (see shapePartNames; aliases like "a" / "AC" / "squarec"
   * resolve). Returns undefined for an unknown part.
   */
  part(name: string): FigurePart | undefined {
    const canon = resolvePartName(this.spec, name);
    const def = canon ? this._partMobs.get(canon) : undefined;
    if (!canon || !def) return undefined;
    const g = new VGroup(...def.mobs);
    const c = g.getCenter();
    let anchor: number[] = c;
    if (def.anchor) anchor = def.anchor();
    else if (def.kind === "side" || def.kind === "line") {
      const m = def.mobs[0];
      const pts = m.points;
      anchor = [(pts[0][0] + pts[pts.length - 1][0]) / 2, (pts[0][1] + pts[pts.length - 1][1]) / 2, 0];
    }
    return { name: canon, kind: def.kind, mobs: def.mobs, anchor, center: c, width: g.getWidth(), height: g.getHeight(), aim: def.aim };
  }

  // --- build: planar --------------------------------------------------------------
  private _register(name: string, kind: FigurePart["kind"], mobs: VMobject[], aim: "point" | "box" = "box", anchor?: () => number[]) {
    this._partMobs.set(name, { kind, mobs, aim, anchor });
  }

  private _buildPlanar(): void {
    const spec = this.spec;
    const lay = planarLayout(spec)!;
    this.layout = lay;
    const raw = lay.vertices;
    const xs = raw.map((p) => p[0]), ys = raw.map((p) => p[1]);
    const ext = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) || 1;
    const k = this.size / ext;
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    const V: P2[] = raw.map((p) => [(p[0] - cx) * k, (p[1] - cy) * k]);
    const n = V.length;
    const u = this.size / 3; // mark scale unit
    const col = this._cfg.color, sw = this._cfg.strokeWidth;
    const centroid: P2 = [V.reduce((s, p) => s + p[0], 0) / n, V.reduce((s, p) => s + p[1], 0) / n];
    const tri = shapeCategory(spec.type) === "triangle";
    const st = this._stage;
    const mp = marksPlan(spec);
    const sideCol = (i: number) => (tri && spec.squares ? (SIDE_COLORS as any)[sideName(spec, i, n)] ?? col : col);

    // fill
    const fill = new Polygon(V.map(p3), { color: col, fillColor: col, fillOpacity: this._cfg.fillOpacity ?? 0.14, strokeWidth: 0 });
    this.add(fill); st.fill.push(fill);
    // sides
    const sideMobs: VMobject[] = [];
    for (let i = 0; i < n; i++) {
      const line = new Line(p3(V[i]), p3(V[(i + 1) % n]), { color: sideCol(i), strokeWidth: sw });
      sideMobs.push(line); this.add(line); st.sides.push(line);
      this._register(sideName(spec, i, n), "side", [line], "point");
    }
    // vertex dots (visible only when vertices are labelled)
    const vLabels = spec.labels?.vertices;
    const showDots = vLabels !== undefined && vLabels !== false;
    for (let i = 0; i < n; i++) {
      const dot = new Dot({ point: p3(V[i]), radius: 0.055 * u, color: col, ...(showDots ? {} : { fillOpacity: 0, strokeOpacity: 0 }) });
      if (!showDots) { dot.fillOpacity = 0; dot.strokeOpacity = 0; }
      this.add(dot);
      if (showDots) st.dots.push(dot);
      this._register(lay.names[i], "vertex", [dot], "point");
    }
    const dirTo = (i: number, j: number): P2 => unit(sub(V[(j + n) % n], V[i]));
    // interior angle at vertex i: from the edge to the next vertex CCW to the edge to the previous one
    const angleAt = (i: number) => {
      const dn = dirTo(i, i + 1), dp = dirTo(i, i - 1);
      const a0 = Math.atan2(dn[1], dn[0]);
      let sweep = Math.atan2(dp[1], dp[0]) - a0;
      while (sweep <= 0) sweep += 2 * Math.PI;
      while (sweep > 2 * Math.PI) sweep -= 2 * Math.PI;
      return { a0, sweep, dn, dp };
    };
    // angle arcs (placeholders for every vertex; visible only if in the marks plan)
    const arcCount = new Map(mp.arcs.map((a) => [a.vertex, a.count]));
    for (let i = 0; i < n; i++) {
      const { a0, sweep } = angleAt(i);
      const minSide = Math.min(len(sub(V[i], V[(i + 1) % n])), len(sub(V[i], V[(i - 1 + n) % n])));
      const r0 = Math.min(0.5 * u, 0.3 * minSide);
      const cnt = arcCount.get(i) ?? 1;
      const arcs: VMobject[] = [];
      for (let c = 0; c < cnt; c++) {
        const a = new Arc({ radius: r0 + c * 0.12 * u, startAngle: a0, angle: sweep, arcCenter: p3(V[i]), color: this._cfg.markColor, strokeWidth: 3.5 });
        if (!arcCount.has(i)) { a.strokeOpacity = 0; }
        arcs.push(a); this.add(a);
        if (arcCount.has(i)) st.marks.push(a);
      }
      this._register(`angle${lay.names[i]}`, "angle", arcs, "box", () => { const g = new VGroup(...arcs); return g.getCenter(); });
    }
    // right-angle marks
    const rightMobs: VMobject[] = [];
    for (const vi of mp.rightAngles) {
      const dn = dirTo(vi, vi + 1), dp = dirTo(vi, vi - 1);
      const r = 0.32 * u;
      const a = add(V[vi], mul(dn, r)), c = add(V[vi], mul(dp, r)), b = add(a, mul(dp, r));
      const m = new VMobject({ color: this._cfg.markColor, strokeWidth: 3 });
      m.setPointsAsCorners([p3(a), p3(b), p3(c)]);
      m.fillOpacity = 0;
      rightMobs.push(m); this.add(m); st.marks.push(m);
    }
    if (rightMobs.length) { this._register("rightAngles", "group", rightMobs); this._register("right", "group", [rightMobs[0]]); }
    // ticks
    const tickMobs: VMobject[] = [];
    for (const { side, count } of mp.ticks) {
      const a = V[side], b = V[(side + 1) % n];
      const mid = mul(add(a, b), 0.5);
      const d = unit(sub(b, a)), nrm = perp(d);
      const gap = 0.13 * u, half = 0.17 * u;
      for (let t = 0; t < count; t++) {
        const off = (t - (count - 1) / 2) * gap;
        const c = add(mid, mul(d, off));
        const m = new Line(p3(add(c, mul(nrm, half))), p3(sub(c, mul(nrm, half))), { color: this._cfg.markColor, strokeWidth: 4.5 });
        tickMobs.push(m); this.add(m); st.marks.push(m);
      }
    }
    if (tickMobs.length) this._register("ticks", "group", tickMobs);
    // parallel chevrons
    const arrowMobs: VMobject[] = [];
    for (const { side, count, ref } of mp.parallels) {
      const a = V[side], b = V[(side + 1) % n];
      const mid = mul(add(a, b), 0.5);
      const d = unit(sub(V[(ref + 1) % n], V[ref])), nrm = perp(d);
      const l = 0.17 * u, w = 0.13 * u, gap = 0.16 * u;
      for (let t = 0; t < count; t++) {
        const tip = add(mid, mul(d, (t - (count - 1) / 2) * gap + l / 2));
        const m = new VMobject({ color: this._cfg.markColor, strokeWidth: 4 });
        m.setPointsAsCorners([p3(add(sub(tip, mul(d, l)), mul(nrm, w))), p3(tip), p3(sub(sub(tip, mul(d, l)), mul(nrm, w)))]);
        m.fillOpacity = 0;
        arrowMobs.push(m); this.add(m); st.marks.push(m);
      }
    }
    if (arrowMobs.length) this._register("arrows", "group", arrowMobs);
    const arcVisible = mp.arcs.length ? [...this._partMobs.entries()].filter(([nm]) => nm.startsWith("angle") && arcCount.has(lay.names.indexOf(nm.slice(5)))).flatMap(([, v]) => v.mobs) : [];
    if (arcVisible.length) this._register("arcs", "group", arcVisible);
    // diagonals
    if (spec.diagonals && n >= 4) {
      for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) {
        if (i === 0 && j === n - 1) continue;
        const m = new DashedLine(p3(V[i]), p3(V[j]), { color: "#9AA5B1", strokeWidth: 3, numDashes: 14 });
        this.add(m); st.marks.push(m);
        this._register(`diagonal${lay.names[i]}${lay.names[j]}`, "line", [m], "point");
      }
    }
    // altitude
    const alt = altitudeSpec(spec);
    if (spec.altitude && alt) {
      const from = V[alt.from];
      const a = V[alt.side], b = V[(alt.side + 1) % n];
      const d = unit(sub(b, a));
      const foot = add(a, mul(d, (from[0] - a[0]) * d[0] + (from[1] - a[1]) * d[1]));
      const m = new DashedLine(p3(from), p3(foot), { color: "#C39BF0", strokeWidth: 3.5, numDashes: 10 });
      this.add(m); st.marks.push(m);
      const ra = new VMobject({ color: "#C39BF0", strokeWidth: 3 });
      const nu = unit(sub(from, foot)), r = 0.22 * u;
      const s1 = add(foot, mul(d, r)), s2 = add(s1, mul(nu, r)), s3 = add(foot, mul(nu, r));
      ra.setPointsAsCorners([p3(s1), p3(s2), p3(s3)]); ra.fillOpacity = 0;
      this.add(ra); st.marks.push(ra);
      this._register("height", "line", [m, ra], "point", () => p3(mul(add(from, foot), 0.5)));
    }
    // circles
    if (spec.circle) {
      const circles: VMobject[] = [];
      const R = Math.max(...V.map((p) => len(sub(p, centroid))));
      const r = Math.min(...V.map((p, i) => len(sub(mul(add(p, V[(i + 1) % n]), 0.5), centroid))));
      if (spec.circle === "circumscribed" || spec.circle === "both") circles.push(new Arc({ radius: R, angle: 2 * Math.PI, arcCenter: p3(centroid), color: "#C39BF0", strokeWidth: 3 }));
      if (spec.circle === "inscribed" || spec.circle === "both") circles.push(new Arc({ radius: r, angle: 2 * Math.PI, arcCenter: p3(centroid), color: "#7FD6C2", strokeWidth: 3 }));
      for (const c of circles) { this.add(c); st.marks.push(c); }
      this._register("circle", "circle", circles);
    }
    // squares on triangle sides
    const labelFont = 0.5 * u;
    // LaTeX labels; plain text if MathJax has not been initialised (initMathTex()).
    const tex = (s: string, color: string, size = labelFont): VMobject => {
      try { return new MathTex(s, { fontSize: size, color }); } catch { return new Text(s.replace(/[{}\\]/g, "").replace(/\^2/, "²").replace(/circ/, "°"), { fontSize: size * 0.9, color }); }
    };
    if (tri && spec.squares) {
      for (const letter of ["A", "B", "C"] as const) {
        const low = letter.toLowerCase() as "a" | "b" | "c";
        const i = [1, 2, 0][["A", "B", "C"].indexOf(letter)];
        const p = V[i], q = V[(i + 1) % n];
        const e = sub(q, p);
        let nrm = unit(perp(e));
        if ((centroid[0] - p[0]) * nrm[0] + (centroid[1] - p[1]) * nrm[1] > 0) nrm = mul(nrm, -1);
        const L = len(e);
        const corners = [p, q, add(q, mul(nrm, L)), add(p, mul(nrm, L))];
        const color = SIDE_COLORS[low];
        const sq = new Polygon(corners.map(p3), { color, fillColor: color, fillOpacity: 0.28, strokeWidth: 3.5 });
        this.add(sq);
        const center = mul(add(corners[0], corners[2]), 0.5);
        const sl = this._sideLabelText(i, n, true);
        const lab = tex(`${sl}^{2}`, color, labelFont * 0.95);
        lab.moveTo(p3(center));
        this.add(lab);
        st.squares.push({ shape: sq, label: lab });
        this._register(`square${letter}`, "square", [sq]);
      }
    }
    // labels
    const outDir = (p: P2): P2 => unit(sub(p, centroid));
    if (showDots) {
      const names = Array.isArray(vLabels) ? vLabels : lay.names;
      for (let i = 0; i < n; i++) {
        const t = tex(names[i] ?? lay.names[i], this._cfg.labelColor, labelFont * 0.85);
        t.moveTo(p3(add(V[i], mul(outDir(V[i]), 0.34 * u))));
        this.add(t); st.labels.push(t);
      }
    }
    const sl = spec.labels?.sides;
    if (sl !== undefined && sl !== false) {
      for (let i = 0; i < n; i++) {
        const text = this._sideLabelText(i, n, false);
        if (!text) continue;
        const a = V[i], b = V[(i + 1) % n];
        const mid = mul(add(a, b), 0.5);
        let nrm = unit(perp(sub(b, a)));
        const outward = (mid[0] - centroid[0]) * nrm[0] + (mid[1] - centroid[1]) * nrm[1] > 0;
        const inside = !!(tri && spec.squares);
        if (outward === inside) nrm = mul(nrm, -1); // want outward unless squares occupy the outside
        const color = tri ? (SIDE_COLORS as any)[sideName(spec, i, n)] ?? this._cfg.labelColor : this._cfg.labelColor;
        const t = tex(text, spec.squares ? color : this._cfg.labelColor, labelFont * 0.85);
        t.moveTo(p3(add(mid, mul(nrm, (inside ? 0.3 : 0.33) * u))));
        this.add(t); st.labels.push(t);
      }
    }
    const al = spec.labels?.angles;
    if (al !== undefined && al !== false) {
      for (let i = 0; i < n; i++) {
        const { a0, sweep } = angleAt(i);
        const text = Array.isArray(al) ? al[i] : `${Math.round(sweep / D2R)}^{\\circ}`;
        if (!text) continue;
        const mid = a0 + sweep / 2;
        const t = tex(text, this._cfg.labelColor, labelFont * 0.8);
        t.moveTo(p3(add(V[i], [Math.cos(mid) * 0.85 * u, Math.sin(mid) * 0.85 * u])));
        this.add(t); st.labels.push(t);
      }
    }
  }

  private _sideLabelText(i: number, n: number, forceDefault: boolean): string {
    const spec = this.spec;
    const sl = spec.labels?.sides;
    const nm = sideName(spec, i, n);
    if (shapeCategory(spec.type) === "triangle") {
      if (sl && typeof sl === "object" && !Array.isArray(sl)) return (sl as any)[nm] ?? nm;
      if (Array.isArray(sl)) return sl[i] ?? nm;
      return forceDefault || sl === true ? nm : nm;
    }
    if (Array.isArray(sl)) return sl[i] ?? "";
    return sl === true ? nm : "";
  }

  // --- build: solids ---------------------------------------------------------------
  private _buildSolid(): void {
    const spec = this.spec;
    const sd = solidData(spec, this.size);
    this._solid = sd;
    const counts = solidCounts(spec)!;
    void counts;
    const col = this._cfg.color;
    this._faceMobs = sd.faces.map((f, i) => {
      const m = new VMobject({ color: FACE_PALETTE[i % FACE_PALETTE.length], fillColor: FACE_PALETTE[i % FACE_PALETTE.length], fillOpacity: 0.3, strokeWidth: 0 });
      m.setPointsAsCorners([...f.map(() => [0, 0, 0]), [0, 0, 0]]);
      this.add(m);
      this._register(`face${i}`, "face", [m]);
      return m;
    });
    this._edgeMobs = sd.edges.map(([a, b], i) => {
      const m = new VMobject({ color: col, strokeWidth: 4 });
      m.fillOpacity = 0;
      setSegments(m, sd.verts[a], sd.verts[b], false);
      this.add(m);
      this._register(`edge${i}`, "edge", [m], "point");
      return m;
    });
    this._vertDots = sd.verts.map((v, i) => {
      const d = new Dot({ point: [v[0], v[1], 0], radius: 0.045 * (this.size / 3), color: "#E8EDF5" });
      this.add(d);
      this._register(`vertex${i}`, "vertex", [d], "point");
      return d;
    });
    this._stage.solid.push(...this._faceMobs, ...this._edgeMobs, ...this._vertDots);
    this._project();
  }

  /** Solids: set the reveal progress (0 hidden .. 1 shown). Used by reveal(); pure in `a`. */
  setRevealProgress(a: number): this {
    this._ra = Math.max(0, Math.min(1, a));
    if (this._solid) this._project();
    return this;
  }

  /** Solids: set the time (seconds) driving the spin. Pure: same t, same frame. Planar shapes ignore it. */
  setTime(t: number): this {
    this._time = t;
    if (this._solid) this._project();
    return this;
  }

  private _project(): void {
    const sd = this._solid!;
    const [pitch, yaw0] = this.spec.tilt ?? [20, 30];
    const yaw = (yaw0 + (this.spec.spin ?? 0) * this._time) * D2R, ph = pitch * D2R;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(ph), sp = Math.sin(ph);
    const rot = (v: number[]): number[] => {
      const x1 = v[0] * cy + v[2] * sy, z1 = -v[0] * sy + v[2] * cy;
      return [x1, v[1] * cp - z1 * sp, v[1] * sp + z1 * cp]; // screen x, y, depth (+ toward viewer)
    };
    const R = sd.verts.map(rot);
    const o = this._frame[0], ex = [this._frame[1][0] - o[0], this._frame[1][1] - o[1]], ey = [this._frame[2][0] - o[0], this._frame[2][1] - o[1]];
    const W = (p: number[]): number[] => [o[0] + p[0] * ex[0] + p[1] * ey[0], o[1] + p[0] * ex[1] + p[1] * ey[1], 0];
    // faces: depth order + front/back
    const info = sd.faces.map((f, i) => {
      const pts = f.map((vi) => R[vi]);
      const [a, b, c] = pts;
      const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const depth = pts.reduce((s, p) => s + p[2], 0) / pts.length;
      return { i, front: nz > 0, depth };
    });
    const al = (k: number, n: number) => Math.max(0, Math.min(1, this._ra * 1.5 - 0.5 * (k / Math.max(n, 1))));
    const order = [...info].sort((p, q) => p.depth - q.depth);
    order.forEach((it, rank) => {
      const f = sd.faces[it.i];
      const m = this._faceMobs[it.i];
      m.setPointsAsCorners([...f.map((vi) => W(R[vi])), W(R[f[0]])]);
      m.zIndex = rank;
      m.fillOpacity = 0.3 * al(it.i, sd.faces.length);
    });
    const F = sd.faces.length;
    const adj = new Map<string, boolean>();
    sd.faces.forEach((f, fi) => { for (let k = 0; k < f.length; k++) { const a = f[k], b = f[(k + 1) % f.length]; const key = a < b ? `${a},${b}` : `${b},${a}`; if (info[fi].front) adj.set(key, true); else if (!adj.has(key)) adj.set(key, false); } });
    sd.edges.forEach(([a, b], i) => {
      const front = adj.get(`${a},${b}`) === true;
      const m = this._edgeMobs[i];
      setSegments(m, W(R[a]), W(R[b]), !front);
      m.zIndex = F + (front ? 2 : 1);
      m.strokeOpacity = (front ? 1 : 0.55) * al(i, sd.edges.length);
      m.strokeWidth = front ? 4 : 2.5;
    });
    this._vertDots.forEach((d, i) => { const w = W(R[i]); d.shift([w[0] - d.getCenter()[0], w[1] - d.getCenter()[1], 0]); d.zIndex = F + 3; d.fillOpacity = al(i, sd.verts.length); });
  }

  // --- animations ---------------------------------------------------------------------
  /**
   * Staged reveal: outline (and fill) first, then the marks, then the labels,
   * then (triangles) the squares one at a time. Solids fade in. Play it with
   * `scene.play(fig.reveal())`; the figure is introduced to the scene by it.
   */
  reveal(config: { runTime?: number } = {}): GeometryReveal {
    const st = this._stage;
    const stages: Animation[] = [];
    if (this._solid) {
      stages.push(new SolidFade(this));
    } else {
      stages.push(new AnimationGroup([
        ...st.fill.map((m) => new FadeIn(m, { runTime: 0.6 })),
        new LaggedStart(st.sides.map((m) => new Create(m, { runTime: 0.55 })), { lagRatio: 0.5 }),
      ]));
      if (st.dots.length) stages.push(new AnimationGroup(st.dots.map((d) => new FadeIn(d, { runTime: 0.25 }))));
      if (st.marks.length) stages.push(new LaggedStart(st.marks.map((m) => new Create(m, { runTime: 0.35 })), { lagRatio: 0.3 }));
      if (st.labels.length) stages.push(new AnimationGroup(st.labels.map((m) => new Write(m, { runTime: 0.6 }))));
      for (const { shape, label } of st.squares) {
        stages.push(new GrowFromCenter(shape, { runTime: 0.45 }));
        if (label) stages.push(new Write(label, { runTime: 0.4 }));
      }
    }
    return new GeometryReveal(this, stages, config.runTime);
  }

  /** A there-and-back flash of a part (restyles it in place; works on invisible placeholders too). */
  highlight(name: string, config: { color?: string; runTime?: number } = {}): Animation {
    const p = this.part(name);
    if (!p) throw new Error(`GeometryFigure.highlight: unknown part "${name}" (have: ${this.partNames().join(", ")})`);
    return new HighlightPart(this, p.mobs, p.kind, config);
  }
}

/** Solids: staged fade-in driven by the figure's reveal progress (their points are rebuilt every frame, so point-based fades do not apply). */
class SolidFade extends Animation {
  constructor(fig: GeometryFigure) { super(fig as any, { runTime: 1.2, suspendMobjectUpdating: false }); }
  begin(): this { this.started = true; this.interpolate(0); return this; }
  interpolateMobject(a: number): void { (this.mobject as GeometryFigure).setRevealProgress(a); }
  finish(): this { (this.mobject as GeometryFigure).setRevealProgress(1); this.finished = true; return this; }
  _hashExtra(): string { return "solidfade"; }
}

/** Reveal animation of a GeometryFigure (a Succession that introduces the figure itself). */
export class GeometryReveal extends Succession {
  figure: GeometryFigure;
  constructor(figure: GeometryFigure, stages: Animation[], runTime?: number) {
    super(stages, runTime !== undefined ? { runTime } : {});
    this.figure = figure;
  }
  getMobjectsToIntroduce(): any[] { return [this.figure]; }
  getMobjectsToRemove(): any[] { return []; }
  _hashExtra(): string { return `geo:${this.figure.spec.type}:${JSON.stringify(this.figure.spec)}`; }
}

interface Style { stroke: Color; fill: Color; sw: number; so: number; fo: number; ctr: number[] }

/** Flash a figure part: restyle (yellow, thicker, opaque) and restore. Does not suspend the figure's updaters. */
export class HighlightPart extends Animation {
  private mobs: VMobject[];
  private color: Color;
  private saved: Style[] = [];
  private kind: string;
  private scaleNow = 1;
  constructor(figure: GeometryFigure, mobs: VMobject[], kind: string, config: { color?: string; runTime?: number } = {}) {
    super(figure as any, { runTime: config.runTime ?? 0.9, rateFunc: thereAndBack, suspendMobjectUpdating: false });
    this.mobs = mobs;
    this.kind = kind;
    this.color = Color.parse(config.color ?? HIGHLIGHT);
  }
  begin(): this {
    this.started = true;
    this.saved = this.mobs.map((m) => ({ stroke: m.strokeColor, fill: m.fillColor, sw: m.strokeWidth, so: m.strokeOpacity, fo: m.fillOpacity, ctr: m.getCenter() }));
    this.interpolate(0);
    return this;
  }
  interpolateMobject(a: number): void {
    const isPoint = this.kind === "vertex";
    this.mobs.forEach((m, i) => {
      const s = this.saved[i];
      m.strokeColor = a > 0 ? this.color : s.stroke;
      m.strokeOpacity = s.so + (1 - s.so) * a;
      m.strokeWidth = isPoint ? s.sw : s.sw + (Math.max(s.sw, 5) * 1.2 - s.sw) * a + 0 * a;
      if (this.kind === "face" || this.kind === "square" || isPoint) {
        m.fillColor = a > 0 ? this.color : s.fill;
        m.fillOpacity = s.fo + (Math.max(s.fo, 0.65) - s.fo) * a;
      }
      if (isPoint) {
        const f = 1 + 1.6 * a;
        const c = m.getCenter();
        m.scale(f / this.scaleNow, { aboutPoint: c });
        this.scaleNow = f;
      }
    });
  }
  finish(): this {
    this.mobs.forEach((m, i) => {
      const s = this.saved[i];
      m.strokeColor = s.stroke; m.fillColor = s.fill; m.strokeWidth = s.sw; m.strokeOpacity = s.so; m.fillOpacity = s.fo;
      if (this.kind === "vertex" && this.scaleNow !== 1) { m.scale(1 / this.scaleNow, { aboutPoint: m.getCenter() }); this.scaleNow = 1; }
    });
    this.finished = true;
    return this;
  }
  _hashExtra(): string { return `hl:${this.kind}:${this.mobs.length}`; }
}
