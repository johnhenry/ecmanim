// Reveal.js/Slidev parity demo 05: reveal.js's per-slide background feature
// (`data-background-color`/`data-background-gradient`/`data-background` +
// `data-background-transition`) -- ref/reveal-demo.html's "Backgrounds"
// group (lines 283-330) and "Background Transitions" section (lines
// 332-343). 4 slides, each with a DIFFERENT background, ported close to the
// ref's own literal values where they're solid colors/gradients:
//   1. Solid color background   -- ref's `data-background="#dddddd"`
//   2. Gradient background      -- ref's exact
//      `linear-gradient(to bottom, #283b95, #17b2c3)`
//   3. Image background         -- SUBSTITUTED with a solid color (a solid
//      or gradient fill is a sufficient recreation of the PATTERN per the
//      campaign brief; no real image asset is fetched), clearly labeled
//      in-slide and here.
//   4. Background transition    -- ref's exact `data-background="#4d7e65"`
//      + `data-background-transition="zoom"`; recreated by having the
//      background itself GROW IN (GrowFromCenter) instead of a hard cut,
//      the same "the background's own transition is independent of the
//      content's" idea the ref demonstrates with `backgroundTransition`.
//
// HONEST DIVERGENCE / DELIBERATE EXCEPTION TO THIS CAMPAIGN'S OWN
// CONVENTION: every other demo in this campaign (see _run.ts's header)
// deliberately does NOT touch `background` -- render()'s default is black
// and Text defaults to white. This demo is the one that's SUPPOSED to
// change backgrounds per section, since that's the feature under test.
// render()'s `background` option is a single global value (Camera/Scene
// background, not per-section) -- see src/node.ts's RenderOptions -- so the
// idiomatic recreation, per this campaign's brief, is a full-frame
// `FullScreenRectangle` (src/scene/moving_camera_scene.ts -- already sized
// to the exact default frame, 14.222 x 8) painted as the FIRST mobject of
// each section and swapped out between sections. Slide 2's gradient reuses
// the multi-stop `gradientColors`/`sheenDirection` mechanism `ColorBar`
// (src/mobject/legend.ts) and `Axes.getArea()` (coordinate_systems.ts) use
// -- a plain Rectangle with 2 gradient stops renders a real
// `ctx.createLinearGradient` ramp, not N adjacent solid strips.
//
// BUG-FIX REMINDER (commit 70e4fad, this campaign's exemplar 01-markdown-
// deck.ts): each slide's mobjects (background rect INCLUDED) are tracked as
// a plain array and FadeOut individually -- never grouped into a wrapper
// VGroup and FadeOut(wrapper), since FadeOut's finish() restores the
// animated mobject's own opacity to full once removal actually takes it out
// of scene.mobjects, which only happens for mobjects that were themselves
// real scene members (via their own FadeIn/GrowFromCenter introducer).

import { Scene } from "../../src/scene/Scene.ts";
import { Text } from "../../src/mobject/text/Text.ts";
import { FullScreenRectangle } from "../../src/scene/moving_camera_scene.ts";
import { FadeIn, FadeOut } from "../../src/animation/Animation.ts";
import { GrowFromCenter } from "../../src/animation/extra.ts";
import type { Mobject } from "../../src/mobject/Mobject.ts";
import { Color } from "../../src/core/color.ts";
import { DOWN } from "../../src/core/math/vector.ts";
import { demoRender } from "./_run.ts";

const HOLD = 0.7;
const FADE_RT = 0.4;

interface BgSlideConfig {
  name: string;
  heading: string;
  body: string;
  textColor: string;
  /** Solid fill color, mutually exclusive with `gradient`. */
  solid?: string;
  /** Two-stop gradient (top -> bottom), reusing VMobject's gradientColors. */
  gradient?: [string, string];
  /** GrowFromCenter instead of a plain FadeIn -- the "zoom" background
   *  transition (ref's `data-background-transition="zoom"`). */
  zoomIn?: boolean;
}

class BackgroundsTransitions extends Scene {
  private async showBgSlide(cfg: BgSlideConfig): Promise<Mobject[]> {
    this.nextSection(cfg.name);
    const built: Mobject[] = [];

    // Background is the FIRST mobject added, so it paints behind everything
    // else added afterward (stable insertion-order z-sort, see
    // CanvasRenderer/SVGRenderer's zIndex sort).
    const bg = new FullScreenRectangle({ fillOpacity: 1, strokeWidth: 0 });
    if (cfg.gradient) {
      bg.gradientColors = cfg.gradient.map((c) => Color.parse(c));
      bg.sheenDirection = DOWN; // stop[0] at top, stop[1] at bottom ("to bottom").
    } else {
      bg.fillColor = Color.parse(cfg.solid ?? "#000000");
    }
    built.push(bg);

    // width-wrap both texts well inside FRAME_WIDTH (14.222) -- the first
    // render of this demo let long headings/body lines (e.g. the full
    // data-background-gradient(...) string) run off both edges of frame.
    const h = new Text(cfg.heading, { fontSize: 0.65, color: cfg.textColor, width: 11.5 });
    h.moveTo([0, 1.8, 0]);
    built.push(h);

    const b = new Text(cfg.body, { fontSize: 0.34, color: cfg.textColor, width: 11.5 });
    b.moveTo([0, 0.5, 0]);
    built.push(b);

    // The background gets its own introducer (GrowFromCenter for the "zoom"
    // slide, FadeIn -- a hard-cut-equivalent fade -- for the rest); text
    // always just fades in. Both kinds are real `scene.mobjects` members via
    // their own introducer, matching the bug-fix convention above.
    const bgAnim = cfg.zoomIn ? new GrowFromCenter(bg) : new FadeIn(bg);
    await this.play(bgAnim, new FadeIn(h), new FadeIn(b), { runTime: FADE_RT });
    return built;
  }

  private async fadeOutAll(mobs: Mobject[]): Promise<void> {
    if (!mobs.length) return;
    await this.play(...mobs.map((m) => new FadeOut(m)), { runTime: FADE_RT });
  }

  async construct() {
    // 1. Solid color background -- ref's data-background="#dddddd" (a light
    // backdrop, so text flips to dark for contrast -- the real reveal.js
    // theme does the same kind of per-slide contrast adaptation).
    let mobs = await this.showBgSlide({
      name: "solid-background",
      heading: "Slide Backgrounds",
      body: 'data-background="#dddddd" -- recolors just this one slide.',
      textColor: "#111111",
      solid: "#dddddd",
    });
    await this.wait(HOLD);
    await this.fadeOutAll(mobs);

    // 2. Gradient background -- ref's exact linear-gradient stops.
    mobs = await this.showBgSlide({
      name: "gradient-background",
      heading: "Gradient Backgrounds",
      body: 'data-background-gradient="linear-gradient(to bottom, #283b95, #17b2c3)"',
      textColor: "#FFFFFF",
      gradient: ["#283b95", "#17b2c3"],
    });
    await this.wait(HOLD);
    await this.fadeOutAll(mobs);

    // 3. "Image background" -- substituted with a solid color (no real
    // asset fetched); the in-slide text says so explicitly.
    mobs = await this.showBgSlide({
      name: "image-background-substituted",
      heading: "Image Backgrounds (substituted)",
      body: "A solid fill stands in for a fetched image -- same per-slide pattern.",
      textColor: "#FFFFFF",
      solid: "#6b5b95",
    });
    await this.wait(HOLD);
    await this.fadeOutAll(mobs);

    // 4. Background transitions -- ref's exact data-background="#4d7e65"
    // with backgroundTransition: 'zoom'; the background GROWS IN instead of
    // fading like the other slides, showing the background's own transition
    // is independent of the content's.
    mobs = await this.showBgSlide({
      name: "background-transition-zoom",
      heading: "Background Transitions",
      body: "backgroundTransition: 'zoom' -- this background grows in, not a hard cut.",
      textColor: "#FFFFFF",
      solid: "#4d7e65",
      zoomIn: true,
    });
    await this.wait(HOLD);
    await this.fadeOutAll(mobs);
  }
}

await demoRender(BackgroundsTransitions, import.meta.url);
