// FLAGSHIP: diffDiagrams — "your diagram, evolving". Two versions of a small
// deployment pipeline (authored for this demo, not from the syntax docs):
//   v1: Build -> Test -> Deploy
//   v2: inserts Review between Test and Ship (Deploy RENAMED to Ship, matched
//       via keyMap so the node morphs instead of fading), plus a Rollback
//       branch off Test. The old Test->Deploy edge is keyMapped onto the new
//       Test->Review edge so it bends in place rather than crossfading.
// Kept nodes (Build, Test, Deploy->Ship) MORPH to their new positions.
//
// The loader now inlines mermaid's <style> CSS and extracts <text> labels;
// labels belong to their nodes' byId groups, so they ride the diff (morph /
// fade) with the geometry instead of needing a manual crossfade layer.
// Remaining gap: <marker> arrowheads are stripped.

import {
  Scene, Text, VGroup, loadMermaid, revealDiagram, diffDiagrams, FadeIn, Indicate,
} from "../../src/node.ts";
import { demoRender } from "./_run.ts";

const V1 = `flowchart LR
    Build[Build] --> Test[Test]
    Test --> Deploy[Deploy]`;

const V2 = `flowchart LR
    Build[Build] --> Test[Test]
    Test --> Review[Review]
    Review --> Ship[Ship]
    Test -->|failure| Rollback[Rollback]`;

const INK = "#1f2328";

class DiagramDiffDemo extends Scene {
  async construct() {
    const old = await loadMermaid(V1);
    const next = await loadMermaid(V2);
    old.scale(0.9).shift([0, 0.8, 0]);
    next.scale(0.9).shift([0, 0.8, 0]);

    this.add(old);
    await this.play(revealDiagram(old, { runTime: 2 }));
    await this.wait(0.3);

    const caption = new Text("v2 adds review + rollback", {
      fontSize: 0.4, color: INK, point: [0, -2.9, 0],
    });
    await this.play(new FadeIn(caption, { runTime: 0.5 }));
    await this.wait(0.2);

    // The diff: kept nodes morph in place (Deploy morphs into Ship via
    // keyMap), Review/Rollback fade in — labels ride along with their nodes.
    await this.play(
      diffDiagrams(old, next, {
        keyMap: { Deploy: "Ship", L_Test_Deploy_0: "L_Test_Review_0" },
        runTime: 2.4,
      }),
    );
    await this.wait(0.2);

    // Beat: flag what v2 added (boxes only — flashing the label too would
    // recolor it into the box fill and hide the text).
    const shapes = (id: string) =>
      new VGroup(...next.byId(id).submobjects.filter((m: any) => !m.__isDiagramLabel));
    await this.play(
      new Indicate(shapes("Review"), { scaleFactor: 1.3, color: "#d97706", runTime: 1.2 }),
      new Indicate(shapes("Rollback"), { scaleFactor: 1.3, color: "#e5484d", runTime: 1.2 }),
    );
    await this.wait(1);
  }
}

await demoRender(DiagramDiffDemo, import.meta.url);
