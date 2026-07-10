// Port of Motion Canvas docs: Filters and Effects (ref/filters-and-effects.tsx,
// both snippets) plus the same docs page's masking/compositeOperation section
// the blur-up and blur-down segments would otherwise collide.

import {
  Scene, Group, Circle, Square, Rectangle, CompositeGroup,
  createSignal, tween, tweenTo, tweenSignal, map, rate_functions,
} from "../../src/node.ts";
const { easeInOutCubic } = rate_functions;
import { demoRender, px, pxLen } from "./_run.ts";

class FiltersAndEffects extends Scene {
  async construct() {
    // view.fill('#141414') is demoRender's default background.
    // Stand-in for <Img src="/img/logo_dark.svg" size={200}/>.
    const icon = new Group(
      new Square({ sideLength: pxLen(200), fillColor: "white", fillOpacity: 1, strokeWidth: 0 }),
      new Circle({ radius: pxLen(60), fillColor: "#141414", fillOpacity: 1, strokeWidth: 0 }),
      new Circle({ radius: pxLen(25), fillColor: "white", fillOpacity: 1, strokeWidth: 0 }),
    );
    this.add(icon);

    // --- snippet: Filters Property ---
    // Modification happens by accessing the `filters` property.
    icon.blur(0);
    const blurEffect = icon.effects![icon.effects!.length - 1] as { radius: number };
    await this.play(tween(1, (t) => { blurEffect.radius = map(0, 10, t); }, easeInOutCubic));
    await this.play(tween(1, (t) => { blurEffect.radius = map(10, 0, t); }, easeInOutCubic));

    // --- snippet: Filters Array ---
    // Modification happens by changing the Filters inside the 'filters' array
    // (here: the blur radius is bound to a signal via an updater).
    const blurSignal = createSignal(0);
    icon.addUpdater(() => { blurEffect.radius = blurSignal(); });
    await this.play(tweenSignal(blurSignal, 10, 1));
    await this.play(tweenSignal(blurSignal, 0, 1));
    icon.clearUpdaters();
    this.remove(icon);

    // --- docs section: Masking & composite operations ---
    // A CompositeGroup scopes blending to SIBLINGS: the "destination-out"
    // circle punches a hole in the red card, not in the whole scene.
    const masked = new CompositeGroup();
    const card = new Rectangle({
      width: pxLen(480), height: pxLen(280),
      fillColor: "#e13238", fillOpacity: 1, strokeWidth: 0,
    });
    const hole = new Circle({ radius: pxLen(70), fillColor: "white", fillOpacity: 1, strokeWidth: 0 });
    hole.compositeOperation = "destination-out";
    hole.moveTo(px(-150, 0));
    masked.add(card, hole);
    this.add(masked);

    await this.play(tweenTo(hole, { x: px(150)[0] }, 1).to({ x: px(-150)[0] }, 1));
  }
}

await demoRender(FiltersAndEffects, import.meta.url);
