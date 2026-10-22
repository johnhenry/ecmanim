// Studio onion-skin + motion-path overlays (epic #61, #74): pure helpers,
// plus the DOM glue driven through fake canvases.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  onionOffsets, onionFrames, onionTimes, speedColor, sampleMotionPath, sampleKeyframeMarkers,
  motionPathSegments, onionVectorGhosts, renderOnionRaster, renderMotionPath,
  attachOnionSkin, attachMotionPath,
} from "../src/studio/overlays.ts";
import * as studio from "../src/studio.ts";
import { Skeleton } from "../src/mobject/skeleton.ts";
import { poseTrack } from "../src/animation/pose.ts";
import { KeyframeTrack } from "../src/animation/keyframe_track.ts";
import { Circle } from "../src/mobject/geometry.ts";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test("onionOffsets: farthest first, prev negative / next positive, step scales", () => {
  const o = onionOffsets({ count: 2, step: 3 });
  assert.deepEqual(o.map((x) => x.offset), [-6, -3, 3, 6]);
  assert.deepEqual(o.map((x) => x.side), ["prev", "prev", "next", "next"]);
  assert.deepEqual(o.map((x) => x.k), [2, 1, 1, 2]);
  assert.deepEqual(onionOffsets({ count: 2, past: false }).map((x) => x.offset), [1, 2]);
  assert.deepEqual(onionOffsets({ count: 2, future: false }).map((x) => x.offset), [-2, -1]);
  assert.deepEqual(onionOffsets({ count: 0 }), []);
});

test("onionFrames clamps to the clip, drops out-of-range, tints per side, fades with distance", () => {
  const f = onionFrames(1, 10, { count: 2, prevColor: "#f00", nextColor: "#00f", opacity: 0.5 });
  assert.deepEqual(f.map((x) => x.frame), [0, 2, 3]);
  assert.equal(f[0].tint, "#f00");
  assert.equal(f[1].tint, "#00f");
  near(f[1].opacity, 0.5);       // k=1 -> full base opacity
  near(f[2].opacity, 0.25);      // k=2 of 2 -> half
  assert.deepEqual(onionFrames(0, 0, { count: 3 }), []);
});

test("onionTimes mirrors onionFrames in seconds", () => {
  const t = onionTimes(1, 2, { count: 1, step: 0.5 });
  assert.deepEqual(t.map((x) => x.t), [0.5, 1.5]);
  assert.deepEqual(onionTimes(0.1, 2, { count: 1, step: 0.5 }).map((x) => x.t), [0.6]);
});

test("speedColor maps slow->fast and clamps", () => {
  assert.equal(speedColor(0, 10, { slow: "#000000", fast: "#ffffff" }), "#000000");
  assert.equal(speedColor(10, 10, { slow: "#000000", fast: "#ffffff" }), "#ffffff");
  assert.equal(speedColor(5, 10, { slow: "#000000", fast: "#ffffff" }), "#808080");
  assert.equal(speedColor(99, 10, { slow: "#000000", fast: "#ffffff" }), "#ffffff");
  assert.equal(speedColor(1, 0, { slow: "#102030", fast: "#ffffff" }), "#102030"); // zero max
});

test("sampleMotionPath on a function source: positions, speeds, length", () => {
  const p = sampleMotionPath((t) => [2 * t, 0], 0, 1, 0.25);
  assert.equal(p.samples.length, 5);
  assert.deepEqual(p.samples.map((s) => s.t), [0, 0.25, 0.5, 0.75, 1]);
  near(p.samples[4].x, 2);
  near(p.samples[2].speed, 2);
  near(p.samples[0].speed, 2); // first sample borrows the first segment's speed
  near(p.maxSpeed, 2);
  near(p.length, 2);
});

test("sampleMotionPath always includes t1 even when step does not divide the range", () => {
  const p = sampleMotionPath((t) => [t, 0], 0, 1, 0.4);
  assert.deepEqual(p.samples.map((s) => +s.t.toFixed(6)), [0, 0.4, 0.8, 1]);
  assert.throws(() => sampleMotionPath((t) => [t, 0], 0, 1, 0), /step/);
});

function arm() {
  const s = new Skeleton([{ id: "a", parent: null, length: 1, angle: 0 }]);
  const p0 = s.getPose();
  const p1 = { ...p0, bones: { ...p0.bones, a: { angle: Math.PI / 2, length: 1, bend: 0 } } };
  const track = poseTrack([{ t: 0, value: p0 }, { t: 1, value: p1 }]);
  s.bindPoseTrack(track);
  return { s, track };
}

test("sampleMotionPath on a Skeleton joint evaluates the bound track without mutating the rig", () => {
  const { s } = arm();
  const before = JSON.stringify(s.getPose());
  const p = sampleMotionPath({ skeleton: s, joint: "a" }, 0, 1, 0.5);
  near(p.samples[0].x, 1); near(p.samples[0].y, 0);
  near(p.samples[2].x, 0); near(p.samples[2].y, 1);
  assert.equal(JSON.stringify(s.getPose()), before);
});

test("sampleMotionPath on a time-pure mobject uses its centre at setTime(t)", () => {
  const { s } = arm();
  const p = sampleMotionPath({ mobject: s }, 0, 1, 1);
  assert.equal(p.samples.length, 2);
  assert.ok(p.samples[0].x !== p.samples[1].x || p.samples[0].y !== p.samples[1].y);
});

test("sampleKeyframeMarkers places a marker at each keyframe time on the path", () => {
  const { s, track } = arm();
  const m = sampleKeyframeMarkers({ skeleton: s, joint: "a" }, track);
  assert.equal(m.length, 2);
  near(m[0].t, 0); near(m[0].x, 1);
  near(m[1].t, 1); near(m[1].y, 1);
  assert.deepEqual(m.map((x) => x.index), [0, 1]);
  const kt = new KeyframeTrack<number>([{ t: 0, value: 0 }, { t: 2, value: 4 }]);
  assert.equal(sampleKeyframeMarkers((t) => [t, 0], kt).length, 2);
});

test("motionPathSegments colours each segment by speed", () => {
  const p = sampleMotionPath((t) => [t < 0.5 ? t : 0.5 + 3 * (t - 0.5), 0], 0, 1, 0.5);
  const segs = motionPathSegments(p, { slow: "#000000", fast: "#ffffff" });
  assert.equal(segs.length, 2);
  assert.equal(segs[0].color, speedColor(p.samples[1].speed, p.maxSpeed, { slow: "#000000", fast: "#ffffff" }));
  assert.notEqual(segs[0].color, segs[1].color);
});

test("onionVectorGhosts clones at t±k, leaves the source untouched, tints and fades", () => {
  const { s } = arm();
  s.setTime(0.5);
  const before = JSON.stringify(s.getPose());
  const ghosts = onionVectorGhosts(s, 0.5, 1, { count: 1, step: 0.5, prevColor: "#ff0000", nextColor: "#0000ff", opacity: 0.4 });
  assert.equal(ghosts.length, 2);
  assert.notEqual(ghosts[0].mobject, s);
  near(ghosts[0].mobject.model.jointPosition("a")[0], 1); // t=0 -> angle 0
  near(ghosts[1].mobject.model.jointPosition("a")[1], 1); // t=1 -> angle 90deg
  near(ghosts[0].mobject.opacity, 0.4);
  assert.equal(JSON.stringify(s.getPose()), before);
});

test("onionVectorGhosts rejects mobjects with no setTime", () => {
  assert.throws(() => onionVectorGhosts(new Circle(), 0, 1, {}), /setTime/);
});

// --- DOM glue with fake canvases --------------------------------------------
function fakeCtx() {
  const calls: Array<[string, any[]]> = [];
  const ctx: any = new Proxy({}, {
    get(_t, k: string) {
      if (k === "calls") return calls;
      return (...a: any[]) => { calls.push([k, a]); };
    },
    set(_t, k: string, v) { calls.push(["set:" + k, [v]]); return true; },
  });
  return ctx;
}
const names = (ctx: any) => ctx.calls.map((c: any) => c[0]);

test("renderOnionRaster draws each ghost frame with alpha + tint and restores state", () => {
  const drawn: number[] = [];
  const player: any = {
    frames: new Array(6).fill(0).map(() => ({ width: 4, height: 4 })),
    pixelWidth: 4, pixelHeight: 4,
    drawFrameTo(_c: any, i: number) { drawn.push(i); },
  };
  const ctx = fakeCtx();
  const scratchCtx = fakeCtx();
  const scratch: any = { width: 4, height: 4, getContext: () => scratchCtx };
  const used = renderOnionRaster(ctx, player, 2, { count: 1, createCanvas: () => scratch });
  assert.deepEqual(drawn, [1, 3]);
  assert.deepEqual(used.map((u) => u.frame), [1, 3]);
  assert.ok(names(ctx).includes("drawImage"));
  assert.ok(names(scratchCtx).includes("fillRect"));
  assert.equal(names(ctx)[0], "save");
  assert.equal(names(ctx).at(-1), "restore");
});

test("renderMotionPath strokes one segment per sample gap and dots the key markers", () => {
  const ctx = fakeCtx();
  const path = sampleMotionPath((t) => [t, 0], 0, 1, 0.25);
  const camera: any = { toPixel: (p: number[]) => [p[0] * 100, 50] };
  renderMotionPath(ctx, path, camera, { markers: [{ t: 0, x: 0, y: 0, index: 0 }, { t: 1, x: 1, y: 0, index: 1 }] });
  assert.equal(names(ctx).filter((n: string) => n === "stroke").length, 4);
  assert.equal(names(ctx).filter((n: string) => n === "arc").length, 2);
});

function fakeOverlayEnv() {
  const created: any[] = [];
  const parent = { children: [] as any[], appendChild(c: any) { parent.children.push(c); c.parentNode = parent; }, removeChild(c: any) { parent.children = parent.children.filter((x) => x !== c); } };
  const make = () => {
    const ctx = fakeCtx();
    const el: any = { width: 0, height: 0, style: {}, getContext: () => ctx, ctx, remove() { parent.removeChild(el); }, parentNode: null };
    created.push(el);
    return el;
  };
  const target: any = { width: 8, height: 4, offsetLeft: 3, offsetTop: 5, parentNode: parent, style: {} };
  return { created, parent, make, target };
}

test("attachOnionSkin layers a pointer-transparent overlay over the player canvas; refresh draws; detach removes", () => {
  const env = fakeOverlayEnv();
  const player: any = { canvas: env.target, frames: [{}, {}, {}], pixelWidth: 8, pixelHeight: 4, drawFrameTo() {}, currentFrame: 1, _current: 1 };
  const h = attachOnionSkin(player, { count: 1, createCanvas: (() => { let n = 0; return () => (n++ === 0 ? env.make() : { width: 8, height: 4, getContext: () => fakeCtx() }); })() });
  assert.equal(env.parent.children.length, 1);
  const ov = env.parent.children[0];
  assert.equal(ov.style.pointerEvents, "none");
  assert.equal(ov.width, 8);
  h.refresh();
  assert.ok(names(ov.ctx).includes("clearRect"));
  h.detach();
  assert.equal(env.parent.children.length, 0);
});

test("attachMotionPath draws on the overlay and detaches", () => {
  const env = fakeOverlayEnv();
  const camera: any = { pixelWidth: 8, pixelHeight: 4, toPixel: (p: number[]) => [p[0], p[1]] };
  const h = attachMotionPath(env.target, camera, { source: (t) => [t, 0], t0: 0, t1: 1, step: 0.5, createCanvas: () => env.make() });
  h.refresh();
  const ov = env.parent.children[0];
  assert.equal(names(ov.ctx).filter((n: string) => n === "stroke").length, 2);
  h.detach();
  assert.equal(env.parent.children.length, 0);
});

test("overlay helpers are exported from ./studio", () => {
  for (const k of ["onionOffsets", "onionFrames", "onionTimes", "speedColor", "sampleMotionPath", "sampleKeyframeMarkers", "motionPathSegments", "onionVectorGhosts", "renderOnionRaster", "renderMotionPath", "attachOnionSkin", "attachMotionPath"]) {
    assert.equal(typeof (studio as any)[k], "function", k);
  }
});
