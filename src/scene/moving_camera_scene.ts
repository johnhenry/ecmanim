// A scene whose camera viewport is driven by an animatable "frame" mobject.
// Mirrors ManimCommunity's manim/scene/moving_camera_scene.py (paired with the
// MovingCamera in manim/camera/moving_camera.py). Because the renderer's Camera
// exposes `frame` + preRender(), animating this frame (scale/moveTo) pans and
// zooms the view: `scene.play(scene.camera.frame.animate.scale(0.5).moveTo(p))`.

import { Scene } from "./Scene.ts";
import type { SceneConfig } from "./Scene.ts";
import { Rectangle } from "../mobject/geometry.ts";
import type { Camera } from "../renderer/CanvasRenderer.ts";
import type { Mobject } from "../mobject/Mobject.ts";
import * as V from "../core/math/vector.ts";
import { ApplyMethod } from "../animation/Animation.ts";
import type { AnimationConfig } from "../animation/Animation.ts";

/**
 * A named camera viewpoint (center/width/height/zoom), recalled via
 * `goToCameraStop()`. `zoom` here is a scale factor applied to the frame's
 * OWN width/height (`frame.animate.scale(1/zoom)`) — a DIFFERENT concept
 * from the interactive camera's `camera.zoom` multiplier
 * (`src/studio/interactive.ts`), which instead scales the projection at
 * render time without touching the frame mobject's own geometry. Don't
 * conflate the two.
 */
export interface CameraStop {
  center?: number[];
  width?: number;
  height?: number;
  zoom?: number;
}

/**
 * A Rectangle sized to (a fraction of) the camera frame, invisible by default.
 * Handy for masking / marking a region of the screen. The `frame` is optional;
 * when omitted, it falls back to the default manim frame dimensions.
 */
export class ScreenRectangle extends Rectangle {
  constructor(
    config: {
      aspectRatio?: number;
      height?: number;
      width?: number;
      strokeWidth?: number;
      fillOpacity?: number;
      [key: string]: any;
    } = {},
  ) {
    const aspectRatio = config.aspectRatio ?? 16 / 9;
    const height = config.height ?? 4;
    const width = config.width ?? height * aspectRatio;
    super({ ...config, width, height });
    // Invisible by default (a region marker), like manim's ScreenRectangle.
    this.strokeWidth = config.strokeWidth ?? 0;
    this.fillOpacity = config.fillOpacity ?? 0;
  }
}

/** A ScreenRectangle sized to the full default manim frame (14.222 x 8). */
export class FullScreenRectangle extends ScreenRectangle {
  constructor(config: { [key: string]: any } = {}) {
    super({ height: 8, width: 14.222222222222221, ...config });
  }
}

/**
 * A scene whose camera has an animatable `frame` mobject. The frame is a
 * Rectangle matching the current viewport (frameWidth x frameHeight centered at
 * frameCenter). play()ing an animation on it moves its points; the renderer's
 * preRender() then syncs the viewport to those points each frame.
 */
export class MovingCameraScene extends Scene {
  constructor(config: SceneConfig = {}) {
    super(config);
    this.setupFrame();
  }

  // Create `this.camera.frame` (idempotent). Reads the current camera geometry
  // so it matches whatever resolution/frame the backend configured.
  setupFrame(): void {
    const cam = this.camera as Camera | null;
    if (!cam) return;
    if (cam.frame) return;
    const frame = new Rectangle({
      width: cam.frameWidth,
      height: cam.frameHeight,
      strokeWidth: 0,
      fillOpacity: 0,
    });
    frame.moveTo(V.clone(cam.frameCenter));
    // Marks the frame as a rotatable camera rect: the renderer's preRender()
    // derives frameWidth/frameHeight/rotation from its corner anchors (so
    // `frame.animate.rotate(a)` rolls the camera) instead of the rotation-
    // blind axis-aligned bounding box.
    (frame as any).__isCameraFrameRect = true;
    cam.frame = frame;
    this._initialFrameState = {
      center: V.clone(cam.frameCenter),
      width: cam.frameWidth,
      height: cam.frameHeight,
    };
  }

  private _initialFrameState?: { center: number[]; width: number; height: number };

  /**
   * Animate the camera to center on a mobject or point (Motion Canvas's
   * `camera().centerOn(node, dur)`). Pure frame movement -- zoom/rotation
   * are untouched.
   */
  async centerOn(target: Mobject | number[], config: AnimationConfig = {}): Promise<this> {
    const point = Array.isArray(target) ? [...target] : target.getCenter();
    const frame = this.getFrame();
    const anim = new ApplyMethod(frame, function (this: any): void {
      this.moveTo(point);
    });
    if (config.runTime != null) anim.runTime = config.runTime;
    if (config.rateFunc != null) anim.rateFunc = config.rateFunc;
    await this.play(anim);
    return this;
  }

  /**
   * Animate the camera roll by `angle` radians (Motion Canvas's
   * `camera().rotation(deg, dur)`, additive). Sugar over rotating the frame
   * mobject; preRender() picks the roll up from its corners.
   */
  async rotateCamera(angle: number, config: AnimationConfig = {}): Promise<this> {
    const frame = this.getFrame();
    const anim = new ApplyMethod(frame, function (this: any): void {
      this.rotate(angle);
    });
    if (config.runTime != null) anim.runTime = config.runTime;
    if (config.rateFunc != null) anim.rateFunc = config.rateFunc;
    await this.play(anim);
    return this;
  }

  /**
   * Animate the camera back to its initial viewport (Motion Canvas's
   * `camera().reset(dur)`): center, size, and zero roll as they were when
   * the frame was created.
   */
  async resetCamera(config: AnimationConfig = {}): Promise<this> {
    const init = this._initialFrameState;
    const frame = this.getFrame();
    if (!init) return this;
    // Current roll, derived the same way the renderer does (first-edge angle
    // vs the Rectangle's rest -x direction) so the un-rotation is exact.
    const sp = frame.getSubpaths()[0];
    let roll = sp && sp.length >= 4
      ? Math.atan2(sp[3][1] - sp[0][1], sp[3][0] - sp[0][0]) - Math.PI
      : 0;
    // Same (-pi, pi] normalization the renderer's preRender() applies.
    roll = ((roll % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    if (roll > Math.PI) roll -= 2 * Math.PI;
    const anim = new ApplyMethod(frame, function (this: any): void {
      if (roll !== 0) this.rotate(-roll);
      this.setWidth(init.width, true);
      this.setHeight(init.height, true);
      this.moveTo(init.center);
    });
    if (config.runTime != null) anim.runTime = config.runTime;
    if (config.rateFunc != null) anim.rateFunc = config.rateFunc;
    await this.play(anim);
    return this;
  }

  /** The camera's frame mobject (creating it if the camera was set late). */
  getFrame(): Rectangle {
    this.setupFrame();
    return (this.camera as Camera).frame as Rectangle;
  }

  private _cameraStops = new Map<string, CameraStop>();

  /** Name a camera viewpoint, recallable later via `goToCameraStop(name)`. */
  defineCameraStop(name: string, stop: CameraStop): this {
    this._cameraStops.set(name, stop);
    return this;
  }

  /**
   * Animate the camera frame to a previously-defined stop. Pure sugar over
   * `camera.frame.animate.moveTo()/setWidth()/setHeight()` -- applied as a
   * SINGLE ApplyMethod (not one animation per field) so multiple fields
   * changing at once compose correctly instead of racing to overwrite the
   * same frame mobject's points each tick.
   */
  async goToCameraStop(name: string, config: AnimationConfig = {}): Promise<this> {
    const stop = this._cameraStops.get(name);
    if (!stop) throw new Error(`goToCameraStop: no camera stop named "${name}"`);
    const frame = this.getFrame();
    // Config fields are set directly on the built Animation rather than
    // passed into ApplyMethod's constructor -- its trailing-args config
    // detection only fires for objects marked `_animConfig` (never actually
    // set anywhere in this codebase), so a plain config object passed as a
    // constructor arg would silently be treated as an extra method argument
    // instead of runTime/rateFunc, same pattern transitions.ts's
    // buildTransition() already uses for exactly this reason.
    const anim = new ApplyMethod(frame, function (this: any): void {
      if (stop.center) this.moveTo(stop.center);
      // stretch=true: setWidth/setHeight default to aspect-preserving uniform
      // rescale, which would let a subsequent setHeight() undo the width just
      // set. A camera stop specifies width/height independently, so scale
      // each axis on its own.
      if (stop.width != null) this.setWidth(stop.width, true);
      if (stop.height != null) this.setHeight(stop.height, true);
      if (stop.zoom != null) this.scale(1 / stop.zoom);
    });
    if (config.runTime != null) anim.runTime = config.runTime;
    if (config.rateFunc != null) anim.rateFunc = config.rateFunc;
    await this.play(anim);
    return this;
  }
}
