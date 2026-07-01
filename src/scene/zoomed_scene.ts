// A MovingCameraScene with a second "zoomed" camera region and an on-screen
// display that frames the magnified area. Mirrors ManimCommunity's
// manim/scene/zoomed_scene.py (which pairs a small camera + a display rectangle
// via a MultiCamera). Full render-to-texture compositing is out of scope; here
// the display is a structurally-correct rectangle positioned in a screen corner
// that visually frames the magnified region.

import { MovingCameraScene } from "./moving_camera_scene.ts";
import type { SceneConfig } from "./Scene.ts";
import { Rectangle } from "../mobject/geometry.ts";
import * as V from "../core/math/vector.ts";
import { WHITE } from "../core/color.ts";

export interface ZoomedSceneConfig extends SceneConfig {
  zoomFactor?: number;
  zoomedDisplayHeight?: number;
  zoomedDisplayWidth?: number;
  zoomedDisplayCenter?: number[] | null;
  zoomedDisplayCorner?: number[];
  zoomedDisplayCornerBuff?: number;
  zoomedCameraConfig?: { [key: string]: any };
  imageFrameStroke?: number;
  [key: string]: any;
}

export class ZoomedScene extends MovingCameraScene {
  zoomFactor: number;
  zoomedDisplayHeight: number;
  zoomedDisplayWidth: number;
  zoomedDisplayCenter: number[] | null;
  zoomedDisplayCorner: number[];
  zoomedDisplayCornerBuff: number;
  imageFrameStroke: number;
  // The small rectangle marking the region being magnified (in the main scene).
  zoomedCamera!: Rectangle;
  // The larger rectangle in a screen corner that shows the magnification.
  zoomedDisplay!: Rectangle;
  activated: boolean;

  constructor(config: ZoomedSceneConfig = {}) {
    super(config);
    this.zoomFactor = config.zoomFactor ?? 0.3;
    this.zoomedDisplayHeight = config.zoomedDisplayHeight ?? 3;
    this.zoomedDisplayWidth = config.zoomedDisplayWidth ?? 3;
    this.zoomedDisplayCenter = config.zoomedDisplayCenter ?? null;
    this.zoomedDisplayCorner = config.zoomedDisplayCorner ?? V.UR;
    this.zoomedDisplayCornerBuff = config.zoomedDisplayCornerBuff ?? 0.5;
    this.imageFrameStroke = config.imageFrameStroke ?? 3;
    this.activated = false;
    this.setupZoom();
  }

  // Build the (initially small) region rectangle and the corner display
  // rectangle. The region rectangle's size is the display size * zoomFactor.
  setupZoom(): void {
    const region = new Rectangle({
      width: this.zoomedDisplayWidth * this.zoomFactor,
      height: this.zoomedDisplayHeight * this.zoomFactor,
      strokeColor: WHITE,
      strokeWidth: this.imageFrameStroke,
      fillOpacity: 0,
    });
    this.zoomedCamera = region;

    const display = new Rectangle({
      width: this.zoomedDisplayWidth,
      height: this.zoomedDisplayHeight,
      strokeColor: WHITE,
      strokeWidth: this.imageFrameStroke,
      fillOpacity: 0,
    });
    if (this.zoomedDisplayCenter) display.moveTo(this.zoomedDisplayCenter);
    else display.toCorner(this.zoomedDisplayCorner, this.zoomedDisplayCornerBuff);
    this.zoomedDisplay = display;
  }

  /** The linear magnification of the display relative to the region. */
  getZoomFactor(): number {
    return this.zoomedCamera.getHeight() / this.zoomedDisplay.getHeight();
  }

  /** An animation that grows the display rectangle from the region into view. */
  getZoomInAnimation(config: { [key: string]: any } = {}): any {
    const start = this.zoomedCamera.copy() as Rectangle;
    start.moveTo(this.zoomedDisplay.getCenter());
    start.scaleToFitHeight(this.zoomedCamera.getHeight());
    return (this.zoomedDisplay as any).animate.become
      ? (this.zoomedDisplay as any).animate.become(this.zoomedDisplay)
      : (this.zoomedDisplay as any).animate.scale(1, config);
  }

  // Bring the zoom region + display into the scene. When `animate` is true,
  // grow the display in; otherwise add both immediately.
  async activateZooming(animate = false): Promise<this> {
    this.activated = true;
    this.add(this.zoomedCamera, this.zoomedDisplay);
    if (animate) {
      await this.play(
        (this.zoomedDisplay as any).animate.scale(1),
        (this.zoomedCamera as any).animate.scale(1),
      );
    }
    return this;
  }
}
