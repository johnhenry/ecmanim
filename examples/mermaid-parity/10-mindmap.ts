// Port of Mermaid syntax docs: mindmap — ref/mindmap.md, first full example
// (section "An example of a mindmap."), quoted verbatim in SOURCE.
//
// Reveal: revealDiagram's mindmap staging — radial, ordered by distance from
// the diagram center, so the root appears first and branches ripple outward
// (GrowFromCenter, the documented mindmap default, now reaches every part).
// Beat: Indicate the root — everything radiates from it.
//
// The loader now inlines mermaid's <style> CSS (per-branch section colors)
// and extracts <text> labels at their node positions.

import { Scene, VGroup, loadMermaid, revealDiagram, Indicate } from "../../src/node.ts";
import { demoRender } from "./_run.ts";

const SOURCE = `mindmap
  root((mindmap))
    Origins
      Long history
      ::icon(fa fa-book)
      Popularisation
        British popular psychology author Tony Buzan
    Research
      On effectiveness<br/>and features
      On Automatic creation
        Uses
            Creative techniques
            Strategic planning
            Argument mapping
    Tools
      Pen and paper
      Mermaid`;

class MindmapDemo extends Scene {
  async construct() {
    const diagram = await loadMermaid(SOURCE);
    diagram.scale(1.05);
    this.add(diagram);

    await this.play(revealDiagram(diagram, { runTime: 3 }));
    await this.wait(0.3);

    // Beat: back to the root every branch radiates from (shape only — the
    // label would vanish against the flash color).
    const root = new VGroup(
      ...diagram.byId("node_0").submobjects.filter((m: any) => !m.__isDiagramLabel),
    );
    await this.play(new Indicate(root, { scaleFactor: 1.35, color: "#d97706", runTime: 1.2 }));
    await this.wait(1);
  }
}

await demoRender(MindmapDemo, import.meta.url);
