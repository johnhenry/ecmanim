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

  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const clampZoom = (z: number): number => Math.max(minZoom, Math.min(maxZoom, z));

  const onPointerDown = (ev: any): void => {
    dragging = true;
    [lastX, lastY] = pointerPos(canvas, ev);
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
    dragging = false;
    canvas.releasePointerCapture?.(ev.pointerId);
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
      canvas.removeEventListener?.("pointerdown", onPointerDown);
      canvas.removeEventListener?.("pointermove", onPointerMove);
      canvas.removeEventListener?.("pointerup", onPointerUp);
      canvas.removeEventListener?.("pointerleave", onPointerUp);
      canvas.removeEventListener?.("wheel", onWheel);
      canvas.removeEventListener?.("click", onClick);
    },
  };
}
