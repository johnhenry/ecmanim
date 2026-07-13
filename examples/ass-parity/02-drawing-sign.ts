// ASS/SSA parity demo 02: \p<n> drawing-mode dialogue lines (fansub sign/
// logo redraws). Reuses the v2 golden-frame fixture (22-drawing-p.ass) --
// a triangle drawn via the m/l mini-language, held static then rotated
// via \frz, rendered as a real VMobject (not a raster image).

import { Scene, loadASS } from "../../src/node.ts";
import { demoRender, loadFixtureText } from "./_run.ts";

class DrawingSign extends Scene {
  async construct() {
    const subs = loadASS(loadFixtureText("22-drawing-p.ass"), { width: 13 });
    subs.attachTo(this);
    await this.wait(subs.durationMs / 1000);
    console.log("warnings:", subs.warnings.length ? subs.warnings : "(none)");
  }
}

await demoRender(DrawingSign, import.meta.url);
