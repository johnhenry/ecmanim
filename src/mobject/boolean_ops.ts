// Boolean (constructive area geometry) operations on VMobjects, mirroring
// ManimCommunity's manim/mobject/geometry/boolean_ops.py. Each op flattens its
// input VMobjects' outlines to 2D polygon rings, runs a polygon-clipping
// operation (union / intersection / difference / xor), then rebuilds this
// VMobject's points/subpaths from the resulting MultiPolygon.

import { VMobject } from "./VMobject.ts";
import type { VMobjectConfig } from "./VMobject.ts";
import { flattenMobject } from "../renderer/geometry_util.ts";

// polygon-clipping is loaded via a caught top-level dynamic import so this module
// (and thus the whole library) still LOADS in an unbundled browser where the bare
// "polygon-clipping" specifier can't resolve without an import map. In Node it
// resolves before any op is constructed, keeping the sync constructor API. In the
// browser (no import map) it stays null and the boolean ops throw a clear error.
let polygonClipping: any = null;
try {
  const _pc: any = await import("polygon-clipping");
  polygonClipping = _pc.default ?? _pc;
} catch { /* browser without an import map for polygon-clipping */ }

function requirePC(): any {
  if (!polygonClipping) {
    throw new Error(
      "Boolean ops require the 'polygon-clipping' package. In Node it loads " +
      "automatically; in an unbundled browser add it to your import map (or use a bundler).",
    );
  }
  return polygonClipping;
}

// A 2D ring is a list of [x, y] pairs; a polygon is a ring list (outer + holes);
// a MultiPolygon is a list of polygons. These mirror polygon-clipping's shapes.
type Ring2D = number[][];
type Polygon2D = Ring2D[];
type MultiPolygon2D = Polygon2D[];

// Turn one VMobject into a polygon-clipping "polygon": a list of rings, where
// each ring is a closed list of [x, y] points. Subpaths become separate rings
// (outer boundary + holes). z is dropped. Requires >= 3 distinct points.
function vmobjectToRings(vmobject: VMobject): Ring2D[] {
  const rings: Ring2D[] = [];
  const loops = flattenMobject(vmobject); // world-space [x,y,z] loops
  for (const loop of loops) {
    if (loop.length < 3) continue;
    const ring: number[][] = loop.map((p) => [p[0], p[1]]);
    rings.push(ring);
  }
  return rings;
}

// Rebuild `target`'s points/subpaths from a polygon-clipping MultiPolygon.
// Every ring (outer boundary or hole) becomes one closed subpath. Empty input
// leaves the target with no points.
function outlineFromMultipolygon(target: VMobject, multipolygon: MultiPolygon2D): void {
  target.points = [];
  target.subpathStarts = [];
  target._straightPath = true;

  for (const polygon of multipolygon) {
    for (const ring of polygon) {
      if (!ring || ring.length < 3) continue;
      // polygon-clipping repeats the first vertex at the end to close the ring;
      // drop that duplicate so we don't emit a zero-length segment.
      let pts = ring;
      const first = pts[0];
      const last = pts[pts.length - 1];
      if (
        pts.length > 1 &&
        first[0] === last[0] &&
        first[1] === last[1]
      ) {
        pts = pts.slice(0, pts.length - 1);
      }
      if (pts.length < 3) continue;
      const corners: number[][] = pts.map((p) => [p[0], p[1], 0]);
      // Close the ring back to its start with a straight segment.
      corners.push([corners[0][0], corners[0][1], 0]);
      outlineAppendClosedSubpath(target, corners);
    }
  }
}

// Append `corners` (already closed) as one straight-segment subpath, matching
// setPointsAsCorners' bezier layout (anchor + straight control/control/anchor).
function outlineAppendClosedSubpath(target: VMobject, corners: number[][]): void {
  if (corners.length < 2) return;
  const tmp = new VMobject();
  tmp.setPointsAsCorners(corners);
  target.appendBezierPoints(
    tmp.points,
    target.points.length > 0, // new subpath unless this is the first
  );
}

// Copy fill/stroke style from a source VMobject to `target`.
function copyStyle(target: VMobject, source: VMobject): void {
  target.setStyle({
    fillColor: source.fillColor,
    fillOpacity: source.fillOpacity,
    strokeColor: source.strokeColor,
    strokeWidth: source.strokeWidth,
    strokeOpacity: source.strokeOpacity,
  });
  // Confirmed bug: this allowlist previously omitted gradientColors/
  // sheenDirection, so a gradient-filled shape silently lost its gradient
  // (falling back to fillColor's already-set first-stop color) whenever it
  // passed through ANY boolean op -- most visibly SVGMobject's clip-path
  // support, which wraps a gradient-filled shape in an Intersection to
  // apply the clip. Found by actually rendering an SVG with both a
  // <linearGradient> fill AND a <clipPath> on the same element (untested
  // combination: the existing gradient and clipPath tests each cover their
  // feature in isolation, never together).
  if (source.gradientColors) target.gradientColors = source.gradientColors;
  target.sheenDirection = source.sheenDirection;
}

// Shared base for the boolean operations. Holds the flattened input rings and
// applies a polygon-clipping operation, populating this VMobject's outline.
export class _BooleanOps extends VMobject {
  constructor(config: VMobjectConfig = {}) {
    super(config);
  }

  // Convert a VMobject to the polygon-clipping "polygon" (ring list) form.
  protected _convertVmobjectToPolygon(vmobject: VMobject): Polygon2D {
    return vmobjectToRings(vmobject);
  }

  // Rebuild this VMobject's outline from a MultiPolygon result.
  protected _applyResult(multipolygon: MultiPolygon2D): void {
    outlineFromMultipolygon(this, multipolygon ?? []);
  }
}

// Union of all input VMobjects (their combined filled area).
export class Union extends _BooleanOps {
  constructor(...vmobjects: VMobject[]) {
    super();
    if (vmobjects.length < 2) {
      throw new Error("At least 2 mobjects are needed for a Union.");
    }
    const polys = vmobjects.map((v) => this._convertVmobjectToPolygon(v));
    const [first, ...rest] = polys;
    const result = requirePC().union(first, ...rest) as MultiPolygon2D;
    this._applyResult(result);
    copyStyle(this, vmobjects[0]);
  }
}

// Intersection of all input VMobjects (area common to every input).
export class Intersection extends _BooleanOps {
  constructor(...vmobjects: VMobject[]) {
    super();
    if (vmobjects.length < 2) {
      throw new Error("At least 2 mobjects are needed for an Intersection.");
    }
    const polys = vmobjects.map((v) => this._convertVmobjectToPolygon(v));
    const [first, ...rest] = polys;
    const result = requirePC().intersection(first, ...rest) as MultiPolygon2D;
    this._applyResult(result);
    copyStyle(this, vmobjects[0]);
  }
}

// Difference: the subject minus each of the clip VMobjects.
export class Difference extends _BooleanOps {
  constructor(subject: VMobject, ...clips: VMobject[]) {
    super();
    if (clips.length < 1) {
      throw new Error("At least 2 mobjects are needed for a Difference.");
    }
    const subjectPoly = this._convertVmobjectToPolygon(subject);
    const clipPolys = clips.map((v) => this._convertVmobjectToPolygon(v));
    const result = requirePC().difference(subjectPoly, ...clipPolys) as MultiPolygon2D;
    this._applyResult(result);
    copyStyle(this, subject);
  }
}

// Exclusion (symmetric difference / XOR): area in an odd number of inputs.
export class Exclusion extends _BooleanOps {
  constructor(...vmobjects: VMobject[]) {
    super();
    if (vmobjects.length < 2) {
      throw new Error("At least 2 mobjects are needed for an Exclusion.");
    }
    const polys = vmobjects.map((v) => this._convertVmobjectToPolygon(v));
    const [first, ...rest] = polys;
    const result = requirePC().xor(first, ...rest) as MultiPolygon2D;
    this._applyResult(result);
    copyStyle(this, vmobjects[0]);
  }
}
