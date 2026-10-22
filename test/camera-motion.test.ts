// Camera motion effects (CameraShake / Handheld / CameraImpact / ZoomPulse) and
// CameraFollow + bakeCameraMotion (epic #61, #69).

import { test } from "node:test";
import assert from "node:assert/strict";

import { Camera, CanvasRenderer } from "../src/renderer/CanvasRenderer.ts";
import { ThreeDCamera } from "../src/scene/three_d.ts";
import { MultiCamera } from "../src/camera/multi_camera.ts";
import { MappingCamera } from "../src/camera/mapping_camera.ts";
import { ThreeRenderer } from "../src/renderer/ThreeRenderer.ts";
import { MovingCameraScene } from "../src/scene/moving_camera_scene.ts";
import { Scene, computeRenderConfigHash } from "../src/scene/Scene.ts";
import { Square, Circle } from "../src/mobject/geometry.ts";
import { BLUE, RED } from "../src/core/color.ts";
import {
  CameraShake, Handheld, CameraImpact, ZoomPulse,
  CameraFollow, bakeCameraMotion, evaluateCameraEffects,
} from "../src/index.ts";
import { captureFrames, matchSnapshot, loadNapiCanvas } from "./_snapshot_util.ts";

const close = (a: number, b: number, eps = 1e-9, msg?: string) =>
  assert.ok(Math.abs(a - b) < eps, msg ?? `${a} !~ ${b}`);

const POINTS = [[0, 0, 0], [1, 2, 0], [-3.5, 1.25, 2], [6, -3, -1], [0.1, 0.2, 0.3]];

// --- byte-identity with no effects registered -------------------------------

// The pre-change Camera.toPixel arithmetic, verbatim, as the reference.
function refToPixel(c: any, p: number[]): [number, number] {
  const z = c.zoom ?? 1;
  let cx = p[0] - c.frameCenter[0];
  let cy = p[1] - c.frameCenter[1];
  const rot = c.rotation ?? 0;
  if (rot !== 0) {
    const co = Math.cos(-rot), s = Math.sin(-rot);
    const rx = cx * co - cy * s;
    cy = cx * s + cy * co;
    cx = rx;
  }
  return [(cx / c.frameWidth / z + 0.5) * c.pixelWidth, (0.5 - cy / c.frameHeight / z) * c.pixelHeight];
}

test("no effects: Camera.toPixel is byte-identical and no effect fields exist", () => {
  for (const cfg of [{}, { zoom: 1.7 }, { rotation: 0.4, frameCenter: [1, -2, 0] }]) {
    const c = new Camera({ pixelWidth: 640, pixelHeight: 360, ...cfg });
    for (const p of POINTS) {
      const got = c.toPixel(p), want = refToPixel(c, p);
      assert.ok(Object.is(got[0], want[0]) && Object.is(got[1], want[1]), `${got} vs ${want}`);
    }
    assert.equal(c.effectOffset, undefined);
    assert.equal(c.effectRoll, undefined);
    assert.equal(c.effectLogZoom, undefined);
  }
});

test("no effects: setEffectTime is a no-op and subclasses unchanged", () => {
  const m = new MappingCamera({ pixelWidth: 640, pixelHeight: 360, mappingFunc: (p) => [p[0] * 2, p[1], 0] });
  const ref = new Camera({ pixelWidth: 640, pixelHeight: 360 });
  m.setEffectTime(3.3);
  assert.deepEqual(m.toPixel([1, 1, 0]), ref.toPixel([2, 1, 0]));
  const t = new ThreeDCamera({ pixelWidth: 640, pixelHeight: 360, phi: 1, theta: -1, gamma: 0.2, zoom: 1.3 });
  const before = POINTS.map((p) => t.toPixel(p));
  t.setEffectTime(2);
  assert.deepEqual(POINTS.map((p) => t.toPixel(p)), before);
});

test("no effects: cache hash and fingerprint strings are unchanged", () => {
  const cam = new Camera({ pixelWidth: 640, pixelHeight: 360 });
  const cam3 = new ThreeDCamera({ pixelWidth: 640, pixelHeight: 360 });
  const base = { pixelWidth: 640, pixelHeight: 360, background: "#000", fps: 15 };
  const h0 = computeRenderConfigHash({ ...base, camera: cam3 });
  cam3.addEffect(new CameraShake({ seed: 1 }));
  assert.notEqual(computeRenderConfigHash({ ...base, camera: cam3 }), h0);
  const c2 = new ThreeDCamera({ pixelWidth: 640, pixelHeight: 360 });
  c2.addEffect(new CameraShake({ seed: 1 })); c2.clearEffects();
  assert.equal(computeRenderConfigHash({ ...base, camera: c2 }), h0);
  assert.equal(computeRenderConfigHash({ ...base, camera: cam }), computeRenderConfigHash({ ...base }));
  assert.equal(cam.effectsFingerprint(), "");
});

function mockTHREE() {
  const V3 = () => ({ set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this; } });
  const cam = (extra: any) => ({ position: V3(), up: V3(), lookAt(x: number, y: number, z: number) { this.look = [x, y, z]; }, updateProjectionMatrix() {}, ...extra });
  return {
    ColorManagement: { enabled: true }, DoubleSide: 2,
    Color: class { c: any; constructor(c: any) { this.c = c; } },
    WebGLRenderer: class { setPixelRatio() {} setSize() {} render() {} dispose() {} },
    Scene: class { children: any[] = []; add(o: any) { this.children.push(o); } },
    Group: class { children: any[] = []; add(o: any) { this.children.push(o); } clear() { this.children = []; } },
    PerspectiveCamera: class { constructor(fov: number, asp: number) { Object.assign(this, cam({ fov, aspect: asp })); } },
    OrthographicCamera: class { constructor(l: number, r: number, t: number, b: number) { Object.assign(this, cam({ left: l, right: r, top: t, bottom: b })); } },
    BufferGeometry: class { setAttribute() {} dispose() {} },
    Float32BufferAttribute: class { array: any; itemSize: number; constructor(a: any, n: number) { this.array = a; this.itemSize = n; } },
    MeshBasicMaterial: class { constructor(o: any) { Object.assign(this, o); } dispose() {} },
    LineBasicMaterial: class { constructor(o: any) { Object.assign(this, o); } dispose() {} },
    Mesh: class {}, LineSegments: class {},
  };
}

test("no effects: ThreeRenderer camera params are exactly the pre-change values", () => {
  const camera = new Camera({ pixelWidth: 640, pixelHeight: 360, frameCenter: [1, 2, 0], zoom: 1.5 });
  const r: any = new ThreeRenderer(mockTHREE(), { camera, canvas: {} });
  r.syncCamera();
  const tc = r.threeCamera;
  assert.deepEqual([tc.position.x, tc.position.y, tc.position.z], [1, 2, 100]);
  assert.deepEqual([tc.up.x, tc.up.y, tc.up.z], [0, 1, 0]);
  assert.deepEqual([tc.left, tc.right, tc.top, tc.bottom], [-camera.frameWidth / 2, camera.frameWidth / 2, 4, -4]);
  assert.equal(tc.zoom, 1.5);
  assert.deepEqual(tc.look, [1, 2, 0]);
});

// --- effects semantics -------------------------------------------------------

test("offset effect shifts the projected image like moving the camera", () => {
  const c = new Camera({ pixelWidth: 640, pixelHeight: 360 });
  c.addEffect({ evaluate: () => ({ dx: 1, dy: -0.5 }) });
  c.setEffectTime(0);
  const shifted = new Camera({ pixelWidth: 640, pixelHeight: 360, frameCenter: [1, -0.5, 0] });
  for (const p of POINTS) {
    const a = c.toPixel(p), b = shifted.toPixel(p);
    close(a[0], b[0], 1e-9); close(a[1], b[1], 1e-9);
  }
  // frameCenter is never written by effects.
  assert.deepEqual(c.frameCenter, [0, 0, 0]);
});

test("logZoom composes multiplicatively with zoom; roll sums with rotation", () => {
  const c = new Camera({ pixelWidth: 640, pixelHeight: 360, zoom: 2, rotation: 0.3 });
  c.addEffect({ evaluate: () => ({ logZoom: Math.log(1.5), roll: 0.2 }) });
  c.setEffectTime(0);
  const ref = new Camera({ pixelWidth: 640, pixelHeight: 360, zoom: 3, rotation: 0.5 });
  for (const p of POINTS) {
    const a = c.toPixel(p), b = ref.toPixel(p);
    close(a[0], b[0], 1e-9); close(a[1], b[1], 1e-9);
  }
  assert.equal(c.zoom, 2);
  assert.equal(c.rotation, 0.3);
});

test("multiple effects: offsets and roll sum, zoom multiplies", () => {
  const s = evaluateCameraEffects([
    { fx: { evaluate: () => ({ dx: 1, roll: 0.1, logZoom: 0.2 }) }, start: 0, duration: Infinity, fadeIn: 0, fadeOut: 0 },
    { fx: { evaluate: () => ({ dx: 2, dy: 3, roll: 0.2, logZoom: 0.3 }) }, start: 0, duration: Infinity, fadeIn: 0, fadeOut: 0 },
  ], 1);
  close(s.dx, 3); close(s.dy, 3); close(s.roll, 0.3); close(s.logZoom, 0.5);
});

test("window and fades: weight 0 outside, ramps in/out, full between", () => {
  const c = new Camera({ pixelWidth: 640, pixelHeight: 360 });
  c.addEffect({ evaluate: () => ({ dx: 1 }) }, { start: 1, duration: 2, fadeIn: 0.5, fadeOut: 0.5 });
  const at = (t: number) => { c.setEffectTime(t); return c.effectOffset![0]; };
  close(at(0.5), 0); close(at(1), 0); close(at(2), 1); close(at(3.5), 0);
  assert.ok(at(1.25) > 0 && at(1.25) < 1);
  assert.ok(at(2.75) > 0 && at(2.75) < 1);
  close(at(1.25) + at(2.75), 1, 1e-9); // symmetric ramps
});

test("removeEffect restores the pristine state", () => {
  const c = new Camera({ pixelWidth: 640, pixelHeight: 360 });
  const fx = new CameraShake({ seed: 3 });
  c.addEffect(fx); c.setEffectTime(0.4);
  assert.ok(c.effectOffset);
  c.removeEffect(fx);
  assert.equal(c.effectOffset, undefined);
  assert.deepEqual(c.toPixel([1, 1, 0]), refToPixel(c, [1, 1, 0]));
});

test("presets are pure functions of t: seed-deterministic, order independent", () => {
  const mk = () => [
    new CameraShake({ amplitude: 0.2, frequency: 10, roll: 0.02, seed: 7 }),
    new Handheld({ seed: 2 }),
    new CameraImpact({ magnitude: 0.5, angle: 1 }),
    new ZoomPulse({ amount: 0.1 }),
  ];
  const a = mk(), b = mk();
  const ts = [0, 0.13, 0.4, 0.9, 2.5, 0.13];
  for (let i = 0; i < a.length; i++) {
    const fwd = ts.map((t) => JSON.stringify(a[i].evaluate(t)));
    const rev = [...ts].reverse().map((t) => JSON.stringify(b[i].evaluate(t))).reverse();
    assert.deepEqual(fwd, rev);
  }
  const other = new CameraShake({ amplitude: 0.2, frequency: 10, roll: 0.02, seed: 8 });
  assert.notDeepEqual(other.evaluate(0.37), a[0].evaluate(0.37));
  assert.notEqual(other.fingerprint(), a[0].fingerprint());
  // Bounded by amplitude.
  for (let t = 0; t < 3; t += 0.01) assert.ok(Math.abs(a[0].evaluate(t).dx!) <= 0.2 * 1.0001);
});

test("CameraImpact decays; ZoomPulse returns to zero", () => {
  const imp = new CameraImpact({ magnitude: 0.5, angle: 0, decay: 6 });
  assert.ok(Math.abs(imp.evaluate(0).dx!) > 0.4);
  assert.ok(Math.abs(imp.evaluate(3).dx!) < 1e-3);
  const zp = new ZoomPulse({ amount: 0.2, period: 0.5 });
  close(zp.evaluate(0).logZoom!, 0, 1e-12);
  assert.ok(zp.evaluate(0.25).logZoom! > 0.19);
  close(zp.evaluate(0.5).logZoom!, 0, 1e-9);
  close(zp.evaluate(5).logZoom!, 0, 1e-12);
});

test("effect state feeds the renderer cache fingerprint", () => {
  const cam = new Camera({ pixelWidth: 64, pixelHeight: 36 });
  const r: any = new CanvasRenderer({} as any, cam);
  const f0 = r._cameraFingerprint();
  cam.addEffect(new CameraShake({ seed: 1 }));
  cam.setEffectTime(0.3);
  const f1 = r._cameraFingerprint();
  cam.setEffectTime(0.31);
  const f2 = r._cameraFingerprint();
  assert.notEqual(f0, f1); assert.notEqual(f1, f2);
});

test("MultiCamera keeps its preRender chain and inherits effects", () => {
  const sub = new Camera({ pixelWidth: 64, pixelHeight: 36 });
  const disp: any = { getWidth: () => 2, getHeight: () => 1, getCenter: () => [3, 3, 0] };
  const mc = new MultiCamera({ pixelWidth: 640, pixelHeight: 360, imageMobjectsFromCameras: [{ imageMobject: disp, camera: sub }] });
  mc.addEffect({ evaluate: () => ({ dx: 1 }) }); mc.setEffectTime(0);
  mc.preRender();
  assert.deepEqual(sub.frameCenter, [3, 3, 0]);
  assert.equal(sub.effectOffset, undefined); // sub-cameras don't inherit
  assert.deepEqual(mc.frameCenter, [0, 0, 0]);
});

// --- 3D / WebGL ---------------------------------------------------------------

test("ThreeDCamera: roll maps to gamma, zoom multiplies, offset is camera-space", () => {
  const base = { pixelWidth: 640, pixelHeight: 360, phi: 0.8, theta: -1.2 };
  const c = new ThreeDCamera({ ...base, gamma: 0.1, zoom: 2 });
  c.addEffect({ evaluate: () => ({ roll: 0.25, logZoom: Math.log(1.5) }) });
  c.setEffectTime(0);
  const ref = new ThreeDCamera({ ...base, gamma: 0.35, zoom: 3 });
  for (const p of POINTS) {
    const a = c.toPixel(p), b = ref.toPixel(p);
    close(a[0], b[0], 1e-7); close(a[1], b[1], 1e-7);
  }
  assert.equal(c.gamma, 0.1);
  // Camera-space offset: shifting the camera right moves content left on screen
  const o = new ThreeDCamera(base);
  const o0 = o.toPixel([0, 0, 0]);
  o.addEffect({ evaluate: () => ({ dx: 1 }) }); o.setEffectTime(0);
  const o1 = o.toPixel([0, 0, 0]);
  assert.ok(o1[0] < o0[0]); close(o1[1], o0[1], 1e-9);
});

test("ThreeRenderer 2D: effects reach center/roll/zoom, frameCenter untouched", () => {
  const camera = new Camera({ pixelWidth: 640, pixelHeight: 360 });
  camera.addEffect({ evaluate: () => ({ dx: 1, dy: 2, roll: 0.5, logZoom: Math.log(2) }) });
  camera.setEffectTime(0);
  const r: any = new ThreeRenderer(mockTHREE(), { camera, canvas: {} });
  r.syncCamera();
  const tc = r.threeCamera;
  assert.deepEqual([tc.position.x, tc.position.y], [1, 2]);
  close(tc.up.x, -Math.sin(0.5)); close(tc.up.y, Math.cos(0.5));
  close(tc.zoom, 2);
  assert.deepEqual(camera.frameCenter, [0, 0, 0]);
});

test("ThreeRenderer 3D: roll adds to gamma, zoom multiplies", () => {
  const mk = (extra: any) => new ThreeDCamera({ pixelWidth: 640, pixelHeight: 360, phi: 0.7, theta: -1, ...extra });
  const withFx = mk({ zoom: 2 });
  withFx.addEffect({ evaluate: () => ({ roll: 0.3, logZoom: Math.log(2) }) }); withFx.setEffectTime(0);
  const manual = mk({ zoom: 4, gamma: 0.3 });
  const a: any = new ThreeRenderer(mockTHREE(), { camera: withFx, canvas: {} });
  const b: any = new ThreeRenderer(mockTHREE(), { camera: manual, canvas: {} });
  a.syncCamera(); b.syncCamera();
  for (const k of ["x", "y", "z"]) {
    close(a.threeCamera.position[k], b.threeCamera.position[k], 1e-9);
    close(a.threeCamera.up[k], b.threeCamera.up[k], 1e-9);
  }
  close(a.threeCamera.zoom, 4);
});

// --- Scene integration --------------------------------------------------------

test("Scene feeds absolute time: shake is a pure function of scene.time", async () => {
  const seen: Array<[number, string]> = [];
  class S extends MovingCameraScene {
    async construct() {
      this.add(new Square());
      this.shakeCamera({ duration: 0.4, amplitude: 0.3, seed: 5 });
      await this.wait(0.5);
    }
  }
  const run = async () => {
    const out: string[] = [];
    const scene = new S({ fps: 10, camera: new Camera({ pixelWidth: 64, pixelHeight: 36 }) });
    scene.frameHandler = async (_m: any, _f: number, t: number) => {
      out.push(`${t.toFixed(3)}:${JSON.stringify(scene.camera!.effectOffset)}`);
    };
    await scene.construct();
    return out;
  };
  const a = await run(), b = await run();
  assert.deepEqual(a, b);
  seen.push([a.length, a[0]]);
  assert.ok(a.some((l) => !l.endsWith("[0,0]") && !l.endsWith("undefined")));
  // After the window the offset is back to zero.
  assert.ok(a[a.length - 1].endsWith("[0,0]"));
  // The frame mobject / frameCenter are never touched by the shake.
});

test("shake does not disturb frameCenter and rides on a frame animation", async () => {
  class S extends MovingCameraScene {
    async construct() {
      this.add(new Square());
      this.shakeCamera({ duration: 1, amplitude: 0.3 });
      await this.play(this.getFrame().animate.moveTo([2, 0, 0]), { _playConfig: true, runTime: 1 } as any);
    }
  }
  const cam = new Camera({ pixelWidth: 64, pixelHeight: 36 });
  const scene = new S({ fps: 10, camera: cam });
  await scene.construct();
  cam.preRender();
  close(cam.frameCenter[0], 2, 1e-6);
});

test("hashAnimations is salted by camera effects", () => {
  const cam = new Camera({ pixelWidth: 64, pixelHeight: 36 });
  const s = new Scene({ fps: 10, camera: cam });
  const h0 = s.hashAnimations([], "wait");
  cam.addEffect(new CameraShake({ seed: 1 }), { start: 0, duration: 1 });
  const h1 = s.hashAnimations([], "wait");
  assert.notEqual(h0, h1);
});

// --- CameraFollow + bake ------------------------------------------------------

test("bakeCameraMotion is deterministic and returns a KeyframeTrack of [cx, cy, height]", () => {
  const target = (t: number) => [Math.sin(t) * 3, 0, 0];
  const f = () => new CameraFollow({ target, smoothTime: 0.4 });
  const a = bakeCameraMotion(f(), { duration: 3, center: [0, 0, 0], height: 8 });
  const b = bakeCameraMotion(f(), { duration: 3, center: [0, 0, 0], height: 8 });
  assert.deepEqual(a.keyframes, b.keyframes);
  assert.equal(a.duration, 3);
  const v = a.valueAt(1.234);
  assert.equal(v.length, 3);
  close(v[2], 8);
});

test("dead zone: camera holds still while target stays inside it", () => {
  const f = new CameraFollow({ target: (t) => [0.5 * Math.sin(t * 5), 0.2, 0], deadZone: { width: 3, height: 3 } });
  const tr = bakeCameraMotion(f, { duration: 2, center: [0, 0, 0], height: 8 });
  for (const k of tr.keyframes) { close(k.value[0], 0, 1e-9); close(k.value[1], 0, 1e-9); }
});

test("camera follows a target that leaves the dead zone and converges", () => {
  const f = new CameraFollow({ target: (t) => [Math.min(10, 4 * t), 0, 0], deadZone: { width: 2, height: 2 }, smoothTime: 0.3 });
  const tr = bakeCameraMotion(f, { duration: 8, center: [0, 0, 0], height: 8 });
  const end = tr.valueAt(8);
  assert.ok(end[0] > 8.5 && end[0] < 10.5, `end x ${end[0]}`);
  // Never overshoots the target by much, and moves monotonically.
  let prev = -Infinity;
  for (const k of tr.keyframes) { assert.ok(k.value[0] >= prev - 1e-9); prev = k.value[0]; }
});

test("hysteresis: no chatter at the dead-zone edge", () => {
  // Target oscillates just across the dead-zone edge (half-width 1).
  const f = new CameraFollow({ target: (t) => [1 + 0.05 * Math.sin(t * 20), 0, 0], deadZone: { width: 2, height: 2 }, hysteresis: 0.5, smoothTime: 0.2 });
  const tr = bakeCameraMotion(f, { duration: 4, center: [0, 0, 0], height: 8 });
  const xs = tr.keyframes.map((k) => k.value[0]);
  let reversals = 0;
  for (let i = 2; i < xs.length; i++) if ((xs[i] - xs[i - 1]) * (xs[i - 1] - xs[i - 2]) < -1e-12) reversals++;
  assert.ok(reversals <= 2, `reversals ${reversals}`);
});

test("look-ahead leads a moving target; auto-zoom fits the target bbox with margin", () => {
  const t = (s: number) => [2 * s, 0, 0];
  const plain = bakeCameraMotion(new CameraFollow({ target: t, deadZone: { width: 0, height: 0 }, smoothTime: 0.3 }), { duration: 4, center: [0, 0, 0], height: 8 });
  const lead = bakeCameraMotion(new CameraFollow({ target: t, deadZone: { width: 0, height: 0 }, smoothTime: 0.3, lookAhead: 0.5 }), { duration: 4, center: [0, 0, 0], height: 8 });
  assert.ok(lead.valueAt(3)[0] > plain.valueAt(3)[0] + 0.5);

  const zoom = bakeCameraMotion(new CameraFollow({
    target: () => ({ center: [0, 0, 0], width: 8, height: 2 }),
    autoZoom: { margin: 0.25, minHeight: 1, maxHeight: 40 }, zoomSmoothTime: 0.2,
  }), { duration: 6, center: [0, 0, 0], height: 8, aspect: 16 / 9 });
  // width 8 binds: height = 8/(16/9) * 1.25 = 5.625
  close(zoom.valueAt(6)[2], 5.625, 1e-3);
});

test("followCamera drives the frame in an explicit window and yields to frame animations", async () => {
  class S extends MovingCameraScene {
    async construct() {
      this.add(new Circle());
      this.followCamera((t) => [3 * t, 0, 0], { duration: 2, deadZone: { width: 0, height: 0 }, smoothTime: 0.2 });
      await this.wait(2);
    }
  }
  const cam = new Camera({ pixelWidth: 64, pixelHeight: 36 });
  const sc = new S({ fps: 10, camera: cam });
  await sc.construct();
  cam.preRender();
  assert.ok(cam.frameCenter[0] > 4, `x=${cam.frameCenter[0]}`);
  // Past the window, a user frame animation takes over unopposed.
  await sc.play(sc.getFrame().animate.moveTo([-5, 0, 0]), { _playConfig: true, runTime: 1 } as any);
  await sc.wait(1);
  cam.preRender();
  close(cam.frameCenter[0], -5, 1e-6);
});

// --- golden frame --------------------------------------------------------------

const canvasAvailable = await loadNapiCanvas().then((m) => !!m);

class ShakeGolden extends MovingCameraScene {
  async construct() {
    this.add(new Square({ sideLength: 2, color: BLUE, fillColor: BLUE, fillOpacity: 0.6 }).shift([-2, 0, 0]));
    this.add(new Circle({ radius: 1, color: RED, fillColor: RED, fillOpacity: 0.6 }).shift([2, 0, 0]));
    this.camera!.addEffect(new CameraShake({ amplitude: 0.5, frequency: 6, roll: 0.08, zoom: 0.1, seed: 11 }), { start: 0, duration: 10 });
    await this.wait(0.6);
  }
}

test("golden: camera shake frame", { skip: !canvasAvailable && "@napi-rs/canvas not available" }, async () => {
  const caps = await captureFrames(ShakeGolden, [5]);
  const failure = await matchSnapshot("camera-shake.mid", caps.get(5)!);
  assert.equal(failure, null, failure ?? undefined);
});

test("ZoomedScene: the derived zoom camera does not inherit shake", async () => {
  const mod = await import("@napi-rs/canvas").then((m) => m, () => null);
  if (!mod) return;
  const { ZoomedScene } = await import("../src/scene/zoomed_scene.ts");
  const { Dot } = await import("../src/mobject/geometry.ts");
  const canvas = mod.createCanvas(320, 180);
  const camera = new Camera({ pixelWidth: 320, pixelHeight: 180 });
  const renderer = new CanvasRenderer(canvas.getContext("2d"), camera, { createCanvas: (w: number, h: number) => mod.createCanvas(w, h) });
  const scene = new ZoomedScene({ camera });
  scene.add(new Dot({ point: [0.1, 0.1, 0], color: "#FF0000", fillOpacity: 1 }));
  scene.zoomedCamera.frame.moveTo([0, 0, 0]);
  scene.activated = true;
  scene.add(scene.zoomedCamera.frame);
  scene.addForegroundMobject(scene.zoomedDisplay);
  camera.addEffect(new CameraShake({ amplitude: 0.4, seed: 2 })); camera.setEffectTime(0.37);
  assert.ok(camera.effectOffset);
  const proto: any = CanvasRenderer.prototype;
  const orig = proto.renderMobjects;
  const subCams: any[] = [];
  proto.renderMobjects = function (this: any, ...a: any[]) { if (this.camera !== camera) subCams.push(this.camera); return orig.apply(this, a); };
  try { renderer.renderScene(scene.mobjects); } finally { proto.renderMobjects = orig; }
  assert.ok(subCams.length >= 1, "zoomed display rendered through a derived camera");
  for (const c of subCams) assert.equal(c.effectOffset, undefined);
});
