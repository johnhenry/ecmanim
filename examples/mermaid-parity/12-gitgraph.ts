// Port of Mermaid syntax docs: gitGraph — ref/gitgraph.md, first full example
// (top of the doc, section "GitGraph Diagrams"), quoted verbatim in SOURCE.
//
// Reveal: mermaid emits NO per-element ids for gitGraph, so revealDiagram
// degrades to its documented spatial fallback — a staggered sweep,
// top-to-bottom / left-to-right. Beat: Indicate the merge commit (where
// develop rejoins main) with a caption.
//
// The loader now inlines mermaid's <style> CSS (per-branch commit colors,
// branch-label plates) and extracts <text> (title, branch names, commit
// hashes). Remaining workaround: mermaid rotates the commit-hash labels
// -45°, which the extractor doesn't reproduce — they'd overlap the dots
// drawn horizontally, so they are hidden here.

import { Scene, Text, VGroup, loadMermaid, revealDiagram, FadeIn, Indicate } from "../../src/node.ts";
import { demoRender } from "./_run.ts";

const SOURCE = `---
title: Example Git diagram
---
gitGraph
   commit
   commit
   branch develop
   checkout develop
   commit
   commit
   checkout main
   merge develop
   commit
   commit`;

const INK = "#1f2328";

class GitGraphDemo extends Scene {
  async construct() {
    const diagram = await loadMermaid(SOURCE);
    diagram.scale(1.1).shift([0, 0.3, 0]);

    // Remaining workaround: hide the rotated commit-hash labels (the
    // extractor places text unrotated, where they'd collide with the dots)
    // and their rotated backing plates (the near-square leaves bigger than
    // commit dots).
    for (const t of diagram.labels().submobjects as any[]) {
      if (/^\d-[0-9a-z]+$/i.test(t.text)) t.setOpacity(0);
    }
    for (const m of diagram.submobjects as any[]) {
      if (m.__isDiagramLabel) continue;
      const w = m.getWidth(), h = m.getHeight();
      if (w >= 0.75 && Math.abs(w - h) < 0.2 * Math.max(w, h)) m.setFill(null, 0);
    }
    this.add(diagram);

    await this.play(revealDiagram(diagram, { runTime: 3 }));
    await this.wait(0.3);

    // Beat: the merge commit — its white core is the smallest circle.
    const circles = (diagram.submobjects as any[]).filter((m) => {
      if (m.__isDiagramLabel) return false;
      const w = m.getWidth(), h = m.getHeight();
      return w > 0.05 && w < 0.75 && Math.abs(w - h) < 0.2 * Math.max(w, h);
    });
    const core = [...circles].sort((a, b) => a.getWidth() - b.getWidth())[0];
    const ring = circles.filter((m) =>
      Math.hypot(m.getCenter()[0] - core.getCenter()[0], m.getCenter()[1] - core.getCenter()[1]) < 0.1);
    const caption = new Text("develop merges back into main", {
      fontSize: 0.4, color: INK, point: [0, -3.3, 0],
    });
    await this.play(new FadeIn(caption, { runTime: 0.5 }));
    await this.play(new Indicate(new VGroup(...ring), { scaleFactor: 1.6, color: "#d97706", runTime: 1.2 }));
    await this.wait(1);
  }
}

await demoRender(GitGraphDemo, import.meta.url);
