// Remotion-style `interpolate` range-mapping function.
//
// Maps a numeric `input` from an `inputRange` onto an `outputRange`, segment by
// segment, with an optional easing (RateFunc) applied to the local parameter of
// the containing segment. Behaviour outside the input range is controlled by the
// `extrapolateLeft` / `extrapolateRight` options. Matches Remotion's semantics.

import { inverseInterpolate, interpolate as lerp } from "../core/math/bezier.ts";
import type { RateFunc } from "../core/types.ts";

/** How to map values that fall outside `inputRange`. */
export type Extrapolation = "extend" | "clamp" | "identity" | "wrap";

export interface InterpolateOptions {
  /** Easing applied to each segment's local parameter. Default: linear. */
  easing?: RateFunc;
  /** Behaviour for inputs below inputRange[0]. Default: "extend". */
  extrapolateLeft?: Extrapolation;
  /** Behaviour for inputs above inputRange[last]. Default: "extend". */
  extrapolateRight?: Extrapolation;
}

const identity: RateFunc = (t) => t;

/**
 * Map `input` from `inputRange` to `outputRange`.
 *
 * `inputRange` and `outputRange` must be the same length (>= 2), and
 * `inputRange` must be strictly monotonically increasing.
 */
export function interpolate(
  input: number,
  inputRange: number[],
  outputRange: number[],
  options?: InterpolateOptions,
): number {
  if (inputRange.length !== outputRange.length) {
    throw new Error(
      `interpolate: inputRange and outputRange must have the same length ` +
        `(got ${inputRange.length} and ${outputRange.length}).`,
    );
  }
  if (inputRange.length < 2) {
    throw new Error(
      `interpolate: inputRange and outputRange must have at least 2 elements ` +
        `(got ${inputRange.length}).`,
    );
  }
  for (let i = 1; i < inputRange.length; i++) {
    if (!(inputRange[i] > inputRange[i - 1])) {
      throw new Error(
        `interpolate: inputRange must be strictly monotonically increasing. ` +
          `Got ${inputRange[i - 1]} then ${inputRange[i]} at index ${i}.`,
      );
    }
  }

  const easing = options?.easing ?? identity;
  const extrapolateLeft = options?.extrapolateLeft ?? "extend";
  const extrapolateRight = options?.extrapolateRight ?? "extend";

  const first = inputRange[0];
  const last = inputRange[inputRange.length - 1];

  // Handle below-range input.
  if (input < first) {
    switch (extrapolateLeft) {
      case "identity":
        return input;
      case "clamp":
        return outputRange[0];
      case "wrap": {
        const range = last - first;
        input = ((((input - first) % range) + range) % range) + first;
        break; // fall through to normal mapping with the wrapped value
      }
      case "extend":
      default:
        // Use the first segment's slope; handled by normal mapping below.
        break;
    }
  } else if (input > last) {
    // Handle above-range input.
    switch (extrapolateRight) {
      case "identity":
        return input;
      case "clamp":
        return outputRange[outputRange.length - 1];
      case "wrap": {
        const range = last - first;
        input = ((((input - first) % range) + range) % range) + first;
        break;
      }
      case "extend":
      default:
        break;
    }
  }

  // Locate the segment [inputRange[i], inputRange[i+1]] containing input. For
  // "extend" (or a wrapped value that landed exactly on the boundaries) we use
  // the first/last segment for out-of-range values.
  let i = 0;
  while (i < inputRange.length - 2 && input >= inputRange[i + 1]) {
    i++;
  }

  const localT = inverseInterpolate(inputRange[i], inputRange[i + 1], input);
  const easedT = easing(localT);
  return lerp(outputRange[i], outputRange[i + 1], easedT);
}
