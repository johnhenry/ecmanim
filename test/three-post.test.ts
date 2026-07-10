// Post-processing tests: buildComposer() is pure/sync so EffectComposer-
// shaped fakes prove pass wiring with no GL; one real-module smoke catches
// the "three/addons resolution" class of bug (the exact failure mode that
// bit the mesh loaders in browsers) without constructing render targets.

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildComposer, loadPostModules } from "../src/renderer/three_post.ts";
import { ThreeRenderer } from "../src/renderer/ThreeRenderer.ts";
import { ThreeDCamera } from "../src/scene/three_d.ts";
import { Sphere } from "../src/mobject/surface.ts";
import * as V from "../src/core/math/vector.ts";

function mockTHREE() {
  const V3 = () => ({
    x: 0, y: 0, z: 0,
    set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; },
  });
  const cam = (extra: any) => ({ position: V3(), up: V3(), lookAt() {}, updateProjectionMatrix() {}, ...extra });
  return {
    ColorManagement: { enabled: true },
    DoubleSide: 2,
    Color: class { c: any; constructor(c: any) { this.c = c; } },
    Vector2: class {
      x: number; y: number;
      constructor(x = 0, y = 0) { this.x = x; this.y = y; }
      set(x: number, y: number) { this.x = x; this.y = y; return this; }
    },
    WebGLRenderer: class { setPixelRatio() {} setSize() {} render() { (this as any).rawRendered = true; } dispose() {} },
    Scene: class { children: any[] = []; add(o: any) { this.children.push(o); } },
    Group: class { children: any[] = []; add(o: any) { this.children.push(o); } clear() { this.children = []; } },
    PerspectiveCamera: class { constructor(fov: any, asp: any) { Object.assign(this, cam({ isPerspectiveCamera: true, fov, aspect: asp })); } },
    OrthographicCamera: class { constructor() { Object.assign(this, cam({ isOrthographicCamera: true })); } },
    BufferGeometry: class {
      attrs: any = {}; index: any = null;
      setAttribute(k: string, v: any) { this.attrs[k] = v; }
      setIndex(i: any) { this.index = i; }
      computeVertexNormals() {}
      dispose() {}
    },
    Float32BufferAttribute: class { array: any; itemSize: number; constructor(a: any, s: number) { this.array = a; this.itemSize = s; } },
    MeshBasicMaterial: class { constructor(o: any) { Object.assign(this, o); } dispose() {} },
    MeshStandardMaterial: class { constructor(o: any) { Object.assign(this, o); } dispose() {} },
    Mesh: class { isMesh = true; geometry: any; material: any; constructor(g: any, m: any) { this.geometry = g; this.material = m; } },
    LineSegments: class { isLine = true; geometry: any; material: any; constructor(g: any, m: any) { this.geometry = g; this.material = m; } },
    LineBasicMaterial: class { constructor(o: any) { Object.assign(this, o); } dispose() {} },
  };
}

// EffectComposer-shaped fakes recording wiring.
function makeFakeModules() {
  class FakeComposer {
    renderer: any; passes: any[] = []; sizes: Array<[number, number]> = []; rendered = 0; disposed = false;
    constructor(renderer: any) { this.renderer = renderer; }
    addPass(p: any) { this.passes.push(p); }
    setSize(w: number, h: number) { this.sizes.push([w, h]); }
    render(_dt?: number) { this.rendered++; }
    dispose() { this.disposed = true; }
  }
  class FakeRenderPass { scene: any; camera: any; constructor(scene: any, camera: any) { this.scene = scene; this.camera = camera; } }
  class FakeBloomPass {
    args: any[]; sizes: Array<[number, number]> = []; disposed = false;
    constructor(...args: any[]) { this.args = args; }
    setSize(w: number, h: number) { this.sizes.push([w, h]); }
    dispose() { this.disposed = true; }
  }
  class FakeShaderPass { shader: any; uniforms: any; constructor(shader: any) { this.shader = shader; this.uniforms = shader.uniforms; } }
  class FakeFilmPass { args: any[]; constructor(...args: any[]) { this.args = args; } }
  class FakeGlitchPass { goWild = false; }
  class FakeOutputPass {}
  return {
    EffectComposer: FakeComposer,
    RenderPass: FakeRenderPass,
    UnrealBloomPass: FakeBloomPass,
    ShaderPass: FakeShaderPass,
    FilmPass: FakeFilmPass,
    GlitchPass: FakeGlitchPass,
    OutputPass: FakeOutputPass,
  };
}

test("buildComposer wires RenderPass first, bloom ctor args, OutputPass only when opted in", () => {
  const THREE = mockTHREE();
  const mods: any = makeFakeModules();
  const built = buildComposer(THREE, mods, { gl: true }, { scene: true }, { cam: true },
    { bloom: { strength: 2.5, radius: 0.6, threshold: 0.2 } }, { width: 320, height: 180 });
  const passes = built.composer.passes;
  assert.ok(passes[0] instanceof mods.RenderPass, "RenderPass first");
  assert.ok(passes[1] instanceof mods.UnrealBloomPass);
  assert.equal(passes[1].args[1], 2.5, "strength threaded");
  assert.equal(passes[1].args[2], 0.6, "radius threaded");
  assert.equal(passes[1].args[3], 0.2, "threshold threaded");
  assert.equal(passes.length, 2, "no OutputPass unless opted in (color-management parity)");

  const withOutput = buildComposer(THREE, mods, {}, {}, {}, { bloom: {}, output: true }, { width: 32, height: 32 });
  const last = withOutput.composer.passes.at(-1);
  assert.ok(last instanceof mods.OutputPass, "OutputPass last when opted in");
});

test("custom shader pass carries user fragment source, merged uniforms, auto uTime/uResolution", () => {
  const THREE = mockTHREE();
  const mods: any = makeFakeModules();
  const frag = `varying vec2 vUv; uniform sampler2D tDiffuse; uniform float uTime; uniform vec2 uResolution; uniform float uAmp;
    void main() { gl_FragColor = texture2D(tDiffuse, vUv) * uAmp; }`;
  const built = buildComposer(THREE, mods, {}, {}, {},
    { custom: [{ fragmentShader: frag, uniforms: { uAmp: { value: 0.5 } } }] }, { width: 64, height: 64 });
  const pass = built.composer.passes[1];
  assert.equal(pass.shader.fragmentShader, frag);
  assert.equal(pass.uniforms.uAmp.value, 0.5);
  assert.ok("tDiffuse" in pass.uniforms, "tDiffuse merged");
  assert.ok("uTime" in pass.uniforms, "uTime auto-injected (referenced in GLSL)");
  assert.equal(pass.uniforms.uResolution.value.x, 64, "uResolution auto-injected at size");

  built.update(0.5);
  built.update(0.25);
  assert.ok(Math.abs(pass.uniforms.uTime.value - 0.75) < 1e-9, "uTime accumulates dt");
});

test("setSize fans out to composer and per-pass setSize + uResolution", () => {
  const THREE = mockTHREE();
  const mods: any = makeFakeModules();
  const frag = `uniform sampler2D tDiffuse; uniform vec2 uResolution; void main() {}`;
  const built = buildComposer(THREE, mods, {}, {}, {},
    { bloom: {}, custom: [{ fragmentShader: frag }] }, { width: 100, height: 100 });
  built.setSize(320, 180);
  assert.deepEqual(built.composer.sizes.at(-1), [320, 180]);
  const bloom = built.composer.passes[1];
  assert.deepEqual(bloom.sizes.at(-1), [320, 180]);
  const custom = built.composer.passes[2];
  assert.equal(custom.uniforms.uResolution.value.x, 320);
});

test("glitch goWild flag and film args thread through; dispose disposes", () => {
  const THREE = mockTHREE();
  const mods: any = makeFakeModules();
  const built = buildComposer(THREE, mods, {}, {}, {},
    { film: { intensity: 0.8, grayscale: true }, glitch: { goWild: true }, bloom: {} }, { width: 32, height: 32 });
  const film = built.composer.passes.find((p: any) => p instanceof mods.FilmPass);
  assert.deepEqual(film.args, [0.8, true]);
  const glitch = built.composer.passes.find((p: any) => p instanceof mods.GlitchPass);
  assert.equal(glitch.goWild, true);
  built.dispose();
  assert.equal(built.composer.disposed, true);
  const bloom = built.composer.passes.find((p: any) => p instanceof mods.UnrealBloomPass);
  assert.equal(bloom.disposed, true);
});

test("ThreeRenderer: enabled post-processing renders via composer, raw render untouched otherwise", async () => {
  const THREE = mockTHREE();
  const camera = new ThreeDCamera({ pixelWidth: 200, pixelHeight: 200, phi: 60 * V.DEGREES });
  const r = new ThreeRenderer(THREE, { camera, canvas: {} });
  const sphere = new Sphere({ radius: 1, resolution: [4, 8], strokeWidth: 0 });

  // Baseline: raw render path.
  r.render([sphere]);
  assert.equal((r.renderer as any).rawRendered, true, "no post-processing => raw render");

  // Enable with injected fakes (no real three/addons import needed).
  (r.renderer as any).rawRendered = false;
  await r.enablePostProcessing({ bloom: { strength: 1 } }, makeFakeModules() as any);
  r.render([sphere]);
  assert.equal((r.renderer as any).rawRendered, false, "composer replaces the raw render");
  const composer = (r as any)._post.composer;
  assert.equal(composer.rendered, 1);

  // setSize threads through; disable restores raw path.
  r.setSize(64, 64);
  assert.deepEqual(composer.sizes.at(-1), [64, 64]);
  r.disablePostProcessing();
  r.render([sphere]);
  assert.equal((r.renderer as any).rawRendered, true, "disable restores the raw render");
});

test("real-module smoke: loadPostModules resolves three's bundled addons", async () => {
  // Catches three/addons path-resolution regressions (the bug class that hit
  // the mesh loaders) without any GL context.
  const mods = await loadPostModules({ bloom: {}, film: {}, custom: [{ fragmentShader: "void main(){}" }] });
  assert.equal(typeof mods.EffectComposer, "function");
  assert.equal(typeof mods.RenderPass, "function");
  assert.equal(typeof mods.UnrealBloomPass, "function");
  assert.equal(typeof mods.FilmPass, "function");
  assert.equal(typeof mods.ShaderPass, "function");
});
