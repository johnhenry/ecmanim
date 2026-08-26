// The plugin registry. A plugin is anything with an `install(api)` method (or a
// bare function); `use()` runs it against the shared registry so it can add
// mobjects, animations, rate functions, colors, renderers, or scene types. This
// works identically in Node and the unbundled browser (no filesystem discovery).

import type { RateFunc } from "../core/types.ts";
import type { StylePreset } from "../core/presets.ts";

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
  /** Parameterized rate-function factories, e.g. registerRateFunctionFactory("backOut", overshoot => ...)
   *  resolved via running("backOut:2")-style colon-suffixed names (see rate_functions.ts). */
  rateFunctionFactories = new Map<string, (...args: number[]) => RateFunc>();
  colors = new Map<string, string>();
  renderers = new Map<string, any>();
  scenes = new Map<string, any>();
  /** Named style/theme presets, extending core/presets.ts's built-in STYLE_PRESETS. */
  stylePresets = new Map<string, StylePreset>();
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
  registerRateFunctionFactory(name: string, factory: (...args: number[]) => RateFunc): this {
    this.rateFunctionFactories.set(name, factory);
    return this;
  }
  registerColor(name: string, value: string): this { this.colors.set(name, value); return this; }
  registerRenderer(name: string, factory: any): this { this.renderers.set(name, factory); return this; }
  registerScene(name: string, cls: any): this { this.scenes.set(name, cls); return this; }
  registerStylePreset(name: string, preset: StylePreset): this { this.stylePresets.set(name, preset); return this; }

  get(kind: RegistryKind, name: string): any { return this.mapFor(kind).get(name); }
  has(kind: RegistryKind, name: string): boolean { return this.mapFor(kind).has(name); }
  list(kind: RegistryKind): string[] { return [...this.mapFor(kind).keys()]; }

  /** Install a plugin (or bare install function). Chainable.
   *
   *  `install()` runs inside a try/catch: previously an uncaught throw
   *  propagated straight out with no indication of WHICH plugin failed --
   *  opaque, especially once several plugins are use()'d in sequence, and a
   *  throw took down the whole registration (any plugins after it in the
   *  same call chain never installed either). The failure is now
   *  attributed to the specific plugin (by name when the plugin provides
   *  one) and re-thrown as a new, clearer error -- fail LOUD rather than
   *  silently skip, since a plugin that can't install usually means real
   *  functionality is missing, and a caller deserves to know synchronously
   *  rather than discover it later as a mysterious "unknown mobject/
   *  animation" error far from the actual cause. */
  use(plugin: PluginLike): this {
    const p: Plugin = typeof plugin === "function" ? { install: plugin } : plugin;
    const label = p.name ? `"${p.name}"` : "(unnamed plugin)";
    try {
      p.install(this);
    } catch (err: any) {
      const message = `Plugin ${label} failed to install: ${err?.message ?? err}`;
      console.error(`[ecmanim plugins] ${message}`);
      throw new Error(message, { cause: err });
    }
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
