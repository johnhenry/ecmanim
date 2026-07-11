// Reveal.js/Slidev parity demo 04: reveal.js's "vertical slides" concept --
// a top-level `<section>` that contains nested `<section>` children, which
// the presenter navigates DOWN into (Space/Down key) rather than forward
// (Right key). Ported from ref/reveal-demo.html's own "Vertical Slides"
// group verbatim in spirit: a top-level slide titled "Vertical Slides" with
// two nested children "Basement Level 1" / "Basement Level 2" (the ref's
// exact three sections, including its own down-arrow/up-arrow navigation
// hints -- see ref/reveal-demo.html lines 78-117), followed by a fresh
// top-level slide once the stack is left. Slidev has no equivalent (a
// single linear `---`-delimited deck) -- see ref/README.md's "documented
// gap" note -- so this demo has no Slidev-side counterpart to port.
//
// HONEST DIVERGENCE: this is a NAVIGATION-UI concept (a down-arrow in the
// real reveal.js UI, presenter free to drill in or skip past), not a
// rendering difference -- a linearly rendered video has no real concept of
// "navigation direction," so this is necessarily an approximation of the
// presenter-facing structure, not a literal capability port. Built directly
// on the Scene API (per the campaign brief) rather than deckFromMarkdown(),
// which has no notion of nested sections at all. The approximation: (1) a
// section-naming convention that mirrors reveal.js's own stack indexing --
// "1" (top-level) / "1.1", "1.2" (its nested children) / "2" (the next
// top-level slide) -- via Scene.nextSection()'s `name` param, so the
// section list itself documents the stack membership even though nothing
// in the rendered pixels can; and (2) a purely visual "drilling down" cue on
// each nested slide: a breadcrumb ("1 > 1.1"), the content inset inside a
// bordered panel (vs. top-level slides, which use the full frame), and a
// down/up Arrow mirroring the ref's own navigate-down/navigate-up arrow
// images -- so the video reads as "went DOWN into a sub-topic, not just
// forward" even without real navigation.

import { Scene } from "../../src/scene/Scene.ts";
import { Text } from "../../src/mobject/text/Text.ts";
import { Rectangle, Arrow } from "../../src/mobject/geometry.ts";
import { FadeIn, FadeOut } from "../../src/animation/Animation.ts";
import type { Mobject } from "../../src/mobject/Mobject.ts";
import { WHITE, LIGHT_GRAY, DARK_GRAY } from "../../src/core/color.ts";
import { demoRender } from "./_run.ts";

const HOLD = 0.6;
const FADE_RT = 0.4;

class VerticalStacks extends Scene {
  // A top-level slide: full-frame content, no breadcrumb, no inset panel --
  // the "surface" of the deck the presenter moves through with Right/Left.
  private async showTopLevel(name: string, heading: string, body: string): Promise<Mobject[]> {
    this.nextSection(name);
    const built: Mobject[] = [];

    const h = new Text(heading, { fontSize: 0.75, color: WHITE });
    h.moveTo([0, 2.1, 0]);
    built.push(h);

    const b = new Text(body, { fontSize: 0.38, color: LIGHT_GRAY });
    b.moveTo([0, 0.7, 0]);
    built.push(b);

    await this.play(...built.map((m) => new FadeIn(m)), { runTime: FADE_RT });
    return built;
  }

  // A nested sub-slide: breadcrumb + inset panel + an arrow cueing the
  // drill-down (entering the stack) or the eventual climb back out
  // (leaving the stack) -- see the file header for why this is the honest
  // recreation of a navigation-only concept in a rendered video.
  private async showSubSlide(
    parentName: string,
    name: string,
    heading: string,
    body: string,
    arrow: "down" | "up",
  ): Promise<Mobject[]> {
    this.nextSection(name);
    const built: Mobject[] = [];

    const crumb = new Text(`${parentName} > ${name}`, { fontSize: 0.32, color: LIGHT_GRAY });
    crumb.moveTo([-5.9, 3.5, 0]);
    built.push(crumb);

    // The inset panel is the visual "we are one level down" cue: top-level
    // slides use the full frame, nested slides are visibly boxed inside it.
    const panelWidth = 9;
    const panelHeight = 4.2;
    const panelCenterY = -0.2;
    const panel = new Rectangle({
      width: panelWidth,
      height: panelHeight,
      point: [0, panelCenterY, 0],
      strokeColor: WHITE,
      strokeWidth: 3,
      fillColor: DARK_GRAY,
      fillOpacity: 0.25,
    });
    built.push(panel);

    const h = new Text(heading, { fontSize: 0.55, color: WHITE });
    h.moveTo([0, panelCenterY + 1.1, 0]);
    built.push(h);

    const b = new Text(body, { fontSize: 0.32, color: LIGHT_GRAY });
    b.moveTo([0, panelCenterY - 0.1, 0]);
    built.push(b);

    const panelTop = panelCenterY + panelHeight / 2;
    const panelBottom = panelCenterY - panelHeight / 2;
    if (arrow === "down") {
      // Just drilled down into this sub-slide -- arrow points DOWN into the
      // panel, mirroring ref/reveal-demo.html's "navigate-down" arrow image.
      const arr = new Arrow([0, panelTop + 1.2, 0], [0, panelTop + 0.2, 0], { color: WHITE });
      built.push(arr);
      const label = new Text("drilling down", { fontSize: 0.26, color: LIGHT_GRAY });
      label.moveTo([0, panelTop + 1.5, 0]);
      built.push(label);
    } else {
      // Last sub-slide in the stack -- arrow points UP out of the panel,
      // mirroring the ref's own "navigate-up" (#/2) arrow image.
      const arr = new Arrow([0, panelBottom - 1.0, 0], [0, panelBottom - 0.2, 0], { color: WHITE });
      built.push(arr);
      const label = new Text("back to top level next", { fontSize: 0.26, color: LIGHT_GRAY });
      label.moveTo([0, panelBottom - 1.3, 0]);
      built.push(label);
    }

    await this.play(...built.map((m) => new FadeIn(m)), { runTime: FADE_RT });
    return built;
  }

  // FadeOut every mobject individually (never a wrapper group) -- see this
  // campaign's exemplar (01-markdown-deck.ts) and commit 70e4fad: FadeOut's
  // finish() restores the animated mobject's own opacity to full once it's
  // actually removed from scene.mobjects, which only happens if EACH
  // mobject (not an unattached wrapper) was itself added via its own
  // FadeIn introducer.
  private async fadeOutAll(mobs: Mobject[]): Promise<void> {
    if (!mobs.length) return;
    await this.play(...mobs.map((m) => new FadeOut(m)), { runTime: FADE_RT });
  }

  async construct() {
    // "1": top-level slide -- the stack's parent.
    let mobs = await this.showTopLevel(
      "1",
      "Vertical Slides",
      "Slides can be nested inside of each other.\nPress Down to drill into a sub-topic.",
    );
    await this.wait(HOLD);
    await this.fadeOutAll(mobs);

    // "1.1": first nested child -- drilling down.
    mobs = await this.showSubSlide(
      "1",
      "1.1",
      "Basement Level 1",
      "Nested slides add detail underneath\na top-level slide.",
      "down",
    );
    await this.wait(HOLD);
    await this.fadeOutAll(mobs);

    // "1.2": second nested child -- still inside the stack, but this is the
    // last one, so the cue flips to "climb back out."
    mobs = await this.showSubSlide(
      "1",
      "1.2",
      "Basement Level 2",
      "That's it -- time to go back up.",
      "up",
    );
    await this.wait(HOLD);
    await this.fadeOutAll(mobs);

    // "2": a fresh top-level slide -- the stack is behind us, full frame
    // again, no breadcrumb, no inset panel.
    mobs = await this.showTopLevel(
      "2",
      "Back at the Top",
      "Forward navigation continues here,\npast the vertical stack.",
    );
    await this.wait(HOLD);
    await this.fadeOutAll(mobs);
  }
}

await demoRender(VerticalStacks, import.meta.url);
