// Port of Mermaid syntax docs: quadrant chart — ref/quadrantChart.md, first
// full example (section "Example"), quoted verbatim in SOURCE.
//
// Reveal: revealDiagram quadrant staging (staggered spatial reveal — mermaid
// emits no per-element ids for quadrant charts, so parts are spatial units).
// Beat: Indicate Campaign C, the point in the "We should expand" quadrant.
//
// The loader now extracts all quadrant <text> (title, axis labels, quadrant
// names, campaign labels) and keeps the inline pastel quadrant fills. The
// beat finds Campaign C's dot as the un-id'd leaf nearest its label.

import {
  Scene, Text, VGroup, loadMermaid, revealDiagram, FadeIn, Indicate,
} from "../../src/node.ts";
import { demoRender } from "./_run.ts";

const SOURCE = `quadrantChart
    title Reach and engagement of campaigns
    x-axis Low Reach --> High Reach
    y-axis Low Engagement --> High Engagement
    quadrant-1 We should expand
    quadrant-2 Need to promote
    quadrant-3 Re-evaluate
    quadrant-4 May be improved
    Campaign A: [0.3, 0.6]
    Campaign B: [0.45, 0.23]
    Campaign C: [0.57, 0.69]
    Campaign D: [0.78, 0.34]
    Campaign E: [0.40, 0.34]
    Campaign F: [0.35, 0.78]`;

const INK = "#1f2328";

class QuadrantDemo extends Scene {
  async construct() {
    const diagram = await loadMermaid(SOURCE);
    diagram.scale(0.85).shift([0, -0.1, 0]);
    this.add(diagram);

    await this.play(revealDiagram(diagram, { runTime: 2.4 }));
    await this.wait(0.3);

    // Beat: the standout campaign in the expand quadrant — its extracted
    // label plus the dot nearest to it.
    const labelC = (diagram.labels().submobjects as any[]).find((t) => t.text === "Campaign C");
    const dots = (diagram.submobjects as any[]).filter(
      (m) => !m.__isDiagramLabel && m.getWidth() < 0.4 && m.getWidth() > 0.03,
    );
    const c = labelC.getCenter();
    const dot = [...dots].sort((a, b) =>
      Math.hypot(a.getCenter()[0] - c[0], a.getCenter()[1] - c[1]) -
      Math.hypot(b.getCenter()[0] - c[0], b.getCenter()[1] - c[1]))[0];
    const caption = new Text("Campaign C: high on both axes — expand", {
      fontSize: 0.34, color: INK, point: [0, -3.75, 0],
    });
    await this.play(new FadeIn(caption, { runTime: 0.5 }));
    await this.play(new Indicate(new VGroup(dot, labelC), { scaleFactor: 1.4, color: "#d97706", runTime: 1.2 }));
    await this.wait(1);
  }
}

await demoRender(QuadrantDemo, import.meta.url);
