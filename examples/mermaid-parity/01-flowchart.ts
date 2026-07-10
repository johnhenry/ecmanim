// Port of Mermaid syntax doc: Flowchart (ref/flowchart.md).
// Source: the doc's FIRST full multi-node example — section "Minimum length
// of a link" — quoted verbatim below. (The doc's earlier blocks — "A node
// (default)" `id` and the two "Direction" `Start --> Stop` samples — are
// degenerate for a topological-reveal port: 1-2 nodes, no decision node.)
// Reveal: topological (nodes before the edges that touch them).
// Beat: Indicate the decision node `B{Is it?}` by friendly id "B".
//
// The loader now inlines mermaid's <style> CSS (palette fills) and extracts
// <text> labels itself — no per-demo restyling / label re-adding needed.
// Remaining gap: <marker> arrowheads are stripped (edges end without tips).

import { Scene, VGroup, Indicate, loadMermaid, revealDiagram } from "../../src/node.ts";
import { demoRender } from "./_run.ts";

const SOURCE = `flowchart TD
    A[Start] --> B{Is it?}
    B -->|Yes| C[OK]
    C --> D[Rethink]
    D --> B
    B ---->|No| E[End]`;

class FlowchartPort extends Scene {
  async construct() {
    const diagram = await loadMermaid(SOURCE);
    diagram.moveTo([0, 0, 0]);
    this.add(diagram);

    await this.play(revealDiagram(diagram, { runTime: 4 }));
    await this.wait(0.3);

    // Beat: flash the decision rhombus by friendly id. The byId group now
    // includes the node's label — exclude it so the text stays readable
    // while the shape flashes.
    const bShapes = new VGroup(
      ...diagram.byId("B").submobjects.filter((m: any) => !m.__isDiagramLabel),
    );
    await this.play(new Indicate(bShapes, { color: "#e5484d", scaleFactor: 1.2 }));
    await this.wait(1);
  }
}

await demoRender(FlowchartPort, import.meta.url);
