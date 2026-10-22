// Studio authoring helpers for skeleton rigs (epic #61, #92). Everything here is
// framework-agnostic and renderer-independent:
//  - `rigToControls` / `applyRigControl`: turn a rig's constraints, IK chains and
//    joint limits into `PropControl`-shaped descriptors (plus a live `value` and a
//    `set()` that writes through and refreshes), for any props panel to render.
//  - `ikHandles` / `pickIKHandle` / `createIKDrag` / `attachIKDrag`: grab an IK
//    target (or pin) in the viewport and drag it; the chain re-solves per move.
// No DOM is touched except through the `canvas` you pass to `attachIKDrag`. 2D
// cameras only (the pixel -> world map is the camera's own affine `toPixel`).

import type { Skeleton } from "../mobject/skeleton.ts";
import type { IKChain } from "../mobject/ik.ts";
import type { Camera } from "../renderer/CanvasRenderer.ts";
import type { PropControl } from "./props.ts";

export interface RigControlTarget {
  skeleton: Skeleton;
  /** Named IK chains to expose (the key is the control-name prefix `ik:<key>.`). */
  chains?: Record<string, IKChain>;
}

export interface RigControl extends PropControl {
  group: "constraint" | "ik" | "bone" | "rig";
  /** Current value (undefined = unset, e.g. no joint limit). */
  value: unknown;
  /** Write a new value through to the rig and refresh. Throws on invalid input (state unchanged). */
  set(value: unknown): void;
}

const num = (v: unknown, what: string): number | undefined => {
  if (v === undefined || v === null || (typeof v === "string" && v.trim() === "")) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) throw new TypeError(`rig control ${what}: expected a finite number (got ${String(v)})`);
  return n;
};
const need = (v: number | undefined, what: string): number => {
  if (v === undefined) throw new TypeError(`rig control ${what}: a value is required`);
  return v;
};

/**
 * Describe a rig's editable parameters as controls. Listed: per constraint
 * `enabled` plus its value fields (connector `slide` when it is a number,
 * weighted `weight.<joint>`, angleLock `reference`/`multiplier`/`offset`,
 * stretch `min`/`max`/`restLength`/`widthResponse`); the set's fixed-point
 * `rig.iterations` / `rig.tolerance`; per IK chain `bendSide`, `allowStretch`,
 * `pinned` (and a numeric `effectorAngle`); per bone `limit.min` / `limit.max`.
 * Structural fields (bones, anchors) are not editable and are not listed.
 */
export function rigToControls(target: RigControlTarget): RigControl[] {
  const { skeleton: sk } = target;
  const m = sk.model;
  const out: RigControl[] = [];
  const add = (c: Omit<RigControl, "label"> & { label?: string }) => out.push({ label: c.name, ...c } as RigControl);

  const refresh = () => { sk.refresh(); };
  const cs = sk.constraints;
  if (cs) {
    for (const id of cs.ids()) {
      const c = cs.get(id) as any;
      const base = `constraint:${id}`;
      add({ group: "constraint", name: `${base}.enabled`, control: "checkbox", value: c.enabled, set: (v) => { c.enabled = !!v; refresh(); } });
      const numField = (field: string, opts: { min?: number; clearable?: boolean } = {}) => add({
        group: "constraint", name: `${base}.${field}`, control: "number", value: c[field], min: opts.min,
        set: (v) => {
          const n = num(v, `${base}.${field}`);
          if (n === undefined) { if (!opts.clearable) need(n, `${base}.${field}`); delete c[field]; } else c[field] = n;
          refresh();
        },
      });
      switch (c.type) {
        case "connector": if (typeof c.slide === "number") numField("slide"); break;
        case "weighted":
          for (const a of c.anchors as { joint: string; weight: number }[]) {
            add({ group: "constraint", name: `${base}.weight.${a.joint}`, control: "number", value: a.weight, set: (v) => { a.weight = need(num(v, `${base}.weight.${a.joint}`), `${base}.weight.${a.joint}`); refresh(); } });
          }
          break;
        case "angleLock":
          add({ group: "constraint", name: `${base}.reference`, control: "select", options: ["parent", "world"], value: c.reference ?? "parent", set: (v) => {
            if (v !== "parent" && v !== "world") throw new Error(`rig control ${base}.reference: must be "parent" or "world"`);
            c.reference = v; refresh();
          } });
          numField("multiplier"); numField("offset");
          break;
        case "stretch":
          numField("min", { min: 0 }); numField("max", { min: 0 }); numField("restLength", { min: 0, clearable: true }); numField("widthResponse", { clearable: true });
          break;
      }
    }
    add({ group: "rig", name: "rig.iterations", control: "number", min: 1, value: cs.iterations, set: (v) => { cs.configure({ iterations: need(num(v, "rig.iterations"), "rig.iterations") }); refresh(); } });
    add({ group: "rig", name: "rig.tolerance", control: "number", min: 0, value: cs.tolerance, set: (v) => { cs.configure({ tolerance: need(num(v, "rig.tolerance"), "rig.tolerance") }); refresh(); } });
  }

  for (const [key, ik] of Object.entries(target.chains ?? {})) {
    const base = `ik:${key}`;
    add({ group: "ik", name: `${base}.bendSide`, control: "select", options: ["left", "right", "auto"], value: ik.bendSide, set: (v) => {
      if (v !== "left" && v !== "right" && v !== "auto") throw new Error(`rig control ${base}.bendSide: must be left, right or auto`);
      ik.bendSide = v; ik.solve();
    } });
    add({ group: "ik", name: `${base}.allowStretch`, control: "checkbox", value: ik.allowStretch, set: (v) => { ik.allowStretch = !!v; ik.solve(); } });
    add({ group: "ik", name: `${base}.pinned`, control: "checkbox", value: ik.pinned, set: (v) => { if (v) ik.pin(); else ik.unpin(); } });
    if (typeof ik.effectorAngle === "number") {
      add({ group: "ik", name: `${base}.effectorAngle`, control: "number", value: ik.effectorAngle, set: (v) => { ik.effectorAngle = need(num(v, `${base}.effectorAngle`), `${base}.effectorAngle`); ik.solve(); } });
    }
  }

  for (const id of m.ids) {
    for (const end of ["min", "max"] as const) {
      const name = `bone:${id}.limit.${end}`;
      add({ group: "bone", name, control: "number", value: m.limitsOf(id)?.[end], set: (v) => {
        const n = num(v, name);
        const next = { ...(m.limitsOf(id) ?? {}) } as { min?: number; max?: number };
        if (n === undefined) delete next[end]; else next[end] = n;
        m.setLimits(id, Object.keys(next).length ? next : null);
      } });
    }
  }
  return out;
}

/** Set one control by name (see `rigToControls`). Throws on an unknown name or invalid value. */
export function applyRigControl(target: RigControlTarget, name: string, value: unknown): void {
  const c = rigToControls(target).find((x) => x.name === name);
  if (!c) throw new Error(`applyRigControl: unknown control "${name}"`);
  c.set(value);
}

// --- IK handles ----------------------------------------------------------------

export interface IKHandle {
  /** The chain's key in the `chains` record. */
  name: string;
  chain: IKChain;
  /** World position being reached for (the pin when pinned, else the target). */
  position: [number, number];
}

export function ikHandles(chains: Record<string, IKChain>): IKHandle[] {
  return Object.entries(chains).map(([name, chain]) => ({ name, chain, position: chain.currentTarget() }));
}

/** The nearest handle within `radiusPx` (default 14) of pixel (px, py), or null. */
export function pickIKHandle(px: number, py: number, chains: Record<string, IKChain>, camera: Camera, radiusPx = 14): IKHandle | null {
  let best: IKHandle | null = null, bd = radiusPx;
  for (const h of ikHandles(chains)) {
    const [sx, sy] = camera.toPixel([h.position[0], h.position[1], 0]);
    const d = Math.hypot(sx - px, sy - py);
    if (d <= bd) { best = h; bd = d; }
  }
  return best;
}

/** Pixel -> world (z = 0) for a 2D camera, by inverting its affine `toPixel`. */
function pixelToWorld(camera: Camera, px: number, py: number): [number, number] {
  const o = camera.toPixel([0, 0, 0]), ex = camera.toPixel([1, 0, 0]), ey = camera.toPixel([0, 1, 0]);
  const a = ex[0] - o[0], b = ey[0] - o[0], c = ex[1] - o[1], d = ey[1] - o[1];
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return [0, 0];
  const dx = px - o[0], dy = py - o[1];
  return [(d * dx - b * dy) / det, (-c * dx + a * dy) / det];
}

export interface IKDragOptions {
  chains: Record<string, IKChain>;
  camera: Camera;
  /** Pixel radius for grabbing a handle. Default 14. */
  pickRadius?: number;
  /** Called after each move, once the chain has re-solved. */
  onChange?: (handle: IKHandle) => void;
}

export interface IKDrag {
  /** Name of the chain being dragged, or null. */
  readonly active: string | null;
  /** Start a drag if a handle is under (px, py); returns it, else null. */
  pointerDown(px: number, py: number): IKHandle | null;
  /** Move the grabbed target/pin to (px, py) and re-solve. False when nothing is grabbed. */
  pointerMove(px: number, py: number): boolean;
  pointerUp(): void;
}

/**
 * Pure drag state machine. Dragging replaces the chain's target with the fixed
 * dragged point (or moves the pin when the chain is pinned), preserving the grab
 * offset, and calls `chain.solve()` on every move. The new target stays after
 * release (re-assign `chain.target` to restore a driven one).
 */
export function createIKDrag(opts: IKDragOptions): IKDrag {
  let grabbed: IKHandle | null = null;
  let offset: [number, number] = [0, 0];
  return {
    get active() { return grabbed ? grabbed.name : null; },
    pointerDown(px, py) {
      const h = pickIKHandle(px, py, opts.chains, opts.camera, opts.pickRadius);
      if (!h) return null;
      const w = pixelToWorld(opts.camera, px, py);
      offset = [h.position[0] - w[0], h.position[1] - w[1]];
      grabbed = h;
      return h;
    },
    pointerMove(px, py) {
      if (!grabbed) return false;
      const w = pixelToWorld(opts.camera, px, py);
      const p: [number, number] = [w[0] + offset[0], w[1] + offset[1]];
      const ch = grabbed.chain;
      if (ch.pinned) ch.pin(p); else ch.target = () => [p[0], p[1]];
      ch.solve();
      grabbed.position = p;
      opts.onChange?.(grabbed);
      return true;
    },
    pointerUp() { grabbed = null; },
  };
}

export interface AttachIKDragOptions extends IKDragOptions {
  /** Called after every move so the caller can redraw. */
  render: () => void;
}

/** Wire `createIKDrag` to pointer events on `canvas`; `detach()` removes the listeners. */
export function attachIKDrag(canvas: any, camera: Camera, opts: Omit<AttachIKDragOptions, "camera">): { detach(): void } {
  const drag = createIKDrag({ ...opts, camera });
  const pos = (ev: any): [number, number] => {
    const r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
    return [ev.clientX - r.left, ev.clientY - r.top];
  };
  const down = (ev: any) => { const [x, y] = pos(ev); if (drag.pointerDown(x, y)) canvas.setPointerCapture?.(ev.pointerId); };
  const move = (ev: any) => { const [x, y] = pos(ev); if (drag.pointerMove(x, y)) opts.render(); };
  const up = (ev: any) => { if (drag.active !== null) canvas.releasePointerCapture?.(ev.pointerId); drag.pointerUp(); };
  canvas.addEventListener?.("pointerdown", down);
  canvas.addEventListener?.("pointermove", move);
  canvas.addEventListener?.("pointerup", up);
  canvas.addEventListener?.("pointerleave", up);
  return {
    detach() {
      canvas.removeEventListener?.("pointerdown", down);
      canvas.removeEventListener?.("pointermove", move);
      canvas.removeEventListener?.("pointerup", up);
      canvas.removeEventListener?.("pointerleave", up);
    },
  };
}
