// Brace mobjects: a curly-brace VMobject spanning a mobject's extent in a given
// direction, with helpers for attaching a text/tex label at the brace tip.
// Ported (shape-approximated) from ManimCommunity's manim/mobject/svg/brace.py.
// Rather than rendering a LaTeX \underbrace glyph, the brace outline is built
// directly from bezier/corner points: two half-spans meeting at a central tip.

import { VMobject, VGroup } from "./VMobject.ts";
import { Mobject, Group } from "./Mobject.ts";
import { Text } from "./text/Text.ts";
import { MathTex } from "./mathtex.ts";
import * as V from "../core/math/vector.ts";

/** Configuration for a Brace. */
export interface BraceConfig {
  direction?: number[];
  buff?: number;
  sharpness?: number;
  strokeColor?: any;
  fillColor?: any;
  color?: any;
  [key: string]: any;
}

const DEFAULT_BUFF = 0.2;
// Height (thickness) of the brace measured perpendicular to its span.
const BRACE_HEIGHT = 0.3;

// Build a curly-brace outline (a filled VMobject) spanning `width` centered at
// the origin, opening downward (tip pointing in -y). The shape is two mirrored
// half-braces meeting at a central downward tip.
function braceOutline(width: number, height: number, sharpness = 2): number[][] {
  const w = Math.max(width, 0.01);
  const half = w / 2;
  const h = height;
  void sharpness;
  // Smooth anchor points tracing the top edge left->right with a central dip,
  // then back along the bottom edge. A thin curly-brace silhouette.
  const t = h * 0.28; // thickness of the stroke band
  const anchors: number[][] = [
    [-half, 0, 0],           // far-left top
    [-half * 0.5, -h * 0.35, 0],
    [0, -h, 0],              // central tip (bottom)
    [half * 0.5, -h * 0.35, 0],
    [half, 0, 0],            // far-right top
    [half, t, 0],            // back along the top band, right
    [half * 0.5, -h * 0.35 + t, 0],
    [0, -h + t, 0],          // tip band
    [-half * 0.5, -h * 0.35 + t, 0],
    [-half, t, 0],           // back to far-left top band
  ];
  return anchors;
}

export class Brace extends VMobject {
  direction: number[];
  buff: number;
  private _tip: number[];
  private _span: number;

  constructor(mobject: Mobject | number[][], config: BraceConfig = {}) {
    super({
      fillOpacity: 1,
      strokeWidth: 0,
      ...(config as any),
    });
    this.direction = config.direction ?? V.DOWN;
    this.buff = config.buff ?? DEFAULT_BUFF;
    const sharpness = config.sharpness ?? 2;

    // Determine the extent to span. For a mobject, project its bounding box
    // onto the axis perpendicular to `direction`.
    const dir = V.normalize(this.direction);
    // The width axis is perpendicular to the brace direction (in-plane).
    const widthAxis = [-dir[1], dir[0], 0];

    let box: { min: number[]; max: number[] };
    if (mobject instanceof Mobject) {
      box = mobject.getBoundingBox();
    } else {
      // Accept a pair (or list) of points.
      let min = [Infinity, Infinity, Infinity];
      let max = [-Infinity, -Infinity, -Infinity];
      for (const p of mobject as number[][]) {
        for (let i = 0; i < 3; i++) {
          if (p[i] < min[i]) min[i] = p[i];
          if (p[i] > max[i]) max[i] = p[i];
        }
      }
      box = { min, max };
    }

    // Span = projected size of the box along the width axis.
    const corners = [
      [box.min[0], box.min[1], 0],
      [box.max[0], box.min[1], 0],
      [box.max[0], box.max[1], 0],
      [box.min[0], box.max[1], 0],
    ];
    let lo = Infinity, hi = -Infinity;
    for (const c of corners) {
      const proj = V.dot(c, widthAxis);
      if (proj < lo) lo = proj;
      if (proj > hi) hi = proj;
    }
    const span = Math.max(hi - lo, 0.01);
    this._span = span;

    // Build the outline (opening in -y), then rotate it so its opening faces
    // `direction`, and position it just beyond the mobject in that direction.
    const anchors = braceOutline(span, BRACE_HEIGHT, sharpness);
    this.setPointsSmoothly([...anchors, anchors[0]]);

    // Rotate from the default DOWN opening to the requested direction.
    const baseAngle = V.angleOf(V.DOWN); // -pi/2
    const targetAngle = V.angleOf(dir);
    this.rotate(targetAngle - baseAngle, { aboutPoint: [0, 0, 0] });

    // Position: the brace's far (flat) edge should sit at the mobject's
    // boundary in `direction`, offset by buff.
    const center = mobject instanceof Mobject
      ? mobject.getCenter()
      : [(box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, 0];
    // Distance from center to the boundary along `direction`.
    let reach = 0;
    for (const c of corners) {
      const proj = V.dot(V.sub(c, center), dir);
      if (proj > reach) reach = proj;
    }
    const braceCenter = V.add(center, V.scale(dir, reach + this.buff + BRACE_HEIGHT / 2));
    this.moveTo(braceCenter);

    // Record the tip (the pointy middle) for label placement.
    this._tip = V.add(center, V.scale(dir, reach + this.buff + BRACE_HEIGHT));

    if (config.color) this.setColor(config.color);
  }

  // The point at the tip of the brace (where a label attaches).
  getTip(): number[] {
    return this._tip;
  }

  getBraceDirection(): number[] {
    return V.normalize(this.direction);
  }

  // Move a mobject so it sits just beyond the brace tip.
  putAtTip(mob: Mobject, buff = 0.25): this {
    const tip = this.getTip();
    const dir = this.getBraceDirection();
    mob.moveTo(V.add(tip, V.scale(dir, buff + mob.getHeight() / 2)));
    return this;
  }

  // Build a MathTex label placed at the brace tip.
  getTex(...tex: string[]): MathTex {
    const label = new MathTex(tex.join(""));
    this.putAtTip(label);
    return label;
  }

  // Build a Text label placed at the brace tip.
  getText(...text: string[]): Text {
    const label = new Text(text.join(" "));
    this.putAtTip(label);
    return label;
  }
}

// A Brace together with a label mobject, grouped for convenience.
export interface BraceLabelConfig {
  braceDirection?: number[];
  buff?: number;
  labelBuff?: number;
  labelConstructor?: (text: string) => Mobject;
  [key: string]: any;
}

export class BraceLabel extends Group {
  brace: Brace;
  label: Mobject;

  constructor(mobject: Mobject, text: string, config: BraceLabelConfig = {}) {
    super();
    const braceDirection = config.braceDirection ?? V.DOWN;
    const labelConstructor = config.labelConstructor
      ?? ((t: string) => new MathTex(t));
    this.brace = new Brace(mobject, { direction: braceDirection, buff: config.buff });
    this.label = labelConstructor(text);
    this.brace.putAtTip(this.label, config.labelBuff ?? 0.25);
    this.add(this.brace, this.label);
  }

  // Shift the whole group so the brace still hugs a (new) mobject.
  getBrace(): Brace {
    return this.brace;
  }

  getLabel(): Mobject {
    return this.label;
  }
}

// Alias matching manim's BraceText (label built from a tex string).
export class BraceText extends BraceLabel {
  constructor(mobject: Mobject, text: string, config: BraceLabelConfig = {}) {
    super(mobject, text, {
      labelConstructor: (t: string) => new MathTex(t),
      ...config,
    });
  }
}

// A brace spanning the segment between two points.
export interface BraceBetweenPointsConfig extends BraceConfig {
  direction?: number[];
}

export class BraceBetweenPoints extends Brace {
  constructor(p1: number[], p2: number[], config: BraceBetweenPointsConfig = {}) {
    // Default direction is perpendicular to the p1->p2 segment.
    let direction = config.direction;
    if (!direction) {
      const along = V.normalize(V.sub(p2, p1));
      direction = [along[1], -along[0], 0];
    }
    super([p1, p2], { ...config, direction });
  }
}

void VGroup;
