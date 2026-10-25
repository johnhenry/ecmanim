import { CanvasElement } from "@napi-rs/canvas";
import { Circle, Square } from "../../src/mobject/geometry.ts";
import type { Scene } from "../../src/scene/Scene.ts";

// Four distinct segments exercise real worker sharding and cache concatenation.
export async function rgbaScene(scene: Scene) {
  const square = new Square({ sideLength: 1.5, fillColor: "#e62918", fillOpacity: 1 }).shift([-2, -1, 0]);
  const circle = new Circle({ radius: 1, fillColor: "#187be6", fillOpacity: 0.5 }).shift([2, 1, 0]);
  scene.add(square, circle);
  for (let i = 0; i < 4; i++) {
    square.shift([0.4, 0.2, 0]);
    circle.shift([-0.3, -0.1, 0]);
    await scene.wait(0.25);
  }
}

// Runs inside workers too: any accidental PNG encoding fails the render.
export async function noPngScene(scene: Scene) {
  const saved = CanvasElement.prototype.toBuffer;
  CanvasElement.prototype.toBuffer = () => { throw new Error("video must not encode PNG frames"); };
  try { await rgbaScene(scene); }
  finally { CanvasElement.prototype.toBuffer = saved; }
}
