// Port of Mermaid syntax docs: timeline — ref/timeline.md, first full example
// (section "An example of a timeline"), quoted verbatim in SOURCE.
//
// Reveal: revealDiagram timeline staging (staggered spatial reveal — periods
// and their events sweep in left-to-right, top-to-bottom). Beat: Indicate the
// 2004 column (the year two platforms arrived) with a caption.
//
// The loader now inlines mermaid's <style> CSS (period/event boxes get the
// theme palette) and extracts <text> labels (title, years, platform names),
// attaching each label to its node-N group.

import {
  Scene, Text, VGroup, loadMermaid, revealDiagram, FadeIn, Indicate,
} from "../../src/node.ts";
import { demoRender } from "./_run.ts";

const SOURCE = `timeline
    title History of Social Media Platform
    2002 : LinkedIn
    2004 : Facebook
         : Google
    2005 : YouTube
    2006 : Twitter`;

const INK = "#1f2328";

class TimelineDemo extends Scene {
  async construct() {
    const diagram = await loadMermaid(SOURCE);
    diagram.scale(1.25).shift([0, 0.3, 0]);
    this.add(diagram);

    await this.play(revealDiagram(diagram, { runTime: 2.6 }));
    await this.wait(0.3);

    // Beat: 2004, the year two platforms arrived at once (labels included —
    // node-N byId groups carry their captions).
    const caption = new Text("2004: Facebook and Google arrive together", {
      fontSize: 0.4, color: INK, point: [0, -3.2, 0],
    });
    const col2004 = new VGroup(diagram.byId("node-2"), diagram.byId("node-3"), diagram.byId("node-4"));
    await this.play(new FadeIn(caption, { runTime: 0.5 }));
    await this.play(new Indicate(col2004, { scaleFactor: 1.18, color: "#d97706", runTime: 1.2 }));
    await this.wait(1);
  }
}

await demoRender(TimelineDemo, import.meta.url);
