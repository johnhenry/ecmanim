# Studio overlays: onion skin and motion paths (`@johnhenry/ecmanim/studio`)

Two review aids layered above a `Player` canvas. All planning/sampling logic
is pure and DOM-free; only `attachOnionSkin` / `attachMotionPath` /
`renderOnionRaster` / `renderMotionPath` touch a canvas, and they take the
canvas (or 2D context) from the caller, so they are testable under fakes.

```ts
import { attachOnionSkin, attachMotionPath, sampleKeyframeMarkers } from "@johnhenry/ecmanim/studio";

// Raster onion skin: composite the Player's recorded frames at +-k.
const onion = attachOnionSkin(player, { count: 2, step: 3, prevColor: "#ff5555", nextColor: "#55aaff", opacity: 0.4 });
player.seek(40); onion.refresh();            // redraw after every seek

// Vector onion skin for a time-pure mobject (Skeleton): clone + setTime(t +- k*step).
attachOnionSkin(player, { count: 2, step: 0.25, vector: { mobject: fig, camera, duration: 4 } });

// Motion path: a joint's trail, coloured slow->fast, keyframes marked.
const trail = attachMotionPath(player.canvas, camera, {
  source: { skeleton: fig, joint: "handL" }, t0: 0, t1: 4, step: 1 / 30, track: fig.poseTrack!,
});
trail.refresh();  // call again after camera pan/zoom
```

The overlay canvas is `pointer-events: none`, so `attachInteractiveCamera` on
the player canvas keeps working. `handle.detach()` removes it.

## Pure helpers

| Helper | Purpose |
|---|---|
| `onionOffsets`, `onionFrames`, `onionTimes` | which ghosts, clamped to the clip, with per-side tint and linear opacity falloff |
| `sampleMotionPath(source, t0, t1, step)` | `{ samples: {t,x,y,speed}[], maxSpeed, length }`; `source` is `t => [x,y]`, `{ skeleton, joint, track? }` or `{ mobject }` (centre) |
| `sampleKeyframeMarkers(source, track)` | a marker at each `KeyframeTrack` keyframe |
| `speedColor`, `motionPathSegments` | slow->fast `#rrggbb` ramp; coloured world-space segments |
| `onionVectorGhosts(mobject, t, duration, opts)` | tinted, faded clones evaluated with `setTime` |

Sampling works on a `copy()` of the rig, so the live mobject is never moved.
For scenes that are not time-pure, use the raster mode; `sampleSceneAt` (a full
`construct()` replay, O(n) per sample) is deliberately not used automatically.

## Renderer support

| | Canvas-2D | WebGL / Three |
|---|---|---|
| Raster onion skin | yes (over any Player canvas) | yes: it composites recorded bitmaps on a separate 2D overlay |
| Vector onion skin | yes (`CanvasRenderer` on the overlay) | ghosts are drawn with Canvas-2D, not WebGL |
| Motion path | yes | yes (2D overlay; uses `camera.toPixel`) |

## Honest divergences

- `Player.seek()` has no event hook; call `handle.refresh()` after seeking.
- Raster tinting is a flat 50% colour wash over the frame's opaque pixels;
  frames have an opaque background, so a raster ghost is a tinted full frame.
  Use the vector mode for clean silhouettes.
- Speed is a finite difference over `step`; coarse steps under-report spikes.
- `speedColor` accepts `#rrggbb` only.
- Motion paths are 2D (x, y); the z coordinate is ignored.
