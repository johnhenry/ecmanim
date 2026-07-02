// Coverage sweep: exercises registered mobjects that had zero usage anywhere
// in examples/ or test/ before this file (found via a registry audit — see
// sweep-registry output in the test report). Grouped into labeled sections so
// each family is easy to spot in the rendered video.
// Run: node examples/coverage-mobjects.ts -> examples/out/coverage-mobjects.mp4
import {
  render, ThreeDScene, ThreeDCamera, VGroup, Text, Create, FadeIn, Write,
  Arrow, ArrowTriangleTip, ArrowCircleTip, ArrowSquareFilledTip,
  Brace, BraceBetweenPoints, BraceText,
  CurvedDoubleArrow, ArrowCircleFilledTip,
  DecimalTable, IntegerTable, MathTable, MobjectTable,
  IntegerMatrix, MobjectMatrix,
  Ellipse, ScreenRectangle, FullScreenRectangle,
  NumberLine, UnitInterval,
  Integer,
  ThreeDVMobject, Sphere, ParametricSurface,
  LabeledArrow, LabeledLine,
  Polygram,
  VectorField, ArrowVectorField,
  Circle, Dot,
  BLUE, GREEN, RED, YELLOW, TEAL, PURPLE, ORANGE, WHITE,
  DEGREES, UP, DOWN,
} from "../src/node.ts";

function label(text: string, point: number[]) {
  return new Text(text, { fontSize: 0.22, color: WHITE, point, opacity: 0.85 });
}

class CoverageMobjects extends ThreeDScene {
  async construct() {
    this.setCameraOrientation({ phi: 0, theta: -90 * DEGREES });

    // 1. Arrow tip shapes (previously only the default ArrowTriangleFilledTip
    //    was exercised; these three tip classes were never instantiated).
    const tipRow = new VGroup(
      new Arrow([0, 0, 0], [1.6, 0, 0], { tipShape: ArrowTriangleTip, color: BLUE }),
      new Arrow([0, 0, 0], [1.6, 0, 0], { tipShape: ArrowCircleTip, color: GREEN }),
      new Arrow([0, 0, 0], [1.6, 0, 0], { tipShape: ArrowSquareFilledTip, color: RED }),
    );
    tipRow.submobjects.forEach((a, i) => a.shift([0, -i * 0.7, 0]));
    tipRow.moveTo([-5.8, 2.5, 0]);
    const tipLabel = label("Triangle/Circle/Square tips", [-5.8, 3.5, 0]);

    // 2. Braces
    const braceTarget = new Text("2x + 1", { fontSize: 0.5, color: WHITE }).moveTo([-2.3, 2.6, 0]);
    const brace = new Brace(braceTarget, { direction: DOWN });
    const braceBetween = new BraceBetweenPoints([-2.9, 1.4, 0], [-1.7, 1.4, 0], { direction: DOWN });
    const braceText = new BraceText(braceTarget, "term", { braceDirection: DOWN });
    const braceLabel = label("Brace/BraceBetweenPoints/BraceText", [-2.3, 3.5, 0]);

    // 3. CurvedDoubleArrow with a non-default tip shape.
    const curvedDouble = new CurvedDoubleArrow([2, 2.2, 0], [4.5, 3.0, 0], {
      tipShape: ArrowCircleFilledTip, color: TEAL,
    });
    const curvedLabel = label("CurvedDoubleArrow", [3.25, 3.5, 0]);

    const topRow = new VGroup(tipRow, tipLabel, braceTarget, brace, braceBetween, braceText, braceLabel, curvedDouble, curvedLabel);

    // 4. Tables + matrices.
    const decTable = new DecimalTable([[1.5, 2.75], [3.1, 4.2]]).scale(0.5).moveTo([-5.2, -0.6, 0]);
    const intTable = new IntegerTable([[1, 2], [3, 4]]).scale(0.5).moveTo([-3.2, -0.6, 0]);
    const mathTable = new MathTable([["x^2", "y^2"]]).scale(0.5).moveTo([-1.2, -0.6, 0]);
    const mobjTable = new MobjectTable([
      [new Dot({ color: RED }), new Dot({ color: BLUE })],
      [new Dot({ color: GREEN }), new Dot({ color: YELLOW })],
    ]).scale(0.5).moveTo([0.8, -0.6, 0]);
    const intMatrix = new IntegerMatrix([[1, 0], [0, 1]]).scale(0.5).moveTo([2.6, -0.6, 0]);
    const mobjMatrix = new MobjectMatrix([[new Dot({ color: PURPLE }), new Dot({ color: ORANGE })]]).scale(0.5).moveTo([4.6, -0.6, 0]);
    const tableLabel = label("Decimal/Integer/Math/Mobject Table, Integer/Mobject Matrix", [0, 0.4, 0]);

    // 5. Geometry: Ellipse, ScreenRectangle, FullScreenRectangle (drawn small/scaled — the
    //    latter two default to the full 14.22x8 camera frame).
    const ellipse = new Ellipse({ width: 2, height: 1, color: YELLOW }).moveTo([-4.5, -2.6, 0]);
    const screenRect = new ScreenRectangle({ height: 1.4 }).moveTo([-2, -2.6, 0]);
    const fullScreenRect = new FullScreenRectangle({ color: TEAL }).scale(0.14).moveTo([0.3, -2.6, 0]);
    const geomLabel = label("Ellipse/ScreenRectangle/FullScreenRectangle", [-1.5, -1.9, 0]);

    // 6. NumberLine / UnitInterval, Integer value tracker, LabeledLine/LabeledArrow.
    const numberLine = new NumberLine({ xRange: [-3, 3, 1], length: 3, includeNumbers: true }).scale(0.6).moveTo([3.2, -2.9, 0]);
    const unitInterval = new UnitInterval({ color: GREEN }).scale(0.5).moveTo([3.2, -3.6, 0]);
    const intTracker = new Integer(42, { unit: " pts" }).scale(0.8).moveTo([5.2, -2.6, 0]);
    const labeledLine = new LabeledLine([-6.5, -3.4, 0], [-5.2, -3.4, 0], { label: "d", fontSize: 0.3 });
    const labeledArrow = new LabeledArrow([-6.5, -4.0, 0], [-5.2, -4.0, 0], { label: "F", tipShape: ArrowCircleFilledTip, fontSize: 0.3 });
    const numberLabel = label("NumberLine/UnitInterval/Integer/Labeled*", [3.2, -4.3, 0]);

    // 7. Polygram: two disjoint triangle loops in one mobject.
    const polygram = new Polygram(
      [[[-6.6, 1.2, 0], [-6.0, 2.0, 0], [-7.2, 2.0, 0]], [[-5.6, 1.2, 0], [-5.0, 2.0, 0], [-6.2, 2.0, 0]]],
      { fillOpacity: 0.6, color: PURPLE },
    );
    const polygramLabel = label("Polygram", [-6.3, 0.75, 0]);

    const bottomGroup = new VGroup(
      decTable, intTable, mathTable, mobjTable, intMatrix, mobjMatrix, tableLabel,
      ellipse, screenRect, fullScreenRect, geomLabel,
      numberLine, unitInterval, intTracker, labeledLine, labeledArrow, numberLabel,
      polygram, polygramLabel,
    );

    await this.play(new FadeIn(topRow), new FadeIn(bottomGroup), { _playConfig: true, runTime: 1 });
    await this.wait(0.8);
    await this.play(new Create(brace), new Write(braceText.label ?? braceText));

    // 8. VectorField is a headless data class (no visual output by itself) —
    //    verify it evaluates and pair it with ArrowVectorField, its renderable
    //    subclass, to show something on screen.
    const field = new VectorField((p: number[]) => [p[1], -p[0], 0]);
    console.log("VectorField sample eval at [1,0,0]:", field.func([1, 0, 0]));
    const arrowField = new ArrowVectorField((p: number[]) => [p[1], -p[0], 0], {
      xRange: [-1, 1, 0.5], yRange: [-1, 1, 0.5], length: 0.35,
    }).scale(0.7).moveTo([5.4, 1.6, 0]);
    const fieldLabel = label("VectorField->ArrowVectorField", [5.4, 2.7, 0]);
    await this.play(new FadeIn(arrowField), new FadeIn(fieldLabel), { _playConfig: true, runTime: 0.8 });

    await this.wait(0.6);

    // 9. ThreeDVMobject: a marker base class flagging Lambertian shading /
    //    depth-sorting. Orbit the camera to show it actually gets 3D treatment.
    const marker = new ThreeDVMobject({ color: ORANGE });
    marker.setPointsAsCorners([[6.5, -1, 0], [7.5, -1, 0], [7.5, 0, 0], [6.5, 0, 0], [6.5, -1, 0]]);
    (marker as any).fillOpacity = 0.7;
    const sphere3d = new Sphere({ radius: 0.6, fillColor: BLUE }).moveTo([6.5, 1, 0]);
    // ParametricSurface is Surface exported under its Python-manim name (an
    // alias, not a subclass) — used here by that name so it's not the one
    // registered mobject with no example anywhere in the repo.
    const saddle = new ParametricSurface(
      (u: number, v: number) => [u, v, 0.3 * (u * u - v * v)],
      { uRange: [-0.8, 0.8], vRange: [-0.8, 0.8], resolution: [12, 12], checkerboardColors: ["#F0AC5F", "#8C5A20"] },
    ).moveTo([7.6, -0.3, 0.3]);
    await this.play(new FadeIn(marker), new FadeIn(sphere3d), new FadeIn(saddle), { _playConfig: true, runTime: 0.6 });
    await this.moveCamera({ phi: 55 * DEGREES, theta: -60 * DEGREES }, { runTime: 2 });
    await this.wait(0.4);
  }
}

await render(CoverageMobjects, {
  output: "examples/out/coverage-mobjects.mp4",
  quality: "medium",
  background: "#0d1117",
  camera: new ThreeDCamera({ phi: 0, theta: -90 * DEGREES }),
});
console.log("coverage-mobjects.ts done");
