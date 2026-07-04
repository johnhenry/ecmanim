// End-to-end tour of the feature surface added between 0.0.6 and 0.0.12,
// exercised together through the real public `ecmanim`/`ecmanim/node`
// package (not deep source imports) and rendered to an actual MP4 via the
// normal Scene/render() pipeline. Each section is independently a "does
// this actually work for a real user, not just in its own unit test" check.
//
// Run: node examples/e2e-feature-tour.ts -> examples/out/e2e-feature-tour.mp4
import {
  render, Scene, VGroup, Text, Rectangle, Dot, Circle,
  FadeIn, FadeOut, Create,
  FlexGroup, setTextShapingBackend, isTextShapingBackendActive,
  spring, crossFade, springTiming,
  SVGMobject, Code, bindTrack,
  WHITE, BLUE, GREEN, RED, YELLOW, TEAL, PURPLE, ORANGE,
} from "../src/node.ts";

function tag(text: string) {
  return new Text(text, { fontSize: 0.32, color: WHITE, point: [0, 3.3, 0], opacity: 0.9 });
}

class FeatureTour extends Scene {
  async construct() {
    // 0. Title.
    const title = new Text("ecmanim feature tour: 0.0.7 -> 0.0.12", { fontSize: 0.5, color: WHITE });
    await this.play(new FadeIn(title), { runTime: 0.5 });
    await this.wait(0.5);
    await this.play(new FadeOut(title), { runTime: 0.4 });

    // 1. FlexGroup: real Yoga flexbox layout for 3 "stat cards", one of
    // which grows to fill remaining space via setChildFlex(flexGrow).
    let t = tag("FlexGroup: Yoga flexbox layout");
    const flexWidth = 12, flexGap = 0.4, fixedCardWidth = 2;
    const cardA = new Rectangle({ width: fixedCardWidth, height: 1.4, color: BLUE, fillOpacity: 0.3 });
    const cardB = new Rectangle({ width: fixedCardWidth, height: 1.4, color: GREEN, fillOpacity: 0.3 });
    const cardC = new Rectangle({ width: fixedCardWidth, height: 1.4, color: PURPLE, fillOpacity: 0.3 });
    const row = new FlexGroup({ direction: "row", justifyContent: "space-between", alignItems: "center", gap: flexGap, width: flexWidth, height: 2 });
    row.add(cardA, cardB, cardC);
    row.setChildFlex(cardB, { flexGrow: 1 });
    await row.layout();
    // layout() only repositions children to Yoga's computed box -- it does
    // NOT resize them to match (confirmed via direct repro; see issue #23
    // and docs/flex-group.md's "flexGrow/flexShrink" callout). Resize the
    // growing card ourselves via setWidth(w, stretch=true) (width-only, so
    // height stays matched to its fixed siblings) to actually fill the
    // space Yoga allotted it.
    cardB.setWidth(flexWidth - 2 * fixedCardWidth - 2 * flexGap, true);
    await this.play(new FadeIn(t), new Create(cardA), new Create(cardB), new Create(cardC), { runTime: 0.7 });
    await this.wait(0.6);
    await this.play(new FadeOut(t), new FadeOut(cardA), new FadeOut(cardB), new FadeOut(cardC), { runTime: 0.4 });

    // 2. HarfBuzz real text shaping: opt in via the now-public barrel export
    // (previously unreachable -- see CHANGELOG "Unreleased" for the fix this
    // scene surfaced) and compare ligatures on/off on ligature-prone text.
    t = tag("HarfBuzz shaping (setTextShapingBackend)");
    await setTextShapingBackend("harfbuzz");
    const ligatedLabel = new Text("ligatures on:  disableLigatures: false", { fontSize: 0.3, color: WHITE, point: [0, 1, 0] });
    const ligated = new Text("office waffle", { fontSize: 0.6, color: YELLOW, point: [0, 0.3, 0], disableLigatures: false });
    const plainLabel = new Text("ligatures off: disableLigatures: true", { fontSize: 0.3, color: WHITE, point: [0, -0.9, 0] });
    const plain = new Text("office waffle", { fontSize: 0.6, color: ORANGE, point: [0, -1.6, 0], disableLigatures: true });
    await this.play(
      new FadeIn(t), new FadeIn(ligatedLabel), new Create(ligated),
      new FadeIn(plainLabel), new Create(plain),
      { runTime: 0.8 },
    );
    console.log(`  [e2e] active text shaping backend: ${isTextShapingBackendActive()}`);
    await this.wait(0.8);
    await setTextShapingBackend("opentype"); // restore default before later sections
    await this.play(new FadeOut(t), new FadeOut(ligatedLabel), new FadeOut(ligated), new FadeOut(plainLabel), new FadeOut(plain), { runTime: 0.4 });

    // 3. Spring physics with a nonzero initial velocity ("fling and
    // decelerate" momentum): two dots seeded with the SAME target-equals-
    // current position but different velocity0, driven frame-by-frame via
    // the analytic spring() function through an ordinary addUpdater.
    t = tag("spring(): velocity0 (fling and decelerate)");
    const restY = -0.5;
    const dotAtRest = new Dot({ color: TEAL, radius: 0.18 }).moveTo([-3, restY, 0]);
    const dotFlung = new Dot({ color: RED, radius: 0.18 }).moveTo([3, restY, 0]);
    const labelAtRest = new Text("velocity0: 0", { fontSize: 0.28, color: WHITE }).nextTo(dotAtRest, [0, 1, 0]).shift([0, 0.6, 0]);
    const labelFlung = new Text("velocity0: 6", { fontSize: 0.28, color: WHITE }).nextTo(dotFlung, [0, 1, 0]).shift([0, 0.6, 0]);
    await this.play(new FadeIn(t), new FadeIn(dotAtRest), new FadeIn(dotFlung), new FadeIn(labelAtRest), new FadeIn(labelFlung), { runTime: 0.5 });

    const springConfig = { mass: 1, damping: 6, stiffness: 90 };
    const springFps = this.fps;
    let elapsed = 0;
    const springUpdater = (dt: number) => {
      elapsed += dt;
      const frame = elapsed * springFps;
      const yAtRest = spring({ frame, fps: springFps, from: restY, to: restY, config: springConfig, velocity0: 0 });
      const yFlung = spring({ frame, fps: springFps, from: restY, to: restY, config: springConfig, velocity0: 6 });
      dotAtRest.setY(yAtRest);
      dotFlung.setY(yFlung);
    };
    dotAtRest.addUpdater(springUpdater);
    await this.wait(1.5);
    dotAtRest.removeUpdater(springUpdater);
    await this.play(new FadeOut(t), new FadeOut(dotAtRest), new FadeOut(dotFlung), new FadeOut(labelAtRest), new FadeOut(labelFlung), { runTime: 0.4 });

    // 4. crossFade with springTiming(): a mobject-level transition whose
    // shared rateFunc AND suggested runTime both come from measuring the
    // spring's own natural settle time.
    const before = new Circle({ radius: 1.2, color: BLUE, fillOpacity: 0.5 });
    const after = new Rectangle({ width: 2.4, height: 2.4, color: ORANGE, fillOpacity: 0.5 });
    const transitionTag = tag("crossFade(a, b, { timing: springTiming() })");
    await this.play(new FadeIn(transitionTag), new FadeIn(before), { runTime: 0.4 });
    await this.wait(0.3);
    await this.play(crossFade(before, after, { timing: springTiming(), fps: this.fps }));
    await this.wait(0.3);
    await this.play(new FadeOut(transitionTag), new FadeOut(after), { runTime: 0.4 });

    // 5. SVGMobject: <linearGradient> fill on a rect, clipped by a circular
    // <clipPath> -- both previously-broken (defs leaking as visible shapes)
    // and newly-added (gradient/clip support) in the same release.
    t = tag("SVGMobject: linearGradient fill + circular clipPath");
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
        <defs>
          <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="#22d3ee"/>
            <stop offset="1" stop-color="#a855f7"/>
          </linearGradient>
          <clipPath id="c"><circle cx="100" cy="100" r="90"/></clipPath>
        </defs>
        <rect x="0" y="0" width="200" height="200" fill="url(#g)" clip-path="url(#c)"/>
      </svg>
    `;
    const badge = new SVGMobject(svg).scale(1.6);
    await this.play(new FadeIn(t), new Create(badge), { runTime: 0.6 });
    await this.wait(0.6);
    await this.play(new FadeOut(t), new FadeOut(badge), { runTime: 0.4 });

    // 6. Code.diffTo(): morph one Code snapshot's tokens into another's via
    // TransformMatchingAuto, disambiguating repeated tokens by position.
    t = tag("Code.diffTo(): animated code diff");
    const before2 = new Code("function add(a, b) {\n  return a + b;\n}", { language: "js", lineNumbers: false }).scale(0.9);
    const after2 = new Code("function add(a, b, c = 0) {\n  return a + b + c;\n}", { language: "js", lineNumbers: false }).scale(0.9);
    await this.play(new FadeIn(t), new FadeIn(before2), { runTime: 0.5 });
    await this.wait(0.4);
    await this.play(before2.diffTo(after2), { runTime: 1.0 });
    await this.wait(0.6);
    // diffTo()'s unmatched NEW tokens (here, ", c = 0" and " + c") are real
    // children of `after2`, individually FadeIn'd -- Scene.play() auto-adds
    // any animation's introduced mobjects directly to the scene's top-level
    // mobject list (Scene.ts's getMobjectsToIntroduce() handling), even
    // though `after2` itself was never explicitly added. Confirmed directly:
    // fading out only `before2` leaves those tokens behind as permanent,
    // untracked scene members. Fade out `after2` too to actually clear them.
    await this.play(new FadeOut(t), new FadeOut(before2), new FadeOut(after2), { runTime: 0.4 });

    // 7. Scene.track()/bindTrack(): a property-keyframe track wired onto a
    // mobject through the ordinary updater mechanism -- the same primitive
    // Studio's timeline UI scrubs, but usable with zero Studio/DOM
    // involvement, driven here purely by scene.wait()'s own per-frame tick.
    t = tag("Scene.track() + bindTrack(): keyframe-driven motion");
    const marker = new Dot({ color: YELLOW, radius: 0.2 });
    const path = new VGroup(
      new Dot({ color: WHITE, radius: 0.04 }).moveTo([-5, 1.5, 0]),
      new Dot({ color: WHITE, radius: 0.04 }).moveTo([5, 1.5, 0]),
      new Dot({ color: WHITE, radius: 0.04 }).moveTo([0, -1.5, 0]),
    );
    const posTrack = this.track<[number, number, number]>([
      { t: 0, value: [-5, 1.5, 0] },
      { t: 1, value: [5, 1.5, 0], ease: "easeInOutSine" },
      { t: 2, value: [0, -1.5, 0], ease: "easeInOutSine" },
    ]);
    bindTrack(marker, "_trackPos" as any, posTrack);
    marker.addUpdater((m: any) => m.moveTo(m._trackPos ?? [-5, 1.5, 0]));
    await this.play(new FadeIn(t), new FadeIn(path), new FadeIn(marker), { runTime: 0.5 });
    await this.wait(2);
    await this.play(new FadeOut(t), new FadeOut(path), new FadeOut(marker), { runTime: 0.4 });

    // Outro.
    const outro = new Text("github.com/johnhenry/ecmanim", { fontSize: 0.4, color: WHITE });
    await this.play(new FadeIn(outro), { runTime: 0.5 });
    await this.wait(0.6);
    await this.play(new FadeOut(outro), { runTime: 0.4 });
  }
}

await render(FeatureTour, {
  output: "examples/out/e2e-feature-tour.mp4",
  quality: "medium",
  background: "#0d1117",
});
console.log("e2e-feature-tour.ts done");
