// A raster image placed in the scene. The image itself is a drawable bitmap
// (an @napi-rs/canvas Image in Node, an HTMLImageElement / ImageBitmap in the
// browser); load it with the backend's loadImage() helper and pass it in. Like
// Text, it carries a 4-corner bounding box so positioning/scaling work, and the
// renderer special-cases it (drawImage / textured quad).

import { Mobject } from "./Mobject.js";

export class ImageMobject extends Mobject {
  constructor(image, config = {}) {
    super(config);
    this._isImage = true;
    this.image = image;
    const iw = image?.width ?? config.imageWidth ?? 1;
    const ih = image?.height ?? config.imageHeight ?? 1;
    this.aspect = ih === 0 ? 1 : iw / ih;

    let h = config.height;
    let w = config.width;
    if (h == null && w == null) h = 2;
    if (h == null) h = w / this.aspect;
    if (w == null) w = h * this.aspect;

    // Corners: TL, TR, BR, BL (matches how the renderer reads the box).
    this.points = [
      [-w / 2, h / 2, 0],
      [w / 2, h / 2, 0],
      [w / 2, -h / 2, 0],
      [-w / 2, -h / 2, 0],
    ];
    this.opacity = config.opacity ?? 1;
    if (config.point) this.moveTo(config.point);
  }

  setImage(image) {
    this.image = image;
    return this;
  }

  copy() {
    const c = super.copy();
    c.image = this.image; // share the bitmap
    return c;
  }
}
