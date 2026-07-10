// Pixel-array normalization for ImageMobject-from-array (manim's
// `ImageMobject(np.uint8([[...]]))`). Pure and isomorphic: turns nested
// grayscale/RGB(A) arrays into {width, height, data} RGBA bytes; the
// backend-specific half (making a drawable canvas) lives in node.ts /
// browser entry points.

export interface NormalizedPixels {
  width: number;
  height: number;
  /** RGBA, row-major, width*height*4 bytes. */
  data: Uint8ClampedArray;
}

const clampByte = (v: number): number => Math.max(0, Math.min(255, Math.round(v)));

/**
 * Accepts:
 *  - 2D array of numbers  -> grayscale (`[[0, 64, 255], ...]`)
 *  - 3D array [h][w][3|4] -> RGB / RGBA
 *  - typed arrays inside are fine (anything indexable with .length)
 */
export function normalizePixelArray(array: any): NormalizedPixels {
  if (!array?.length || !array[0]?.length) {
    throw new Error("imageFromArray: expected a non-empty 2D (grayscale) or 3D (RGB/RGBA) array");
  }
  const height = array.length;
  const width = array[0].length;
  const first = array[0][0];
  const channels = typeof first === "number" ? 1 : first?.length;
  if (channels !== 1 && channels !== 3 && channels !== 4) {
    throw new Error(`imageFromArray: pixels must be numbers (grayscale) or [r,g,b(,a)] — got ${JSON.stringify(first)}`);
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = array[y];
    if (row.length !== width) throw new Error(`imageFromArray: ragged rows (row ${y} has ${row.length}, expected ${width})`);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (channels === 1) {
        const v = clampByte(row[x]);
        data[o] = v; data[o + 1] = v; data[o + 2] = v; data[o + 3] = 255;
      } else {
        const px = row[x];
        data[o] = clampByte(px[0]);
        data[o + 1] = clampByte(px[1]);
        data[o + 2] = clampByte(px[2]);
        data[o + 3] = channels === 4 ? clampByte(px[3]) : 255;
      }
    }
  }
  return { width, height, data };
}
