// Extra animations: growing, spinning, indication, and movement helpers.
// Each subclasses Animation and mutates its target mobject per frame. Patterns
// mirror the core animations in Animation.js — record initial/final state in
// setup() (which runs after begin() captures this.startState), then rebuild the
// mobject's points from that recorded state in interpolateMobject(alpha).

import { Animation } from "./Animation.ts";
import type { AnimationConfig } from "./Animation.ts";
import * as V from "../core/math/vector.ts";
import * as rf from "./rate_functions.ts";
import { Line, Rectangle } from "../mobject/geometry.ts";
import { VGroup } from "../mobject/VMobject.ts";
import type { Mobject } from "../mobject/Mobject.ts";
import type { Vec3, RateFunc, ColorLike } from "../core/types.ts";
import { X_AXIS, Z_AXIS } from "../core/constants.ts";

// --- camera-facing billboarding (issue #29) ---------------------------------
//
// Circumscribe/Flash/FocusOn each build a brand-new, flat highlight mobject
// in the mobject's local XY plane. Issue #21 fixed the case where the target
// is fixed-in-frame (the highlight now inherits that flag). But a target
// that's a genuine 3D world-space point has no "fixed" orientation to
// inherit -- pinning it to the camera plane would be wrong too, since the
// highlight wouldn't track the point's real 3D position as the camera
// orbits. What that case needs is true camera-facing billboarding: build the
// highlight directly in the point's camera-tangent plane (the two world-space
// directions that project to flat screen X/Y under the CURRENT camera
// orientation), so the ordinary 3D pipeline projects it back out undistorted,
// still perspective-scaled and depth-tested against other 3D content, at any
// camera angle.
//
// This must be recomputed every frame (not once at construction) so an
// orbiting/animated camera (beginAmbientCameraRotation, moveCamera) doesn't
// leave the highlight's orientation stale relative to a moving view.

/** Camera-space right/up unit vectors, rotated into world space -- the
 *  inverse of ThreeDCamera.toCameraSpace()'s rotation chain (Rz(-(theta+90))
 *  then Rx(-phi) then Rz(-gamma)), applied in reverse order. Confirmed
 *  empirically: projecting `center ± right*d` / `center ± up*d` through the
 *  same camera's toPixel() moves purely along screen X / screen Y
 *  respectively, at any phi/theta/gamma -- i.e. these two vectors span
 *  exactly the plane that renders undistorted (camera-facing) at `center`. */
function cameraBillboardBasis(camera: any): { right: number[]; up: number[] } {
  const theta = camera.theta ?? 0, phi = camera.phi ?? 0, gamma = camera.gamma ?? 0;
  const toWorld = (v: number[]) => {
    let r = V.rotateVector(v, gamma, Z_AXIS);
    r = V.rotateVector(r, phi, X_AXIS);
    r = V.rotateVector(r, theta + 90 * V.DEGREES, Z_AXIS);
    return r;
  };
  return { right: toWorld([1, 0, 0]), up: toWorld([0, 1, 0]) };
}

/** Remap flat, origin-centered local points (z ignored -- these shapes are
 *  always built flat) into world space via a camera-billboard basis. */
function billboardLocalPoints(localPoints: number[][], center: number[], right: number[], up: number[]): number[][] {
  return localPoints.map((p) => V.add(center, V.add(V.scale(right, p[0]), V.scale(up, p[1]))));
}

/** True when config supplies a 3D camera and the target isn't already
 *  fixed-in-frame/fixed-orientation (those paths already render correctly
 *  via issue #21's flag-propagation fix -- billboarding is the alternative
 *  for a target that's a genuine, still-3D world-space point). */
function usesCameraBillboard(config: ExtraConfig, fixedInFrame: boolean, fixedOrientation: boolean): boolean {
  return !fixedInFrame && !fixedOrientation && !!config.camera && typeof config.camera.projectionDepth === "function";
}

// Config accepted by the extra animations. All class-specific fields are
// optional; AnimationConfig already carries an index signature.
interface ExtraConfig extends AnimationConfig {
  pointColor?: ColorLike | null;
  angle?: number;
  axis?: Vec3 | number[];
  radians?: number;
  aboutPoint?: Vec3 | number[] | null;
  scaleFactor?: number;
  color?: ColorLike;
  numLines?: number;
  lineLength?: number;
  flashRadius?: number;
  scaleValue?: number;
  rotationAngle?: number;
  nWiggles?: number;
  buff?: number;
  fadeOut?: boolean;
  startRadius?: number;
  fillOpacity?: number;
  strokeWidth?: number;
  /** Force the highlight geometry to render fixed-in-frame / fixed-
   *  orientation under a 3D camera (see the `_fixedInFrame`/
   *  `_fixedOrientation` doc note above each class below). Defaults to
   *  whatever the target mobject already carries when one is available
   *  (Circumscribe always has one; Flash/FocusOn only when called with a
   *  mobject rather than a raw point) -- set explicitly to override, or to
   *  supply the flag when only a raw point is available. */
  fixedInFrame?: boolean;
  fixedOrientation?: boolean;
  /** A 3D camera (e.g. `this.camera` inside a ThreeDScene's construct()) to
   *  billboard the highlight against, for a target that's a genuine 3D
   *  world-space point (not fixed-in-frame/fixed-orientation) -- see the
   *  "camera-facing billboarding" note above (issue #29). Ignored when the
   *  target is fixed-in-frame/fixed-orientation, since those already render
   *  correctly without it. Recomputed every frame, so an orbiting camera
   *  (beginAmbientCameraRotation/moveCamera) is tracked correctly. */
  camera?: any;
}

// Snapshot every family member's points (deep copy) for later reconstruction.
function familyPoints(mobject: any): number[][][] {
  return mobject.getFamily().map((m: any) => m.points.map((p: number[]) => [...p]));
}

// Snapshot fill/stroke opacity for each family member.
function familyOpacities(mobject: any): Array<{ fill: number; stroke: number; op: number }> {
  return mobject.getFamily().map((m: any) => ({
    fill: m.fillOpacity ?? m.opacity ?? 1,
    stroke: m.strokeOpacity ?? m.opacity ?? 1,
    op: m.opacity ?? 1,
  }));
}

// --- growing ---------------------------------------------------------------

// Grow the mobject out of a single fixed point (scale 0 -> 1) while fading in.
export class GrowFromPoint extends Animation {
  point: any;
  pointColor: any;
  finalPoints!: number[][][];
  targetOpacities!: Array<{ fill: number; stroke: number; op: number }>;

  constructor(mobject: Mobject, point: any, config: ExtraConfig = {}) {
    super(mobject, { ...config, introducer: true });
    this.point = point ?? V.ORIGIN;
    this.pointColor = config.pointColor ?? null;
  }

  setup(): void {
    // Final geometry & opacity, captured before any interpolation runs.
    this.finalPoints = familyPoints(this.mobject);
    this.targetOpacities = familyOpacities(this.mobject);
  }

  interpolateMobject(alpha: number): void {
    const fam = this.mobject.getFamily();
    fam.forEach((m: any, i: number) => {
      const final = this.finalPoints[i];
      // p = point + (final - point) * alpha  (scale about the grow point).
      for (let j = 0; j < m.points.length; j++) {
        m.points[j] = V.add(this.point, V.scale(V.sub(final[j], this.point), alpha));
      }
      const t = this.targetOpacities[i];
      m.fillOpacity = t.fill * alpha;
      m.strokeOpacity = t.stroke * alpha;
      m.opacity = t.op;
    });
  }

  finish(): this {
    this.interpolateMobject(1);
    this.finished = true;
    return this;
  }
}

// GrowFromPoint from the mobject's own center.
export class GrowFromCenter extends GrowFromPoint {
  constructor(mobject: any, config: ExtraConfig = {}) {
    super(mobject, mobject.getCenter(), config);
  }
}

// GrowFromPoint from a bounding-box edge point (e.g. V.UP, V.LEFT).
export class GrowFromEdge extends GrowFromPoint {
  constructor(mobject: any, edge: any, config: ExtraConfig = {}) {
    super(mobject, mobject.getBoundaryPoint(edge), config);
  }
}

// Grow from center while rotating in from `angle` (default PI/2).
export class SpinInFromNothing extends GrowFromCenter {
  spinAngle: number;
  spinAxis: any;

  constructor(mobject: any, config: ExtraConfig = {}) {
    super(mobject, { rateFunc: config.rateFunc ?? rf.smooth, ...config });
    this.spinAngle = config.angle ?? Math.PI / 2;
    this.spinAxis = config.axis ?? V.OUT;
  }

  interpolateMobject(alpha: number): void {
    super.interpolateMobject(alpha);
    // Rotate from -angle*(1-alpha)... i.e. start rotated by spinAngle, unwind.
    const angle = this.spinAngle * (alpha - 1);
    this.mobject.rotate(angle, { axis: this.spinAxis, aboutPoint: this.point });
  }
}

// Reverse of GrowFromCenter: shrink into the center and remove.
export class ShrinkToCenter extends Animation {
  point: any;
  startPoints!: number[][][];
  startOpacities!: Array<{ fill: number; stroke: number; op: number }>;

  constructor(mobject: any, config: ExtraConfig = {}) {
    super(mobject, { ...config, remover: true });
    this.point = mobject.getCenter();
  }

  setup(): void {
    this.startPoints = familyPoints(this.mobject);
    this.startOpacities = familyOpacities(this.mobject);
  }

  interpolateMobject(alpha: number): void {
    const s = 1 - alpha; // scale 1 -> 0
    const fam = this.mobject.getFamily();
    fam.forEach((m: any, i: number) => {
      const start = this.startPoints[i];
      for (let j = 0; j < m.points.length; j++) {
        m.points[j] = V.add(this.point, V.scale(V.sub(start[j], this.point), s));
      }
      const o = this.startOpacities[i];
      m.fillOpacity = o.fill * s;
      m.strokeOpacity = o.stroke * s;
    });
  }

  finish() {
    this.interpolateMobject(1);
    this.finished = true;
    return this;
  }
}

// --- rotation --------------------------------------------------------------

// Continuous rotation by `radians` (default TAU) over runTime (default 5).
// Not a remover/introducer. Default linear rate for constant angular speed.
export class Rotating extends Animation {
  radians: number;
  axis: any;
  aboutPoint: any;
  startPoints!: number[][][];
  pivot: any;

  constructor(mobject: any, config: ExtraConfig = {}) {
    super(mobject, {
      runTime: config.runTime ?? 5,
      rateFunc: config.rateFunc ?? rf.linear,
      ...config,
    });
    this.radians = config.radians ?? V.TAU;
    this.axis = config.axis ?? V.OUT;
    this.aboutPoint = config.aboutPoint ?? null;
  }

  setup(): void {
    this.startPoints = familyPoints(this.mobject);
    // Fix the pivot once so it doesn't drift as points move.
    this.pivot = this.aboutPoint ?? this.mobject.getCenter();
  }

  interpolateMobject(alpha: number): void {
    const angle = this.radians * alpha;
    const fam = this.mobject.getFamily();
    fam.forEach((m: any, i: number) => {
      const start = this.startPoints[i];
      for (let j = 0; j < m.points.length; j++) {
        m.points[j] = V.add(this.pivot, V.rotateVector(V.sub(start[j], this.pivot), angle, this.axis));
      }
    });
  }
}

// Animated fixed-angle rotation (default smooth). Duplicates the factory name
// from Animation.js intentionally — this is the class form used in this module.
export class Rotate extends Animation {
  angle: number;
  axis: any;
  aboutPoint: any;
  startPoints!: number[][][];
  pivot: any;

  constructor(mobject: any, angle: number, config: ExtraConfig = {}) {
    super(mobject, { rateFunc: config.rateFunc ?? rf.smooth, ...config });
    this.angle = angle ?? Math.PI;
    this.axis = config.axis ?? V.OUT;
    this.aboutPoint = config.aboutPoint ?? null;
  }

  setup(): void {
    this.startPoints = familyPoints(this.mobject);
    this.pivot = this.aboutPoint ?? this.mobject.getCenter();
  }

  interpolateMobject(alpha: number): void {
    const angle = this.angle * alpha;
    const fam = this.mobject.getFamily();
    fam.forEach((m: any, i: number) => {
      const start = this.startPoints[i];
      for (let j = 0; j < m.points.length; j++) {
        m.points[j] = V.add(this.pivot, V.rotateVector(V.sub(start[j], this.pivot), angle, this.axis));
      }
    });
  }
}

// --- movement --------------------------------------------------------------

// Move the mobject so its center follows `path` (a VMobject) via
// path.pointFromProportion(alpha).
export class MoveAlongPath extends Animation {
  path: any;

  constructor(mobject: any, path: any, config: ExtraConfig = {}) {
    super(mobject, config);
    this.path = path;
  }

  interpolateMobject(alpha: number): void {
    const target = this.path.pointFromProportion(alpha);
    this.mobject.moveTo(target);
  }
}

// --- indication ------------------------------------------------------------

// Briefly scale up and flash to `color`, then return, via thereAndBack.
export class Indicate extends Animation {
  scaleFactor: number;
  flashColor: any;
  startPoints!: number[][][];
  center: any;
  startColors!: Array<{ color: any; strokeColor: any; fillColor: any }>;

  constructor(mobject: any, config: ExtraConfig = {}) {
    super(mobject, { rateFunc: config.rateFunc ?? rf.thereAndBack, ...config });
    this.scaleFactor = config.scaleFactor ?? 1.2;
    this.flashColor = config.color ?? "#FFFF00";
  }

  setup(): void {
    this.startPoints = familyPoints(this.mobject);
    this.center = this.mobject.getCenter();
    // Remember original colors to blend toward the flash color and back.
    this.startColors = this.mobject.getFamily().map((m: any) => ({
      color: m.color,
      strokeColor: m.strokeColor ?? m.color,
      fillColor: m.fillColor ?? m.color,
    }));
  }

  interpolateMobject(alpha: number): void {
    const s = 1 + (this.scaleFactor - 1) * alpha;
    const fam = this.mobject.getFamily();
    fam.forEach((m: any, i: number) => {
      const start = this.startPoints[i];
      for (let j = 0; j < m.points.length; j++) {
        m.points[j] = V.add(this.center, V.scale(V.sub(start[j], this.center), s));
      }
      if (alpha >= 0.5) {
        m.setColor(this.flashColor);
      } else {
        const c = this.startColors[i];
        m.color = c.color;
        if (m.strokeColor != null) m.strokeColor = c.strokeColor;
        if (m.fillColor != null) m.fillColor = c.fillColor;
      }
    });
  }

  finish(): this {
    // Restore original geometry and colors.
    const fam = this.mobject.getFamily();
    fam.forEach((m: any, i: number) => {
      m.points = this.startPoints[i].map((p: number[]) => [...p]);
      const c = this.startColors[i];
      m.color = c.color;
      if (m.strokeColor != null) m.strokeColor = c.strokeColor;
      if (m.fillColor != null) m.fillColor = c.fillColor;
    });
    this.finished = true;
    return this;
  }
}

// --- flash / focus ---------------------------------------------------------

// Emit short lines radiating from a point, fading out over the animation.
// Builds a temporary VGroup of Lines; introducer + remover.
export class Flash extends Animation {
  point: any;
  lines: any;
  startOpacities!: Array<{ fill: number; stroke: number; op: number }>;
  _billboard: boolean;
  _billboardCamera: any;
  _billboardCenter!: number[];
  _billboardFlashRadius!: number;
  _billboardLineLength!: number;
  _billboardNumLines!: number;

  constructor(point: any, config: ExtraConfig = {}) {
    const color = config.color ?? "#FFFFFF";
    const numLines = config.numLines ?? 12;
    const lineLength = config.lineLength ?? 0.2;
    const flashRadius = config.flashRadius ?? 0.3;
    // A caller with a Mobject in hand (not just its raw center) can pass it
    // directly -- lets us inherit its fixed-in-frame/orientation flags below,
    // same detection FocusOn already does for its own `point` parameter.
    const sourceMobject = point && typeof point === "object" && !Array.isArray(point) && typeof point.getCenter === "function" ? point : null;
    const center = sourceMobject ? sourceMobject.getCenter() : (point ?? V.ORIGIN);

    const lines = new VGroup();
    for (let i = 0; i < numLines; i++) {
      const angle = (V.TAU * i) / numLines;
      const dir: number[] = [Math.cos(angle), Math.sin(angle), 0];
      const start = V.add(center, V.scale(dir, flashRadius));
      const end = V.add(center, V.scale(dir, flashRadius + lineLength));
      const line = new Line(start, end);
      line.setColor(color);
      lines.add(line);
    }
    // Bug (issue #21): built flat in the mobject's local XY plane with no
    // fixed-in-frame/orientation flags of its own, so under a 3D camera it
    // renders as an oblique, asymmetric burst instead of a symmetric one --
    // even when the point came from an already-fixed-in-frame mobject.
    // Inherit from a source Mobject when we have one; otherwise an explicit
    // config override is the only way to get this right for a raw point.
    const fixedInFrame = config.fixedInFrame ?? !!sourceMobject?._fixedInFrame;
    const fixedOrientation = config.fixedOrientation ?? !!sourceMobject?._fixedOrientation;
    if (fixedInFrame) lines.getFamily().forEach((m: any) => { m._fixedInFrame = true; });
    if (fixedOrientation) lines.getFamily().forEach((m: any) => { m._fixedOrientation = true; });

    super(lines, { ...config, introducer: true, remover: true });
    this.point = center;
    this.lines = lines;
    // Bug (issue #29): a genuinely-3D (non-fixed) point still rendered as a
    // lopsided starburst -- see "camera-facing billboarding" above.
    this._billboard = usesCameraBillboard(config, fixedInFrame, fixedOrientation);
    this._billboardCamera = config.camera;
    this._billboardCenter = center;
    this._billboardFlashRadius = flashRadius;
    this._billboardLineLength = lineLength;
    this._billboardNumLines = numLines;
  }

  setup(): void {
    this.startOpacities = familyOpacities(this.mobject);
  }

  interpolateMobject(alpha: number): void {
    if (this._billboard) {
      // Recomputed every frame (not cached) so an orbiting/animated camera
      // keeps the burst camera-facing throughout the animation's runTime.
      const { right, up } = cameraBillboardBasis(this._billboardCamera);
      const n = this._billboardNumLines;
      for (let i = 0; i < n; i++) {
        const angle = (V.TAU * i) / n;
        const dir = V.add(V.scale(right, Math.cos(angle)), V.scale(up, Math.sin(angle)));
        const start = V.add(this._billboardCenter, V.scale(dir, this._billboardFlashRadius));
        const end = V.add(this._billboardCenter, V.scale(dir, this._billboardFlashRadius + this._billboardLineLength));
        (this.lines.submobjects[i] as any).setPointsAsCorners([start, end]);
      }
    }
    // Fade out the rays over the animation.
    const fade = 1 - alpha;
    this.mobject.getFamily().forEach((m: any, i: number) => {
      const s = this.startOpacities[i];
      m.strokeOpacity = s.stroke * fade;
      m.fillOpacity = s.fill * fade;
    });
  }

  finish(): this {
    this.interpolateMobject(1);
    this.finished = true;
    return this;
  }
}

// A small rotational + scale wobble that restores the original state.
export class Wiggle extends Animation {
  scaleValue: number;
  rotationAngle: number;
  nWiggles: number;
  axis: any;
  startPoints!: number[][][];
  center: any;

  constructor(mobject: any, config: ExtraConfig = {}) {
    super(mobject, { rateFunc: config.rateFunc ?? rf.linear, ...config });
    this.scaleValue = config.scaleValue ?? 1.1;
    this.rotationAngle = config.rotationAngle ?? 0.01 * V.TAU;
    this.nWiggles = config.nWiggles ?? 6;
    this.axis = config.axis ?? V.OUT;
  }

  setup(): void {
    this.startPoints = familyPoints(this.mobject);
    this.center = this.mobject.getCenter();
  }

  interpolateMobject(alpha: number): void {
    // Scale envelope peaks at the middle (thereAndBack), and rotation
    // oscillates nWiggles times, both damped to zero at the ends.
    const s = 1 + (this.scaleValue - 1) * rf.thereAndBack(alpha);
    const wiggle = rf.thereAndBack(alpha) * Math.sin(this.nWiggles * Math.PI * alpha);
    const angle = this.rotationAngle * wiggle;
    const fam = this.mobject.getFamily();
    fam.forEach((m: any, i: number) => {
      const start = this.startPoints[i];
      for (let j = 0; j < m.points.length; j++) {
        const scaled = V.add(this.center, V.scale(V.sub(start[j], this.center), s));
        m.points[j] = V.add(this.center, V.rotateVector(V.sub(scaled, this.center), angle, this.axis));
      }
    });
  }

  finish(): this {
    const fam = this.mobject.getFamily();
    fam.forEach((m: any, i: number) => {
      m.points = this.startPoints[i].map((p: number[]) => [...p]);
    });
    this.finished = true;
    return this;
  }
}

// Briefly draw a rectangle around the mobject's bounds, then fade.
// introducer + remover.
export class Circumscribe extends Animation {
  rect: any;
  fadeOut: boolean;
  startOpacities!: Array<{ fill: number; stroke: number; op: number }>;
  _billboard: boolean;
  _billboardCamera: any;
  _billboardCenter!: number[];
  _billboardLocalPoints!: number[][] | null;

  constructor(mobject: any, config: ExtraConfig = {}) {
    const target = mobject;
    const buff = config.buff ?? 0.1;
    const w = target.getWidth() + 2 * buff;
    const h = target.getHeight() + 2 * buff;
    const rect = new Rectangle({ width: Math.max(w, 1e-3), height: Math.max(h, 1e-3) });
    rect.setColor(config.color ?? "#FFFF00");
    rect.fillOpacity = 0;
    rect.moveTo(target.getCenter());
    // Bug (issue #21): built flat in the target's local XY plane, so under a
    // 3D camera it renders as a skewed parallelogram instead of an
    // axis-aligned rectangle -- even when the target itself is already
    // fixed-in-frame (addFixedInFrameMobjects only flags the target, and
    // this `rect` is a brand-new mobject the target's flag never reaches).
    // `target` is always a real Mobject here (unlike Flash/FocusOn's `point`,
    // which may be a raw coordinate), so this can inherit automatically.
    const fixedInFrame = config.fixedInFrame ?? !!(target as any)._fixedInFrame;
    const fixedOrientation = config.fixedOrientation ?? !!(target as any)._fixedOrientation;
    (rect as any)._fixedInFrame = fixedInFrame;
    (rect as any)._fixedOrientation = fixedOrientation;

    super(rect, {
      rateFunc: config.rateFunc ?? rf.smooth,
      ...config,
      introducer: true,
      remover: true,
    });
    this.rect = rect;
    this.fadeOut = config.fadeOut ?? true;
    // Bug (issue #29): a genuinely-3D (non-fixed) target still rendered as a
    // skewed parallelogram -- see "camera-facing billboarding" above. The
    // rectangle's own LOCAL (origin-centered) points are captured once --
    // width/height are static -- and remapped through a freshly recomputed
    // camera basis every frame in interpolateMobject().
    this._billboard = usesCameraBillboard(config, fixedInFrame, fixedOrientation);
    this._billboardCamera = config.camera;
    this._billboardCenter = target.getCenter();
    this._billboardLocalPoints = this._billboard
      ? new Rectangle({ width: Math.max(w, 1e-3), height: Math.max(h, 1e-3) }).points.map((p: number[]) => [...p])
      : null;
  }

  setup(): void {
    this.startOpacities = familyOpacities(this.mobject);
  }

  interpolateMobject(alpha: number): void {
    if (this._billboard) {
      const { right, up } = cameraBillboardBasis(this._billboardCamera);
      this.rect.points = billboardLocalPoints(this._billboardLocalPoints!, this._billboardCenter, right, up);
    }
    // First half: draw the outline. Second half: fade it out.
    if (alpha <= 0.5) {
      this.mobject.getFamily().forEach((m: any) => {
        m.strokeEnd = alpha * 2;
      });
    } else {
      this.mobject.getFamily().forEach((m: any, i: number) => {
        m.strokeEnd = 1;
        if (this.fadeOut) {
          const s = this.startOpacities[i];
          m.strokeOpacity = s.stroke * (1 - (alpha - 0.5) * 2);
        }
      });
    }
  }

  finish(): this {
    this.interpolateMobject(1);
    this.finished = true;
    return this;
  }
}

// A shrinking spotlight circle converging on a point. introducer + remover.
export class FocusOn extends Animation {
  point: any;
  circle: any;
  startRadius: number;
  startPoints!: number[][][];
  startOpacities!: Array<{ fill: number; stroke: number; op: number }>;
  _billboard: boolean;
  _billboardCamera: any;
  _billboardLocalPoints!: number[][] | null;

  constructor(point: any, config: ExtraConfig = {}) {
    const sourceMobject = point instanceof Object && !Array.isArray(point) && point.getCenter ? point : null;
    const target = sourceMobject ? sourceMobject.getCenter() : (point ?? V.ORIGIN);
    // Build the spotlight ring lazily via Circle-like bezier points using Line
    // segments would be lossy; import Circle here to keep the shape true.
    // (Imported below to avoid a circular concern at module top.)
    const { Circle } = FocusOn._geometry();
    const startRadius = config.startRadius ?? config.flashRadius ?? 2;
    const circle = new Circle({ radius: startRadius });
    circle.setColor(config.color ?? "#808080");
    circle.fillOpacity = config.fillOpacity ?? 0.2;
    circle.strokeWidth = config.strokeWidth ?? 0;
    circle.moveTo(target);
    // Bug (issue #21): same root cause as Circumscribe/Flash above -- a
    // brand-new flat circle never inherits the source's fixed-in-frame/
    // orientation flags. Inherit automatically when called with a Mobject
    // (as `sourceMobject` here); a raw point has no flags to inherit, so an
    // explicit config override is the only way to get this right for one.
    const fixedInFrame = config.fixedInFrame ?? !!(sourceMobject as any)?._fixedInFrame;
    const fixedOrientation = config.fixedOrientation ?? !!(sourceMobject as any)?._fixedOrientation;
    (circle as any)._fixedInFrame = fixedInFrame;
    (circle as any)._fixedOrientation = fixedOrientation;

    super(circle, {
      rateFunc: config.rateFunc ?? rf.smooth,
      ...config,
      introducer: true,
      remover: true,
    });
    this.point = target;
    this.circle = circle;
    this.startRadius = startRadius;
    // Bug (issue #29): a genuinely-3D (non-fixed) point still rendered as an
    // ellipse -- see "camera-facing billboarding" above. The ring's own
    // LOCAL (origin-centered, full-size) points are captured once; shrinking
    // toward the point commutes with the (linear) billboard remap, so
    // interpolateMobject() shrinks these local points by `1 - alpha` FIRST,
    // then remaps through a freshly recomputed camera basis every frame.
    this._billboard = usesCameraBillboard(config, fixedInFrame, fixedOrientation);
    this._billboardCamera = config.camera;
    this._billboardLocalPoints = this._billboard
      ? new Circle({ radius: startRadius }).points.map((p: number[]) => [...p])
      : null;
  }

  static _geometry(): { Circle: typeof _Circle } {
    // Local require-style import to keep the top-of-file import list minimal.
    return _geometryModule;
  }

  setup(): void {
    this.startPoints = familyPoints(this.mobject);
    this.startOpacities = familyOpacities(this.mobject);
  }

  interpolateMobject(alpha: number): void {
    // Shrink the ring toward the point (scale startRadius -> ~0).
    const s = 1 - alpha;
    if (this._billboard) {
      const { right, up } = cameraBillboardBasis(this._billboardCamera);
      const shrunk = this._billboardLocalPoints!.map((p) => [p[0] * s, p[1] * s, 0]);
      this.circle.points = billboardLocalPoints(shrunk, this.point, right, up);
      const o = this.startOpacities[0];
      this.circle.fillOpacity = o.fill * alpha;
      this.circle.strokeOpacity = o.stroke * alpha;
      return;
    }
    const fam = this.mobject.getFamily();
    fam.forEach((m: any, i: number) => {
      const start = this.startPoints[i];
      for (let j = 0; j < m.points.length; j++) {
        m.points[j] = V.add(this.point, V.scale(V.sub(start[j], this.point), s));
      }
      const o = this.startOpacities[i];
      m.fillOpacity = o.fill * alpha;
      m.strokeOpacity = o.stroke * alpha;
    });
  }

  finish(): this {
    this.interpolateMobject(1);
    this.finished = true;
    return this;
  }
}

// Bind Circle for FocusOn without adding it to the eager import block that the
// task specified; imported statically here so it is available synchronously.
import { Circle as _Circle } from "../mobject/geometry.ts";
const _geometryModule = { Circle: _Circle };
