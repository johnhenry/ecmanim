// Pure geographic projections: (longitude, latitude) in degrees → abstract
// planar coordinates (y-up, unnormalized — the GeoJSON loader fits the
// result to world units). Kept separate from the loader so projections are
// testable in isolation and user-supplied ones slot in via the same shape.

export type GeoProjection = (lon: number, lat: number) => [number, number];

const RAD = Math.PI / 180;

// Web-Mercator's usable latitude bound: beyond ±85.05113° y diverges.
const MAX_MERCATOR_LAT = 85.05113;

/** Plate carrée: x = λ, y = φ (radians). Cheap, heavy polar distortion. */
export const equirectangular: GeoProjection = (lon, lat) => [lon * RAD, lat * RAD];

/** Web-Mercator: conformal, the familiar slippy-map look. Latitude clamped
 *  to ±85.05113° (the projection diverges at the poles). */
export const mercator: GeoProjection = (lon, lat) => {
  const phi = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat)) * RAD;
  return [lon * RAD, Math.log(Math.tan(Math.PI / 4 + phi / 2))];
};

/** Identity / "none": pass PRE-PROJECTED planar coordinates through instead
 *  of treating them as lon/lat. For data already projected to pixel space
 *  (e.g. the US-atlas TopoJSON, Albers-projected with y increasing DOWN),
 *  y is negated so the map is upright in the loader's y-up planar space —
 *  the loader's usual fit and winding normalization then apply unchanged. */
export const identity: GeoProjection = (x, y) => [x, -y];

export const PROJECTIONS: Record<string, GeoProjection> = {
  mercator,
  equirectangular,
  identity,
  none: identity,
};
