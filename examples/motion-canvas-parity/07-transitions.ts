// fingerprints only TOP-LEVEL mobjects' own point counts ("Group:0" for any
// Group), so equal-length waits over different Group content collide and the
// concat step reuses the first hold's frames for the last one (library bug —
// see report).

import {
  Scene, Rectangle, Text, Group, tweenTo,
  slideTransition, fadeTransition, zoomInTransition, Direction, finishScene,
} from "../../src/node.ts";
import { demoRender, px, pxLen } from "./_run.ts";

// A labeled color card standing in for a "scene"'s content.
function sceneCard(label: string, color: string): Group {
  const bg = new Rectangle({
    width: pxLen(1400), height: pxLen(700),
    fillColor: color, fillOpacity: 1, strokeWidth: 0,
  });
  const text = new Text(label, {
    fontSize: pxLen(90), fillColor: "#ffffff", fillOpacity: 1,
  });
  return new Group(bg, text);
}

class Transitions extends Scene {
  async construct() {
    // The previous scene, already on screen when transitions-1 begins.
    const prev = sceneCard("PREVIOUS SCENE", "#2f2f2f");
    this.add(prev);
    await this.wait(0.5);

    // --- ref/transitions-1.tsx ---
    // set up the scene:
    const first = sceneCard("FIRST SCENE", "#e13238"); // your nodes here

    // perform a slide transition to the left:
    await slideTransition(this, Direction.Left, first, { runTime: 0.6 });

    // proceed with the animation
    await this.wait(3);

    // --- ref/transitions-2.tsx ---
    // yield* animationOne();
    await this.play(tweenTo(first, { scale: 0.85 }, 0.7));
    // trigger the transition early:
    finishScene();
    // continue animating:
    await this.play(tweenTo(first, { rotation: (-5 * Math.PI) / 180 }, 0.7));

    // ...as the next scene fades in over it (fadeTransition):
    const second = sceneCard("SECOND SCENE", "#e6a700");
    await fadeTransition(this, second, { runTime: 0.6 });
    await this.wait(1);

    // ...and the last one grows out of a screen area (zoomInTransition):
    const third = sceneCard("THIRD SCENE", "lightseagreen");
    await zoomInTransition(
      this,
      { center: px(250, -125), width: pxLen(400), height: pxLen(200) },
      third,
      { runTime: 0.8 },
    );
    await this.wait(1);
  }
}

await demoRender(Transitions, import.meta.url);
