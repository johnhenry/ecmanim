// Showcase parity: VibrantSnap — screen-recording beautifier (auto zooms,
// cursor spotlight, pretty window chrome). Proves: DECLARATIVE zoom events
// compiled into springy MovingCamera keyframes, a cursor spotlight driven by
// a KeyframeTrack, and drop-shadowed window chrome (effects pass).

import {
  MovingCameraScene, VGroup, RoundedRectangle, Circle, Rectangle, Text,
  FadeIn, FadeOut, KeyframeTrack, springTiming,
} from "../../src/node.ts";
import { demoRender } from "./_run.ts";

// The VibrantSnap model: you RECORD plainly, then declare zoom beats.
const ZOOM_EVENTS = [
  { at: 1.2, center: [-2.2, 0.9, 0], zoom: 1.7, hold: 1.1 },
  { at: 3.6, center: [2.4, -0.9, 0], zoom: 1.9, hold: 1.2 },
];

// Cursor path as a keyframe track (positions over the whole take).
const CURSOR_TRACK = new KeyframeTrack<number[]>([
  { t: 0.0, value: [-4.5, 2.0, 0] },
  { t: 1.2, value: [-2.2, 0.9, 0] },
  { t: 2.6, value: [-0.4, 0.0, 0] },
  { t: 3.6, value: [2.4, -0.9, 0] },
  { t: 5.4, value: [3.6, -1.6, 0] },
  { t: 6.5, value: [0.5, -0.4, 0] },
]);

class VibrantSnap extends MovingCameraScene {
  async construct() {
    // Pretty window chrome with a deep drop shadow (the "beautified" look).
    const win = new VGroup(
      new RoundedRectangle({ width: 11.4, height: 6.6, cornerRadius: 0.3, color: "#FFFFFF", fillOpacity: 1, strokeWidth: 0, point: [0, -0.1, 0] }),
      new Rectangle({ width: 11.4, height: 0.66, color: "#EAECEF", fillOpacity: 1, strokeWidth: 0, point: [0, 2.87, 0] }),
      ...["#FF5F56", "#FFBD2E", "#27C93F"].map((c, i) =>
        new Circle({ radius: 0.09, color: c, fillOpacity: 1, strokeWidth: 0, point: [-5.1 + i * 0.34, 2.87, 0] })),
    );
    win.dropShadow(40, "#000000", 0, -0.18);

    // Fake document content.
    const doc = new VGroup(
      new Text("Quarterly report", { fontSize: 0.5, color: "#1A1D21", point: [-2.2, 1.6, 0] }),
      new Rectangle({ width: 4.2, height: 0.16, color: "#C9CED4", fillOpacity: 1, strokeWidth: 0, point: [-2.2, 0.9, 0] }),
      new Rectangle({ width: 3.6, height: 0.16, color: "#C9CED4", fillOpacity: 1, strokeWidth: 0, point: [-2.5, 0.45, 0] }),
      new RoundedRectangle({ width: 4.4, height: 2.6, cornerRadius: 0.15, color: "#E8F1FB", fillOpacity: 1, strokeWidth: 0, point: [2.4, -0.9, 0] }),
      new Text("+38%", { fontSize: 0.8, color: "#2563EB", point: [2.4, -0.9, 0] }),
    );

    // Cursor + soft spotlight halo that follows it.
    const cursor = new Circle({ radius: 0.09, color: "#1A1D21", fillOpacity: 1, strokeWidth: 0 });
    const spotlight = new Circle({ radius: 0.55, color: "#FFD700", fillOpacity: 0.28, strokeWidth: 0 });
    spotlight.addUpdater(() => {
      const p = CURSOR_TRACK.valueAt(Math.min(this.time, 6.5));
      spotlight.moveTo(p);
      cursor.moveTo(p);
    });

    await this.play(new FadeIn(win, { scale: 0.94 }), new FadeIn(doc), { runTime: 0.7 });
    this.add(spotlight, cursor);

    // Compile the declarative zoom events into springy camera moves.
    const frame = this.camera!.frame!;
    const timing = springTiming({ damping: 14, stiffness: 140 })({ fps: this.fps });
    let clock = 0.7;
    for (const ev of ZOOM_EVENTS) {
      if (ev.at > clock) { await this.wait(ev.at - clock); clock = ev.at; }
      const runTime = Math.min(timing.runTime ?? 0.8, 0.9);
      await this.play(
        frame.animate.scale(1 / ev.zoom / (frame.getWidth() / 14.22)).moveTo(ev.center),
        { runTime, rateFunc: timing.rateFunc },
      );
      clock += runTime;
      await this.wait(ev.hold);
      clock += ev.hold;
    }
    // Settle back out.
    await this.play(frame.animate.scale(14.22 / frame.getWidth()).moveTo([0, 0, 0]), { runTime: 0.8 });
    await this.wait(0.6);
    await this.play(new FadeOut(win), new FadeOut(doc), new FadeOut(cursor), new FadeOut(spotlight), { runTime: 0.6 });
  }
}

await demoRender(VibrantSnap, import.meta.url, { background: "#6E56CF" });
