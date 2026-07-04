// Packs many raster Text mobjects' bitmaps into one shared canvas (a texture
// atlas), so ThreeRenderer can draw all of them with ONE texture + ONE merged
// quad buffer instead of one THREE.Sprite (own CanvasTexture) per mobject --
// converting N draw calls into 1 for the common "many small text labels"
// case. Simple shelf packing: sort tallest-first, pack left-to-right into
// rows ("shelves"), wrap to a new shelf when a row would exceed maxWidth.
//
// Flagged honestly (per the item's own scoping note): texture-atlas packing
// has real edge cases -- this is a first-pass spike (padding to avoid
// filtering bleed between neighboring regions; no atlas reuse across frames
// yet, even for static text) that should be checked against actual visual
// output, not just this module's own unit tests, before leaning on it hard.

export interface AtlasRegion {
  mob: any;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  worldWidth: number;
  worldHeight: number;
  worldCenter: number[];
}

export interface TextAtlasResult {
  canvas: any;
  regions: AtlasRegion[];
}

export interface TextAtlasOptions {
  fontPx?: number;
  padding?: number;
  maxWidth?: number;
  /** Injectable Document, for environments where the global isn't set
   *  (matches this project's existing test-injection conventions). */
  documentRef?: any;
}

function fontStringFor(mob: any, fontPx: number): string {
  return `${mob.weight ?? "normal"} ${fontPx}px ${mob.font ?? "sans-serif"}`;
}

/** Returns null when there's no synchronous canvas/document backend
 *  available (matches ThreeRenderer._textSprite()'s existing headless
 *  skip), or when given no text mobjects. */
export function buildTextAtlas(textMobjects: any[], opts: TextAtlasOptions = {}): TextAtlasResult | null {
  const doc = opts.documentRef ?? (typeof document !== "undefined" ? document : null);
  if (!doc || textMobjects.length === 0) return null;

  const fontPx = opts.fontPx ?? 64;
  const padding = opts.padding ?? 2;
  const maxWidth = opts.maxWidth ?? 2048;

  const measureCanvas = doc.createElement("canvas");
  const mctx = measureCanvas.getContext("2d");

  const items = textMobjects.map((mob) => {
    const lines = String(mob.text ?? "").split("\n");
    mctx.font = fontStringFor(mob, fontPx);
    const w = Math.max(1, Math.ceil(Math.max(...lines.map((l: string) => mctx.measureText(l).width))));
    const h = Math.ceil(fontPx * 1.3 * lines.length);
    return { mob, lines, w, h };
  });

  // Shelf packing, tallest-first (fewer wasted rows than input order).
  const order = [...items].sort((a, b) => b.h - a.h);
  const placements: Array<{ item: (typeof items)[number]; x: number; y: number }> = [];
  let shelfX = 0, shelfY = 0, shelfH = 0, atlasW = 0;
  for (const item of order) {
    if (shelfX > 0 && shelfX + item.w + padding > maxWidth) {
      shelfY += shelfH + padding;
      shelfX = 0;
      shelfH = 0;
    }
    placements.push({ item, x: shelfX, y: shelfY });
    shelfX += item.w + padding;
    shelfH = Math.max(shelfH, item.h);
    atlasW = Math.max(atlasW, shelfX - padding);
  }
  const atlasH = shelfY + shelfH;

  const atlas = doc.createElement("canvas");
  atlas.width = Math.max(1, atlasW);
  atlas.height = Math.max(1, atlasH);
  const actx = atlas.getContext("2d");
  actx.textAlign = "center";
  actx.textBaseline = "middle";

  const regions: AtlasRegion[] = [];
  for (const { item, x, y } of placements) {
    const { mob, lines, w, h } = item;
    actx.font = fontStringFor(mob, fontPx);
    actx.fillStyle = mob.fillColor?.toRGBAString?.((mob.fillOpacity ?? 1) * (mob.opacity ?? 1)) ?? "#ffffff";
    lines.forEach((l: string, i: number) => actx.fillText(l, x + w / 2, y + fontPx * 1.3 * (i + 0.5)));

    const worldHeight = (mob.getHeight ? mob.getHeight() : 0) || mob.fontSize || 0.5;
    const worldWidth = worldHeight * (w / h);
    regions.push({
      mob,
      u0: x / atlas.width,
      v0: 1 - (y + h) / atlas.height,
      u1: (x + w) / atlas.width,
      v1: 1 - y / atlas.height,
      worldWidth,
      worldHeight,
      worldCenter: mob.getCenter ? mob.getCenter() : [0, 0, 0],
    });
  }

  return { canvas: atlas, regions };
}
