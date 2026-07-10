// GeoJSON → mobjects: loadGeoJSON parses a Feature/FeatureCollection and
// returns a GeoMap (VGroup) whose regions are addressable by feature name for
// choropleths, and which can `project()` any lon/lat through the SAME
// fit transform — so markers and arcs land exactly on their regions.
//
// Synchronous by design: this is pure JSON + math (loaders are async only
// when they lazy-import optional dependencies).
//
// Winding: CanvasRenderer fills evenodd (holes work regardless), but
// SVGRenderer uses nonzero — so exterior rings are normalized CCW and holes
// CW, making holes render under BOTH fill rules.

import { VMobject, VGroup } from "../mobject/VMobject.ts";
import type { VMobjectConfig } from "../mobject/VMobject.ts";
import type { Vec3 } from "../core/types.ts";
import { PROJECTIONS } from "./geo_projection.ts";
import type { GeoProjection } from "./geo_projection.ts";

type Position = [number, number, ...number[]];
type Ring = Position[];

export interface GeoJSONOptions extends VMobjectConfig {
  /** Projection name or custom function (default "mercator"). Use
   *  "none" (alias "identity") for PRE-PROJECTED planar data — e.g. TopoJSON
   *  atlases already in y-down pixel space — where coordinates pass through
   *  as-is except for a y-flip into the loader's y-up space (fit, winding
   *  normalization, and project() behave as usual). */
  projection?: "mercator" | "equirectangular" | "none" | "identity" | GeoProjection;
  /** Feature property used as the region key (default "name"). */
  nameProperty?: string;
  /** Target width in world units. If only one of width/height is given the
   *  other follows the projected aspect ratio; default width 8. */
  width?: number;
  height?: number;
  /** World-space center of the fitted map (default origin). */
  point?: number[];
  /** Douglas-Peucker simplification tolerance in WORLD units (post-fit). */
  simplifyTolerance?: number;
}

/** A projected, fitted GeoJSON map. Regions keep their feature names. */
export class GeoMap extends VGroup {
  /** Feature mobjects grouped by `properties[nameProperty]`. Features
   *  without that property are rendered but not addressable. */
  readonly regions = new Map<string, VGroup>();
  /** lon/lat (degrees) → world point, through the map's own projection and
   *  fit transform. Use for placing markers/arcs on the map. */
  readonly project: (lonLat: [number, number]) => Vec3;

  constructor(project: (lonLat: [number, number]) => Vec3) {
    super();
    this.project = project;
  }

  hasRegion(name: string): boolean {
    return this.regions.has(name);
  }

  byName(name: string): VGroup {
    const region = this.regions.get(name);
    if (!region) {
      const available = [...this.regions.keys()].join(", ") || "(none)";
      throw new Error(`GeoMap.byName: no region named "${name}". Available: ${available}`);
    }
    return region;
  }
}

// Signed area of a ring in planar coordinates (positive = CCW in y-up space).
function signedArea(ring: Array<[number, number]>): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

// Iterative Douglas-Peucker on an open or closed point list.
function simplify(points: Array<[number, number]>, tolerance: number): Array<[number, number]> {
  if (points.length <= 4 || tolerance <= 0) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    if (b - a < 2) continue;
    const [ax, ay] = points[a];
    const [bx, by] = points[b];
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy);
    let maxDist = -1, maxIdx = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = points[i];
      // Coincident endpoints (a closed ring): fall back to point distance.
      const dist = len < 1e-12
        ? Math.hypot(px - ax, py - ay)
        : Math.abs(dx * (ay - py) - (ax - px) * dy) / len;
      if (dist > maxDist) { maxDist = dist; maxIdx = i; }
    }
    if (maxDist > tolerance) {
      keep[maxIdx] = 1;
      stack.push([a, maxIdx], [maxIdx, b]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

interface ParsedFeature {
  name: string | null;
  // Each entry is one drawable: polygons carry rings (exterior first), lines
  // carry a single open path.
  polygons: Array<Array<Array<[number, number]>>>;
  lines: Array<Array<[number, number]>>;
}

function collectFeatures(geojson: any, nameProperty: string, proj: GeoProjection): ParsedFeature[] {
  const features: any[] =
    geojson?.type === "FeatureCollection" ? geojson.features
    : geojson?.type === "Feature" ? [geojson]
    : geojson?.type ? [{ type: "Feature", properties: {}, geometry: geojson }]
    : [];
  const out: ParsedFeature[] = [];
  const projRing = (ring: Ring): Array<[number, number]> =>
    ring.map(([lon, lat]) => proj(lon, lat));
  for (const f of features) {
    const g = f?.geometry;
    if (!g) continue;
    const parsed: ParsedFeature = {
      name: f.properties?.[nameProperty] != null ? String(f.properties[nameProperty]) : null,
      polygons: [],
      lines: [],
    };
    if (g.type === "Polygon") parsed.polygons.push((g.coordinates as Ring[]).map(projRing));
    else if (g.type === "MultiPolygon") for (const poly of g.coordinates as Ring[][]) parsed.polygons.push(poly.map(projRing));
    else if (g.type === "LineString") parsed.lines.push(projRing(g.coordinates as Ring));
    else if (g.type === "MultiLineString") for (const line of g.coordinates as Ring[]) parsed.lines.push(projRing(line));
    // Point/MultiPoint are metadata-tier (use map.project() to place markers).
    if (parsed.polygons.length || parsed.lines.length) out.push(parsed);
  }
  return out;
}

/**
 * Parse GeoJSON (text or object) into a {@link GeoMap}. Supports
 * Feature/FeatureCollection with Polygon / MultiPolygon (filled, holes as
 * extra subpaths) and LineString / MultiLineString (stroke-only). The whole
 * collection is projected, then fit to `width`/`height` centered on `point`.
 */
export function loadGeoJSON(textOrObject: string | object, options: GeoJSONOptions = {}): GeoMap {
  const {
    projection = "mercator", nameProperty = "name",
    width, height, point, simplifyTolerance,
    ...style
  } = options;
  const proj = typeof projection === "function" ? projection : PROJECTIONS[projection];
  if (!proj) throw new Error(`loadGeoJSON: unknown projection ${JSON.stringify(projection)}`);
  const geojson = typeof textOrObject === "string" ? JSON.parse(textOrObject) : textOrObject;
  const features = collectFeatures(geojson, nameProperty, proj);
  if (!features.length) throw new Error("loadGeoJSON: no drawable features (Polygon/MultiPolygon/LineString) found.");

  // Fit: projected bbox → width/height world units centered on `point`.
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const f of features) {
    for (const poly of f.polygons) for (const ring of poly) for (const [x, y] of ring) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    for (const line of f.lines) for (const [x, y] of line) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  const spanX = maxX - minX || 1e-12;
  const spanY = maxY - minY || 1e-12;
  let scale: number;
  if (width != null && height != null) scale = Math.min(width / spanX, height / spanY);
  else if (height != null) scale = height / spanY;
  else scale = (width ?? 8) / spanX;
  const [cx, cy] = point ?? [0, 0, 0];
  const midX = (minX + maxX) / 2;
  const midY = (minY + maxY) / 2;
  const toWorld = ([x, y]: [number, number]): [number, number] =>
    [(x - midX) * scale + cx, (y - midY) * scale + cy];

  const map = new GeoMap(([lon, lat]) => {
    const [x, y] = toWorld(proj(lon, lat));
    return [x, y, 0];
  });

  const styleConfig: VMobjectConfig = { fillOpacity: 1, strokeWidth: 1, ...style };
  for (const f of features) {
    const mobs: VMobject[] = [];
    for (const poly of f.polygons) {
      const mob = new VMobject(styleConfig);
      mob.points = [];
      mob.subpathStarts = [];
      poly.forEach((rawRing, ringIdx) => {
        // Drop GeoJSON's duplicated closing coordinate; renderers close subpaths.
        let ring = rawRing.map(toWorld);
        const first = ring[0], last = ring[ring.length - 1];
        if (ring.length > 1 && first[0] === last[0] && first[1] === last[1]) ring = ring.slice(0, -1);
        if (simplifyTolerance) {
          ring = simplify([...ring, ring[0]], simplifyTolerance).slice(0, -1);
        }
        if (ring.length < 3) return;
        // Normalize winding for nonzero fills: exterior CCW, holes CW.
        const ccw = signedArea(ring) > 0;
        if ((ringIdx === 0) !== ccw) ring.reverse();
        // VMobject.points is a CUBIC BEZIER chain (anchor, handle, handle,
        // anchor, ...) — pushing raw ring vertices made every 3rd vertex a
        // curve HANDLE, so polygons rendered as rounded petals with gaps
        // (found by the D3 choropleth port). Emit straight-line curves:
        // each edge as anchor + two collinear handles + anchor.
        mob.subpathStarts.push(mob.points.length);
        const closed = [...ring, ring[0]];
        for (let i = 0; i + 1 < closed.length; i++) {
          const [ax, ay] = closed[i];
          const [bx, by] = closed[i + 1];
          const a: number[] = [ax, ay, 0];
          const b: number[] = [bx, by, 0];
          const h1: number[] = [ax + (bx - ax) / 3, ay + (by - ay) / 3, 0];
          const h2: number[] = [ax + (2 * (bx - ax)) / 3, ay + (2 * (by - ay)) / 3, 0];
          if (i === 0) mob.points.push(a);
          mob.points.push(h1, h2, b);
        }
      });
      if (!mob.points.length) continue;
      mob._straightPath = true;
      mobs.push(mob);
    }
    for (const rawLine of f.lines) {
      let line = rawLine.map(toWorld);
      if (simplifyTolerance) line = simplify(line, simplifyTolerance);
      if (line.length < 2) continue;
      const mob = new VMobject({ ...styleConfig, fillOpacity: 0 });
      mob.setPointsAsCorners(line.map(([x, y]) => [x, y, 0]));
      mobs.push(mob);
    }
    if (!mobs.length) continue;
    if (f.name != null) {
      let group = map.regions.get(f.name);
      if (!group) {
        group = new VGroup();
        map.regions.set(f.name, group);
        map.add(group);
      }
      group.add(...mobs);
    } else {
      const group = new VGroup();
      group.add(...mobs);
      map.add(group);
    }
  }
  return map;
}
