# 3Blue1Brown canon suite

Ten iconic 3Blue1Brown visuals recreated on ecmanim's public API —
**recreations of the visuals, not code ports** (3b1b/videos is ManimGL and
the artistry is Grant Sanderson's; each scene header and
[CANON.md](./CANON.md) cite the source video). No pi-creature art or brand
assets — math visuals only, on the characteristic near-black blue.

```bash
ECMANIM_DEMO_QUALITY=low npx tsx examples/threeb1b-parity/01-fourier-epicycles.ts
for f in examples/threeb1b-parity/[0-9]*.ts; do npx tsx "$f"; done
```

## Scorecard

| # | Scene | Source video | Proves |
|---|-------|--------------|--------|
| 01 | fourier-epicycles | "But what is a Fourier series?" (2019) | **FourierPath**/dftOfPath: π traced by 1 → 2 → 10 → 100 rotating vectors, dissipating → persistent TracedPath |
| 02 | linear-transformation | Essence of linear algebra ch. 3 (2016) | LinearTransformationScene grid morph, riding unit square, live determinant |
| 03 | eigenvectors | Essence ch. 14 | **eigen2x2**: eigenlines hold their spans through A and A² while generic lines swing |
| 04 | sum-of-odds | visual-proof genre | L-shell buildup of n², TransformMatchingTex running equation |
| 05 | prime-spiral | "Why do prime numbers make these spirals?" (2019) | **sieve** + polar scatter + two camera zoom-outs to the arm galaxy |
| 06 | hilbert-curve | "Hilbert's curve" (2017) | **hilbertCurve** orders 1–6, rainbow arc-length gradient, smooth locality-preserving morphs |
| 07 | pendulum-phase | Differential equations ch. 1 (2019) | ArrowVectorField + RK4 StreamLines, hero trajectory with synced pendulum inset |
| 08 | taylor-series | "Taylor series" (2017) | P₁…P₁₃ morphing onto sin(x), formula growing term by term |
| 09 | sphere-unwrap | "But why is a sphere's surface area 4πr²?" (2018) | **Surface.setFunc** ring peel → flatten → stack vs 4 unit circles, CPU z-buffer 3D + camera moves |
| 10 | neural-network | "But what IS a neural network?" (2017) | **NeuralNetworkMobject**: layered draw-in, forward-pass pulse wave, argmax highlight |

## Bugs the receipts workflow caught (fixed + regression-tested)

- **Transform truncated VGroup children**: family point counts were never
  aligned, so mismatched children kept only the leading fraction of their
  target (curves dissolved into dashes).
- **3D scenes silently rendered with no projection**: `render()` bound the
  renderer to the camera built before `makeScene`, so ThreeDScene's
  ThreeDCamera upgrade never reached it (unless the caller passed a camera
  explicitly).
- **parseTexGroups broke on nested braces**: `{{\frac{x^3}{3!}}}` lost its
  closing brace to the non-greedy regex and corrupted the tex.
- **forwardPass blanked the network**: pulsing the live edges pinned their
  stroke windows and the flash removers dropped them; pulses now ride
  bright throwaway copies.
- Gotchas documented in-scene: `addTransformableMobject` registers but
  does not add; MathTex sizes in world units (use `.scale()`, not a
  fontSize config); `strokeColor` assignment needs `Color.parse`.

## Honest divergences

These are recreations: layouts, pacing, and palettes approximate the
videos from memory of the visual, not from Grant's code. The prime-spiral
intermediate zoom reads as scatter at our dot count (arms fully resolve at
the final zoom); the sphere unwrap uses 12 rings at modest resolution for
CPU render time; MathTex normalizes expression size, so growing formulas
are rescaled to keep the head constant.
