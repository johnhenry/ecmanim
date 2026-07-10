// Port of Mermaid syntax docs: user journey — ref/userJourney.md, first full
// example (top of the doc, section "User Journey Diagram"), quoted verbatim
// in SOURCE.
//
// Reveal: revealDiagram journey staging (staggered spatial reveal of the
// task0..task4 markers + section scaffolding). Beat: Indicate the journey's
// low point, task2 "Do work" (score 1), with a caption.
//
// The loader now inlines mermaid's <style> CSS (score faces yellow, section
// fills) and extracts <text> labels (title, section names, task names).

import {
  Scene, Text, VGroup, loadMermaid, revealDiagram, FadeIn, Indicate,
} from "../../src/node.ts";
import { demoRender } from "./_run.ts";

const SOURCE = `journey
    title My working day
    section Go to work
      Make tea: 5: Me
      Go upstairs: 3: Me
      Do work: 1: Me, Cat
    section Go home
      Go downstairs: 5: Me
      Sit down: 5: Me`;

const INK = "#1f2328";

class JourneyDemo extends Scene {
  async construct() {
    const diagram = await loadMermaid(SOURCE);
    diagram.scale(1.15).shift([0, 0.4, 0]);
    this.add(diagram);

    await this.play(revealDiagram(diagram, { runTime: 2.6 }));
    await this.wait(0.3);

    // Beat: the journey's low point.
    const caption = new Text("Low point: Do work scores 1 of 5", {
      fontSize: 0.4, color: INK, point: [0, -3.3, 0],
    });
    await this.play(new FadeIn(caption, { runTime: 0.5 }));
    // Include task2's score face (the sad, lowest one) so the flash is seen.
    const t2x = diagram.byId("task2").getCenter()[0];
    const face = (diagram.submobjects as any[])
      .filter((m) => !m.__isDiagramLabel && Math.abs(m.getCenter()[0] - t2x) < 0.4 && m.getCenter()[1] < 0);
    const lowPoint = new VGroup(diagram.byId("task2"), ...face);
    await this.play(new Indicate(lowPoint, { scaleFactor: 1.35, color: "#e5484d", runTime: 1.2 }));
    await this.wait(1);
  }
}

await demoRender(JourneyDemo, import.meta.url);
