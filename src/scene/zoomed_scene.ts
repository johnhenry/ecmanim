// ZoomedScene: a second camera whose small `frame` marks a source region of
// the scene, and a `zoomedDisplay` rectangle elsewhere on screen showing that
// region MAGNIFIED — real render-to-region compositing, mirroring
// ManimCommunity's manim/scene/zoomed_scene.py (MultiCamera +
// ImageMobjectFromCamera).
//
// How the compositing works: the display mobject is tagged
// `_isZoomedDisplay` and carries a reference to the source frame; the
// CanvasRenderer special-cases it (drawZoomedDisplay) by re-rendering the
// scene's top-level mobjects through a derived Camera (frameWidth/Height/
// Center taken from the live source frame) into the display's pixel rect
// every frame. Canvas backends only — SVG/GL draw the border and skip the
// blit (same silent-skip convention as effects/particles).

import { MovingCameraScene } from "./moving_camera_scene.ts";
import type { SceneConfig } from "./Scene.ts";
import { Mobject } from "../mobject/Mobject.ts";
import { Rectangle } from "../mobject/geometry.ts";
import { Restore } from "../animation/transform_extra.ts";
import { ApplyMethod } from "../animation/Animation.ts";
import * as V from "../core/math/vector.ts";
import { WHITE } from "../core/color.ts";

export interface ZoomedSceneConfig extends SceneConfig {
  zoomFactor?: number;
  zoomedDisplayHeight?: number;
  zoomedDisplayWidth?: number;
  zoomedDisplayCenter?: number[] | null;
  zoomedDisplayCorner?: number[];
  zoomedDisplayCornerBuff?: number;
  /** manim's zoomed_camera_config: defaultFrameStrokeWidth/Color style the
   *  SOURCE frame rectangle. */
  zoomedCameraConfig?: {
    defaultFrameStrokeWidth?: number;
    defaultFrameStrokeColor?: any;
    background?: any;
    [key: string]: any;
  };
  /** manim's zoomed_camera_frame_starting_position. */
  zoomedCameraFrameStartingPosition?: number[];
  imageFrameStroke?: number;
  [key: string]: any;
}

/** The magnified-view mobject: a positioned rect the renderer fills by
 *  re-rendering the source frame's region. Its one child is the border. */
export class ZoomedDisplay extends Mobject {
  _isZoomedDisplay = true;
  _sourceFrame: Rectangle;
  displayFrame: Rectangle;

  constructor(width: number, height: number, sourceFrame: Rectangle, strokeWidth: number) {
    super();
    this._sourceFrame = sourceFrame;
    // 4-corner box (TL, TR, BR, BL) — same convention as ImageMobject.
    this.points = [
      [-width / 2, height / 2, 0],
      [width / 2, height / 2, 0],
      [width / 2, -height / 2, 0],
      [-width / 2, -height / 2, 0],
    ];
    this.displayFrame = new Rectangle({
      width, height,
      strokeColor: WHITE,
      strokeWidth,
      fillOpacity: 0,
    });
    this.add(this.displayFrame);
  }
}

export class ZoomedScene extends MovingCameraScene {
  zoomFactor: number;
  zoomedDisplayHeight: number;
  zoomedDisplayWidth: number;
  zoomedDisplayCenter: number[] | null;
  zoomedDisplayCorner: number[];
  zoomedDisplayCornerBuff: number;
  imageFrameStroke: number;
  zoomedCameraConfig: NonNullable<ZoomedSceneConfig["zoomedCameraConfig"]>;
  /** manim shape: `this.zoomedCamera.frame` is the SOURCE region rectangle. */
  zoomedCamera!: { frame: Rectangle };
  zoomedDisplay!: ZoomedDisplay;
  activated: boolean;

  constructor(config: ZoomedSceneConfig = {}) {
    super(config);
    this.zoomFactor = config.zoomFactor ?? 0.3;
    this.zoomedDisplayHeight = config.zoomedDisplayHeight ?? 3;
    this.zoomedDisplayWidth = config.zoomedDisplayWidth ?? 3;
    this.zoomedDisplayCenter = config.zoomedDisplayCenter ?? null;
    this.zoomedDisplayCorner = config.zoomedDisplayCorner ?? V.UR;
    this.zoomedDisplayCornerBuff = config.zoomedDisplayCornerBuff ?? 0.5;
    this.zoomedCameraConfig = config.zoomedCameraConfig ?? {};
    this.imageFrameStroke = config.imageFrameStroke ?? 3;
    this.activated = false;
    this.setupZoom(config);
  }

  setupZoom(config: ZoomedSceneConfig = {}): void {
    // The SOURCE region: display size scaled down by zoomFactor.
    const frame = new Rectangle({
      width: this.zoomedDisplayWidth * this.zoomFactor,
      height: this.zoomedDisplayHeight * this.zoomFactor,
      strokeColor: this.zoomedCameraConfig.defaultFrameStrokeColor ?? WHITE,
      strokeWidth: this.zoomedCameraConfig.defaultFrameStrokeWidth ?? 3,
      fillOpacity: 0,
    });
    if (config.zoomedCameraFrameStartingPosition) {
      frame.moveTo(config.zoomedCameraFrameStartingPosition);
    }
    this.zoomedCamera = { frame };

    const display = new ZoomedDisplay(
      this.zoomedDisplayWidth,
      this.zoomedDisplayHeight,
      frame,
      this.imageFrameStroke,
    );
    if (this.zoomedDisplayCenter) display.moveTo(this.zoomedDisplayCenter);
    else display.toCorner(this.zoomedDisplayCorner, this.zoomedDisplayCornerBuff);
    // Keep the border glued to the display box wherever it moves/scales.
    display.displayFrame.addUpdater(() => {
      const [cx, cy] = display.getCenter();
      const w = display.getWidth();
      const h = display.getHeight();
      display.displayFrame.setPointsAsCorners([
        [cx - w / 2, cy + h / 2, 0],
        [cx + w / 2, cy + h / 2, 0],
        [cx + w / 2, cy - h / 2, 0],
        [cx - w / 2, cy - h / 2, 0],
        [cx - w / 2, cy + h / 2, 0],
      ]);
    });
    this.zoomedDisplay = display;
  }

  /** The linear magnification the display applies to the framed region. */
  getZoomFactor(): number {
    return this.zoomedCamera.frame.getHeight() / this.zoomedDisplay.getHeight();
  }

  /** manim parity: the frame starts full-screen and shrinks onto its region. */
  getZoomInAnimation(config: { [key: string]: any } = {}): any {
    const frame = this.zoomedCamera.frame;
    const cam = this.camera as any;
    frame.saveState();
    const w = cam?.frameWidth ?? 14.22;
    const h = cam?.frameHeight ?? 8;
    frame.stretch(w / Math.max(1e-12, frame.getWidth()), 0);
    frame.stretch(h / Math.max(1e-12, frame.getHeight()), 1);
    frame.moveTo([0, 0, 0]);
    const anim = new ApplyMethod(frame, "restore");
    anim.runTime = config.runTime ?? 2;
    return anim;
  }

  /** manim parity: the display "pops out" of the frame to its screen spot. */
  getZoomedDisplayPopOutAnimation(config: { [key: string]: any } = {}): any {
    const display = this.zoomedDisplay;
    display.saveState();
    display.replace(this.zoomedCamera.frame, { stretch: true });
    const anim = new Restore(display);
    if (config.runTime != null) anim.runTime = config.runTime;
    return anim;
  }

  /** Add the frame + display (optionally with manim's two-step entrance). */
  async activateZooming(animate = false): Promise<this> {
    this.activated = true;
    this.add(this.zoomedCamera.frame);
    this.addForegroundMobject(this.zoomedDisplay);
    if (animate) {
      await this.play(this.getZoomInAnimation());
      await this.play(this.getZoomedDisplayPopOutAnimation());
    }
    return this;
  }
}
