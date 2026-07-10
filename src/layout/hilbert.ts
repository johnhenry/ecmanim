// Space-filling curves (3b1b campaign, Hilbert-curve visual). Pure math.

/**
 * Hilbert curve of the given order as 4^order points in the unit square
 * [0, 1]², visiting order = curve order (index-to-position via the
 * classic bit-twiddled d2xy walk — no recursion, no L-system expansion).
 */
export function hilbertCurve(order: number): Array<[number, number]> {
  const n = 1 << order; // grid side
  const total = n * n;
  const out: Array<[number, number]> = new Array(total);
  for (let d = 0; d < total; d++) {
    let rx = 0, ry = 0, t = d;
    let x = 0, y = 0;
    for (let s = 1; s < n; s *= 2) {
      rx = 1 & (t >> 1);
      ry = 1 & (t ^ rx);
      // Rotate quadrant.
      if (ry === 0) {
        if (rx === 1) { x = s - 1 - x; y = s - 1 - y; }
        [x, y] = [y, x];
      }
      x += s * rx;
      y += s * ry;
      t >>= 2;
    }
    // Center cells in their grid squares.
    out[d] = [(x + 0.5) / n, (y + 0.5) / n];
  }
  return out;
}

/**
 * Generic L-system expansion + turtle interpretation: `rules` rewrite the
 * axiom `iterations` times; `F` draws forward, `+`/`-` turn by `angle`
 * radians, other symbols only rewrite. Returns the polyline the turtle
 * walks (unit steps from the origin heading +x).
 */
export function lsystem(
  axiom: string,
  rules: Record<string, string>,
  iterations: number,
  angle: number,
  drawSymbols = "F",
): Array<[number, number]> {
  let s = axiom;
  for (let i = 0; i < iterations; i++) {
    let next = "";
    for (const ch of s) next += rules[ch] ?? ch;
    s = next;
  }
  const pts: Array<[number, number]> = [[0, 0]];
  let x = 0, y = 0, heading = 0;
  for (const ch of s) {
    if (drawSymbols.includes(ch)) {
      x += Math.cos(heading);
      y += Math.sin(heading);
      pts.push([x, y]);
    } else if (ch === "+") heading += angle;
    else if (ch === "-") heading -= angle;
  }
  return pts;
}
