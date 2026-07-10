// Recreation of the "Essence of linear algebra" ch. 3 visual (3b1b, 2016):
// the plane's grid morphs under a 2x2 matrix while i-hat/j-hat move to
// their images; a unit square rides along and the determinant readout
// tracks its area. Recreation of the visual, not a code port.

import {
  Square, MathTex, VGroup, DecimalNumber, Text,
} from "../../src/node.ts";
import { LinearTransformationScene } from "../../src/scene/vector_space_scene.ts";
import { demoRender } from "./_run.ts";

const det = (m: number[][]) => m[0][0] * m[1][1] - m[0][1] * m[1][0];

class LinearTransformation extends LinearTransformationScene {
  async construct() {
    // The unit square riding the transform (fill = det area).
    const unit = new Square({ sideLength: 1, fillColor: "#FFFF00", fillOpacity: 0.3, strokeColor: "#FFFF00", strokeWidth: 2 });
    unit.moveTo([0.5, 0.5, 0]);
    this.addTransformableMobject(unit); // registers for transforms...
    this.add(unit); // ...but scene membership is separate

    // Matrix + determinant readout, top-left, fixed (not transformable).
    // MathTex default size ~= manim font_size 48; scale down for a corner label.
    const label = new MathTex("A = \\begin{bmatrix} 1 & 1 \\\\ 0 & 1 \\end{bmatrix}").scale(0.8);
    label.moveTo([-5.2, 3.2, 0]);
    const detText = new Text("det = ", { fontSize: 0.45, color: "#FFFF00" });
    const detValue = new DecimalNumber(1, { numDecimalPlaces: 2, fontSize: 0.45, color: "#FFFF00" });
    detText.moveTo([-5.6, 2.4, 0]);
    detValue.nextTo(detText, [1, 0, 0], 0.15);
    this.add(label, detText, detValue);
    await this.wait(1);

    // Beat 1: shear [[1, 1], [0, 1]] — det stays 1.
    const shear = [[1, 1], [0, 1]];
    await this.applyMatrix(shear, { runTime: 2.5 });
    detValue.setValue(det(shear));
    await this.wait(1);

    // Beat 2: compose with a stretch-rotate [[0, -1.5], [1, 0]] (det 1.5).
    const rot = [[0, -1.5], [1, 0]];
    const label2 = new MathTex("A = \\begin{bmatrix} 0 & -1.5 \\\\ 1 & 0 \\end{bmatrix}").scale(0.8);
    label2.moveTo(label.getCenter());
    this.remove(label);
    this.add(label2);
    await this.applyMatrix(rot, { runTime: 2.5 });
    detValue.setValue(det(rot) * det(shear));
    await this.wait(1.5);
  }
}

await demoRender(LinearTransformation, import.meta.url, { mathTex: true });
