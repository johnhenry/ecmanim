// Port of Mermaid syntax doc: Gantt diagram (ref/gantt.md).
// Source: the doc's FIRST example — the intro block under "A note to users"
// ("# Gantt diagrams") — quoted verbatim below.
// Reveal: axis/section scaffolding fades in first, then bars grow
// left-to-right (revealDiagram's gantt strategy, GrowFromEdge LEFT).
// Beat: Indicate the critical task — this example marks nothing `crit`, so
// the dependency-chain anchor `a1` ("A task", which "Another task" waits on)
// is indicated instead.
//
// The loader now inlines mermaid's <style> CSS (bar/section/grid colors),
// extracts <text> labels (title, task names, axis dates, section names) and
// crops the off-canvas "today" line (x ~96k px; today is years past the
// 2014 axis) that used to collapse the world fit to a sliver.

import { Scene, Indicate, loadMermaid, revealDiagram } from "../../src/node.ts";
import { demoRender } from "./_run.ts";

const SOURCE = `gantt
    title A Gantt Diagram
    dateFormat YYYY-MM-DD
    section Section
        A task          :a1, 2014-01-01, 30d
        Another task    :after a1, 20d
    section Another
        Task in Another :2014-01-12, 12d
        another task    :24d`;

class GanttPort extends Scene {
  async construct() {
    const d = await loadMermaid(SOURCE);
    d.moveTo([0, 0, 0]);
    this.add(d);

    await this.play(revealDiagram(d, { runTime: 4 }));
    await this.wait(0.3);

    // Beat: flash the chain-anchor task bar (labels live under the separate
    // `<id>-text` element, so byId("a1") is the bar geometry alone).
    await this.play(new Indicate(d.byId("a1"), { color: "#e5484d", scaleFactor: 1.2 }));
    await this.wait(1);
  }
}

await demoRender(GanttPort, import.meta.url);
