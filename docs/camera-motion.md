# Camera motion: shake, handheld, impact, zoom pulse, follow

Two layers that compose:

1. **Effects** -- seeded, closed-form functions of time layered on top of the
   camera framing: `CameraShake`, `Handheld`, `CameraImpact`, `ZoomPulse`, or
   any `(t) => ({ dx, dy, roll, logZoom })` function.
2. **Follow** -- `CameraFollow` tracks a moving target (dead zone, hysteresis,
   look-ahead, critically damped smoothing, optional auto-zoom). Following is
   path-dependent, so it is **baked** at a fixed dt into a `KeyframeTrack`
   (`bakeCameraMotion`) and sampled by absolute time.

Follow drives the frame; shake rides on top.

```ts
import { MovingCameraScene, CameraImpact, Handheld } from "@johnhenry/ecmanim";

class Demo extends MovingCameraScene {
  async construct() {
    this.camera!.addEffect(new Handheld({ seed: 3 }));              // always on
    this.followCamera((t) => [3 * Math.sin(t), 0, 0], {            // t = seconds since this call
      duration: 6, deadZone: { width: 2, height: 1.2 }, lookAhead: 0.3,
      autoZoom: { margin: 0.3 },
    });
    this.camera!.addEffect(new CameraImpact({ magnitude: 0.5 }), { start: 2 });
    this.shakeCamera({ duration: 0.6, amplitude: 0.2, roll: 0.03 });
    await this.wait(6);
  }
}
```

## Effects

`camera.addEffect(fx, { start, duration, fadeIn, fadeOut })` / `removeEffect(fx)` /
`clearEffects()`. `fx` is a function or an object with `evaluate(t)` (and an
optional `fingerprint()` used in cache keys). The effect receives the time
since `start`; its output is scaled by a smooth fade envelope (0 outside
`[start, start + duration]`).

| Field | Meaning | Composition |
|---|---|---|
| `dx, dy` | camera offset, world units | sum |
| `roll` | camera roll, radians (same sign as `camera.rotation`) | sum |
| `logZoom` | log of the zoom factor (positive = zoom in) | sum (= factors multiply) |

Presets (all constants are this project's own; every random source is seeded):

| Preset | Character | Main options |
|---|---|---|
| `CameraShake` | fast noise, bounded by `amplitude` | `amplitude` 0.12, `frequency` 11 Hz, `roll`, `zoom`, `decay`, `seed` |
| `Handheld` | slow two-octave drift | `amplitude` 0.05, `frequency` 0.6 Hz, `roll` 0.008, `seed` |
| `CameraImpact` | one damped hit along `angle` | `magnitude` 0.35, `angle` -PI/2, `frequency` 3.2, `decay` 5, `rollKick`, `zoomKick` |
| `ZoomPulse` | smooth punch-in that returns to rest | `amount` 0.08, `period` 0.6, `beats` 1 |

### How it is applied

Effects are evaluated from **absolute `scene.time`** (`Scene.emitFrame` calls
`camera.setEffectTime(time)`), never from accumulated `dt`, so seeking,
studio scrubbing and `node-parallel` segments all agree. The result lands in
**separate** camera fields -- `effectOffset`, `effectRoll`, `effectLogZoom` --
read by `Camera.toPixel` and `ThreeRenderer`. They are never written into
`frameCenter` or the frame mobject (`preRender()` overwrites or accumulates
there). A camera with no effects takes the exact pre-existing code path
(`toPixel` is byte-identical; tested).

- `ThreeDCamera`: roll adds to `gamma`; the offset is a camera-space (screen
  aligned) shift; zoom multiplies `zoom`.
- `MultiCamera` / `MappingCamera` keep their `preRender` / `toPixel` chains and
  inherit effects. Sub-cameras of a `MultiCamera` do not.
- `ZoomedScene`'s derived zoom camera is built fresh and does **not** inherit
  shake: the magnified inset shows the un-shaken region, while the display
  rectangle itself (a scene mobject) shakes with the world.
- Fixed-in-frame mobjects (`_drawFixed`) are HUD-like and do not shake.

### Cache correctness

Effect state is part of the cache keys: `computeRenderConfigHash` and
`Scene.hashAnimations` (play and wait segments) include
`camera.effectsFingerprint()` when effects exist, and the canvas static-subtree
cache fingerprint includes the current effect offset/roll/zoom. With no
effects every key is unchanged. Custom function effects are fingerprinted by
their source text -- give object effects a `fingerprint()` when they close
over parameters.

## CameraFollow

```ts
const follow = new CameraFollow({
  target: (t) => ({ center: [x(t), y(t), 0], width: 2, height: 1 }),  // or a bare point
  deadZone: { width: 2, height: 1.2 }, hysteresis: 0.5, lookAhead: 0.25,
  smoothTime: 0.35, autoZoom: { margin: 0.3, minHeight: 2, maxHeight: 40 },
});
const track = bakeCameraMotion(follow, { duration: 8, center: [0, 0, 0], height: 8, dt: 1 / 60 });
track.valueAt(2.5); // [centerX, centerY, height]
```

- **Dead zone + hysteresis**: the camera ignores the target inside the zone;
  once it starts chasing on an axis it continues until the target is within
  `deadZone * (1 - hysteresis)`, so it does not chatter at the edge.
- **Smoothing**: an exact critically damped step (no integration error).
- **Auto-zoom**: fits the target's bbox plus margin, clamped, with its own
  smoothing.
- The target must be a **function of time** so the bake can run without
  playing the scene.

`MovingCameraScene.followCamera(target, { duration, ...config })` bakes at the
current scene time, then drives the frame during `[now, now + duration]`. It
yields to explicit frame animations: `play(frame.animate...)` suspends the
frame's updaters, so a user animation always wins while it runs. After the
window the frame is left where it ended. `stopFollowCamera()` detaches it.

## Renderer support

| | Canvas-2D | SVG | Three.js / WebGL | Headless GPU |
|---|:-:|:-:|:-:|:-:|
| Offset / roll / zoom effects | yes | yes (via `toPixel`) | yes (needs the #62 `preRender` fix) | follows the Three.js column |
| `CameraFollow` frame driving | yes | yes | yes (frame is synced by `preRender`) | follows Three.js |

## Honest divergences

- Effects apply a rigid camera transform; there is no motion blur, so heavy
  shakes at low fps look steppy.
- 2D `roll` rotates about the (shifted) frame centre; WebGL does the same via
  the camera `up` vector, but pixel results are GPU-dependent.
- Perspective (`ThreeDCamera`) offsets are applied before the perspective
  divide, i.e. as a screen-aligned shift of the view, not a parallax-accurate
  dolly.
- `followCamera` samples the baked track linearly at the bake dt (default
  1/60 s); a coarser `dt` trades smoothness for bake time.
- Follow targets cannot be plain mobjects: a mobject's position at bake time is
  not its position later. Pass a function of time (e.g. from a
  `KeyframeTrack.valueAt` or the same expression that animates the mobject).
