// Path functions (ManimCommunity manim/utils/paths.py). A path function takes
// two arrays of points (start and end) plus alpha in [0,1] and returns the
// interpolated array of points. Used by Transform-style animations to move
// points along non-linear trajectories.

import type { Vec3 } from "../types.ts";
import {
  add,
  sub,
  scale,
  cross,
  normalize,
  rotationMatrix,
  matrixVectorProduct,
  PI,
} from "./vector.ts";

/** A path function: (startPoints, endPoints, alpha) -> interpolatedPoints. */
export type PathFunc = (start: number[][], end: number[][], alpha: number) => Vec3[];

const STRAIGHT_PATH_THRESHOLD = 0.01;

/** Linear interpolation of each corresponding start/end point. */
export function straightPath(): PathFunc {
  return (start, end, alpha) =>
    start.map((s, i) => {
      const e = end[i];
      return [
        s[0] + (e[0] - s[0]) * alpha,
        s[1] + (e[1] - s[1]) * alpha,
        s[2] + (e[2] - s[2]) * alpha,
      ] as Vec3;
    });
}

/** Move each point along a circular arc of `arcAngle` radians about `axis`. */
export function pathAlongArc(arcAngle: number, axis: number[] = [0, 0, 1]): PathFunc {
  if (Math.abs(arcAngle) < STRAIGHT_PATH_THRESHOLD) return straightPath();
  const unitAxis = normalize(axis);
  if (unitAxis[0] === 0 && unitAxis[1] === 0 && unitAxis[2] === 0) {
    unitAxis[2] = 1;
  }

  return (start, end, alpha) => {
    const rot = rotationMatrix(alpha * arcAngle, unitAxis);
    return start.map((s, i) => {
      const e = end[i];
      const vect = sub(e, s);
      let center = add(s, scale(vect, 0.5));
      if (arcAngle !== PI) {
        const c = cross(unitAxis, scale(vect, 0.5));
        center = add(center, scale(c, 1 / Math.tan(arcAngle / 2)));
      }
      // np.dot(start - center, rot.T)  ==  rot @ (start - center)
      const rotated = matrixVectorProduct(rot, sub(s, center));
      return add(center, rotated) as Vec3;
    });
  };
}

/** Half-circle clockwise path. */
export function clockwisePath(): PathFunc {
  return pathAlongArc(-PI);
}

/** Half-circle counterclockwise path. */
export function counterclockwisePath(): PathFunc {
  return pathAlongArc(PI);
}

/** Each point orbits its given circle center while moving to its destination. */
export function pathAlongCircles(
  arcAngle: number,
  circlesCenters: number[][],
  axis: number[] = [0, 0, 1],
): PathFunc {
  const unitAxis = normalize(axis);
  if (unitAxis[0] === 0 && unitAxis[1] === 0 && unitAxis[2] === 0) unitAxis[2] = 1;

  return (start, end, alpha) => {
    const rotBack = rotationMatrix(-arcAngle, unitAxis);
    const rot = rotationMatrix(alpha * arcAngle, unitAxis);
    return start.map((s, i) => {
      const e = end[i];
      const center = circlesCenters[i] ?? circlesCenters[0];
      // detransformed_end = center + (end - center) @ rot(-arcAngle).T
      const detEnd = add(center, matrixVectorProduct(rotBack, sub(e, center)));
      // interp between start and detEnd, then rotate about center by alpha*arcAngle
      const interp: Vec3 = [
        s[0] + (detEnd[0] - s[0]) * alpha,
        s[1] + (detEnd[1] - s[1]) * alpha,
        s[2] + (detEnd[2] - s[2]) * alpha,
      ];
      return add(center, matrixVectorProduct(rot, sub(interp, center))) as Vec3;
    });
  };
}

/** Spiral path combining linear interpolation with rotation. */
export function spiralPath(angle: number, axis: number[] = [0, 0, 1]): PathFunc {
  if (Math.abs(angle) < STRAIGHT_PATH_THRESHOLD) return straightPath();
  const unitAxis = normalize(axis);
  if (unitAxis[0] === 0 && unitAxis[1] === 0 && unitAxis[2] === 0) unitAxis[2] = 1;

  return (start, end, alpha) => {
    const rot = rotationMatrix((alpha - 1) * angle, unitAxis);
    return start.map((s, i) => {
      const e = end[i];
      // start + alpha * ((end - start) @ rot.T)  ==  start + alpha * rot @ (end - start)
      const rotated = matrixVectorProduct(rot, sub(e, s));
      return add(s, scale(rotated, alpha)) as Vec3;
    });
  };
}
