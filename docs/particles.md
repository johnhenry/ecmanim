# Particles and particle presets

`ParticleSystem` (`src/mobject/particles.ts`) is a closed-form particle
emitter: every particle is a pure function of `(seed, index, time)`, so
scrubbing, backward seeks, `node-parallel` segments and the content-hash render
cache all work with no simulation state.

## ParticleSystem options added with the presets

All optional; unset = identical output to earlier releases.

| Option | Meaning |
|--------|---------|
| `turbulence: { amplitude, frequency, seed?, octaves? }` | Noise displacement added to the ballistic path. A closed-form function of (spawn position, age) built on `simplex3D` (`fbm3` when `octaves > 1`), measured relative to birth so particles start at their spawn point. Consumes no RNG draws. Peak displacement is up to about `2 * amplitude` per axis; the bounding box accounts for it. |
| `blendMode: "normal" \| "add" \| "screen"` | Sets the mobject's `compositeOperation` (`"lighter"` / `"screen"`). `"normal"`/unset leaves it untouched. |
| `material: "circle" \| "square" \| "soft" \| "star"` | Sprite per particle. `shape` (`"circle" \| "square"`) remains as an alias; `material` wins when both are set. `soft` is a radial-falloff blob (sprite canvases are cached per color when an offscreen backend exists, otherwise the same gradient is drawn directly). |

### `maxParticles` and `maxParticlesMode`

| Mode | Meaning |
|------|---------|
| `"total"` (default) | `maxParticles` caps total births: the continuous stream stops after that many (20/s at the default 2000 stops at about 100 s). |
| `"alive"` | Unlimited births; at most `maxParticles` particles alive at once, keeping the most recent. Deterministic and seek-safe. Identical to `"total"` while below the cap. |

Sampling cost is O(particles that can be alive at `t`) (`rate x max lifetime`),
not O(total births), in both modes.

**Compatibility contract:** the per-particle RNG draw order
(`lifetime, speed, angle, spawnA, spawnB`) must never change. New options add
no draws; `test/particles-defaults.test.ts` compares fixed-seed output with a
fixture captured before these options existed.

## Presets

```ts
import { Aura, Explosion, Smoke, Beam } from "@johnhenry/ecmanim";

const aura = new Aura({ style: "arcane", radius: 1.2 });
const boom = new Explosion({ style: "fire", startTime: 0.5, size: 1.2 });
const smoke = new Smoke({ style: "billow", center: [0, -3, 0] });
const beam = new Beam({ style: "plasma", from: [-4, 0, 0], to: [4, 1, 0] });
```

Each preset is a `Group` of `ParticleSystem` layers sharing one clock.
Common options: `style`, `seed`, `intensity` (emission multiplier),
`autoAdvance` (default `true`: an updater advances the clock with scene time).
For explicit control pass `autoAdvance: false` and call
`preset.setTime(scene.time - t0)`; `setTime` is closed-form and may jump in
either direction.

| Preset | Styles | Notes |
|--------|--------|-------|
| `Aura` | `flame`, `frost`, `arcane`, `radiant` | `center`, `radius`. Soft additive halo, rising wisps, bright motes. |
| `Explosion` | `fire`, `plasma`, `confetti` | `center`, `size`, `startTime`. One-shot flash, fireball, sparks, smoke. |
| `Smoke` | `wisp`, `billow`, `steam` | `center`, `width`. Continuous rising column. |
| `Beam` | `laser`, `plasma`, `holy` | `from`, `to` (required), `width`. Core glow, travelling streaks, side sparks. |

Continuous preset layers use `maxParticlesMode: "alive"` (4000 alive per
layer), so presets run indefinitely; there is no total-births limit.

## Renderer support

| Feature | Canvas-2D | SVG | WebGL (Three.js) |
|---------|:---------:|:---:|:----------------:|
| ParticleSystem / presets | yes | no (warns once) | no (warns once) |
| `turbulence` | yes | no | no |
| `blendMode` | yes | no | no |
| `material` soft / star | yes | no | no |

SVG and WebGL warn once per particle mobject; presets warn once per preset,
not per child layer.

## Honest divergences

- Presets are original looks authored for ecmanim, not pixel matches to any
  other tool's effects. Clean-room: implemented from public prose docs and our
  own design, StykAnimate source not consulted.
- `soft` sprites drawn via the cached-canvas path and the direct-gradient
  fallback are visually equivalent but not byte-identical to each other.
- Turbulence is a displacement field, not a fluid simulation: particles do not
  interact and the field does not advect.
- Blend modes need Canvas-2D compositing; they cannot be emulated in SVG or the
  current WebGL tier.
