// Animation base class plus the core concrete animations. An Animation mutates
// its target mobject each frame given interpolated alpha in [0,1].

import { smooth, linear, running } from "./rate_functions.js";
import { Color } from "../core/color.js";
import * as V from "../core/math/vector.js";

export class Animation {
  constructor(mobject, config = {}) {
    this.mobject = mobject;
    this.runTime = config.runTime ?? 1;
    this.rateFunc = running(config.rateFunc ?? smooth);
    this.remover = config.remover ?? false; // remove mobject from scene when done
    this.introducer = config.introducer ?? false; // add mobject to scene at start
    this.lagRatio = config.lagRatio ?? 0;
    this.started = false;
    this.finished = false;
  }

  // Called once when the animation starts playing.
  begin() {
    this.started = true;
    this.startState = this.mobject.copy();
    this.setup();
    this.interpolate(0);
    return this;
  }

  setup() {}

  finish() {
    this.interpolate(1);
    this.finished = true;
    return this;
  }

  // alpha is raw progress in [0,1]; subclasses override interpolateMobject.
  interpolate(alpha) {
    this.interpolateMobject(this.rateFunc(Math.max(0, Math.min(1, alpha))));
  }

  interpolateMobject(_alpha) {}

  getMobjectsToIntroduce() {
    return this.introducer ? [this.mobject] : [];
  }

  getMobjectsToRemove() {
    return this.remover ? [this.mobject] : [];
  }
}

// --- transform-style animations -------------------------------------------
export class Transform extends Animation {
  constructor(mobject, target, config = {}) {
    super(mobject, config);
    this.target = target;
    this.replace = config.replace ?? false;
  }

  setup() {
    // Align point counts so interpolation is well defined.
    if (this.mobject.alignPointsWith && this.target.alignPointsWith) {
      this.targetCopy = this.target.copy();
      this.startCopy = this.startState.copy();
      this.startCopy.alignPointsWith(this.targetCopy);
      this.targetCopy.alignPointsWith(this.startCopy);
      // Reset the live mobject to the aligned start geometry.
      this.mobject.points = this.startCopy.points.map((p) => [...p]);
      this.mobject.subpathStarts = [...(this.startCopy.subpathStarts ?? [])];
      this.startState = this.startCopy;
    } else {
      this.targetCopy = this.target.copy();
    }
  }

  interpolateMobject(alpha) {
    this.mobject.interpolate(this.startState, this.targetCopy, alpha);
  }
}

export class ReplacementTransform extends Transform {
  constructor(mobject, target, config = {}) {
    super(mobject, target, { ...config, replace: true });
    this.remover = true;
    this.introducer = true;
    this.introduced = target;
  }

  finish() {
    super.finish();
    // Leave the target geometry in place under the original mobject.
    return this;
  }
}

// --- creation animations ---------------------------------------------------
export class Create extends Animation {
  constructor(mobject, config = {}) {
    super(mobject, { rateFunc: config.rateFunc ?? smooth, ...config, introducer: true });
  }

  setup() {
    this.origFill = this.mobject.getFamily().map((m) => m.fillOpacity ?? 0);
  }

  interpolateMobject(alpha) {
    const fam = this.mobject.getFamily();
    fam.forEach((m, i) => {
      if (m._isText) {
        m.revealFraction = alpha; // typewriter reveal for Text
        return;
      }
      m.strokeEnd = alpha;
      // Fade fill in only over the final stretch so the outline draws first.
      if (m.fillOpacity != null) m.fillOpacity = this.origFill[i] * Math.max(0, (alpha - 0.5) * 2);
    });
  }

  finish() {
    const fam = this.mobject.getFamily();
    fam.forEach((m, i) => {
      if (m._isText) { m.revealFraction = 1; return; }
      m.strokeEnd = 1;
      if (m.fillOpacity != null) m.fillOpacity = this.origFill[i];
    });
    this.finished = true;
    return this;
  }
}

export class Write extends Create {
  constructor(mobject, config = {}) {
    super(mobject, { runTime: config.runTime ?? 1.5, rateFunc: config.rateFunc ?? linear, ...config });
  }
}

export class Uncreate extends Create {
  constructor(mobject, config = {}) {
    super(mobject, config);
    this.remover = true;
    this.introducer = false;
  }

  interpolateMobject(alpha) {
    super.interpolateMobject(1 - alpha);
  }

  finish() {
    this.mobject.getFamily().forEach((m) => (m.strokeEnd = 0));
    this.finished = true;
    return this;
  }
}

// --- fading ----------------------------------------------------------------
export class FadeIn extends Animation {
  constructor(mobject, config = {}) {
    super(mobject, { ...config, introducer: true });
    this.shiftVec = config.shift ?? [0, 0, 0];
    this.scaleFactor = config.scale ?? 1;
  }

  setup() {
    const fam = this.mobject.getFamily();
    this.targetOpacities = fam.map((m) => ({
      fill: m.fillOpacity ?? m.opacity ?? 1,
      stroke: m.strokeOpacity ?? m.opacity ?? 1,
      op: m.opacity ?? 1,
    }));
    this.finalPoints = fam.map((m) => m.points.map((p) => [...p]));
    // The mobject fades in from a state scaled by `scale` about its center and
    // shifted by `-shift` (manim's _Fade). Precompute that start geometry.
    const c = this.mobject.getCenter();
    const s = this.scaleFactor;
    this.startPoints = this.finalPoints.map((pts) => pts.map((p) => [
      c[0] + (p[0] - c[0]) * s - this.shiftVec[0],
      c[1] + (p[1] - c[1]) * s - this.shiftVec[1],
      c[2] + (p[2] - c[2]) * s - this.shiftVec[2],
    ]));
  }

  interpolateMobject(alpha) {
    const fam = this.mobject.getFamily();
    fam.forEach((m, i) => {
      const t = this.targetOpacities[i];
      m.fillOpacity = t.fill * alpha;
      m.strokeOpacity = t.stroke * alpha;
      m.opacity = t.op;
      const start = this.startPoints[i];
      const final = this.finalPoints[i];
      for (let j = 0; j < m.points.length; j++) m.points[j] = V.lerp(start[j], final[j], alpha);
    });
  }

  finish() {
    this.interpolateMobject(1);
    this.finished = true;
    return this;
  }
}

export class FadeOut extends Animation {
  constructor(mobject, config = {}) {
    super(mobject, { ...config, remover: true });
    this.shiftVec = config.shift ?? [0, 0, 0];
    this.scaleFactor = config.scale ?? 1;
  }

  setup() {
    const fam = this.mobject.getFamily();
    this.startOpacities = fam.map((m) => ({
      fill: m.fillOpacity ?? m.opacity ?? 1,
      stroke: m.strokeOpacity ?? m.opacity ?? 1,
    }));
    this.startPoints = fam.map((m) => m.points.map((p) => [...p]));
    // Fades out toward a state scaled by `scale` about center and shifted by `shift`.
    const c = this.mobject.getCenter();
    const s = this.scaleFactor;
    this.endPoints = this.startPoints.map((pts) => pts.map((p) => [
      c[0] + (p[0] - c[0]) * s + this.shiftVec[0],
      c[1] + (p[1] - c[1]) * s + this.shiftVec[1],
      c[2] + (p[2] - c[2]) * s + this.shiftVec[2],
    ]));
  }

  interpolateMobject(alpha) {
    const fam = this.mobject.getFamily();
    fam.forEach((m, i) => {
      const s = this.startOpacities[i];
      m.fillOpacity = s.fill * (1 - alpha);
      m.strokeOpacity = s.stroke * (1 - alpha);
      const start = this.startPoints[i];
      const end = this.endPoints[i];
      for (let j = 0; j < m.points.length; j++) m.points[j] = V.lerp(start[j], end[j], alpha);
    });
  }

  finish() {
    this.interpolateMobject(1);
    this.finished = true;
    return this;
  }
}

// --- movement / method animations -----------------------------------------
export class ApplyMethod extends Animation {
  // Records the effect of calling `method(...args)` on a copy, then tweens to it.
  constructor(mobject, method, ...args) {
    // Drop a trailing undefined/null (from optional config params in factories).
    while (args.length && args[args.length - 1] == null) args.pop();
    let config = {};
    if (args.length && typeof args[args.length - 1] === "object" && args[args.length - 1]?._animConfig) {
      config = args.pop();
    }
    super(mobject, config);
    this.method = method;
    this.args = args;
  }

  setup() {
    this.targetCopy = this.mobject.copy();
    const fn = typeof this.method === "string" ? this.targetCopy[this.method] : this.method;
    fn.apply(this.targetCopy, this.args);
    if (this.mobject.alignPointsWith) {
      this.startState.alignPointsWith(this.targetCopy);
      this.targetCopy.alignPointsWith(this.startState);
      this.mobject.points = this.startState.points.map((p) => [...p]);
      this.mobject.subpathStarts = [...(this.startState.subpathStarts ?? [])];
    }
  }

  interpolateMobject(alpha) {
    this.mobject.interpolate(this.startState, this.targetCopy, alpha);
  }
}

// Convenience factories mirroring manim's mobject.animate syntax.
export const Shift = (mob, vec, config) => new ApplyMethod(mob, "shift", vec, config);
export const MoveTo = (mob, pt, config) => new ApplyMethod(mob, "moveTo", pt, config);
export const ScaleAnim = (mob, f, config) => new ApplyMethod(mob, "scale", f, config);
// NOTE: the animated `Rotate` lives in ./extra.js (a full Animation subclass with
// about_point support). Do not re-add a factory named `Rotate` here — it caused a
// duplicate-export collision.

export class FadeToColor extends ApplyMethod {
  constructor(mobject, color, config = {}) {
    super(mobject, "setColor", color, config);
  }
}
