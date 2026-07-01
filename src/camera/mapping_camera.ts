// A camera that distorts points through an arbitrary mapping function before
// projecting them. Mirrors ManimCommunity's manim/camera/mapping_camera.py,
// which applies a point-wise transform (e.g. a complex map) to every mobject
// vertex as it is drawn. Here the mapping is folded into toPixel so it composes
// with the base world->pixel projection with no other changes to the renderer.

import { Camera } from "../renderer/CanvasRenderer.ts";
import type { CameraConfig } from "../renderer/CanvasRenderer.ts";

export interface MappingCameraConfig extends CameraConfig {
  // World-point -> world-point distortion, applied before projection.
  mappingFunc?: (p: number[]) => number[];
  // Names of mobject transform classes this camera is allowed to remap
  // (parity with manim; advisory here).
  allowedTransformClasses?: any[];
  minNumCurves?: number;
}

export class MappingCamera extends Camera {
  mappingFunc: (p: number[]) => number[];
  allowedTransformClasses: any[];
  minNumCurves: number;

  constructor(config: MappingCameraConfig = {}) {
    super(config);
    // Identity by default — a MappingCamera with no func behaves like Camera.
    this.mappingFunc = config.mappingFunc ?? ((p: number[]) => p);
    this.allowedTransformClasses = config.allowedTransformClasses ?? [];
    this.minNumCurves = config.minNumCurves ?? 50;
  }

  // Distort the world point through mappingFunc, then project it like the base
  // camera. A vertex-level distortion, so straight edges bend piecewise.
  toPixel(p: number[]): [number, number] {
    const mapped = this.mappingFunc(p);
    const q = [mapped[0] ?? 0, mapped[1] ?? 0, mapped[2] ?? 0];
    return super.toPixel(q);
  }
}
