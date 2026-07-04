// 3D support for the Canvas-2D renderer — no GPU/WebGL/Three.js. A ThreeDCamera
// subclasses the 2D Camera and overrides toPixel() to rotate world points by the
// camera orientation and apply weak perspective, so the existing bezier renderer
// draws 3D with zero renderer changes (the same technique manim's Cairo renderer
// uses). ThreeDScene adds camera-orientation animation and ambient rotation.

import { Camera } from "../renderer/CanvasRenderer.ts";
import type { CameraConfig } from "../renderer/CanvasRenderer.ts";
import { Scene } from "./Scene.ts";
import type { SceneConfig } from "./Scene.ts";
import { VGroup } from "../mobject/VMobject.ts";
import type { VMobject } from "../mobject/VMobject.ts";
import { Line } from "../mobject/geometry.ts";
import { NumberLine } from "../mobject/coordinate_systems.ts";
import type { NumberLineConfig } from "../mobject/coordinate_systems.ts";
import * as V from "../core/math/vector.ts";
import { smooth } from "../animation/rate_functions.ts";
import type { RateFunc } from "../core/types.ts";

const Z_AXIS: number[] = [0, 0, 1];
const X_AXIS: number[] = [1, 0, 0];

// Manim's default light source position: 9*DOWN + 7*LEFT + 10*OUT.
const DEFAULT_LIGHT_SOURCE: number[] = [-7, -9, 10];

export interface ThreeDCameraConfig extends CameraConfig {
  phi?: number;
  theta?: number;
  gamma?: number;
  focalDistance?: number;
  zoom?: number;
  lightSource?: number[];
}

/** Orientation options accepted by setOrientation / moveCamera. */
export interface CameraOrientation {
  phi?: number;
  theta?: number;
  gamma?: number;
  zoom?: number;
  focalDistance?: number;
  frameCenter?: number[];
}

export class ThreeDCamera extends Camera {
  phi: number;
  theta: number;
  // gamma: roll about the view axis (camera-space z). Declared so no field
  // initializer shadows anything; set in the constructor.
  gamma: number;
  // focalDistance is declared on the base Camera; give it a concrete type here.
  declare focalDistance: number;
  zoom: number;
  // Light source position in world space; direction derives from it.
  lightSource: number[];

  constructor(config: ThreeDCameraConfig = {}) {
    super(config);
    // phi: polar angle measured from the +z axis (0 = looking straight down the
    // z-axis onto the xy-plane). theta: azimuthal angle; -90deg keeps the xy-plane
    // upright and un-mirrored (matching the plain 2D view). gamma: roll.
    this.phi = config.phi ?? 0;
    this.theta = config.theta ?? -90 * V.DEGREES;
    this.gamma = config.gamma ?? 0;
    this.focalDistance = config.focalDistance ?? 20;
    this.zoom = config.zoom ?? 1;
    this.frameCenter = config.frameCenter ?? [0, 0, 0];
    this.lightSource = config.lightSource ?? DEFAULT_LIGHT_SOURCE;
  }

  // Rotate a world point into camera space. The reference orientation
  // (theta = -90deg, phi = 0, gamma = 0) leaves the xy-plane upright:
  // z-rotation by -(theta + 90deg), x-rotation by -phi, then roll by -gamma
  // about the (already rotated) view axis / camera-space z. Returns [cx, cy, cz]
  // where cz is depth toward the viewer (larger cz = nearer the camera).
  toCameraSpace(p: number[]): number[] {
    const rel = [
      p[0] - this.frameCenter[0],
      p[1] - this.frameCenter[1],
      p[2] - this.frameCenter[2],
    ];
    const spun = V.rotateVector(rel, -(this.theta + 90 * V.DEGREES), Z_AXIS);
    const tilted = V.rotateVector(spun, -this.phi, X_AXIS);
    if (this.gamma === 0) return tilted;
    // Roll: rotate about the camera-space z-axis (the view axis). A positive
    // gamma rolls the world clockwise, so the projected image rolls by -gamma.
    return V.rotateVector(tilted, -this.gamma, Z_AXIS);
  }

  // Camera-space depth toward the viewer (for painter sorting).
  projectionDepth(p: number[]): number {
    return this.toCameraSpace(p)[2];
  }

  // World [x,y,z] -> pixel [px, py]. Weak-perspective divide by focal distance,
  // then the same frame->pixel mapping (with y-flip) as the base Camera.
  toPixel(p: number[]): [number, number] {
    const [cx, cy, cz] = this.toCameraSpace(p);
    const denom = this.focalDistance - cz;
    const factor = (this.focalDistance / (Math.abs(denom) < 1e-3 ? 1e-3 * Math.sign(denom || 1) : denom)) * this.zoom;
    const screenX = cx * factor;
    const screenY = cy * factor;
    return [
      (screenX / this.frameWidth + 0.5) * this.pixelWidth,
      (0.5 - screenY / this.frameHeight) * this.pixelHeight,
    ];
  }

  // Normalized world-space direction from the scene toward the light source.
  getLightDirection(): number[] {
    return V.normalize(this.lightSource);
  }

  setOrientation({ phi, theta, gamma, zoom, focalDistance, frameCenter }: CameraOrientation = {}): this {
    if (phi != null) this.phi = phi;
    if (theta != null) this.theta = theta;
    if (gamma != null) this.gamma = gamma;
    if (zoom != null) this.zoom = zoom;
    if (focalDistance != null) this.focalDistance = focalDistance;
    if (frameCenter != null) this.frameCenter = [frameCenter[0], frameCenter[1], frameCenter[2]];
    return this;
  }
}

export interface MoveCameraConfig {
  runTime?: number;
  rateFunc?: RateFunc;
  /** Animations to run concurrently while the camera moves. */
  addedAnims?: any[];
}

export class ThreeDScene extends Scene {
  declare camera: ThreeDCamera;
  _ambientOn: boolean;
  _ambientRate: number;
  _ambientField: string;
  _depthSort: boolean;
  // 3d-illusion oscillation state.
  _illusionOn: boolean;
  _illusionRate: number;
  _illusionTime: number;
  _illusionOriginPhi: number;
  _illusionOriginTheta: number;

  constructor(config: SceneConfig = {}) {
    super(config);
    if (!(this.camera instanceof ThreeDCamera)) {
      const base: any = this.camera ?? {};
      this.camera = new ThreeDCamera({
        pixelWidth: base.pixelWidth,
        pixelHeight: base.pixelHeight,
        frameHeight: base.frameHeight,
        frameWidth: base.frameWidth,
        frameCenter: base.frameCenter,
        background: base.background,
      });
    }
    this._ambientOn = false;
    this._ambientRate = 0.2;
    this._ambientField = "theta";
    this._depthSort = false;
    this._illusionOn = false;
    this._illusionRate = 1;
    this._illusionTime = 0;
    this._illusionOriginPhi = 0;
    this._illusionOriginTheta = 0;
  }

  setCameraOrientation(opts: CameraOrientation = {}): this {
    this.camera.setOrientation(opts);
    return this;
  }

  /** Manim's default "nicely angled" 3D view (phi ~ 75deg, theta ~ -45deg). */
  setToDefaultAngledCameraOrientation(opts: CameraOrientation = {}): this {
    this.camera.setOrientation({
      phi: 75 * V.DEGREES,
      theta: -45 * V.DEGREES,
      gamma: 0,
      ...opts,
    });
    return this;
  }

  // Smoothly tween phi/theta/gamma/zoom/focalDistance/frameCenter over runTime
  // seconds. Any animations in addedAnims are interpolated concurrently.
  async moveCamera(
    { phi, theta, gamma, zoom, focalDistance, frameCenter }: CameraOrientation = {},
    { runTime = 3, rateFunc = smooth, addedAnims = [] }: MoveCameraConfig = {},
  ): Promise<this> {
    const cam = this.camera;
    const start = {
      phi: cam.phi, theta: cam.theta, gamma: cam.gamma,
      zoom: cam.zoom, focalDistance: cam.focalDistance,
      frameCenter: [cam.frameCenter[0], cam.frameCenter[1], cam.frameCenter[2]],
    };
    const targetCenter = frameCenter ?? start.frameCenter;
    const target = {
      phi: phi ?? start.phi,
      theta: theta ?? start.theta,
      gamma: gamma ?? start.gamma,
      zoom: zoom ?? start.zoom,
      focalDistance: focalDistance ?? start.focalDistance,
      frameCenter: [targetCenter[0], targetCenter[1], targetCenter[2]],
    };

    const anims = (addedAnims ?? []).flat().filter(Boolean).map((a: any) =>
      a && a._isAnimateBuilder ? a.build() : a);
    for (const a of anims) {
      if (a.suspendMobjectUpdating !== false) a.mobject?.suspendUpdating?.();
      a.begin();
      for (const m of a.getMobjectsToIntroduce?.() ?? []) this.add(m);
    }

    const nFrames = Math.max(1, Math.round(runTime * this.fps));
    const dt = runTime / nFrames;
    for (let f = 1; f <= nFrames; f++) {
      const a = rateFunc(f / nFrames);
      cam.phi = start.phi + (target.phi - start.phi) * a;
      cam.theta = start.theta + (target.theta - start.theta) * a;
      cam.gamma = start.gamma + (target.gamma - start.gamma) * a;
      cam.zoom = start.zoom + (target.zoom - start.zoom) * a;
      cam.focalDistance = start.focalDistance + (target.focalDistance - start.focalDistance) * a;
      cam.frameCenter = [
        start.frameCenter[0] + (target.frameCenter[0] - start.frameCenter[0]) * a,
        start.frameCenter[1] + (target.frameCenter[1] - start.frameCenter[1]) * a,
        start.frameCenter[2] + (target.frameCenter[2] - start.frameCenter[2]) * a,
      ];
      for (const anim of anims) {
        const localAlpha = anim.runTime === 0 ? 1 : Math.max(0, Math.min(1, (f / nFrames * runTime) / anim.runTime));
        anim.interpolate(localAlpha);
      }
      this.updateMobjects(dt);
      this.time += dt;
      await this.emitFrame();
    }

    for (const anim of anims) {
      anim.finish?.();
      if (anim.suspendMobjectUpdating !== false) anim.mobject?.resumeUpdating?.();
      for (const m of anim.getMobjectsToIntroduce?.() ?? []) this.add(m);
      for (const m of anim.getMobjectsToRemove?.() ?? []) this.remove(m);
      if (anim.introduced) this.add(anim.introduced);
    }
    return this;
  }

  beginAmbientCameraRotation({ rate = 0.02, about = "theta" }: { rate?: number; about?: string } = {}): this {
    this._ambientOn = true;
    this._ambientRate = rate;
    // Only phi/theta/gamma are meaningful axes to spin about.
    this._ambientField = (about === "phi" || about === "gamma") ? about : "theta";
    return this;
  }

  stopAmbientCameraRotation(): this {
    this._ambientOn = false;
    return this;
  }

  // Oscillate phi/theta in a small Lissajous figure each frame, producing a
  // subtle "3D illusion" wobble (matches manim's begin_3dillusion_camera_rotation).
  begin3dillusionCameraRotation({ rate = 1, originPhi, originTheta }: { rate?: number; originPhi?: number; originTheta?: number } = {}): this {
    this._illusionOn = true;
    this._illusionRate = rate;
    this._illusionTime = 0;
    this._illusionOriginPhi = originPhi ?? this.camera.phi;
    this._illusionOriginTheta = originTheta ?? this.camera.theta;
    return this;
  }

  stop3dillusionCameraRotation(): this {
    this._illusionOn = false;
    return this;
  }

  updateMobjects(dt: number): void {
    if (this._ambientOn) (this.camera as any)[this._ambientField] += this._ambientRate * dt;
    if (this._illusionOn) {
      this._illusionTime += dt * this._illusionRate;
      const t = this._illusionTime;
      // Small Lissajous oscillation about the origin angles (manim uses ~0.3 rad).
      const amp = 0.3;
      this.camera.phi = this._illusionOriginPhi + amp * Math.sin(t) * Math.sin(t);
      this.camera.theta = this._illusionOriginTheta + amp * Math.sin(2 * t) * 0.5;
    }
    super.updateMobjects(dt);
  }

  // --- Fixed-in-frame / fixed-orientation mobjects -----------------------
  // Fixed-in-frame: drawn in screen space (HUD/titles), ignoring the 3D camera.
  addFixedInFrameMobjects(...mobs: any[]): this {
    for (const m of mobs) { m._fixedInFrame = true; this.add(m); }
    return this;
  }
  removeFixedInFrameMobjects(...mobs: any[]): this {
    for (const m of mobs) m._fixedInFrame = false;
    return this;
  }
  // Fixed-orientation: positioned in 3D but drawn un-rotated (billboards).
  addFixedOrientationMobjects(...mobs: any[]): this {
    for (const m of mobs) { m._fixedOrientation = true; this.add(m); }
    return this;
  }
  removeFixedOrientationMobjects(...mobs: any[]): this {
    for (const m of mobs) m._fixedOrientation = false;
    return this;
  }

  // --- Light --------------------------------------------------------------
  // Move the light source and re-shade every surface in the scene.
  moveLight(pos: number[]): this {
    return this.setCameraLight(pos);
  }
  setCameraLight(pos: number[]): this {
    this.camera.lightSource = [pos[0], pos[1], pos[2]];
    const dir = this.camera.getLightDirection();
    const reshade = (m: any) => {
      if (typeof m.applyShading === "function") {
        m.applyShading(dir);
        if (typeof m.applySmoothShading === "function" && m.smooth) m.applySmoothShading(dir);
      }
      for (const s of m.submobjects ?? []) reshade(s);
    };
    for (const m of this.mobjects) reshade(m);
    return this;
  }

  // Optional painter's-depth sorting: order top-level mobjects so nearer ones
  // draw last. Robust to mobjects without points.
  enableDepthSorting(on = true): this {
    this._depthSort = on;
    return this;
  }

  async emitFrame(): Promise<void> {
    if (this._depthSort) {
      for (const m of this.mobjects) {
        try {
          m.zIndex = this.camera.projectionDepth(m.getCenter());
        } catch { /* ignore mobjects without a center */ }
      }
    }
    return super.emitFrame();
  }
}

// A real 3D axes: three NumberLine axes (x, y in-plane; z along world-Z). The
// z-axis carries points with a real z-component, so the camera projects it. A
// coordsToPoint/c2p and pointToCoords/p2c map data coords <-> world 3D points.
export interface ThreeDAxesConfig {
  xRange?: number[];
  yRange?: number[];
  zRange?: number[];
  xLength?: number;
  yLength?: number;
  zLength?: number;
  axisColors?: string[];
  axisConfig?: NumberLineConfig;
  [key: string]: any;
}

export class ThreeDAxes extends VGroup {
  xRange: number[];
  yRange: number[];
  zRange: number[];
  xLength: number;
  yLength: number;
  zLength: number;
  xAxis: NumberLine;
  yAxis: NumberLine;
  zAxis: NumberLine;
  // World-space unit sizes along each axis (world units per data unit).
  _xUnit: number;
  _yUnit: number;
  _zUnit: number;

  constructor(config: ThreeDAxesConfig = {}) {
    super();
    this.xRange = config.xRange ?? [-4, 4, 1];
    this.yRange = config.yRange ?? [-4, 4, 1];
    this.zRange = config.zRange ?? [-4, 4, 1];
    this.xLength = config.xLength ?? (this.xRange[1] - this.xRange[0]);
    this.yLength = config.yLength ?? (this.yRange[1] - this.yRange[0]);
    this.zLength = config.zLength ?? (this.zRange[1] - this.zRange[0]);
    const colors = config.axisColors ?? ["#FC6255", "#83C167", "#58C4DD"]; // x=red, y=green, z=blue
    const axisConfig = config.axisConfig ?? {};

    // Build three horizontal NumberLines then rotate y and z into place. Each
    // line's data value 0 sits at its center; we shift so the origin crosses at
    // the world origin.
    this.xAxis = new NumberLine({ ...axisConfig, xRange: this.xRange, length: this.xLength, color: colors[0] });
    this.yAxis = new NumberLine({ ...axisConfig, xRange: this.yRange, length: this.yLength, color: colors[1] });
    this.zAxis = new NumberLine({ ...axisConfig, xRange: this.zRange, length: this.zLength, color: colors[2] });

    this._xUnit = this.xAxis.getUnitSize();
    this._yUnit = this.yAxis.getUnitSize();
    this._zUnit = this.zAxis.getUnitSize();

    // y-axis: rotate +90deg about Z (world +y is up in-plane).
    this.yAxis.rotate(Math.PI / 2, { axis: V.OUT, aboutPoint: V.ORIGIN });
    // z-axis: rotate +90deg about -Y so its local +x maps to world +z.
    this.zAxis.rotate(Math.PI / 2, { axis: [0, -1, 0], aboutPoint: V.ORIGIN });

    // Shift each axis so its crossing REFERENCE sits at the world origin --
    // not unconditionally data-value 0 (issue #31: when a range doesn't
    // include 0, e.g. xRange: [1.1, 3.4], 0's mapped position sits off that
    // axis's own rendered segment, so the three axes never actually meet).
    // Mirrors the 2D Axes class's _xRef()/_yRef() fallback (also corrected
    // by this same fix -- see coordinate_systems.ts).
    this.xAxis.shift(V.neg(this._axisPointRaw(this.xAxis, this._xRef(), X_AXIS)));
    this.yAxis.shift(V.neg(this._axisPointRaw(this.yAxis, this._yRef(), [0, 1, 0])));
    this.zAxis.shift(V.neg(this._axisPointRaw(this.zAxis, this._zRef(), Z_AXIS)));

    this.add(this.xAxis, this.yAxis, this.zAxis);
  }

  // Data value used as each axis's crossing reference: 0 when it's actually
  // within the axis's configured range, otherwise the axis minimum. See the
  // 2D Axes class's _xRef()/_yRef() for the identical rule and its own
  // history (this check used to test `Number.isFinite(functionOf(0))`,
  // which only catches a true log-scale axis, not a plain linear range that
  // simply doesn't straddle 0).
  _xRef(): number { return this.xAxis.xMin <= 0 && 0 <= this.xAxis.xMax ? 0 : this.xAxis.xMin; }
  _yRef(): number { return this.yAxis.xMin <= 0 && 0 <= this.yAxis.xMax ? 0 : this.yAxis.xMin; }
  _zRef(): number { return this.zAxis.xMin <= 0 && 0 <= this.zAxis.xMax ? 0 : this.zAxis.xMin; }

  // World point of data value `v` along a rotated axis whose positive direction
  // is `dir` (its NumberLine measures along its own local x before rotation).
  _axisPointRaw(axis: NumberLine, v: number, dir: number[]): number[] {
    const s = axis.scaling.functionOf(v);
    const local = axis._leftX + (s - axis._sMin) * axis.unit;
    return [dir[0] * local, dir[1] * local, dir[2] * local];
  }

  // Data (x,y,z) -> world 3D point. Displacement from each axis's own
  // reference (see _xRef()/_yRef()/_zRef()), summed onto the shared origin --
  // same "reference, not hardcoded 0" fix as the constructor's shift above.
  coordsToPoint(x: number, y = 0, z = 0): number[] {
    const sx = this.xAxis.scaling.functionOf(x) - this.xAxis.scaling.functionOf(this._xRef());
    const sy = this.yAxis.scaling.functionOf(y) - this.yAxis.scaling.functionOf(this._yRef());
    const sz = this.zAxis.scaling.functionOf(z) - this.zAxis.scaling.functionOf(this._zRef());
    return [sx * this._xUnit, sy * this._yUnit, sz * this._zUnit];
  }
  c2p(x: number, y = 0, z = 0): number[] { return this.coordsToPoint(x, y, z); }

  // World 3D point -> data (x,y,z).
  pointToCoords(p: number[]): number[] {
    const invX = this.xAxis.scaling.inverseFunctionOf(p[0] / this._xUnit + this.xAxis.scaling.functionOf(this._xRef()));
    const invY = this.yAxis.scaling.inverseFunctionOf(p[1] / this._yUnit + this.yAxis.scaling.functionOf(this._yRef()));
    const invZ = this.zAxis.scaling.inverseFunctionOf(p[2] / this._zUnit + this.zAxis.scaling.functionOf(this._zRef()));
    return [invX, invY, invZ];
  }
  p2c(p: number[]): number[] { return this.pointToCoords(p); }

  getAxis(index: number): NumberLine {
    return [this.xAxis, this.yAxis, this.zAxis][index];
  }
  getXAxis(): NumberLine { return this.xAxis; }
  getYAxis(): NumberLine { return this.yAxis; }
  getZAxis(): NumberLine { return this.zAxis; }

  getOrigin(): number[] { return this.coordsToPoint(0, 0, 0); }

  getAxisLabels(xLabel: any = "x", yLabel: any = "y", zLabel: any = "z"): VGroup {
    const g = new VGroup();
    const mk = (text: any, at: number[]): VMobject => {
      // Accept either a ready mobject or a string label rendered as a small Line
      // marker (kept dependency-light; callers may pass real Text/MathTex).
      if (text && typeof text === "object" && (text as any).points) {
        (text as any).moveTo?.(at);
        return text as VMobject;
      }
      const marker = new Line(at, [at[0] + 0.001, at[1], at[2]], { color: "#FFFFFF" });
      (marker as any).label = String(text);
      return marker;
    };
    g.add(
      mk(xLabel, this.coordsToPoint(this.xRange[1], 0, 0)),
      mk(yLabel, this.coordsToPoint(0, this.yRange[1], 0)),
      mk(zLabel, this.coordsToPoint(0, 0, this.zRange[1])),
    );
    return g;
  }
}
