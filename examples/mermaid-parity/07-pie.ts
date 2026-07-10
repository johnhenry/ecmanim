// Port of Mermaid syntax docs: pie chart — ref/pie.md, first full example
// (top of the doc, section "Pie chart diagrams"), quoted verbatim in SOURCE.
//
// Reveal: revealDiagram's pie staging — GrowFromCenter per part (the
// documented pie default now reaches un-id'd parts). Slices render as real
// arcs (the path parser converts `A` commands to cubics), the <style> CSS
// palette is inlined (no black outer circle), and title/legend/percentage
// <text> is extracted by the loader.
// Beat: caption with the top value (slices carry no ids to Indicate).

import { Scene, Text, FadeIn, Indicate, loadMermaid, revealDiagram } from "../../src/node.ts";
import { demoRender } from "./_run.ts";

const SOURCE = `pie title Pets adopted by volunteers
    "Dogs" : 386
    "Cats" : 85
    "Rats" : 15`;

const INK = "#1f2328";

class PieDemo extends Scene {
  async construct() {
    const diagram = await loadMermaid(SOURCE);
    diagram.scale(0.85).shift([0, -0.1, 0]);
    this.add(diagram);

    await this.play(revealDiagram(diagram, { runTime: 2.6 }));
    await this.wait(0.3);

    // Beat: the headline value.
    const caption = new Text("Dogs lead: 386 of 486 adoptions (79%)", {
      fontSize: 0.4, color: INK, point: [0, -3.35, 0],
    });
    await this.play(new FadeIn(caption, { runTime: 0.5 }));
    await this.play(new Indicate(caption, { scaleFactor: 1.12, color: "#d97706", runTime: 1 }));
    await this.wait(1);
  }
}

await demoRender(PieDemo, import.meta.url);
