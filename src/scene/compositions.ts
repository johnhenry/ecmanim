// A registry of named "compositions" — renderable Scenes with metadata (like
// Remotion's <Composition> list / getCompositions()). Lets tooling enumerate what
// can be rendered, with each entry's params schema and defaults, and underpins
// renderStill and the CLI `scenes` listing. Isomorphic (pure data).

export interface CompositionDescriptor {
  name: string;
  /** The Scene subclass (or a construct function). */
  scene: any;
  description?: string;
  /** Default fps/dimensions for this composition (optional). */
  fps?: number;
  width?: number;
  height?: number;
  durationInFrames?: number;
  /** A params schema (defineSchema result) if the scene is parameterized. */
  schema?: any;
  defaultParams?: Record<string, any>;
}

const registry = new Map<string, CompositionDescriptor>();

/** Register a renderable composition by name. Later registrations overwrite. */
export function registerComposition(
  name: string,
  scene: any,
  config: Omit<CompositionDescriptor, "name" | "scene"> = {},
): CompositionDescriptor {
  const desc: CompositionDescriptor = {
    name,
    scene,
    // Pick up a static `schema` on the Scene class if present.
    schema: config.schema ?? scene?.schema ?? scene?.constructor?.schema,
    ...config,
  };
  registry.set(name, desc);
  return desc;
}

/** Look up a composition by name. */
export function getComposition(name: string): CompositionDescriptor | undefined {
  return registry.get(name);
}

/** All registered compositions, in insertion order. */
export function listCompositions(): CompositionDescriptor[] {
  return Array.from(registry.values());
}

/** A JSON-serializable summary of every composition (for `--json` CLI output). */
export function compositionsToJSON(): Array<Record<string, any>> {
  return listCompositions().map((c) => ({
    name: c.name,
    description: c.description,
    fps: c.fps,
    width: c.width,
    height: c.height,
    durationInFrames: c.durationInFrames,
    schema: c.schema?.spec,
    defaultParams: c.defaultParams,
  }));
}

/** Remove a composition (mainly for tests). */
export function unregisterComposition(name: string): boolean {
  return registry.delete(name);
}

/** Clear all (tests). */
export function _clearCompositions(): void {
  registry.clear();
}
