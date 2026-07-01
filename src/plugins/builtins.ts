// Register the built-in library into the shared registry, so built-ins and
// third-party plugins are looked up the same way (by name) and plugins can
// extend or override them. Also publishes the base classes on registry.bases.

import { registry } from "./registry.ts";
import { Mobject } from "../mobject/Mobject.ts";
import { VMobject, VGroup } from "../mobject/VMobject.ts";
import { Animation } from "../animation/Animation.ts";
import { Scene } from "../scene/Scene.ts";
import { Color } from "../core/color.ts";

import * as geometry from "../mobject/geometry.ts";
import * as tips from "../mobject/tips.ts";
import * as arcs from "../mobject/arcs.ts";
import * as polygram from "../mobject/polygram.ts";
import * as shapeMatchers from "../mobject/shape_matchers.ts";
import * as vectors from "../mobject/vectors.ts";
import * as labeled from "../mobject/labeled.ts";
import * as booleanOps from "../mobject/boolean_ops.ts";
import * as matrix from "../mobject/matrix.ts";
import * as table from "../mobject/table.ts";
import * as brace from "../mobject/brace.ts";
import * as graph from "../mobject/graph.ts";
import * as functionsMod from "../mobject/functions.ts";
import * as probabilityMod from "../mobject/probability.ts";
import * as vectorFieldMod from "../mobject/vector_field.ts";
import * as surface from "../mobject/surface.ts";
import * as polyhedra from "../mobject/polyhedra.ts";
import * as coords from "../mobject/coordinate_systems.ts";
import * as valueTracker from "../mobject/value_tracker.ts";
import * as textMod from "../mobject/text/Text.ts";
import * as paragraphMod from "../mobject/text/paragraph.ts";
import * as texExtrasMod from "../mobject/text/tex_extras.ts";
import * as codeMod from "../mobject/text/code.ts";
import * as variableMod from "../mobject/text/variable.ts";
import * as numbersAnim from "../animation/numbers.ts";
import * as vtextMod from "../mobject/vectorized_text.ts";
import * as mathtexMod from "../mobject/mathtex.ts";
import * as svgMod from "../mobject/svg_mobject.ts";
import * as imageMod from "../mobject/image_mobject.ts";
import * as threeDMod from "../scene/three_d.ts";
import * as movingCamScene from "../scene/moving_camera_scene.ts";
import * as zoomedScene from "../scene/zoomed_scene.ts";
import * as vectorScene from "../scene/vector_space_scene.ts";
import * as animationMod from "../animation/Animation.ts";
import * as extra from "../animation/extra.ts";
import * as composition from "../animation/composition.ts";
import * as creationExtra from "../animation/creation_extra.ts";
import * as transformExtra from "../animation/transform_extra.ts";
import * as transformMatching from "../animation/transform_matching.ts";
import * as movementAnim from "../animation/movement.ts";
import * as indicationExtra from "../animation/indication_extra.ts";
import * as changingAnim from "../animation/changing.ts";
import * as specializedAnim from "../animation/specialized.ts";
import * as complexVT from "../mobject/complex_value_tracker.ts";
import { RATE_FUNCTIONS } from "../animation/rate_functions.ts";
import * as colorMod from "../core/color.ts";

const isSubclassOf = (v: any, base: any) =>
  typeof v === "function" && (v === base || v.prototype instanceof base);

let done = false;

export function registerBuiltins(): typeof registry {
  if (done) return registry;
  done = true;

  const mobjectModules = [geometry, tips, arcs, polygram, shapeMatchers, vectors,
    labeled, booleanOps, matrix, table, brace, graph, surface, polyhedra, coords, functionsMod, probabilityMod, vectorFieldMod,
    complexVT, valueTracker, textMod, paragraphMod, texExtrasMod, codeMod, variableMod, vtextMod, mathtexMod, svgMod, imageMod, threeDMod, movingCamScene, zoomedScene, vectorScene];
  for (const mod of mobjectModules) {
    for (const [name, value] of Object.entries(mod)) {
      if (isSubclassOf(value, Mobject)) registry.registerMobject(name, value);
      if (isSubclassOf(value, Scene) && value !== Scene) registry.registerScene(name, value);
    }
  }

  const animationModules = [animationMod, extra, composition, numbersAnim, creationExtra,
    transformExtra, transformMatching, movementAnim, indicationExtra, changingAnim, specializedAnim];
  for (const mod of animationModules) {
    for (const [name, value] of Object.entries(mod)) {
      if (isSubclassOf(value, Animation)) registry.registerAnimation(name, value);
    }
  }

  for (const [name, fn] of Object.entries(RATE_FUNCTIONS)) {
    registry.registerRateFunction(name, fn as any);
  }

  for (const [name, value] of Object.entries(colorMod)) {
    if (typeof value === "string" && value.startsWith("#")) registry.registerColor(name, value);
  }

  registry.registerScene("Scene", Scene);
  registry.bases = { Mobject, VMobject, VGroup, Animation, Scene, Color };
  return registry;
}
