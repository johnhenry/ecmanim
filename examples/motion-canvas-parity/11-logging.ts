// Port of Motion Canvas docs: logging (ref/logging.tsx) — useLogger() →
// this.logger. The ref is a stub (`const logger = useLogger(); // ...`), so
// this fleshes out the docs page's four levels around a small animation.
// onLog is wired to the console so debug/info actually print during the
// render (warn/error already echo to the console on their own), and the
// sliding circle keeps the video from being empty.

import { Scene, Circle, tweenTo } from "../../src/node.ts";
import { demoRender, px, pxLen } from "./_run.ts";

class Logging extends Scene {
  async construct() {
    // const logger = useLogger();
    const logger = this.logger;
    this.onLog = (level, msg) => {
      if (level === "debug" || level === "info") console.log(`[${level}] ${msg}`);
    };

    const circle = new Circle({
      radius: pxLen(120) / 2,
      fillColor: "#68abdf",
      fillOpacity: 1,
      strokeWidth: 0,
    });
    circle.moveTo(px(-300, 0));
    this.add(circle);

    logger.debug("circle created at x=-300");
    logger.info("sliding the circle to the right");
    await this.play(tweenTo(circle, { x: px(300)[0] }, 1));

    logger.warn("about to change the fill");
    await this.play(tweenTo(circle, { fill: "#e13238" }, 0.5));

    logger.error("this is what an error looks like");
    await this.wait(0.5);
  }
}

await demoRender(Logging, import.meta.url);
