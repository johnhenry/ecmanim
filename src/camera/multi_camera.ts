// A camera that composites the views of several sub-cameras onto image
// mobjects. Mirrors ManimCommunity's manim/camera/multi_camera.py, which the
// ZoomedScene uses to render a magnified inset. This is a structural port: it
// tracks the (image mobject, sub-camera) pairs and can fit each sub-camera to
// its display rectangle. Full render-to-texture compositing (drawing each
// sub-camera's pixels into its image) is left to the backend.

import { Camera } from "../renderer/CanvasRenderer.ts";
import type { CameraConfig } from "../renderer/CanvasRenderer.ts";

export interface MultiCameraConfig extends CameraConfig {
  // Pairs of image mobjects to composite, each fed by a sub-camera.
  imageMobjectsFromCameras?: Array<{ imageMobject: any; camera: Camera }>;
  allowCameraRotation?: boolean;
}

export class MultiCamera extends Camera {
  // Each entry pairs a display image mobject with the camera that fills it.
  imageMobjects: Array<{ imageMobject: any; camera: Camera }>;
  allowCameraRotation: boolean;

  constructor(config: MultiCameraConfig = {}) {
    super(config);
    this.imageMobjects = [];
    this.allowCameraRotation = config.allowCameraRotation ?? true;
    for (const pair of config.imageMobjectsFromCameras ?? []) {
      this.addImageMobjectFromCamera(pair.imageMobject, pair.camera);
    }
  }

  /** Register an image mobject fed by a sub-camera, fitting it immediately. */
  addImageMobjectFromCamera(imageMobject: any, camera: Camera): this {
    this.imageMobjects.push({ imageMobject, camera });
    this.updateSubCameraToFitInFrame(imageMobject, camera);
    return this;
  }

  // Match a sub-camera's frame to the world-space size of its display image so
  // the magnified region maps 1:1 onto the display rectangle.
  updateSubCameraToFitInFrame(imageMobject: any, camera: Camera): void {
    if (!imageMobject || typeof imageMobject.getWidth !== "function") return;
    const w = imageMobject.getWidth();
    const h = imageMobject.getHeight();
    if (w > 0) camera.frameWidth = w;
    if (h > 0) camera.frameHeight = h;
    if (typeof imageMobject.getCenter === "function") {
      camera.frameCenter = imageMobject.getCenter();
    }
  }

  /** Re-fit every registered sub-camera (call after a display moves/resizes). */
  updateSubCamerasToFitInFrame(): this {
    for (const { imageMobject, camera } of this.imageMobjects) {
      this.updateSubCameraToFitInFrame(imageMobject, camera);
    }
    return this;
  }

  // On the main render pass, keep the sub-cameras in sync with their displays.
  preRender(): void {
    super.preRender();
    this.updateSubCamerasToFitInFrame();
  }
}
