// Port of Motion Canvas docs: hierarchy (ref/hierarchy.tsx) — a Layout row
// ("Example" + a red card holding "42", a circle, "!!!") built with nested
// FlexGroups (Yoga), then every Txt found in the tree tweens its fill to
// #FFC66D and back. MC's content-hugging Layout is emulated by computing the
// row's content size up front; the Rect's fill becomes a backing Rectangle.
// NOTE: Yoga rounds layout to whole "pixels", which quantizes world-unit
// sizes to mush — so the flex pass runs at MC pixel scale (x135) and the
// finished tree is scaled back down (suspected library bug, see report).

import { Scene, Text, Circle, Rectangle, Group, FlexGroup, Color, tween, rate_functions } from "../../src/node.ts";
import { demoRender, PPU, pxLen } from "./_run.ts";

const { easeInOutCubic } = rate_functions;

class Hierarchy extends Scene {
  async construct() {
    const gap = 20, pad = 20; // MC pixels — the flex pass runs at pixel scale
    const fontSize = pxLen(48);

    const t1 = new Text("Example", { fontSize, color: "white" });
    const t2 = new Text("42", { fontSize, color: "white" });
    const circle = new Circle({ radius: pxLen(60) / 2, fillColor: "#FFC66D", fillOpacity: 1, strokeWidth: 0 });
    const t3 = new Text("!!!", { fontSize, color: "white" });
    for (const m of [t1, t2, circle, t3]) m.scale(PPU); // world -> px scale

    // <Rect fill padding gap> hugging its children (row is MC's default).
    const innerKids = [t2, circle, t3];
    const innerW = innerKids.reduce((s, m) => s + m.getWidth(), 0) + 2 * gap + 2 * pad;
    const innerH = Math.max(...innerKids.map((m) => m.getHeight())) + 2 * pad;
    const inner = new FlexGroup({
      direction: "row", alignItems: "center", gap, padding: pad,
      width: innerW, height: innerH,
    });
    inner.add(t2, circle, t3);
    const innerCenter = inner.getCenter(); // container is centered here
    await inner.layout(); // ASYNC: loads Yoga's WASM
    const cardFill = new Rectangle({ width: innerW, height: innerH, fillColor: "#f3303f", fillOpacity: 1, strokeWidth: 0 });
    cardFill.moveTo(innerCenter);
    const card = new Group(cardFill, inner);

    // <Layout layout gap alignItems="center"> around the text + card.
    const outerW = t1.getWidth() + gap + innerW;
    const outerH = Math.max(t1.getHeight(), innerH);
    const outer = new FlexGroup({
      direction: "row", alignItems: "center", gap,
      width: outerW, height: outerH,
    });
    outer.add(t1, card);
    await outer.layout();
    outer.scale(1 / PPU); // px -> world scale
    outer.moveTo([0, 0, 0]); // view centers the layout
    this.add(outer);

    // const texts = view.findAll(is(Txt));
    // yield* all(...texts.map(text => text.fill('#FFC66D', 1).back(1)));
    // (tweenTo's fill prop doesn't reach glyph submobjects — use setColor.)
    const texts = [t1, t2, t3];
    const from = Color.parse("white");
    const to = Color.parse("#FFC66D");
    const thereAndBack = (t: number) =>
      t < 0.5 ? easeInOutCubic(2 * t) : easeInOutCubic(2 - 2 * t);
    await this.play(
      ...texts.map((text) =>
        tween(2, (t) => text.setColor(Color.lerp(from, to, thereAndBack(t)))),
      ),
    );
  }
}

await demoRender(Hierarchy, import.meta.url);
