// Pointer-driven camera control for any renderer configuration (2D
// CanvasRenderer, 2D-orthographic ThreeRenderer, 3D-perspective ThreeRenderer).
// Drag pans (2D) or orbits (3D); wheel zooms via the shared `camera.zoom`
// (see Camera.toPixel() in renderer/CanvasRenderer.ts). Picking is
// screen-space bounding-box hit-testing — every candidate mobject's world AABB
// corners are forward-projected through the camera's own `toPixel()` (which
// already handles both the 2D affine map and ThreeDCamera's 3D perspective
// override), so no inverse projection or GPU raycasting is needed.
//
// Renderer-agnostic by design: this module never calls `renderer.renderScene()`
// itself. Callers supply `opts.render()`, invoked after every camera mutation.

import type { Camera } from "../renderer/CanvasRenderer.ts";
import { spring, measureSpring } from "../animation/spring.ts";
import type { SpringConfig } from "../animation/spring.ts";

export interface InteractiveCameraOptions {
  /** Called after every camera mutation (pan/orbit/zoom) so the caller can redraw. */
  render: () => void;
  /** Mobjects tested for picking on click/hover. Defaults to none (picking disabled). */
  mobjects?: any[];
  onClick?: (hit: PickResult | null, ev: any) => void;
  onHover?: (hit: PickResult | null, ev: any) => void;
  /** World units of pan per pixel dragged is derived from the camera; this only
   * scales orbit (degrees per pixel) and wheel zoom (multiplier per notch). */
  orbitSensitivity?: number;
  zoomSensitivity?: number;
  /** Minimum/maximum camera.zoom, applied after every wheel step. Default [0.05, 20]. */
  minZoom?: number;
  maxZoom?: number;
  /** Enable "fling and decelerate" momentum after a drag release: the
   *  released pointer velocity feeds a spring's `velocity0`, sprung back
   *  toward the value it was already at (not toward any fixed target).
   *  Default false. */
  momentum?: boolean;
  /** Spring config used for the momentum decay. Defaults to a gentle,
   *  slightly underdamped feel. */
  momentumConfig?: SpringConfig;
  /** Injectable clock (ms), for deterministic testing. Defaults to Date.now. */
  now?: () => number;
  /** Injectable per-frame scheduler, for deterministic testing. Defaults to
   *  requestAnimationFrame (falls back to a 16ms timer with no DOM). The
   *  returned handle is passed back to `cancelFrame`. */
  scheduleFrame?: (cb: () => void) => any;
  /** Injectable canceller matching `scheduleFrame`'s handle. Defaults to
   *  cancelAnimationFrame (or clearTimeout with no DOM). */
  cancelFrame?: (handle: any) => void;
}

export interface PickResult {
  mobject: any;
  index: number;
}

export interface InteractiveCameraHandle {
  detach(): void;
}

function is3D(camera: Camera): boolean {
  return typeof camera.projectionDepth === "function";
}

function pointerPos(canvas: any, ev: any): [number, number] {
  const rect = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
  return [ev.clientX - rect.left, ev.clientY - rect.top];
}

/**
 * Forward-project each mobject's world-space bounding box through
 * `camera.toPixel()` and return the topmost (last-drawn) mobject whose
 * screen-space AABB contains (px, py), or null.
 */
export function pickAt(px: number, py: number, mobjects: any[], camera: Camera): PickResult | null {
  for (let i = mobjects.length - 1; i >= 0; i--) {
    const mob = mobjects[i];
    if (typeof mob?.getBoundingBox !== "function") continue;
    const { min, max } = mob.getBoundingBox();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const x of [min[0], max[0]]) {
      for (const y of [min[1], max[1]]) {
        for (const z of [min[2], max[2]]) {
          const [sx, sy] = camera.toPixel([x, y, z]);
          if (sx < minX) minX = sx;
          if (sx > maxX) maxX = sx;
          if (sy < minY) minY = sy;
          if (sy > maxY) maxY = sy;
        }
      }
    }
    if (px >= minX && px <= maxX && py >= minY && py <= maxY) {
      return { mobject: mob, index: i };
    }
  }
  return null;
}

/**
 * Attach pointer (drag pan/orbit) and wheel (zoom) handlers to `canvas`,
 * mutating `camera` in place and invoking `opts.render()` after each change.
 * Returns a handle whose `detach()` removes every listener — call it from
 * `disconnectedCallback` or equivalent teardown.
 */
export function attachInteractiveCamera(
  canvas: any,
  camera: Camera,
  opts: InteractiveCameraOptions,
): InteractiveCameraHandle {
  const orbitSensitivity = opts.orbitSensitivity ?? 0.5; // degrees per pixel
  const zoomSensitivity = opts.zoomSensitivity ?? 0.001; // exponent per wheel-delta unit
  const minZoom = opts.minZoom ?? 0.05;
  const maxZoom = opts.maxZoom ?? 20;
  const momentumEnabled = opts.momentum ?? false;
  const momentumConfig: SpringConfig = opts.momentumConfig ?? { mass: 1, damping: 12, stiffness: 90 };
  const now = opts.now ?? ((): number => Date.now());
  const scheduleFrame =
    opts.scheduleFrame ??
    ((cb: () => void): any =>
      typeof requestAnimationFrame === "function" ? requestAnimationFrame(cb) : setTimeout(cb, 16));
  const cancelFrame =
    opts.cancelFrame ??
    ((h: any): void => {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(h);
      else clearTimeout(h);
    });

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  // Ring buffer of recent (t, x, y) pointer samples while dragging, used to
  // estimate a "flick" release velocity -- oldest-vs-newest within the last
  // few samples, not just the final instantaneous delta (which is noisy).
  const RING_SIZE = 5;
  let ring: Array<{ t: number; x: number; y: number }> = [];
  let momentumHandle: any = null;

  const clampZoom = (z: number): number => Math.max(minZoom, Math.min(maxZoom, z));

  const cancelMomentum = (): void => {
    if (momentumHandle != null) {
      cancelFrame(momentumHandle);
      momentumHandle = null;
    }
  };

  // Release velocity in px/sec, from the oldest to the newest ring sample.
  const releaseVelocityPxPerSec = (): [number, number] => {
    if (ring.length < 2) return [0, 0];
    const first = ring[0];
    const last = ring[ring.length - 1];
    const dt = (last.t - first.t) / 1000;
    if (dt <= 0) return [0, 0];
    return [(last.x - first.x) / dt, (last.y - first.y) / dt];
  };

  // Spring each driven field from its current value back to itself, seeded
  // with the release velocity -- "fling and decelerate", not "seek a target".
  const startMomentum = (): void => {
    const [vx, vy] = releaseVelocityPxPerSec();
    ring = [];
    if (Math.abs(vx) < 1 && Math.abs(vy) < 1) return; // no meaningful fling

    const settleSeconds = measureSpring({ fps: 60, config: momentumConfig }) / 60;
    const start = now();

    if (is3D(camera)) {
      const theta0 = (camera as any).theta ?? 0;
      const phi0 = (camera as any).phi ?? 0;
      const vTheta = vx * orbitSensitivity * (Math.PI / 180);
      const vPhi = vy * orbitSensitivity * (Math.PI / 180);
      const step = (): void => {
        const t = (now() - start) / 1000;
        (camera as any).theta = spring({ frame: t * 60, fps: 60, from: theta0, to: theta0, config: momentumConfig, velocity0: vTheta });
        (camera as any).phi = spring({ frame: t * 60, fps: 60, from: phi0, to: phi0, config: momentumConfig, velocity0: vPhi });
        opts.render();
        momentumHandle = t < settleSeconds ? scheduleFrame(step) : null;
      };
      momentumHandle = scheduleFrame(step);
    } else {
      const z = camera.zoom ?? 1;
      const cx0 = camera.frameCenter[0];
      const cy0 = camera.frameCenter[1];
      const vCx = (-vx / camera.pixelWidth) * camera.frameWidth * z;
      const vCy = (vy / camera.pixelHeight) * camera.frameHeight * z;
      const step = (): void => {
        const t = (now() - start) / 1000;
        const cx = spring({ frame: t * 60, fps: 60, from: cx0, to: cx0, config: momentumConfig, velocity0: vCx });
        const cy = spring({ frame: t * 60, fps: 60, from: cy0, to: cy0, config: momentumConfig, velocity0: vCy });
        camera.frameCenter = [cx, cy, camera.frameCenter[2] ?? 0];
        opts.render();
        momentumHandle = t < settleSeconds ? scheduleFrame(step) : null;
      };
      momentumHandle = scheduleFrame(step);
    }
  };

  const onPointerDown = (ev: any): void => {
    cancelMomentum();
    dragging = true;
    [lastX, lastY] = pointerPos(canvas, ev);
    ring = [{ t: now(), x: lastX, y: lastY }];
    canvas.setPointerCapture?.(ev.pointerId);
  };

  const onPointerMove = (ev: any): void => {
    if (!dragging) {
      if (opts.onHover && opts.mobjects) {
        const [px, py] = pointerPos(canvas, ev);
        opts.onHover(pickAt(px, py, opts.mobjects, camera), ev);
      }
      return;
    }
    const [x, y] = pointerPos(canvas, ev);
    const dx = x - lastX;
    const dy = y - lastY;
    lastX = x;
    lastY = y;

    if (momentumEnabled) {
      ring.push({ t: now(), x, y });
      if (ring.length > RING_SIZE) ring.shift();
    }

    if (is3D(camera)) {
      (camera as any).theta = ((camera as any).theta ?? 0) + dx * orbitSensitivity * (Math.PI / 180);
      (camera as any).phi = ((camera as any).phi ?? 0) + dy * orbitSensitivity * (Math.PI / 180);
    } else {
      const z = camera.zoom ?? 1;
      const worldDx = (-dx / camera.pixelWidth) * camera.frameWidth * z;
      const worldDy = (dy / camera.pixelHeight) * camera.frameHeight * z;
      camera.frameCenter = [
        camera.frameCenter[0] + worldDx,
        camera.frameCenter[1] + worldDy,
        camera.frameCenter[2] ?? 0,
      ];
    }
    opts.render();
  };

  const onPointerUp = (ev: any): void => {
    const wasDragging = dragging;
    dragging = false;
    canvas.releasePointerCapture?.(ev.pointerId);
    if (momentumEnabled && wasDragging) startMomentum();
  };

  const onWheel = (ev: any): void => {
    ev.preventDefault?.();
    const factor = Math.exp(-ev.deltaY * zoomSensitivity);
    camera.zoom = clampZoom((camera.zoom ?? 1) * factor);
    opts.render();
  };

  const onClick = (ev: any): void => {
    if (!opts.onClick) return;
    const [px, py] = pointerPos(canvas, ev);
    opts.onClick(pickAt(px, py, opts.mobjects ?? [], camera), ev);
  };

  canvas.addEventListener?.("pointerdown", onPointerDown);
  canvas.addEventListener?.("pointermove", onPointerMove);
  canvas.addEventListener?.("pointerup", onPointerUp);
  canvas.addEventListener?.("pointerleave", onPointerUp);
  canvas.addEventListener?.("wheel", onWheel, { passive: false });
  canvas.addEventListener?.("click", onClick);

  return {
    detach(): void {
      cancelMomentum();
      canvas.removeEventListener?.("pointerdown", onPointerDown);
      canvas.removeEventListener?.("pointermove", onPointerMove);
      canvas.removeEventListener?.("pointerup", onPointerUp);
      canvas.removeEventListener?.("pointerleave", onPointerUp);
      canvas.removeEventListener?.("wheel", onWheel);
      canvas.removeEventListener?.("click", onClick);
    },
  };
}
