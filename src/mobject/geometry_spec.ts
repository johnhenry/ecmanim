// Pure (Mobject-free, DOM-free) model behind GeometryFigure: the declarative
// shape spec, its normalisation/validation, planar vertex layout, the textbook
// marks plan (congruent ticks, angle arcs, parallel chevrons, right angles) and
// the addressable part names. GeometryFigure (geometry_figure.ts) renders it.
//
// Conventions: planar vertices are named A, B, C, ... in COUNTER-CLOCKWISE
// order; side i joins vertex i and i+1. For triangles, side a is opposite A
// (BC), b opposite B (CA), c opposite C (AB). Coordinates are y-up and in the
// shape's own units (the figure rescales to its `size`).

export type Vec2 = [number, number];
export type ShapeCategory = "triangle" | "quadrilateral" | "polygon" | "solid";

export const TRIANGLE_TYPES = ["right-triangle", "isosceles-triangle", "equilateral-triangle", "scalene-triangle", "obtuse-triangle", "acute-triangle", "triangle"] as const;
export const QUAD_TYPES = ["square", "rectangle", "rhombus", "parallelogram", "kite", "trapezoid", "isosceles-trapezoid", "right-trapezoid", "quadrilateral"] as const;
export const POLYGON_TYPES = ["regular-polygon", "polygon"] as const;
export const SOLID_TYPES = ["tetrahedron", "cube", "octahedron", "dodecahedron", "icosahedron", "prism", "pyramid", "cuboid"] as const;
export const SHAPE_TYPES = [...TRIANGLE_TYPES, ...QUAD_TYPES, ...POLYGON_TYPES, ...SOLID_TYPES] as const;
export type ShapeType = (typeof SHAPE_TYPES)[number];

const REGULAR_NAMES: Record<string, number> = { pentagon: 5, hexagon: 6, heptagon: 7, septagon: 7, octagon: 8, nonagon: 9, enneagon: 9, decagon: 10, hendecagon: 11, undecagon: 11, dodecagon: 12 };

/** Synonyms models and people use -> canonical type (lower-case keys). */
export const SHAPE_ALIASES: Record<string, string> = {
  triangle: "triangle", "right triangle": "right-triangle", "right-angled-triangle": "right-triangle", "right-angle-triangle": "right-triangle", "right_triangle": "right-triangle", righttriangle: "right-triangle", "right-angled triangle": "right-triangle",
  isosceles: "isosceles-triangle", "isosceles triangle": "isosceles-triangle", isosceles_triangle: "isosceles-triangle",
  equilateral: "equilateral-triangle", "equilateral triangle": "equilateral-triangle", equilateral_triangle: "equilateral-triangle",
  scalene: "scalene-triangle", "scalene triangle": "scalene-triangle", scalene_triangle: "scalene-triangle",
  obtuse: "obtuse-triangle", "obtuse triangle": "obtuse-triangle", acute: "acute-triangle", "acute triangle": "acute-triangle",
  diamond: "rhombus", lozenge: "rhombus", rhomb: "rhombus",
  oblong: "rectangle", rect: "rectangle", box: "cuboid", "rectangular prism": "cuboid", "rectangular-prism": "cuboid",
  trapezium: "trapezoid", trapeze: "trapezoid", "isosceles trapezoid": "isosceles-trapezoid", "isosceles_trapezoid": "isosceles-trapezoid", "isosceles trapezium": "isosceles-trapezoid", "isosceles-trapezium": "isosceles-trapezoid",
  "right trapezoid": "right-trapezoid", "right trapezium": "right-trapezoid", "right-trapezium": "right-trapezoid", "right_trapezoid": "right-trapezoid",
  quad: "quadrilateral", quadrangle: "quadrilateral", tetragon: "quadrilateral", "general quadrilateral": "quadrilateral",
  "regular polygon": "regular-polygon", regular_polygon: "regular-polygon", "n-gon": "regular-polygon", ngon: "regular-polygon",
  "regular tetrahedron": "tetrahedron", "triangular pyramid": "tetrahedron", hexahedron: "cube", "regular hexahedron": "cube", "regular octahedron": "octahedron",
  "regular dodecahedron": "dodecahedron", "regular icosahedron": "icosahedron", "square pyramid": "pyramid", "triangular prism": "prism", "rect prism": "cuboid",
};

/** Resolve a free-form type name to a canonical type (and implied params), or undefined. */
export function canonicalShapeType(name: unknown): { type: ShapeType; n?: number } | undefined {
  if (typeof name !== "string") return undefined;
  const k = name.trim().toLowerCase().replace(/\s+/g, " ");
  if ((SHAPE_TYPES as readonly string[]).includes(k)) return { type: k as ShapeType };
  const dash = k.replace(/[ _]/g, "-");
  if ((SHAPE_TYPES as readonly string[]).includes(dash)) return { type: dash as ShapeType };
  if (REGULAR_NAMES[k]) return { type: "regular-polygon", n: REGULAR_NAMES[k] };
  if (SHAPE_ALIASES[k]) return { type: SHAPE_ALIASES[k] as ShapeType };
  return undefined;
}

export function shapeCategory(type: string): ShapeCategory {
  if ((TRIANGLE_TYPES as readonly string[]).includes(type)) return "triangle";
  if ((QUAD_TYPES as readonly string[]).includes(type)) return "quadrilateral";
  if ((SOLID_TYPES as readonly string[]).includes(type)) return "solid";
  return "polygon";
}
export const isSolid = (type: string): boolean => shapeCategory(type) === "solid";

export interface MarkOverrides { ticks?: boolean; arcs?: boolean; parallels?: boolean; rightAngles?: boolean }
export interface LabelSpec {
  /** true -> A, B, C...; or explicit strings. */
  vertices?: boolean | string[];
  /** true -> a,b,c (triangles) / none otherwise; array in side order; or {a,b,c} for triangles. LaTeX. */
  sides?: boolean | string[] | { a?: string; b?: string; c?: string };
  /** true -> degrees; or explicit LaTeX strings per vertex. */
  angles?: boolean | string[];
}

/** The declarative figure spec. Which params apply depends on `type`. */
export interface ShapeSpec {
  type: ShapeType;
  // triangles
  a?: number; b?: number; c?: number;
  base?: number; height?: number; side?: number;
  angles?: number[];
  // quadrilaterals
  w?: number; h?: number; angle?: number; width?: number; top?: number; bottom?: number; base1?: number; base2?: number; offset?: number;
  // polygons
  n?: number; vertices?: Vec2[];
  // solids
  d?: number;
  /** Textbook marks; `false` disables all, an object overrides individually (default per subtype). */
  marks?: boolean | MarkOverrides;
  labels?: LabelSpec;
  diagonals?: boolean;
  /** Dashed altitude (triangles, parallelograms, trapezoids). */
  altitude?: boolean;
  /** Squares on the sides of a triangle (Pythagoras). */
  squares?: boolean;
  /** Circle(s) for regular shapes. */
  circle?: "inscribed" | "circumscribed" | "both";
  /** Solids: spin in degrees per second (default 0) and view tilt in degrees. */
  spin?: number;
  tilt?: [number, number];
}

export interface NormalizedShape { spec: ShapeSpec; notes: string[] }

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};
const okDim = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= 1000;
const bool = (v: unknown): boolean | undefined => (typeof v === "boolean" ? v : undefined);

/** Default params per type (also the fallback when a param is missing/invalid). */
export const SHAPE_DEFAULTS: Record<string, Partial<ShapeSpec>> = {
  "right-triangle": { a: 3, b: 4 },
  "isosceles-triangle": { base: 4, height: 3 },
  "equilateral-triangle": { side: 4 },
  "scalene-triangle": { a: 4, b: 5, c: 6 },
  "obtuse-triangle": { angles: [35, 30, 115] },
  "acute-triangle": { angles: [60, 70, 50] },
  triangle: { a: 4, b: 5, c: 6 },
  square: { side: 3 },
  rectangle: { w: 5, h: 3 },
  rhombus: { side: 3, angle: 60 },
  parallelogram: { w: 4, h: 2.5, angle: 65 },
  kite: { width: 3, top: 1.8, bottom: 2.8 },
  trapezoid: { base1: 5, base2: 3, height: 2.5, offset: 0.7 },
  "isosceles-trapezoid": { base1: 5, base2: 3, height: 2.5 },
  "right-trapezoid": { base1: 5, base2: 3, height: 2.5 },
  quadrilateral: {},
  "regular-polygon": { n: 6 },
  polygon: {},
  prism: { n: 3 },
  pyramid: { n: 4 },
  cuboid: { w: 2, h: 1.4, d: 1.2 },
};

const DEFAULT_QUAD: Vec2[] = [[0, 0], [4, 0.4], [3.4, 2.8], [0.2, 2.2]];

/**
 * Normalise a raw spec (a string type name, or an object using common model
 * spellings) into a canonical ShapeSpec. Never throws; invalid params fall back
 * to the type's defaults with a note. `fallbackType` is used when `type` is absent.
 */
export function normalizeShapeSpec(raw: unknown, fallbackType: ShapeType = "right-triangle"): NormalizedShape {
  const notes: string[] = [];
  let o: Record<string, any> = {};
  if (typeof raw === "string") o = { type: raw };
  else if (raw && typeof raw === "object" && !Array.isArray(raw)) o = { ...(raw as Record<string, any>) };
  else if (raw !== undefined && raw !== null) notes.push("shape content is not an object; using defaults");

  // type
  const typeRaw = o.type ?? o.shape ?? o.kind ?? o.name;
  let type: ShapeType = fallbackType;
  let impliedN: number | undefined;
  if (typeRaw !== undefined) {
    const c = canonicalShapeType(typeRaw);
    if (c) { type = c.type; impliedN = c.n; if (String(typeRaw).trim().toLowerCase() !== c.type) notes.push(`shape type "${typeRaw}" normalized to ${c.type}`); }
    else notes.push(`unknown shape type "${typeRaw}"; using ${fallbackType}`);
  } else if (!(o.a !== undefined || o.legs !== undefined || o.sides !== undefined) || false) {
    if (Object.keys(o).length) notes.push(`shape type missing; using ${fallbackType}`);
  }
  // Legacy / model-friendly triangle content without a type: {a,b}, {legs}, {sides}.
  const spec: ShapeSpec = { type };
  const d = SHAPE_DEFAULTS[type] ?? {};
  const cat = shapeCategory(type);
  const dim = (key: keyof ShapeSpec, aliases: string[] = []): number | undefined => {
    for (const k of [key as string, ...aliases]) if (o[k] !== undefined) {
      const v = num(o[k]);
      if (okDim(v)) return v;
      notes.push(`${k} must be a positive number; using the default`);
      return undefined;
    }
    return undefined;
  };
  const setDims = (keys: Array<[keyof ShapeSpec, string[]?]>) => {
    for (const [k, al] of keys) (spec as any)[k] = dim(k, al ?? []) ?? (d as any)[k];
  };
  const ratioOk = (vals: number[], what: string): boolean => {
    const mx = Math.max(...vals), mn = Math.min(...vals);
    if (mx / mn > 20) { notes.push(`${what} proportions are absurd; using the defaults`); return false; }
    return true;
  };

  switch (type) {
    case "right-triangle": {
      let a: number | undefined, b: number | undefined, c: number | undefined;
      const legs = Array.isArray(o.legs) ? o.legs.map(num) : undefined;
      const sides = Array.isArray(o.sides) ? o.sides.map(num) : undefined;
      if (legs) [a, b] = legs; else if (sides) [a, b, c] = sides; else { a = num(o.a); b = num(o.b); c = num(o.c); }
      if (typeof raw === "string" || (!legs && !sides && o.a === undefined && o.b === undefined)) { a = undefined; b = undefined; }
      if (!okDim(a) || !okDim(b) || !ratioOk([a, b], "triangle")) {
        if (a !== undefined || b !== undefined) notes.push("triangle sides missing, non-positive or absurd; using 3 and 4");
        a = 3; b = 4; c = undefined;
      } else if (c !== undefined && Number.isFinite(c) && Math.abs(a * a + b * b - c * c) > 0.03 * c * c) {
        notes.push(`triangle sides ${a}, ${b}, ${c} do not satisfy a^2 + b^2 = c^2; using the legs ${a} and ${b}`);
      }
      spec.a = a; spec.b = b;
      break;
    }
    case "isosceles-triangle": setDims([["base"], ["height", ["h"]]]); break;
    case "equilateral-triangle": setDims([["side", ["a"]]]); break;
    case "scalene-triangle": case "triangle": {
      const s = Array.isArray(o.sides) ? o.sides.map(num) : [num(o.a), num(o.b), num(o.c)];
      const ang = Array.isArray(o.angles) ? o.angles.map(num) : undefined;
      if (type === "triangle" && ang && ang.length === 3 && ang.every((x) => x !== undefined && x > 0 && x < 180)) {
        const sum = (ang as number[]).reduce((p, q) => p + q, 0);
        if (Math.abs(sum - 180) > 1) { notes.push(`triangle angles sum to ${sum}, not 180; using the defaults`); spec.a = d.a; spec.b = d.b; spec.c = d.c; }
        else spec.angles = (ang as number[]).map((x) => (x * 180) / sum);
        break;
      }
      const [a, b, c] = s;
      if (okDim(a) && okDim(b) && okDim(c) && a + b > c && a + c > b && b + c > a && ratioOk([a, b, c], "triangle")) { spec.a = a; spec.b = b; spec.c = c; }
      else {
        if (s.some((x) => x !== undefined)) notes.push("triangle sides violate the triangle inequality or are invalid; using the defaults");
        spec.a = d.a; spec.b = d.b; spec.c = d.c;
      }
      break;
    }
    case "obtuse-triangle": case "acute-triangle": {
      const ang = Array.isArray(o.angles) ? o.angles.map(num) : undefined;
      const good = ang && ang.length === 3 && ang.every((x) => x !== undefined && x > 0 && x < 180) && Math.abs((ang as number[]).reduce((p, q) => p + q, 0) - 180) <= 1;
      const mx = good ? Math.max(...(ang as number[])) : 0;
      const kindOk = good && (type === "obtuse-triangle" ? mx > 90 : mx < 90);
      if (kindOk) spec.angles = ang as number[];
      else { if (ang) notes.push(`angles do not describe an ${type === "obtuse-triangle" ? "obtuse" : "acute"} triangle; using the defaults`); spec.angles = d.angles; }
      break;
    }
    case "square": setDims([["side", ["w", "a"]]]); break;
    case "rectangle": {
      setDims([["w", ["width", "a"]], ["h", ["height", "b"]]]);
      if (!ratioOk([spec.w!, spec.h!], "rectangle")) { spec.w = d.w; spec.h = d.h; }
      break;
    }
    case "rhombus": {
      setDims([["side", ["a"]]]);
      const ang = dim("angle");
      spec.angle = ang !== undefined && ang >= 20 && ang <= 160 ? ang : d.angle;
      if (ang !== undefined && spec.angle !== ang) notes.push("rhombus angle must be between 20 and 160 degrees; using 60");
      break;
    }
    case "parallelogram": {
      setDims([["w", ["width", "a", "base"]], ["h", ["side", "b"]]]);
      const ang = dim("angle");
      spec.angle = ang !== undefined && ang >= 20 && ang <= 160 ? ang : d.angle;
      if (ang !== undefined && spec.angle !== ang) notes.push("parallelogram angle must be between 20 and 160 degrees; using 65");
      break;
    }
    case "kite": setDims([["width", ["w"]], ["top"], ["bottom"]]); break;
    case "trapezoid": case "isosceles-trapezoid": case "right-trapezoid": {
      setDims([["base1", ["b1", "bottom"]], ["base2", ["b2", "top"]], ["height", ["h"]]]);
      if (type === "trapezoid") { const off = num(o.offset); spec.offset = off !== undefined && Math.abs(off) <= 100 ? off : d.offset; }
      if (spec.base1 === spec.base2) { notes.push("a trapezoid needs two different bases; using the defaults"); spec.base1 = d.base1; spec.base2 = d.base2; }
      break;
    }
    case "quadrilateral": case "polygon": {
      const v = parseVertices(o.vertices);
      const min = type === "quadrilateral" ? 4 : 3;
      const max = type === "quadrilateral" ? 4 : 16;
      if (v && v.length >= min && v.length <= max) spec.vertices = v;
      else {
        if (o.vertices !== undefined) notes.push(`vertices invalid (need ${min === max ? min : `${min} to ${max}`} finite [x, y] points); using a default`);
        spec.vertices = type === "quadrilateral" ? DEFAULT_QUAD : [[0, 0], [3, 0], [3.6, 2], [1.5, 3.2], [-0.4, 2]];
      }
      break;
    }
    case "regular-polygon": {
      const n = num(o.n ?? o.sides ?? o.numSides ?? o.sideCount) ?? impliedN;
      spec.n = n !== undefined && Number.isInteger(n) && n >= 3 && n <= 24 ? n : (impliedN ?? d.n);
      if (n !== undefined && spec.n !== n) notes.push(`n must be an integer from 3 to 24; using ${spec.n}`);
      break;
    }
    case "tetrahedron": case "cube": case "octahedron": case "dodecahedron": case "icosahedron": break;
    case "prism": case "pyramid": {
      const n = num(o.n ?? o.sides ?? o.base);
      spec.n = n !== undefined && Number.isInteger(n) && n >= 3 && n <= 12 ? n : d.n;
      if (n !== undefined && spec.n !== n) notes.push(`${type} n must be an integer from 3 to 12; using ${spec.n}`);
      break;
    }
    case "cuboid": {
      setDims([["w", ["width"]], ["h", ["height"]], ["d", ["depth"]]]);
      if (!ratioOk([spec.w!, spec.h!, spec.d!], "cuboid")) { spec.w = d.w; spec.h = d.h; spec.d = d.d; }
      break;
    }
  }
  void cat;

  // marks
  if (typeof o.marks === "boolean") spec.marks = o.marks;
  else if (o.marks && typeof o.marks === "object") {
    const m: MarkOverrides = {};
    const mm = o.marks as Record<string, unknown>;
    if (bool(mm.ticks) !== undefined) m.ticks = mm.ticks as boolean;
    const arcs = bool(mm.arcs) ?? bool(mm.angleArcs) ?? bool(mm.angles);
    if (arcs !== undefined) m.arcs = arcs;
    const par = bool(mm.parallels) ?? bool(mm.parallel) ?? bool(mm.arrows);
    if (par !== undefined) m.parallels = par;
    const ra = bool(mm.rightAngles) ?? bool(mm.rightAngle) ?? bool(mm.right);
    if (ra !== undefined) m.rightAngles = ra;
    if (Object.keys(m).length) spec.marks = m;
  }
  if (o.rightAngle === false) spec.marks = { ...(typeof spec.marks === "object" ? spec.marks : {}), rightAngles: false };

  // labels
  const L = o.labels;
  if (L && typeof L === "object" && !Array.isArray(L)) {
    const labels: LabelSpec = {};
    const strs = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x) => typeof x === "string").map((x: string) => x.trim().replace(/^\$+|\$+$/g, "").trim().slice(0, 16)) : undefined);
    if (L.vertices !== undefined) labels.vertices = bool(L.vertices) ?? strs(L.vertices);
    if (L.angles !== undefined) labels.angles = bool(L.angles) ?? strs(L.angles);
    if (L.sides !== undefined) {
      if (typeof L.sides === "boolean") labels.sides = L.sides;
      else if (Array.isArray(L.sides)) labels.sides = strs(L.sides);
      else if (typeof L.sides === "object") labels.sides = cleanABC(L.sides);
    } else if (typeof L.a === "string" || typeof L.b === "string" || typeof L.c === "string") labels.sides = cleanABC(L); // legacy {a,b,c}
    spec.labels = labels;
  } else if (typeof L === "boolean") spec.labels = { vertices: L, sides: L };

  if (bool(o.diagonals)) spec.diagonals = true;
  if (bool(o.altitude) ?? bool(o.height === true ? true : undefined)) spec.altitude = true;
  if (bool(o.squares)) spec.squares = true;
  if (o.circle !== undefined) {
    const c = o.circle === true ? "both" : String(o.circle).toLowerCase();
    if (c === "inscribed" || c === "circumscribed" || c === "both") spec.circle = c;
    else if (c !== "false") notes.push(`circle "${o.circle}" is not inscribed/circumscribed/both; ignored`);
  }
  const spin = num(o.spin);
  if (spin !== undefined && Math.abs(spin) <= 360) spec.spin = spin;
  if (Array.isArray(o.tilt) && o.tilt.length === 2 && o.tilt.every((x: unknown) => num(x) !== undefined)) spec.tilt = [num(o.tilt[0])!, num(o.tilt[1])!];

  // Features that do not apply to the category.
  if (spec.squares && cat !== "triangle") { delete spec.squares; notes.push("squares only apply to triangles; ignored"); }
  if (spec.circle && !hasCircles(spec.type)) { delete spec.circle; notes.push(`circle is not supported for ${spec.type}; ignored`); }
  if ((spec.diagonals) && (cat === "triangle" || cat === "solid")) { delete spec.diagonals; }
  if (spec.altitude && !(cat === "triangle" || ["parallelogram", "rhombus", "trapezoid", "isosceles-trapezoid", "right-trapezoid"].includes(spec.type))) { delete spec.altitude; notes.push(`altitude is not supported for ${spec.type}; ignored`); }
  return { spec, notes };
}

const cleanABC = (v: any): { a?: string; b?: string; c?: string } => {
  const out: Record<string, string> = {};
  for (const k of ["a", "b", "c"]) {
    const s = typeof v?.[k] === "string" ? v[k].trim().replace(/^\$+|\$+$/g, "").trim() : "";
    if (s && s.length <= 16) out[k] = s;
  }
  return out;
};

function parseVertices(v: unknown): Vec2[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Vec2[] = [];
  for (const p of v) {
    const x = Array.isArray(p) ? num(p[0]) : num((p as any)?.x);
    const y = Array.isArray(p) ? num(p[1]) : num((p as any)?.y);
    if (x === undefined || y === undefined || Math.abs(x) > 1e4 || Math.abs(y) > 1e4) return undefined;
    out.push([x, y]);
  }
  return out;
}

export const hasCircles = (type: string): boolean => ["regular-polygon", "square", "equilateral-triangle"].includes(type);

// --- planar layout ------------------------------------------------------------------

export interface PlanarLayout {
  /** Vertex coordinates in A, B, C... order, counter-clockwise. */
  vertices: Vec2[];
  /** Vertex letters. */
  names: string[];
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWX";
const D2R = Math.PI / 180;

function signedArea(v: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < v.length; i++) { const [x1, y1] = v[i], [x2, y2] = v[(i + 1) % v.length]; s += x1 * y2 - x2 * y1; }
  return s / 2;
}

/** Planar vertices for a (planar) spec; null for solids. */
export function planarLayout(spec: ShapeSpec): PlanarLayout | null {
  let v: Vec2[];
  const t = spec.type;
  const d = SHAPE_DEFAULTS[t] ?? {};
  switch (t) {
    case "right-triangle": { const a = spec.a ?? 3, b = spec.b ?? 4; v = [[b, 0], [0, a], [0, 0]]; break; }
    case "isosceles-triangle": { const bs = spec.base ?? 4, h = spec.height ?? 3; v = [[0, h], [-bs / 2, 0], [bs / 2, 0]]; break; }
    case "equilateral-triangle": { const s = spec.side ?? 4; v = [[0, (s * Math.sqrt(3)) / 2], [-s / 2, 0], [s / 2, 0]]; break; }
    case "scalene-triangle": case "triangle": case "obtuse-triangle": case "acute-triangle": {
      let a: number, b: number, c: number;
      if (spec.angles) { a = Math.sin(spec.angles[0] * D2R); b = Math.sin(spec.angles[1] * D2R); c = Math.sin(spec.angles[2] * D2R); }
      else { a = spec.a ?? d.a ?? 4; b = spec.b ?? d.b ?? 5; c = spec.c ?? d.c ?? 6; }
      const x = (c * c + a * a - b * b) / (2 * a);
      const y = Math.sqrt(Math.max(c * c - x * x, 0));
      v = [[x, y], [0, 0], [a, 0]];
      break;
    }
    case "square": { const s = spec.side ?? 3; v = [[0, 0], [s, 0], [s, s], [0, s]]; break; }
    case "rectangle": { const w = spec.w ?? 5, h = spec.h ?? 3; v = [[0, 0], [w, 0], [w, h], [0, h]]; break; }
    case "rhombus": {
      const s = spec.side ?? 3, th = (spec.angle ?? 60) * D2R;
      const dx = s * Math.cos(th), dy = s * Math.sin(th);
      v = [[0, 0], [s, 0], [s + dx, dy], [dx, dy]];
      break;
    }
    case "parallelogram": {
      const w = spec.w ?? 4, s = spec.h ?? 2.5, th = (spec.angle ?? 65) * D2R;
      const dx = s * Math.cos(th), dy = s * Math.sin(th);
      v = [[0, 0], [w, 0], [w + dx, dy], [dx, dy]];
      break;
    }
    case "kite": { const w = spec.width ?? 3, top = spec.top ?? 1.8, bot = spec.bottom ?? 2.8; v = [[0, top], [-w / 2, 0], [0, -bot], [w / 2, 0]]; break; }
    case "trapezoid": { const b1 = spec.base1 ?? 5, b2 = spec.base2 ?? 3, h = spec.height ?? 2.5, off = spec.offset ?? 0.7; v = [[0, 0], [b1, 0], [off + b2, h], [off, h]]; break; }
    case "isosceles-trapezoid": { const b1 = spec.base1 ?? 5, b2 = spec.base2 ?? 3, h = spec.height ?? 2.5, off = (b1 - b2) / 2; v = [[0, 0], [b1, 0], [off + b2, h], [off, h]]; break; }
    case "right-trapezoid": { const b1 = spec.base1 ?? 5, b2 = spec.base2 ?? 3, h = spec.height ?? 2.5; v = [[0, 0], [b1, 0], [b2, h], [0, h]]; break; }
    case "quadrilateral": case "polygon": v = (spec.vertices ?? DEFAULT_QUAD).map((p) => [p[0], p[1]] as Vec2); break;
    case "regular-polygon": {
      const n = spec.n ?? 6;
      v = [];
      for (let k = 0; k < n; k++) { const ang = (-90 - 180 / n + (360 * k) / n) * D2R; v.push([Math.cos(ang), Math.sin(ang)]); }
      break;
    }
    default: return null;
  }
  if (signedArea(v) < 0) v = v.slice().reverse();
  return { vertices: v, names: v.map((_, i) => LETTERS[i] ?? `V${i}`) };
}

// --- marks plan -----------------------------------------------------------------------

export interface MarksPlan {
  /** Congruent-side ticks: side i (vertex i -> i+1) gets `count` ticks. */
  ticks: Array<{ side: number; count: number }>;
  /** Congruent-angle arcs at vertex i. */
  arcs: Array<{ vertex: number; count: number }>;
  /** Parallel chevrons on side i; `ref` is the side whose direction all chevrons of the class point along. */
  parallels: Array<{ side: number; count: number; ref: number }>;
  rightAngles: number[];
}

/** The textbook marks of a subtype, after applying spec.marks overrides. */
export function marksPlan(spec: ShapeSpec): MarksPlan {
  const m: MarksPlan = { ticks: [], arcs: [], parallels: [], rightAngles: [] };
  const all = (n: number, count = 1) => Array.from({ length: n }, (_, i) => ({ side: i, count }));
  switch (spec.type) {
    case "right-triangle": m.rightAngles = [2]; break;
    case "isosceles-triangle": m.ticks = [{ side: 2, count: 1 }, { side: 0, count: 1 }]; m.arcs = [{ vertex: 1, count: 1 }, { vertex: 2, count: 1 }]; break;
    case "equilateral-triangle": m.ticks = all(3); m.arcs = [0, 1, 2].map((vertex) => ({ vertex, count: 1 })); break;
    case "square": m.ticks = all(4); m.rightAngles = [0, 1, 2, 3]; break;
    case "rectangle": m.ticks = [{ side: 0, count: 1 }, { side: 2, count: 1 }, { side: 1, count: 2 }, { side: 3, count: 2 }]; m.rightAngles = [0, 1, 2, 3]; break;
    case "rhombus":
      m.ticks = all(4);
      m.parallels = [{ side: 0, count: 1, ref: 0 }, { side: 2, count: 1, ref: 0 }, { side: 1, count: 2, ref: 1 }, { side: 3, count: 2, ref: 1 }];
      m.arcs = [{ vertex: 0, count: 1 }, { vertex: 2, count: 1 }, { vertex: 1, count: 2 }, { vertex: 3, count: 2 }];
      break;
    case "parallelogram":
      m.ticks = [{ side: 0, count: 1 }, { side: 2, count: 1 }, { side: 1, count: 2 }, { side: 3, count: 2 }];
      m.parallels = [{ side: 0, count: 1, ref: 0 }, { side: 2, count: 1, ref: 0 }, { side: 1, count: 2, ref: 1 }, { side: 3, count: 2, ref: 1 }];
      m.arcs = [{ vertex: 0, count: 1 }, { vertex: 2, count: 1 }, { vertex: 1, count: 2 }, { vertex: 3, count: 2 }];
      break;
    case "kite": m.ticks = [{ side: 0, count: 1 }, { side: 3, count: 1 }, { side: 1, count: 2 }, { side: 2, count: 2 }]; m.arcs = [{ vertex: 1, count: 1 }, { vertex: 3, count: 1 }]; break;
    case "trapezoid": m.parallels = [{ side: 0, count: 1, ref: 0 }, { side: 2, count: 1, ref: 0 }]; break;
    case "isosceles-trapezoid":
      m.parallels = [{ side: 0, count: 1, ref: 0 }, { side: 2, count: 1, ref: 0 }];
      m.ticks = [{ side: 1, count: 1 }, { side: 3, count: 1 }];
      m.arcs = [{ vertex: 0, count: 1 }, { vertex: 1, count: 1 }, { vertex: 2, count: 2 }, { vertex: 3, count: 2 }];
      break;
    case "right-trapezoid": m.parallels = [{ side: 0, count: 1, ref: 0 }, { side: 2, count: 1, ref: 0 }]; m.rightAngles = [0, 3]; break;
    case "regular-polygon": { const n = spec.n ?? 6; m.ticks = all(n); if (n <= 8) m.arcs = Array.from({ length: n }, (_, vertex) => ({ vertex, count: 1 })); break; }
  }
  const o = spec.marks;
  if (o === false) return { ticks: [], arcs: [], parallels: [], rightAngles: [] };
  if (o && typeof o === "object") {
    if (o.ticks === false) m.ticks = [];
    if (o.arcs === false) m.arcs = [];
    if (o.parallels === false) m.parallels = [];
    if (o.rightAngles === false) m.rightAngles = [];
  }
  return m;
}

// --- solids ---------------------------------------------------------------------------

/** Vertex / edge / face counts of a solid spec (null for planar shapes). */
export function solidCounts(spec: ShapeSpec): { v: number; e: number; f: number } | null {
  const n = spec.n ?? 3;
  switch (spec.type) {
    case "tetrahedron": return { v: 4, e: 6, f: 4 };
    case "cube": case "cuboid": return { v: 8, e: 12, f: 6 };
    case "octahedron": return { v: 6, e: 12, f: 8 };
    case "dodecahedron": return { v: 20, e: 30, f: 12 };
    case "icosahedron": return { v: 12, e: 30, f: 20 };
    case "prism": return { v: 2 * n, e: 3 * n, f: n + 2 };
    case "pyramid": return { v: n + 1, e: 2 * n, f: n + 1 };
    default: return null;
  }
}

// --- parts ----------------------------------------------------------------------------

const isTri = (t: string) => shapeCategory(t) === "triangle";
const TRI_SIDE = ["c", "a", "b"] as const; // side i (AB, BC, CA) -> alias

/** Canonical name of side i for this spec (triangles: a/b/c; others: the vertex pair). */
export function sideName(spec: ShapeSpec, i: number, n: number): string {
  if (isTri(spec.type)) return TRI_SIDE[i];
  return `${LETTERS[i]}${LETTERS[(i + 1) % n]}`;
}

/** Which vertex does the altitude start from (and which side does it hit)? */
export function altitudeSpec(spec: ShapeSpec): { from: number; side: number } | null {
  switch (spec.type) {
    case "right-triangle": return { from: 2, side: 0 }; // C onto AB
    case "isosceles-triangle": case "equilateral-triangle": case "scalene-triangle": case "triangle": case "obtuse-triangle": case "acute-triangle": return { from: 0, side: 1 }; // A onto BC
    case "parallelogram": case "rhombus": case "trapezoid": case "isosceles-trapezoid": case "right-trapezoid": return { from: 3, side: 0 }; // D onto AB
    default: return null;
  }
}

/** Every addressable part name of a spec, canonical form. */
export function shapePartNames(spec: ShapeSpec): string[] {
  const names: string[] = [];
  const solid = solidCounts(spec);
  if (solid) {
    for (let i = 0; i < solid.f; i++) names.push(`face${i}`);
    for (let i = 0; i < solid.e; i++) names.push(`edge${i}`);
    for (let i = 0; i < solid.v; i++) names.push(`vertex${i}`);
    return names;
  }
  const lay = planarLayout(spec);
  if (!lay) return names;
  const n = lay.vertices.length;
  for (let i = 0; i < n; i++) names.push(lay.names[i]);
  for (let i = 0; i < n; i++) names.push(sideName(spec, i, n));
  for (let i = 0; i < n; i++) names.push(`angle${lay.names[i]}`);
  const mp = marksPlan(spec);
  if (mp.ticks.length) names.push("ticks");
  if (mp.parallels.length) names.push("arrows");
  if (mp.arcs.length) names.push("arcs");
  if (mp.rightAngles.length) names.push("rightAngles", "right");
  if (spec.diagonals && n >= 4) for (let i = 0; i < n; i++) for (let j = i + 2; j < n; j++) if (!(i === 0 && j === n - 1)) names.push(`diagonal${lay.names[i]}${lay.names[j]}`);
  if (spec.altitude && altitudeSpec(spec)) names.push("height");
  if (spec.squares && isTri(spec.type)) names.push("squareA", "squareB", "squareC");
  if (spec.circle) names.push("circle");
  return names;
}

/**
 * Resolve a user/model part name (case-insensitive except single letters,
 * `ab` = `BA` for sides, `squarec`, `right`...) to its canonical name, or
 * undefined if the spec has no such part.
 */
export function resolvePartName(spec: ShapeSpec, name: string): string | undefined {
  const names = shapePartNames(spec);
  const t = name.trim();
  if (names.includes(t)) return t;
  const lower = t.toLowerCase();
  if (t.length > 1) {
    const hit = names.find((x) => x.toLowerCase() === lower);
    if (hit) return hit;
  }
  const lay = planarLayout(spec);
  if (lay) {
    const n = lay.vertices.length;
    // Side by vertex pair in either order (triangles map to a/b/c; "AC" == "CA").
    const m = /^([A-Za-z])([A-Za-z])$/.exec(t);
    if (m) {
      const p = m[1].toUpperCase(), q = m[2].toUpperCase();
      for (let i = 0; i < n; i++) {
        const u = lay.names[i], w = lay.names[(i + 1) % n];
        if ((p === u && q === w) || (p === w && q === u)) { const s = sideName(spec, i, n); if (names.includes(s)) return s; }
      }
    }
    const diag = /^diagonal([A-Za-z])([A-Za-z])$/i.exec(t);
    if (diag) {
      const p = diag[1].toUpperCase(), q = diag[2].toUpperCase();
      for (const nm of names) if (/^diagonal/.test(nm) && ((nm[8] === p && nm[9] === q) || (nm[8] === q && nm[9] === p))) return nm;
    }
    if (lower === "arrow" || lower === "parallels") return names.includes("arrows") ? "arrows" : undefined;
    if (lower === "tick") return names.includes("ticks") ? "ticks" : undefined;
    if (lower === "altitude") return names.includes("height") ? "height" : undefined;
    if (lower === "rightangle" || lower === "right-angle") return names.includes("right") ? "right" : undefined;
    // Uppercase single letter vertex but lowercase typed for non-triangles ("a" -> vertex A)
    if (t.length === 1 && !isTri(spec.type)) { const up = t.toUpperCase(); if (names.includes(up)) return up; }
  }
  return undefined;
}
