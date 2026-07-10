// Port of Mermaid syntax doc: Sequence diagram (ref/sequenceDiagram.md).
// Source: the doc's FIRST example — the intro block under "# Sequence
// diagrams" (Alice/John) — quoted verbatim below.
// Reveal: actors + lifelines first, then messages top-to-bottom.
// Beat: Indicate an actor (Alice's boxes).
//
// The loader now inlines mermaid's <style> CSS and extracts <text> labels
// (actor names, message texts) itself. The Indicate beat excludes labels
// (marked __isDiagramLabel) and the lifeline: a flash-colored name on a
// flash-colored box would vanish mid-beat.

import { Scene, VGroup, Indicate, loadMermaid, revealDiagram } from "../../src/node.ts";
import type { VMobject } from "../../src/node.ts";
import { demoRender } from "./_run.ts";

const SOURCE = `sequenceDiagram
    Alice->>John: Hello John, how are you?
    John-->>Alice: Great!
    Alice-)John: See you later!`;

class SequencePort extends Scene {
  async construct() {
    const d = await loadMermaid(SOURCE);
    d.moveTo([0, 0, 0]);
    this.add(d);

    await this.play(revealDiagram(d, { runTime: 4 }));
    await this.wait(0.3);

    // Beat: flash the Alice actor boxes (not the tall lifeline, not labels).
    const aliceBoxes = new VGroup(
      ...(d.byId("Alice").getFamily() as VMobject[]).filter(
        (m: any) => !m.__isDiagramLabel && m.getHeight() < 3 && m.points?.length,
      ),
    );
    await this.play(new Indicate(aliceBoxes, { color: "#e5484d", scaleFactor: 1.15 }));
    await this.wait(1);
  }
}

await demoRender(SequencePort, import.meta.url);
