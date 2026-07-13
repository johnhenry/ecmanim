// ASS/SSA parity demo 01: continuous sweep karaoke (\kf/\K). Reuses the
// v1.5 golden-frame fixture (18-karaoke-kf.ass) unmodified -- one plain
// \kf line, one line using the \K alias, both sweeping secondary->primary
// color across each syllable's own duration via the same CompositeGroup+
// destination-in mask mechanism \clip uses.

import { Scene, loadASS } from "../../src/node.ts";
import { demoRender, loadFixtureText } from "./_run.ts";

class KaraokeSweep extends Scene {
  async construct() {
    const subs = loadASS(loadFixtureText("18-karaoke-kf.ass"), { width: 10 });
    subs.attachTo(this);
    await this.wait(subs.durationMs / 1000);
    console.log("warnings:", subs.warnings.length ? subs.warnings : "(none)");
  }
}

await demoRender(KaraokeSweep, import.meta.url);
