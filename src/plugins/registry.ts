// The plugin registry. A plugin is anything with an `install(api)` method (or a
// bare function); `use()` runs it against the shared registry so it can add
// mobjects, animations, rate functions, colors, renderers, or scene types. This
// works identically in Node and the unbundled browser (no filesystem discovery).

import type { RateFunc } from "../core/types.ts";

export type RegistryKind = "mobject" | "animation" | "rateFunction" | "color" | "renderer" | "scene";

export interface Plugin {
  name?: string;
  version?: string;
  install(api: Registry): void;
}

export type PluginLike = Plugin | ((api: Registry) => void);

export class Registry {
  mobjects = new Map<string, any>();
  animations = new Map<string, any>();
  rateFunctions = new Map<string, RateFunc>();
  colors = new Map<string, string>();
  renderers = new Map<string, any>();
  scenes = new Map<string, any>();
  plugins: Plugin[] = [];
  /** Base classes exposed to plugin authors so they can extend without deep imports. */
  bases: Record<string, any> = {};

  private mapFor(kind: RegistryKind): Map<string, any> {
    switch (kind) {
      case "mobject": return this.mobjects;
      case "animation": return this.animations;
      case "rateFunction": return this.rateFunctions;
      case "color": return this.colors;
      case "renderer": return this.renderers;
      case "scene": return this.scenes;
    }
  }

  register(kind: RegistryKind, name: string, value: any): this {
    this.mapFor(kind).set(name, value);
    return this;
  }

  registerMobject(name: string, cls: any): this { this.mobjects.set(name, cls); return this; }
  registerAnimation(name: string, cls: any): this { this.animations.set(name, cls); return this; }
  registerRateFunction(name: string, fn: RateFunc): this { this.rateFunctions.set(name, fn); return this; }
  registerColor(name: string, value: string): this { this.colors.set(name, value); return this; }
  registerRenderer(name: string, factory: any): this { this.renderers.set(name, factory); return this; }
  registerScene(name: string, cls: any): this { this.scenes.set(name, cls); return this; }

  get(kind: RegistryKind, name: string): any { return this.mapFor(kind).get(name); }
  has(kind: RegistryKind, name: string): boolean { return this.mapFor(kind).has(name); }
  list(kind: RegistryKind): string[] { return [...this.mapFor(kind).keys()]; }

  /** Install a plugin (or bare install function). Chainable. */
  use(plugin: PluginLike): this {
    const p: Plugin = typeof plugin === "function" ? { install: plugin } : plugin;
    p.install(this);
    this.plugins.push(p);
    return this;
  }
}

/** The shared singleton registry. */
export const registry = new Registry();

/** Install a plugin against the shared registry. */
export function use(plugin: PluginLike): Registry {
  return registry.use(plugin);
}
