// GPU post-processing for ThreeRenderer via three's own bundled
// EffectComposer passes: bloom / film grain / glitch / LUT color grading /
// SMAA, plus user fragment-shader passes. Split deliberately in two:
//
//   loadPostModules(config)  -- ASYNC: dynamically imports only the
//                               "three/addons/postprocessing/*.js" modules
//                               the config actually needs (the /addons/
//                               alias resolves in Node AND browsers with the
//                               standard importmap -- the "examples/jsm"
//                               path form does not; see mesh_obj.ts).
//   buildComposer(...)       -- PURE/SYNC: wires passes from (possibly fake)
//                               modules, so unit tests inject
//                               EffectComposer-shaped mocks with no GL.
//
// THREE itself is injected (never imported), matching ThreeRenderer/
// bezier_shader conventions so this module stays out of non-WebGL builds.
//
// Color-space note: ThreeRenderer sets THREE.ColorManagement.enabled = false
// so GPU output matches the CPU renderer byte-for-byte-ish. three's
// OutputPass applies sRGB conversion + tone mapping and would break that
// parity -- it is therefore OPT-IN (config.output), default off, and render
// targets are left in the default color space.

export interface PostProcessingConfig {
  /** UnrealBloomPass. Threshold applies to the raw 0..1 channel values you
   *  set on mobjects (color management is disabled for CPU parity). */
  bloom?: { strength?: number; radius?: number; threshold?: number };
  /** FilmPass (animated grain; grayscale optionally). */
  film?: { intensity?: number; grayscale?: boolean };
  /** GlitchPass. `goWild` = continuous heavy glitch. */
  glitch?: boolean | { goWild?: boolean };
  /** LUTPass color grading. `url` loads a .cube/.3dl file (works through
   *  node-gl's JSON-serialized options); `texture` is a pre-built 3D LUT
   *  texture for direct browser use only. */
  lut?: { url?: string; texture?: any; intensity?: number };
  /** SMAAPass antialiasing (post-resolve). */
  smaa?: boolean;
  /** OutputPass (sRGB + tone mapping). OPT-IN: changes colors relative to
   *  the CPU renderer -- see the color-space note above. */
  output?: boolean;
  /** Custom fullscreen fragment-shader passes, applied in array order after
   *  bloom. The shader samples `tDiffuse` (the composed frame so far);
   *  `uTime` (seconds) and `uResolution` (vec2) are auto-provided when the
   *  GLSL source references them. Uniforms use the {value} convention. */
  custom?: Array<{
    fragmentShader: string;
    vertexShader?: string;
    uniforms?: Record<string, { value: any }>;
  }>;
}

export interface PostModules {
  EffectComposer: any;
  RenderPass: any;
  ShaderPass?: any;
  UnrealBloomPass?: any;
  FilmPass?: any;
  GlitchPass?: any;
  LUTPass?: any;
  SMAAPass?: any;
  OutputPass?: any;
  /** Pre-loaded LUT texture when config.lut.url was given. */
  lutTexture?: any;
}

export interface BuiltComposer {
  composer: any;
  setSize(w: number, h: number): void;
  /** Advance time-driven passes (film grain, glitch, uTime uniforms). */
  update(dt: number): void;
  dispose(): void;
}

// Standard fullscreen-quad copy vertex shader for custom passes.
const COPY_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Dynamically import exactly the postprocessing modules `config` needs.
 *  Throws a clear error if three isn't installed (it's an optionalDependency). */
export async function loadPostModules(config: PostProcessingConfig): Promise<PostModules> {
  const base = "three/addons/postprocessing/";
  try {
    const [composerMod, renderMod] = await Promise.all([
      import(/* @vite-ignore */ `${base}EffectComposer.js`),
      import(/* @vite-ignore */ `${base}RenderPass.js`),
    ]);
    const mods: PostModules = {
      EffectComposer: composerMod.EffectComposer,
      RenderPass: renderMod.RenderPass,
    };
    const wants: Array<[boolean, string, keyof PostModules]> = [
      [!!config.bloom, "UnrealBloomPass.js", "UnrealBloomPass"],
      [!!config.film, "FilmPass.js", "FilmPass"],
      [!!config.glitch, "GlitchPass.js", "GlitchPass"],
      [!!config.lut, "LUTPass.js", "LUTPass"],
      [!!config.smaa, "SMAAPass.js", "SMAAPass"],
      [!!config.output, "OutputPass.js", "OutputPass"],
      [!!config.custom?.length, "ShaderPass.js", "ShaderPass"],
    ];
    await Promise.all(wants.filter(([need]) => need).map(async ([, file, key]) => {
      const mod: any = await import(/* @vite-ignore */ `${base}${file}`);
      (mods as any)[key] = mod[key];
    }));
    if (config.lut?.url) {
      const isCube = /\.cube$/i.test(config.lut.url);
      const loaderMod: any = await import(
        /* @vite-ignore */ `three/addons/loaders/${isCube ? "LUTCubeLoader" : "LUT3dlLoader"}.js`
      );
      const Loader = isCube ? loaderMod.LUTCubeLoader : loaderMod.LUT3dlLoader;
      const result: any = await new Loader().loadAsync(config.lut.url);
      mods.lutTexture = result.texture3D ?? result.texture;
    }
    return mods;
  } catch (e: any) {
    throw new Error(
      `post-processing requires the optional 'three' dependency (and its bundled addons) -- ${e?.message ?? e}`,
    );
  }
}

/** Wire an EffectComposer from already-loaded (or fake) modules. Pure and
 *  synchronous -- everything async (module/LUT loading) happened in
 *  loadPostModules. Pass order: RenderPass, bloom, custom shader passes,
 *  film, glitch, LUT, SMAA, then OutputPass (only when opted in). */
export function buildComposer(
  THREE: any,
  modules: PostModules,
  glRenderer: any,
  scene: any,
  camera: any,
  config: PostProcessingConfig,
  size: { width: number; height: number },
): BuiltComposer {
  const composer = new modules.EffectComposer(glRenderer);
  composer.setSize(size.width, size.height);
  const passes: any[] = [];
  const timed: Array<{ pass: any; kind: "film" | "glitch" | "custom" }> = [];

  const add = (pass: any) => { composer.addPass(pass); passes.push(pass); };

  add(new modules.RenderPass(scene, camera));

  if (config.bloom && modules.UnrealBloomPass) {
    const b = config.bloom;
    add(new modules.UnrealBloomPass(
      new THREE.Vector2(size.width, size.height),
      b.strength ?? 1.0, b.radius ?? 0.4, b.threshold ?? 0.85,
    ));
  }

  for (const c of config.custom ?? []) {
    if (!modules.ShaderPass) break;
    const uniforms: Record<string, { value: any }> = {
      tDiffuse: { value: null },
      ...(c.uniforms ?? {}),
    };
    if (/\buTime\b/.test(c.fragmentShader) && !uniforms.uTime) uniforms.uTime = { value: 0 };
    if (/\buResolution\b/.test(c.fragmentShader) && !uniforms.uResolution) {
      uniforms.uResolution = { value: new THREE.Vector2(size.width, size.height) };
    }
    const pass = new modules.ShaderPass({
      uniforms,
      vertexShader: c.vertexShader ?? COPY_VERT,
      fragmentShader: c.fragmentShader,
    });
    add(pass);
    timed.push({ pass, kind: "custom" });
  }

  if (config.film && modules.FilmPass) {
    const pass = new modules.FilmPass(config.film.intensity ?? 0.35, config.film.grayscale ?? false);
    add(pass);
    timed.push({ pass, kind: "film" });
  }

  if (config.glitch && modules.GlitchPass) {
    const pass = new modules.GlitchPass();
    if (typeof config.glitch === "object" && config.glitch.goWild) pass.goWild = true;
    add(pass);
    timed.push({ pass, kind: "glitch" });
  }

  if (config.lut && modules.LUTPass && modules.lutTexture) {
    const pass = new modules.LUTPass({ lut: modules.lutTexture, intensity: config.lut.intensity ?? 1 });
    add(pass);
  } else if (config.lut?.texture && modules.LUTPass) {
    add(new modules.LUTPass({ lut: config.lut.texture, intensity: config.lut.intensity ?? 1 }));
  }

  if (config.smaa && modules.SMAAPass) add(new modules.SMAAPass());
  if (config.output && modules.OutputPass) add(new modules.OutputPass());

  let elapsed = 0;
  return {
    composer,
    setSize(w: number, h: number): void {
      composer.setSize(w, h);
      for (const p of passes) p.setSize?.(w, h);
      for (const { pass, kind } of timed) {
        if (kind === "custom" && pass.uniforms?.uResolution) pass.uniforms.uResolution.value.set(w, h);
      }
    },
    update(dt: number): void {
      elapsed += dt;
      for (const { pass, kind } of timed) {
        if (kind === "custom" && pass.uniforms?.uTime) pass.uniforms.uTime.value = elapsed;
        // FilmPass/GlitchPass advance via composer.render(deltaTime) below.
      }
    },
    dispose(): void {
      for (const p of passes) p.dispose?.();
      composer.dispose?.();
    },
  };
}
