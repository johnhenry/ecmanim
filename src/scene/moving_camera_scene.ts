// A scene whose camera viewport is driven by an animatable "frame" mobject.
// Mirrors ManimCommunity's manim/scene/moving_camera_scene.py (paired with the
// MovingCamera in manim/camera/moving_camera.py). Because the renderer's Camera
// exposes `frame` + preRender(), animating this frame (scale/moveTo) pans and
// zooms the view: `scene.play(scene.camera.frame.animate.scale(0.5).moveTo(p))`.

import { Scene } from "./Scene.ts";
import type { SceneConfig } from "./Scene.ts";
import { Rectangle } from "../mobject/geometry.ts";
import type { Camera } from "../renderer/CanvasRenderer.ts";
import * as V from "../core/math/vector.ts";

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
    cam.frame = frame;
  }

  /** The camera's frame mobject (creating it if the camera was set late). */
  getFrame(): Rectangle {
    this.setupFrame();
    return (this.camera as Camera).frame as Rectangle;
  }
}
