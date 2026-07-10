// Chord diagram layout: a pure-math port of d3-chord.
//
// Isomorphic (no renderer, mobject, or node:* imports) and deterministic:
// no randomness, and every sort has a STABLE index tie-break, so the same
// matrix always produces the same groups/chords.
//
// ANGLE CONVENTION (identical to d3): angles are in radians, measured
// CLOCKWISE from 12 o'clock, starting at 0 and accumulating to 2*PI. To
// convert an angle to a point on a circle of radius r:
//   - y-down screen coords (SVG-like):  [r * sin(a), -r * cos(a)]
//   - y-up math/scene coords:           [r * sin(a),  r * cos(a)]
// `chordAngleToPoint` below implements the y-up variant used by ecmanim
// scenes.
//
// DOCUMENTED DIVERGENCE FROM d3: d3's chord(matrix) returns a chords ARRAY
// with a non-enumerable `.groups` property bolted on; we return a plain
// `{groups, chords}` object instead (cleaner in TypeScript). Subgroups also
// carry `subindex` (the opposite group's index, as in d3 v4) in addition to
// d3 v3's fields.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;

export interface ChordGroup {
  /** Row index in the input matrix. */
  index: number;
  startAngle: number;
  endAngle: number;
  /** Row sum: total outgoing value of this group. */
  value: number;
}

export interface ChordSubgroup {
  /** Group this subgroup belongs to (the arc it sits on). */
  index: number;
  /** The opposite group's index: this subgroup spans matrix[index][subindex]. */
  subindex: number;
  startAngle: number;
  endAngle: number;
  /** matrix[index][subindex]. */
  value: number;
}

export interface Chord {
  source: ChordSubgroup;
  target: ChordSubgroup;
}

export interface ChordLayoutResult {
  groups: ChordGroup[];
  chords: Chord[];
}

export interface ChordOptions {
  /** Pad angle (radians) between adjacent groups. Default 0. */
  padAngle?: number;
  /** Comparator of group values, e.g. (a, b) => b - a for descending. */
  sortGroups?: (a: number, b: number) => number;
  /** Comparator of subgroup values within a group. */
  sortSubgroups?: (a: number, b: number) => number;
  /**
   * Comparator of chord combined values (source.value + target.value),
   * controlling z-order of the returned chords array.
   */
  sortChords?: (a: number, b: number) => number;
}

// ---------------------------------------------------------------------------
// chord
// ---------------------------------------------------------------------------

/**
 * Create a chord layout (d3.chord equivalent, undirected). Call the returned
 * function with a square matrix; matrix[i][j] is the flow from group i to
 * group j. Group i's arc spans its row sum; within the arc, one subgroup per
 * column j (including j === i). Chord {i, j} pairs subgroup matrix[i][j]
 * with matrix[j][i]; like d3, `source` is whichever end has the LARGER
 * value (ties keep i < j as source). Chords where both directions are zero
 * are omitted.
 */
export function chord(options: ChordOptions = {}): (matrix: number[][]) => ChordLayoutResult {
  const { padAngle = 0, sortGroups, sortSubgroups, sortChords } = options;

  return function layout(matrix: number[][]): ChordLayoutResult {
    const n = matrix.length;
    const groupSums = new Array<number>(n);
    const groupIndex = Array.from({ length: n }, (_, i) => i);
    const chordByKey = new Array<{ source: ChordSubgroup | null; target: ChordSubgroup | null } | undefined>(n * n);
    const groups = new Array<ChordGroup>(n);

    // Compute the scaling factor from value to angle.
    let k = 0;
    for (let i = 0; i < n; ++i) {
      if (matrix[i].length !== n) throw new Error("chord: matrix must be square");
      let x = 0;
      for (let j = 0; j < n; ++j) x += matrix[i][j];
      k += groupSums[i] = x;
    }
    k = Math.max(0, TAU - padAngle * n) / k;
    const dx = k ? padAngle : TAU / n;

    // Compute the angles for each group and constituent subgroup.
    let x = 0;
    if (sortGroups) {
      // Stable index tie-break.
      groupIndex.sort((a, b) => sortGroups(groupSums[a], groupSums[b]) || a - b);
    }
    for (const i of groupIndex) {
      const x0 = x;
      const subgroupIndex = Array.from({ length: n }, (_, j) => j);
      if (sortSubgroups) {
        subgroupIndex.sort((a, b) => sortSubgroups(matrix[i][a], matrix[i][b]) || a - b);
      }
      for (const j of subgroupIndex) {
        const key = i < j ? i * n + j : j * n + i;
        const c = chordByKey[key] ?? (chordByKey[key] = { source: null, target: null });
        const subgroup: ChordSubgroup = {
          index: i,
          subindex: j,
          startAngle: x,
          endAngle: (x += matrix[i][j] * k),
          value: matrix[i][j],
        };
        if (i < j) {
          c.source = subgroup;
        } else {
          c.target = subgroup;
          if (i === j) c.source = subgroup;
        }
        // Like d3: the larger-valued end becomes the source.
        if (c.source && c.target && c.source.value < c.target.value) {
          const s = c.source;
          c.source = c.target;
          c.target = s;
        }
      }
      groups[i] = { index: i, startAngle: x0, endAngle: x, value: groupSums[i] };
      x += dx;
    }

    // Collect chords in deterministic (i, j) key order, dropping empty ones.
    const chords: Chord[] = [];
    for (let key = 0; key < n * n; ++key) {
      const c = chordByKey[key];
      if (c && c.source && c.target && (c.source.value || c.target.value)) {
        chords.push({ source: c.source, target: c.target });
      }
    }
    if (sortChords) {
      chords.sort(
        (a, b) =>
          sortChords(a.source.value + a.target.value, b.source.value + b.target.value) ||
          a.source.index - b.source.index ||
          a.source.subindex - b.source.subindex,
      );
    }
    return { groups, chords };
  };
}

// ---------------------------------------------------------------------------
// ribbonPoints
// ---------------------------------------------------------------------------

export type RibbonSegment =
  | {
      /** Arc along the circle at `radius` from startAngle to endAngle. */
      type: "arc";
      startAngle: number;
      endAngle: number;
      radius: number;
      /** Convenience: y-up points of the arc's start and end. */
      from: [number, number];
      to: [number, number];
    }
  | {
      /** Quadratic bezier from the previous segment's endpoint to `to`. */
      type: "quad";
      /** Control point: always the circle center [0, 0], like d3.ribbon. */
      control: [number, number];
      from: [number, number];
      to: [number, number];
    };

export interface RibbonOptions {
  source: { startAngle: number; endAngle: number };
  target: { startAngle: number; endAngle: number };
  radius: number;
}

/**
 * Convert a d3 chord angle (radians, clockwise from 12 o'clock) to a point
 * in y-UP scene coordinates: [radius * sin(a), radius * cos(a)].
 * (For y-down SVG coordinates, negate the y component.)
 */
export function chordAngleToPoint(angle: number, radius: number): [number, number] {
  return [radius * Math.sin(angle), radius * Math.cos(angle)];
}

/**
 * Path control data for a chord ribbon, matching d3.ribbon's outline:
 *
 *   1. arc  along the SOURCE span (source.startAngle -> source.endAngle)
 *      at `radius`;
 *   2. quad from the source arc's end to the TARGET span's start point,
 *      control point at the circle center [0, 0];
 *   3. arc  along the TARGET span (target.startAngle -> target.endAngle);
 *   4. quad from the target arc's end back to the source arc's START point
 *      (closing the outline), control again at [0, 0].
 *
 * CONVENTIONS: the path begins at chordAngleToPoint(source.startAngle,
 * radius); each segment starts where the previous one ended (`from` ==
 * previous `to`); all points are y-up scene coordinates (see
 * chordAngleToPoint); arcs are centered on [0, 0] and traced in the
 * direction of increasing chord angle (clockwise on screen). Render arcs
 * with the existing arc primitive and quads via a quadratic (or an
 * equivalent cubic with c1 = from + 2/3*(control-from), c2 = to +
 * 2/3*(control-to)) bezier.
 *
 * Self-chords (source span == target span) still yield all four segments;
 * the middle quad degenerates to a point and may be skipped by renderers.
 */
export function ribbonPoints({ source, target, radius }: RibbonOptions): RibbonSegment[] {
  const s0 = chordAngleToPoint(source.startAngle, radius);
  const s1 = chordAngleToPoint(source.endAngle, radius);
  const t0 = chordAngleToPoint(target.startAngle, radius);
  const t1 = chordAngleToPoint(target.endAngle, radius);
  const center: [number, number] = [0, 0];

  return [
    {
      type: "arc",
      startAngle: source.startAngle,
      endAngle: source.endAngle,
      radius,
      from: s0,
      to: s1,
    },
    { type: "quad", control: center, from: s1, to: t0 },
    {
      type: "arc",
      startAngle: target.startAngle,
      endAngle: target.endAngle,
      radius,
      from: t0,
      to: t1,
    },
    { type: "quad", control: center, from: t1, to: s0 },
  ];
}
