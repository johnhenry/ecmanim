// Remotion-inspired `calculateMetadata` hook for scenes.
//
// A scene may declare two optional things:
//   - a static `schema` (a Schema from ../core/schema.ts) used to validate and
//     fill defaults for its params, and
//   - a `calculateMetadata` function (static or instance) that derives runtime
//     metadata (duration, fps, dimensions, ...) from the resolved params.
//
// `resolveSceneMetadata` ties these together: it validates params through the
// schema (if any), calls the hook (if any) with { params, defaults }, and
// merges the result over the supplied defaults.
//
// This module has no node-only imports so it stays browser-safe.

import type { Schema } from "../core/schema.ts";

export interface SceneMetadata {
  durationInFrames?: number;
  fps?: number;
  width?: number;
  height?: number;
  [key: string]: any;
}

export type CalculateMetadata<P = Record<string, any>> = (args: {
  params: P;
  defaults: SceneMetadata;
}) => SceneMetadata | Promise<SceneMetadata>;

// ---------------------------------------------------------------------------
// Helpers — dig a member out of a scene that might be a class, an instance, or
// a plain object. We check the value itself, then its constructor (for the
// "static member on the class of an instance" case).
// ---------------------------------------------------------------------------
function findMember(scene: any, name: string): any {
  if (scene == null) return undefined;
  if (scene[name] !== undefined) return scene[name];
  const ctor = scene.constructor;
  if (ctor && ctor !== Object && ctor[name] !== undefined) return ctor[name];
  return undefined;
}

function isSchema(value: any): value is Schema {
  return (
    value != null &&
    typeof value === "object" &&
    typeof value.parse === "function" &&
    typeof value.safeParse === "function"
  );
}

/**
 * Resolve final metadata for a scene given raw params.
 *
 * @param scene  a scene class, instance, or plain object; may carry `schema`
 *               and/or `calculateMetadata` (static or instance).
 * @param params raw, unvalidated params.
 * @param defaults baseline metadata that the hook result is merged over.
 * @returns the merged metadata plus the (possibly schema-validated) params.
 */
export async function resolveSceneMetadata(
  scene: any,
  params: Record<string, any> = {},
  defaults: SceneMetadata = {},
): Promise<{ metadata: SceneMetadata; params: Record<string, any> }> {
  let resolvedParams: Record<string, any> = params ?? {};

  // 1. Validate + fill defaults through the schema, if present.
  const schema = findMember(scene, "schema");
  if (isSchema(schema)) {
    resolvedParams = schema.parse(resolvedParams);
  }

  // 2. Start from the supplied defaults.
  const metadata: SceneMetadata = { ...defaults };

  // 3. Call the metadata hook, if present, and merge its result over defaults.
  const hook = findMember(scene, "calculateMetadata");
  if (typeof hook === "function") {
    const result = await hook({ params: resolvedParams, defaults });
    if (result && typeof result === "object") {
      Object.assign(metadata, result);
    }
  }

  return { metadata, params: resolvedParams };
}
