// Parse an SVG path `d` string into VMobject cubic-Bezier subpaths. Every
// command is normalized to cubics so the output slots straight into a VMobject
// (flat point list per subpath, length 1 + 3k). Coordinates are returned in the
// path's own space (SVG y-down); callers apply any transform / y-flip.

// A single tokenized path element: either a command letter or a number.
interface PathToken {
  cmd?: string;
  num?: number;
}

// Tokenize a path data string into [command, ...numbers] runs.
function tokenize(d: string): PathToken[] {
  const tokens: PathToken[] = [];
  const re = /([a-zA-Z])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
  let m;
  while ((m = re.exec(d)) !== null) {
    if (m[1]) tokens.push({ cmd: m[1] });
    else tokens.push({ num: parseFloat(m[2]) });
  }
  return tokens;
}

const P = (x: number, y: number): number[] => [x, y, 0];
const lerp2 = (a: number[], b: number[], t: number): number[] =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0];

// Elevate a quadratic (p0, q, p2) to a cubic's two control points.
function quadToCubic(p0: number[], q: number[], p2: number[]): number[][] {
  return [
    [p0[0] + (2 / 3) * (q[0] - p0[0]), p0[1] + (2 / 3) * (q[1] - p0[1]), 0],
    [p2[0] + (2 / 3) * (q[0] - p2[0]), p2[1] + (2 / 3) * (q[1] - p2[1]), 0],
  ];
}

// SVG elliptical arc (endpoint parameterization, spec appendix F.6.5) to a
// list of cubic-Bezier segments [c1, c2, end], splitting sweeps > 90° so each
// cubic approximates at most a quarter turn. Works directly in the path's own
// (y-down) coordinate space; degenerate radii fall back to a straight chord
// per the spec (F.6.6: rx==0 or ry==0 means a line; too-small radii scale up).
export function arcToCubics(
  x1: number, y1: number,
  rx: number, ry: number,
  xAxisRotationDeg: number,
  largeArcFlag: number,
  sweepFlag: number,
  x2: number, y2: number,
): Array<[number[], number[], number[]]> {
  if (x1 === x2 && y1 === y2) return [];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const chord = (): Array<[number[], number[], number[]]> => [[
    lerp2([x1, y1, 0], [x2, y2, 0], 1 / 3),
    lerp2([x1, y1, 0], [x2, y2, 0], 2 / 3),
    [x2, y2, 0],
  ]];
  if (rx === 0 || ry === 0) return chord();

  const phi = (xAxisRotationDeg * Math.PI) / 180;
  const cosP = Math.cos(phi), sinP = Math.sin(phi);

  // (F.6.5.1) midpoint-relative start point in the ellipse's axis frame.
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;

  // (F.6.6.2) scale radii up if no ellipse of the given radii can reach.
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  // (F.6.5.2) center in the axis frame.
  const rx2 = rx * rx, ry2 = ry * ry;
  const num = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
  const den = rx2 * y1p * y1p + ry2 * x1p * x1p;
  if (den === 0) return chord();
  const coef = (largeArcFlag !== sweepFlag ? 1 : -1) * Math.sqrt(Math.max(0, num / den));
  const cxp = coef * ((rx * y1p) / ry);
  const cyp = coef * (-(ry * x1p) / rx);

  // (F.6.5.3) center in user space.
  const cx = cosP * cxp - sinP * cyp + (x1 + x2) / 2;
  const cy = sinP * cxp + cosP * cyp + (y1 + y2) / 2;

  // (F.6.5.4-6) start angle and sweep extent.
  const angleOf = (ux: number, uy: number, vx: number, vy: number): number => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx, vy = (-y1p - cyp) / ry;
  const theta1 = angleOf(1, 0, ux, uy);
  let dTheta = angleOf(ux, uy, vx, vy);
  if (!sweepFlag && dTheta > 0) dTheta -= 2 * Math.PI;
  else if (sweepFlag && dTheta < 0) dTheta += 2 * Math.PI;

  // Point on / derivative of the (rotated) ellipse at parameter t.
  const pointAt = (t: number): number[] => {
    const c = Math.cos(t), s = Math.sin(t);
    return [cx + rx * c * cosP - ry * s * sinP, cy + rx * c * sinP + ry * s * cosP, 0];
  };
  const derivAt = (t: number): number[] => {
    const c = Math.cos(t), s = Math.sin(t);
    return [-rx * s * cosP - ry * c * sinP, -rx * s * sinP + ry * c * cosP, 0];
  };

  // Split into <= 90° segments; each becomes one cubic with the standard
  // k = 4/3 * tan(delta/4) Hermite-style control-point construction.
  const segments = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)));
  const delta = dTheta / segments;
  const k = (4 / 3) * Math.tan(delta / 4);
  const out: Array<[number[], number[], number[]]> = [];
  for (let s = 0; s < segments; s++) {
    const t0 = theta1 + s * delta;
    const t1 = t0 + delta;
    const p0 = pointAt(t0), p1 = pointAt(t1);
    const d0 = derivAt(t0), d1 = derivAt(t1);
    const end: number[] = s === segments - 1 ? [x2, y2, 0] : p1; // land exactly on the endpoint
    out.push([
      [p0[0] + k * d0[0], p0[1] + k * d0[1], 0],
      [p1[0] - k * d1[0], p1[1] - k * d1[1], 0],
      end,
    ]);
  }
  return out;
}

export function parsePathToSubpaths(d: string): number[][][] {
  const tokens = tokenize(d);
  const subpaths: number[][][] = [];
  let current: number[][] | null = null; // flat point list for the active subpath
  let start: number[] | null = null; // subpath start anchor (for Z)
  let cursor: number[] = [0, 0, 0];
  let lastCtrl: number[] | null = null; // for S / T reflection
  let lastCmd = "";

  let i = 0;
  const nextNum = (): number => tokens[i++].num as number;
  const hasNum = () => i < tokens.length && tokens[i].num !== undefined;

  const pushCubic = (c1: number[], c2: number[], end: number[]) => {
    current!.push(c1, c2, end);
    cursor = end;
  };
  const lineTo = (end: number[]) => {
    const c1 = lerp2(cursor, end, 1 / 3);
    const c2 = lerp2(cursor, end, 2 / 3);
    pushCubic(c1, c2, end);
  };
  const finishSubpath = () => {
    if (current && current.length >= 1) subpaths.push(current);
    current = null;
  };

  while (i < tokens.length) {
    let cmd: string;
    const tok = tokens[i];
    if (tok.cmd !== undefined) { cmd = tok.cmd; i++; }
    else cmd = /[Mm]/.test(lastCmd) ? (lastCmd === "M" ? "L" : "l") : lastCmd; // implicit repeat
    const rel = cmd === cmd.toLowerCase();
    const abs = (x: number, y: number): number[] => (rel ? [cursor[0] + x, cursor[1] + y, 0] : [x, y, 0]);

    switch (cmd.toUpperCase()) {
      case "M": {
        finishSubpath();
        const p = abs(nextNum(), nextNum());
        current = [p];
        start = p;
        cursor = p;
        // Subsequent implicit pairs after M are treated as L.
        while (hasNum()) lineTo(abs(nextNum(), nextNum()));
        break;
      }
      case "L":
        while (hasNum()) lineTo(abs(nextNum(), nextNum()));
        break;
      case "H":
        while (hasNum()) { const x = rel ? cursor[0] + nextNum() : nextNum(); lineTo([x, cursor[1], 0]); }
        break;
      case "V":
        while (hasNum()) { const y = rel ? cursor[1] + nextNum() : nextNum(); lineTo([cursor[0], y, 0]); }
        break;
      case "C":
        while (hasNum()) {
          const c1 = abs(nextNum(), nextNum());
          const c2 = abs(nextNum(), nextNum());
          const end = abs(nextNum(), nextNum());
          pushCubic(c1, c2, end);
          lastCtrl = c2;
        }
        break;
      case "S":
        while (hasNum()) {
          const c1 = /[CS]/i.test(lastCmd) && lastCtrl
            ? [2 * cursor[0] - lastCtrl[0], 2 * cursor[1] - lastCtrl[1], 0] : cursor;
          const c2 = abs(nextNum(), nextNum());
          const end = abs(nextNum(), nextNum());
          pushCubic(c1, c2, end);
          lastCtrl = c2;
          lastCmd = cmd;
        }
        break;
      case "Q":
        while (hasNum()) {
          const q = abs(nextNum(), nextNum());
          const end = abs(nextNum(), nextNum());
          const [c1, c2] = quadToCubic(cursor, q, end);
          pushCubic(c1, c2, end);
          lastCtrl = q;
        }
        break;
      case "T":
        while (hasNum()) {
          const q: number[] = /[QT]/i.test(lastCmd) && lastCtrl
            ? [2 * cursor[0] - lastCtrl[0], 2 * cursor[1] - lastCtrl[1], 0] : cursor;
          const end = abs(nextNum(), nextNum());
          const [c1, c2] = quadToCubic(cursor, q, end);
          pushCubic(c1, c2, end);
          lastCtrl = q;
          lastCmd = cmd;
        }
        break;
      case "A":
        // Elliptical arc: endpoint-to-center parameterization, converted to
        // cubic segments (arcs > 90° are split). NOTE: the tokenizer assumes
        // whitespace/comma-separated numbers, so the compact no-separator
        // flag form ("a1 1 0 011 1") is not supported (mermaid/MathJax/
        // inkscape all emit separated numbers).
        while (hasNum()) {
          const rx = nextNum(), ry = nextNum(), rot = nextNum();
          const laf = nextNum(), sweep = nextNum();
          const end = abs(nextNum(), nextNum());
          const cubics = arcToCubics(cursor[0], cursor[1], rx, ry, rot, laf ? 1 : 0, sweep ? 1 : 0, end[0], end[1]);
          if (cubics.length === 0 && (cursor[0] !== end[0] || cursor[1] !== end[1])) lineTo(end);
          for (const [c1, c2, e] of cubics) pushCubic(c1, c2, e);
        }
        break;
      case "Z":
        if (current && start && (cursor[0] !== start[0] || cursor[1] !== start[1])) lineTo(start);
        finishSubpath();
        cursor = start ?? cursor;
        break;
      default:
        // Unknown command — skip its number to avoid an infinite loop.
        if (hasNum()) nextNum();
    }
    lastCmd = cmd;
  }
  finishSubpath();
  return subpaths;
}

// Build a VMobject (or fill an existing one) from parsed subpaths, applying a
// transform: scale, then translate, with optional y-flip (SVG is y-down).
export function subpathsToVMobject(
  vmobject: any,
  subpaths: number[][][],
  { scale = 1, translate = [0, 0, 0], flipY = false }: {
    scale?: number | number[];
    translate?: number[];
    flipY?: boolean;
  } = {},
): any {
  vmobject.points = [];
  vmobject.subpathStarts = [];
  const sx = typeof scale === "number" ? scale : scale[0];
  const sy = typeof scale === "number" ? (flipY ? -scale : scale) : (flipY ? -scale[1] : scale[1]);
  for (const sp of subpaths) {
    if (sp.length < 1) continue;
    vmobject.subpathStarts.push(vmobject.points.length);
    for (const p of sp) {
      vmobject.points.push([p[0] * sx + translate[0], p[1] * sy + translate[1], translate[2]]);
    }
  }
  return vmobject;
}
