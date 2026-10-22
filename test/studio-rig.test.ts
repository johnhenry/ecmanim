// Studio rig authoring helpers (#92): controls schema + IK handle drag. Written first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rigToControls, applyRigControl, ikHandles, pickIKHandle, createIKDrag, attachIKDrag } from "../src/studio/rig.ts";
import { Skeleton } from "../src/mobject/skeleton.ts";
import { IKChain } from "../src/mobject/ik.ts";
import { Camera } from "../src/renderer/CanvasRenderer.ts";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

const build = () => {
  const sk = new Skeleton([
    { id: "spine", length: 2, angle: Math.PI / 2 },
    { id: "armL", parent: "spine", length: 1, angle: Math.PI / 2, limits: { min: -1, max: 2 } },
    { id: "armR", parent: "spine", length: 1, angle: -Math.PI / 2 },
    { id: "mid", parent: "spine", length: 0.1 },
    { id: "hand", parent: "armL", length: 0.4 },
  ]);
  sk.addConstraint({ type: "connector", id: "belt", bone: "mid", a: "armL", b: "armR", slide: 0.5 });
  sk.addConstraint({ type: "angleLock", id: "up", bone: "hand", reference: "world", multiplier: 0 });
  sk.addConstraint({ type: "stretch", id: "st", driver: "spine", targets: ["armR"], min: 0.5, max: 2 });
  const ik = new IKChain(sk, { bones: ["spine", "armL"], target: [-1, 2], bendSide: "left" });
  return { sk, ik };
};

test("rigToControls: pure schema of constraint / IK / limit parameters with current values", () => {
  const { sk, ik } = build();
  const cs = rigToControls({ skeleton: sk, chains: { arm: ik } });
  const by = Object.fromEntries(cs.map((c) => [c.name, c]));
  assert.equal(by["constraint:belt.slide"].control, "number");
  assert.equal(by["constraint:belt.slide"].value, 0.5);
  assert.equal(by["constraint:belt.enabled"].control, "checkbox");
  assert.equal(by["constraint:up.reference"].control, "select");
  assert.deepEqual(by["constraint:up.reference"].options, ["parent", "world"]);
  assert.equal(by["constraint:st.min"].value, 0.5);
  assert.equal(by["ik:arm.bendSide"].control, "select");
  assert.equal(by["ik:arm.bendSide"].value, "left");
  assert.equal(by["ik:arm.allowStretch"].control, "checkbox");
  assert.equal(by["bone:armL.limit.min"].value, -1);
  assert.equal(by["bone:armR.limit.min"].value, undefined);
  assert.equal(by["rig.iterations"].value, 1);
  // every control has the PropControl shape
  for (const c of cs) { assert.equal(typeof c.name, "string"); assert.equal(typeof c.label, "string"); assert.ok(["text", "number", "checkbox", "color", "select"].includes(c.control)); }
  // function-valued slide is listed read-only-ish (not offered as a number)
  const fn = new Skeleton([{ id: "a", length: 1 }, { id: "b", length: 1 }, { id: "c", length: 0.1 }]);
  fn.addConstraint({ type: "connector", id: "k", bone: "c", a: "a", b: "b", slide: () => 0.3 });
  assert.ok(!rigToControls({ skeleton: fn }).some((c) => c.name === "constraint:k.slide"));
});

test("applyRigControl: edits write through to the live rig and refresh geometry", () => {
  const { sk, ik } = build();
  const target = { skeleton: sk, chains: { arm: ik } };
  const before = sk.model.jointPosition("mid");
  applyRigControl(target, "constraint:belt.slide", 0.9);
  assert.equal((sk.constraints!.get("belt") as any).slide, 0.9);
  const after = sk.model.jointPosition("mid");
  assert.ok(Math.hypot(after[0] - before[0], after[1] - before[1]) > 1e-3);
  applyRigControl(target, "constraint:belt.enabled", false);
  assert.equal(sk.constraints!.get("belt")!.enabled, false);
  applyRigControl(target, "constraint:up.multiplier", 1);
  assert.equal((sk.constraints!.get("up") as any).multiplier, 1);
  applyRigControl(target, "ik:arm.bendSide", "right");
  assert.equal(ik.bendSide, "right");
  applyRigControl(target, "ik:arm.allowStretch", true);
  assert.equal(ik.allowStretch, true);
  applyRigControl(target, "bone:armR.limit.max", 0.5);
  assert.deepEqual(sk.model.limitsOf("armR"), { max: 0.5 });
  applyRigControl(target, "bone:armR.limit.max", "");
  assert.equal(sk.model.limitsOf("armR"), undefined);
  applyRigControl(target, "rig.iterations", 8);
  assert.equal(sk.constraints!.iterations, 8);
  assert.throws(() => applyRigControl(target, "constraint:nope.slide", 1), /unknown/i);
  assert.throws(() => applyRigControl(target, "bone:armL.limit.min", 5), /min/); // 5 > max 2
  // limit control set() goes through the same validation and leaves state untouched
  assert.deepEqual(sk.model.limitsOf("armL"), { min: -1, max: 2 });
});

test("ikHandles / pickIKHandle: target points projected through the camera", () => {
  const { sk, ik } = build();
  const camera = new Camera({ pixelWidth: 800, pixelHeight: 450, frameWidth: 8, frameHeight: 4.5, frameCenter: [0, 0, 0] });
  const hs = ikHandles({ arm: ik });
  assert.equal(hs.length, 1);
  assert.deepEqual(hs[0].position, [-1, 2]);
  const [px, py] = camera.toPixel([-1, 2, 0]);
  assert.equal(pickIKHandle(px + 3, py - 2, { arm: ik }, camera)?.name, "arm");
  assert.equal(pickIKHandle(px + 60, py, { arm: ik }, camera), null);
  void sk;
});

test("createIKDrag: grabbing and dragging a handle moves the target and re-solves", () => {
  const { sk, ik } = build();
  const camera = new Camera({ pixelWidth: 800, pixelHeight: 450, frameWidth: 8, frameHeight: 4.5, frameCenter: [0, 0, 0] });
  let changes = 0;
  const drag = createIKDrag({ chains: { arm: ik }, camera, onChange: () => { changes++; } });
  assert.equal(drag.pointerMove(10, 10), false); // not dragging
  const [px, py] = camera.toPixel([-1, 2, 0]);
  assert.equal(drag.pointerDown(px + 2, py + 2)?.name, "arm");
  assert.equal(drag.active, "arm");
  const [qx, qy] = camera.toPixel([-0.5, 2.2, 0]);
  assert.equal(drag.pointerMove(qx + 2, qy + 2), true);
  const t = ik.currentTarget();
  near(t[0], -0.5, 1e-6); near(t[1], 2.2, 1e-6); // grab offset preserved
  const eff = ik.effector;
  assert.ok(Math.hypot(eff[0] - t[0], eff[1] - t[1]) < 1e-6);
  assert.ok(changes >= 1);
  drag.pointerUp();
  assert.equal(drag.active, null);
  assert.equal(drag.pointerMove(0, 0), false);
  void sk;
});

test("createIKDrag: pinned chains move their pin; miss does nothing", () => {
  const { ik } = build();
  const camera = new Camera({ pixelWidth: 800, pixelHeight: 450, frameWidth: 8, frameHeight: 4.5, frameCenter: [0, 0, 0] });
  ik.solve(); ik.pin();
  const drag = createIKDrag({ chains: { arm: ik }, camera });
  assert.equal(drag.pointerDown(5, 5), null);
  const [ex, ey] = camera.toPixel([...ik.effector, 0]);
  assert.ok(drag.pointerDown(ex, ey));
  const [qx, qy] = camera.toPixel([-1, 1.5, 0]);
  drag.pointerMove(qx, qy);
  assert.ok(ik.pinned);
  near(ik.currentTarget()[0], -1, 1e-6);
  drag.pointerUp();
});

test("attachIKDrag: DOM wiring and detach", () => {
  const { ik } = build();
  const camera = new Camera({ pixelWidth: 800, pixelHeight: 450, frameWidth: 8, frameHeight: 4.5, frameCenter: [0, 0, 0] });
  const listeners = new Map<string, Set<(e: any) => void>>();
  const canvas: any = {
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    addEventListener(t: string, f: any) { (listeners.get(t) ?? listeners.set(t, new Set()).get(t)!).add(f); },
    removeEventListener(t: string, f: any) { listeners.get(t)?.delete(f); },
    setPointerCapture() {}, releasePointerCapture() {},
    dispatch(t: string, e: any) { for (const f of listeners.get(t) ?? []) f(e); },
  };
  let renders = 0;
  const h = attachIKDrag(canvas, camera, { chains: { arm: ik }, render: () => { renders++; } });
  const [px, py] = camera.toPixel([-1, 2, 0]);
  canvas.dispatch("pointerdown", { clientX: px, clientY: py, pointerId: 1 });
  const [qx, qy] = camera.toPixel([0, 2, 0]);
  canvas.dispatch("pointermove", { clientX: qx, clientY: qy, pointerId: 1 });
  canvas.dispatch("pointerup", { pointerId: 1 });
  assert.ok(renders >= 1);
  near(ik.currentTarget()[0], 0, 1e-6);
  h.detach();
  for (const s of listeners.values()) assert.equal(s.size, 0);
});
