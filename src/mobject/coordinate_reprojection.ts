// Rebuild a curve, sampled in domain (coordinate) space, against a different
// coordinate system -- e.g. take a curve plotted on an `Axes` and reproject
// it onto a `PolarPlane`. `VMobject.points` only stores already-projected
// world points with no back-reference to the domain samples that produced
// them, so reprojection needs the original domain data, either passed
// explicitly or read from a curve's `_domainSamples` tag (stamped by
// `Axes.plot()`).
//
// `targetSystem` is typed structurally (it only needs `coordsToPoint`), so
// `Axes`, `PolarPlane`, and `ComplexPlane` all work as a reprojection target
// with no special-casing.

import { VMobject } from "./VMobject.ts";
import type { Vec3, ColorLike } from "../core/types.ts";

export interface CoordSystemLike {
  coordsToPoint(a: number, b: number): Vec3;
}

export interface ReprojectOptions {
  color?: ColorLike;
  strokeColor?: ColorLike;
}

/**
 * Reuses exactly the construction `Axes.plot()` uses (`setPointsAsCorners`
 * over samples mapped through `targetSystem.coordsToPoint`), so a reprojected
 * curve has the same fidelity as one originally plotted directly against the
 * target system -- not a parallel curve-fitting reimplementation.
 */
export function reprojectCurve(
  domainSamples: Array<[number, number]>,
  targetSystem: CoordSystemLike,
  options?: ReprojectOptions,
): VMobject;
/** Overload: read the domain samples from a curve built by a plotting method
 *  that stamps `_domainSamples` (currently only `Axes.plot()`). */
export function reprojectCurve(
  curve: VMobject,
  targetSystem: CoordSystemLike,
  options?: ReprojectOptions,
): VMobject;
export function reprojectCurve(
  domainSamplesOrCurve: Array<[number, number]> | VMobject,
  targetSystem: CoordSystemLike,
  options: ReprojectOptions = {},
): VMobject {
  let domainSamples: Array<[number, number]>;
  if (Array.isArray(domainSamplesOrCurve)) {
    domainSamples = domainSamplesOrCurve;
  } else {
    const tagged = (domainSamplesOrCurve as any)._domainSamples;
    if (!tagged) {
      throw new Error(
        "reprojectCurve(curve, targetSystem) requires a curve built by a plotting method that " +
        "stamps _domainSamples (currently only Axes.plot()); pass the domain samples array " +
        "directly instead: reprojectCurve(samples, targetSystem).",
      );
    }
    domainSamples = tagged;
  }

  const corners = domainSamples.map(([a, b]) => targetSystem.coordsToPoint(a, b));
  const curve = new VMobject({
    strokeColor: options.strokeColor ?? options.color,
    color: options.color,
  });
  curve.setPointsAsCorners(corners);
  curve.fillOpacity = 0;
  return curve;
}
