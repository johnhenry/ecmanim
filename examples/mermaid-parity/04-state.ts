// Port of Mermaid syntax doc: State diagram (ref/stateDiagram.md).
// Source: the doc's FIRST example — the "Simple sample" block in the intro
// ("# State diagrams") — quoted verbatim below (title frontmatter included).
// Reveal: nodes first; state's `edgeN` ids carry no endpoints, so the
// transitions follow in spatial order (per revealDiagram's state strategy).
// Beat: Indicate the `Moving` state by friendly id.
//
// The loader now inlines mermaid's <style> CSS (state boxes lavender, [*]
// markers dark) and extracts <text> labels (title + state names). The beat
// excludes the state's label (marked __isDiagramLabel) so it stays readable
// while the box flashes.

import { Scene, VGroup, Indicate, loadMermaid, revealDiagram } from "../../src/node.ts";
import { demoRender } from "./_run.ts";

const SOURCE = `---
title: Simple sample
---
stateDiagram-v2
    [*] --> Still
    Still --> [*]

    Still --> Moving
    Moving --> Still
    Moving --> Crash
    Crash --> [*]`;

class StatePort extends Scene {
  async construct() {
    const d = await loadMermaid(SOURCE);
    d.moveTo([0, 0, 0]);
    this.add(d);

    await this.play(revealDiagram(d, { runTime: 4 }));
    await this.wait(0.3);

    // Beat: flash the Moving state by friendly id (shape only).
    const moving = new VGroup(
      ...d.byId("Moving").submobjects.filter((m: any) => !m.__isDiagramLabel),
    );
    await this.play(new Indicate(moving, { color: "#e5484d", scaleFactor: 1.25 }));
    await this.wait(1);
  }
}

await demoRender(StatePort, import.meta.url);
