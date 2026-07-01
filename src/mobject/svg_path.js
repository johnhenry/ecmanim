// Parse an SVG path `d` string into VMobject cubic-Bezier subpaths. Every
// command is normalized to cubics so the output slots straight into a VMobject
// (flat point list per subpath, length 1 + 3k). Coordinates are returned in the
// path's own space (SVG y-down); callers apply any transform / y-flip.

// Tokenize a path data string into [command, ...numbers] runs.
function tokenize(d) {
  const tokens = [];
  const re = /([a-zA-Z])|(-?\d*\.?\d+(?:[eE][-+]?\d+)?)/g;
  let m;
  while ((m = re.exec(d)) !== null) {
    if (m[1]) tokens.push({ cmd: m[1] });
    else tokens.push({ num: parseFloat(m[2]) });
  }
  return tokens;
}

const P = (x, y) => [x, y, 0];
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, 0];

// Elevate a quadratic (p0, q, p2) to a cubic's two control points.
function quadToCubic(p0, q, p2) {
  return [
    [p0[0] + (2 / 3) * (q[0] - p0[0]), p0[1] + (2 / 3) * (q[1] - p0[1]), 0],
    [p2[0] + (2 / 3) * (q[0] - p2[0]), p2[1] + (2 / 3) * (q[1] - p2[1]), 0],
  ];
}

export function parsePathToSubpaths(d) {
  const tokens = tokenize(d);
  const subpaths = [];
  let current = null; // flat point list for the active subpath
  let start = null; // subpath start anchor (for Z)
  let cursor = [0, 0, 0];
  let lastCtrl = null; // for S / T reflection
  let lastCmd = "";

  let i = 0;
  const nextNum = () => tokens[i++].num;
  const hasNum = () => i < tokens.length && tokens[i].num !== undefined;

  const pushCubic = (c1, c2, end) => {
    current.push(c1, c2, end);
    cursor = end;
  };
  const lineTo = (end) => {
    const c1 = lerp2(cursor, end, 1 / 3);
    const c2 = lerp2(cursor, end, 2 / 3);
    pushCubic(c1, c2, end);
  };
  const finishSubpath = () => {
    if (current && current.length >= 1) subpaths.push(current);
    current = null;
  };

  while (i < tokens.length) {
    let cmd;
    if (tokens[i].cmd !== undefined) { cmd = tokens[i].cmd; i++; }
    else cmd = /[Mm]/.test(lastCmd) ? (lastCmd === "M" ? "L" : "l") : lastCmd; // implicit repeat
    const rel = cmd === cmd.toLowerCase();
    const abs = (x, y) => (rel ? [cursor[0] + x, cursor[1] + y, 0] : [x, y, 0]);

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
          const q = /[QT]/i.test(lastCmd) && lastCtrl
            ? [2 * cursor[0] - lastCtrl[0], 2 * cursor[1] - lastCtrl[1], 0] : cursor;
          const end = abs(nextNum(), nextNum());
          const [c1, c2] = quadToCubic(cursor, q, end);
          pushCubic(c1, c2, end);
          lastCtrl = q;
          lastCmd = cmd;
        }
        break;
      case "A":
        // Arc: approximate with a straight line (rare in glyph/MathJax output).
        while (hasNum()) {
          nextNum(); nextNum(); nextNum(); nextNum(); nextNum(); // rx ry rot laf sweep
          lineTo(abs(nextNum(), nextNum()));
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
export function subpathsToVMobject(vmobject, subpaths, { scale = 1, translate = [0, 0, 0], flipY = false } = {}) {
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
