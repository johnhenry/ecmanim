// Port of Mermaid syntax doc: Entity Relationship diagram
// (ref/entityRelationshipDiagram.md). Source: the doc's FIRST example — the
// "Order example" block in the intro ("# Entity Relationship Diagrams") —
// quoted verbatim below (title frontmatter included).
// Reveal: topological over the er entity/edge friendly ids.
// Beat: highlight an entity — Indicate `CUSTOMER` by friendly id.
//
// The loader now inlines mermaid's <style> CSS and extracts <text> labels
// (title, entity names, relationship words). Remaining gap: cardinality
// markers (crow's feet) are <marker> defs the loader strips.

import { Scene, VGroup, Indicate, loadMermaid, revealDiagram } from "../../src/node.ts";
import { demoRender } from "./_run.ts";

const SOURCE = `---
title: Order example
---
erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE-ITEM : contains
    CUSTOMER }|..|{ DELIVERY-ADDRESS : uses`;

class ErPort extends Scene {
  async construct() {
    const d = await loadMermaid(SOURCE);
    d.moveTo([0, 0, 0]);
    this.add(d);

    await this.play(revealDiagram(d, { runTime: 4 }));
    await this.wait(0.3);

    // Beat: flash the CUSTOMER entity by friendly id (box only — the label
    // would vanish against the flash color).
    const customer = new VGroup(
      ...d.byId("CUSTOMER").submobjects.filter((m: any) => !m.__isDiagramLabel),
    );
    await this.play(new Indicate(customer, { color: "#e5484d", scaleFactor: 1.2 }));
    await this.wait(1);
  }
}

await demoRender(ErPort, import.meta.url);
