import { test } from "node:test";
import assert from "node:assert/strict";

import { attachInteractiveCamera } from "../src/studio/interactive.ts";
import { Camera } from "../src/renderer/CanvasRenderer.ts";

// Same fake-canvas shape used by test/studio-interactive.test.ts.
function makeFakeCanvas(): any {
  const listeners = new Map<string, Set<(ev: any) => void>>();
  return {
    getBoundingClientRect() {
      return { left: 0, top: 0 };
    },
    addEventListener(type: string, fn: any) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: any) {
      listeners.get(type)?.delete(fn);
    },
    setPointerCapture() {},
    releasePointerCapture() {},
    dispatch(type: string, ev: any) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(ev);
    },
  };
}

// A fake clock + a manually-drainable frame queue, so momentum can be driven
// deterministically instead of racing real timers/rAF.
function makeFakeScheduler() {
  let t = 0;
  const pending: Array<() => void> = [];
  return {
    now: () => t,
    advance(ms: number) {
      t += ms;
    },
    scheduleFrame: (cb: () => void): any => {
      pending.push(cb);
      return cb;
    },
    cancelFrame: (handle: any): void => {
      const i = pending.indexOf(handle);
      if (i >= 0) pending.splice(i, 1);
    },
    pending,
    drain(maxIterations = 10000): number {
      let iterations = 0;
      while (pending.length && iterations < maxIterations) {
        t += 16;
        const cb = pending.shift()!;
        cb();
        iterations++;
      }
      return iterations;
    },
  };
}

test("drag + release with momentum enabled keeps moving the camera, then settles back near the release position", () => {
  const canvas = makeFakeCanvas();
  const camera = new Camera({ pixelWidth: 800, pixelHeight: 450, frameWidth: 8, frameHeight: 4.5, frameCenter: [0, 0, 0] });
  const sched = makeFakeScheduler();
  let renders = 0;

  attachInteractiveCamera(canvas, camera, {
    render: () => { renders++; },
    momentum: true,
    now: sched.now,
    scheduleFrame: sched.scheduleFrame,
    cancelFrame: sched.cancelFrame,
  });

  canvas.dispatch("pointerdown", { clientX: 0, clientY: 0, pointerId: 1 });
  sched.advance(10); canvas.dispatch("pointermove", { clientX: 20, clientY: 0 });
  sched.advance(10); canvas.dispatch("pointermove", { clientX: 40, clientY: 0 });
  sched.advance(10); canvas.dispatch("pointermove", { clientX: 60, clientY: 0 });
  const xAtRelease = camera.frameCenter[0];
  canvas.dispatch("pointerup", { pointerId: 1 });

  assert.ok(sched.pending.length > 0, "momentum should schedule a frame on release");

  let firstStepX: number | null = null;
  let iterations = 0;
  while (sched.pending.length && iterations < 10000) {
    sched.advance(16);
    const cb = sched.pending.shift()!;
    cb();
    if (firstStepX === null) firstStepX = camera.frameCenter[0];
    iterations++;
  }

  assert.ok(iterations > 1, "momentum should run for more than a single frame");
  assert.ok(renders > 0, "render() should have been called during momentum");
  assert.ok(firstStepX !== null && firstStepX !== xAtRelease, "the camera visibly moved due to momentum");
  assert.ok(
    Math.abs(camera.frameCenter[0] - xAtRelease) < 1e-2,
    `expected the camera to settle back near its release position (${xAtRelease}), got ${camera.frameCenter[0]}`,
  );
});

test("a fresh pointerdown mid-fling cancels the running momentum", () => {
  const canvas = makeFakeCanvas();
  const camera = new Camera({ pixelWidth: 800, pixelHeight: 450, frameWidth: 8, frameHeight: 4.5, frameCenter: [0, 0, 0] });
  const sched = makeFakeScheduler();

  attachInteractiveCamera(canvas, camera, {
    render: () => {},
    momentum: true,
    now: sched.now,
    scheduleFrame: sched.scheduleFrame,
    cancelFrame: sched.cancelFrame,
  });

  canvas.dispatch("pointerdown", { clientX: 0, clientY: 0, pointerId: 1 });
  sched.advance(10); canvas.dispatch("pointermove", { clientX: 30, clientY: 0 });
  sched.advance(10); canvas.dispatch("pointermove", { clientX: 60, clientY: 0 });
  canvas.dispatch("pointerup", { pointerId: 1 });

  assert.ok(sched.pending.length > 0, "momentum scheduled after release");

  canvas.dispatch("pointerdown", { clientX: 5, clientY: 5, pointerId: 1 });
  assert.equal(sched.pending.length, 0, "a fresh drag must cancel the running momentum");
});

test("momentum disabled by default: no frame is scheduled after release", () => {
  const canvas = makeFakeCanvas();
  const camera = new Camera({ pixelWidth: 800, pixelHeight: 450, frameWidth: 8, frameHeight: 4.5, frameCenter: [0, 0, 0] });
  const sched = makeFakeScheduler();

  attachInteractiveCamera(canvas, camera, {
    render: () => {},
    now: sched.now,
    scheduleFrame: sched.scheduleFrame,
    cancelFrame: sched.cancelFrame,
  });

  canvas.dispatch("pointerdown", { clientX: 0, clientY: 0, pointerId: 1 });
  sched.advance(10); canvas.dispatch("pointermove", { clientX: 60, clientY: 0 });
  canvas.dispatch("pointerup", { pointerId: 1 });

  assert.equal(sched.pending.length, 0, "momentum is opt-in; disabled by default");
});

test("a slow/negligible release does not trigger momentum", () => {
  const canvas = makeFakeCanvas();
  const camera = new Camera({ pixelWidth: 800, pixelHeight: 450, frameWidth: 8, frameHeight: 4.5, frameCenter: [0, 0, 0] });
  const sched = makeFakeScheduler();

  attachInteractiveCamera(canvas, camera, {
    render: () => {},
    momentum: true,
    now: sched.now,
    scheduleFrame: sched.scheduleFrame,
    cancelFrame: sched.cancelFrame,
  });

  canvas.dispatch("pointerdown", { clientX: 0, clientY: 0, pointerId: 1 });
  sched.advance(1000); canvas.dispatch("pointermove", { clientX: 0.4, clientY: 0 }); // barely moved, very slowly
  canvas.dispatch("pointerup", { pointerId: 1 });

  assert.equal(sched.pending.length, 0, "a negligible release velocity should not start a fling");
});
