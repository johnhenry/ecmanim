// 3D support for the Canvas-2D renderer — no GPU/WebGL/Three.js. A ThreeDCamera
// subclasses the 2D Camera and overrides toPixel() to rotate world points by the
// camera orientation and apply weak perspective, so the existing bezier renderer
// draws 3D with zero renderer changes (the same technique manim's Cairo renderer
// uses). ThreeDScene adds camera-orientation animation and ambient rotation.

import { Camera } from "../renderer/CanvasRenderer.js";
import { Scene } from "./Scene.js";
import { VGroup } from "../mobject/VMobject.js";
import { Line } from "../mobject/geometry.js";
import * as V from "../core/math/vector.js";
import { smooth } from "../animation/rate_functions.js";

const Z_AXIS = [0, 0, 1];
const X_AXIS = [1, 0, 0];

export class ThreeDCamera extends Camera {
  constructor(config = {}) {
    super(config);
    // phi: polar angle measured from the +z axis (0 = looking straight down the
    // z-axis onto the xy-plane). theta: azimuthal angle; -90deg keeps the xy-plane
    // upright and un-mirrored (matching the plain 2D view).
    this.phi = config.phi ?? 0;
    this.theta = config.theta ?? -90 * V.DEGREES;
    this.focalDistance = config.focalDistance ?? 20;
    this.zoom = config.zoom ?? 1;
    this.frameCenter = config.frameCenter ?? [0, 0, 0];
  }

  // Rotate a world point into camera space. The reference orientation
  // (theta = -90deg, phi = 0) leaves the xy-plane upright: z-rotation by
  // -(theta + 90deg) then x-rotation by -phi. Returns [cx, cy, cz] where cz is
  // depth toward the viewer (larger cz = nearer the camera).
  toCameraSpace(p) {
    const rel = [
      p[0] - this.frameCenter[0],
      p[1] - this.frameCenter[1],
      p[2] - this.frameCenter[2],
    ];
    const spun = V.rotateVector(rel, -(this.theta + 90 * V.DEGREES), Z_AXIS);
    return V.rotateVector(spun, -this.phi, X_AXIS);
  }

  // Camera-space depth toward the viewer (for painter sorting).
  projectionDepth(p) {
    return this.toCameraSpace(p)[2];
  }

  // World [x,y,z] -> pixel [px, py]. Weak-perspective divide by focal distance,
  // then the same frame->pixel mapping (with y-flip) as the base Camera.
  toPixel(p) {
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

  setOrientation({ phi, theta, zoom, focalDistance } = {}) {
    if (phi != null) this.phi = phi;
    if (theta != null) this.theta = theta;
    if (zoom != null) this.zoom = zoom;
    if (focalDistance != null) this.focalDistance = focalDistance;
    return this;
  }
}

export class ThreeDScene extends Scene {
  constructor(config = {}) {
    super(config);
    if (!(this.camera instanceof ThreeDCamera)) {
      const base = this.camera ?? {};
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
  }

  setCameraOrientation(opts = {}) {
    this.camera.setOrientation(opts);
    return this;
  }

  // Smoothly tween phi/theta/zoom/focalDistance over runTime seconds.
  async moveCamera({ phi, theta, zoom, focalDistance } = {}, { runTime = 3, rateFunc = smooth } = {}) {
    const cam = this.camera;
    const start = { phi: cam.phi, theta: cam.theta, zoom: cam.zoom, focalDistance: cam.focalDistance };
    const target = {
      phi: phi ?? start.phi,
      theta: theta ?? start.theta,
      zoom: zoom ?? start.zoom,
      focalDistance: focalDistance ?? start.focalDistance,
    };
    const nFrames = Math.max(1, Math.round(runTime * this.fps));
    const dt = runTime / nFrames;
    for (let f = 1; f <= nFrames; f++) {
      const a = rateFunc(f / nFrames);
      cam.phi = start.phi + (target.phi - start.phi) * a;
      cam.theta = start.theta + (target.theta - start.theta) * a;
      cam.zoom = start.zoom + (target.zoom - start.zoom) * a;
      cam.focalDistance = start.focalDistance + (target.focalDistance - start.focalDistance) * a;
      this.updateMobjects(dt);
      this.time += dt;
      await this.emitFrame();
    }
    return this;
  }

  beginAmbientCameraRotation({ rate = 0.02, about = "theta" } = {}) {
    this._ambientOn = true;
    this._ambientRate = rate;
    this._ambientField = about;
    return this;
  }

  stopAmbientCameraRotation() {
    this._ambientOn = false;
    return this;
  }

  updateMobjects(dt) {
    if (this._ambientOn) this.camera[this._ambientField] += this._ambientRate * dt;
    super.updateMobjects(dt);
  }

  // Optional painter's-depth sorting: order top-level mobjects so nearer ones
  // draw last. Robust to mobjects without points.
  enableDepthSorting(on = true) {
    this._depthSort = on;
    return this;
  }

  async emitFrame() {
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

// Three number-line-style axes (x, y, z) crossing the origin. The z-axis uses
// points with a real z-component; the camera projects everything.
export class ThreeDAxes extends VGroup {
  constructor(config = {}) {
    super();
    const xr = config.xRange ?? [-4, 4, 1];
    const yr = config.yRange ?? [-4, 4, 1];
    const zr = config.zRange ?? [-4, 4, 1];
    const colors = config.axisColors ?? ["#FC6255", "#83C167", "#58C4DD"]; // x=red, y=green, z=blue

    this.xAxis = new Line([xr[0], 0, 0], [xr[1], 0, 0], { color: colors[0], strokeColor: colors[0] });
    this.yAxis = new Line([0, yr[0], 0], [0, yr[1], 0], { color: colors[1], strokeColor: colors[1] });
    this.zAxis = new Line([0, 0, zr[0]], [0, 0, zr[1]], { color: colors[2], strokeColor: colors[2] });

    this.add(this.xAxis, this.yAxis, this.zAxis);
  }
}
