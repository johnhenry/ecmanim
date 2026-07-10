# 3Blue1Brown canon — visual recreation spec

Ten iconic 3Blue1Brown VISUALS recreated on ecmanim's public API. These
are **recreations of the visuals, not code ports** — 3b1b/videos is
ManimGL and the artistry is Grant Sanderson's; each scene below cites the
video whose visual it recreates. No pi-creature art, logos, or brand
assets are reproduced — math visuals only, on 3b1b's characteristic
near-black blue (#171d23-ish) background.

Each spec lists the on-screen elements and the motion beats a faithful
recreation must hit.

## 01 — Fourier epicycles ("But what is a Fourier series?", 2019)
A closed drawing (we use a treble clef / simple glyph from an SVG path)
is traced by a chain of rotating vectors: each vector's length/phase from
the complex DFT of N samples of the path, sorted by amplitude; the chain
tip leaves a glowing trail that persists while old segments fade. Beats:
show 1 vector (circle), then 2, then 10, then 100; each stage traces for
a full period; the drawing emerges from noise.

## 02 — Linear transformation ("Essence of linear algebra" ch. 3)
Full-plane grid (with a dimmer background copy that stays fixed) morphs
under a 2×2 matrix while i-hat (green) and j-hat (red) basis vectors move
to their images; a unit square rides the transform and its area becomes
the determinant readout. Beats: identity → shear → rotation-ish
composite; determinant value updates live; matrix entries shown top-left.

## 03 — Eigenvectors ("Essence" ch. 14)
Same grid-morph machinery; several colored direction lines through the
origin; apply A repeatedly — generic lines swing around, the two
eigen-directions stay on their own spans (glow/pulse when the transform
lands). Show λ scaling along each eigenline.

## 04 — Sum of odd numbers = n² (visual proof genre)
Unit squares accumulate as L-shaped shells: 1, then 3 around it, then 5,
… each shell a new color; after shell k the assembly is a k×k square;
running MathTex `1 + 3 + ... + (2n-1) = n²` updates. Beats: shells slide
in piece by piece, then the square outline pulses.

## 05 — Prime spiral ("Why do prime numbers make these spirals?", 2019)
Polar scatter of (n, n) for n up to ~10k: first the Archimedean-ish
spiral of ALL integers, then filter to primes; zoom out reveals the
spiral arms (residue classes mod 6/44/710). Beats: dots appear in waves,
camera zooms out twice, non-primes fade leaving the prime galaxy.

## 06 — Hilbert curve ("Hilbert's curve", 2017)
Space-filling curve refinement: order-1 U shape morphs into order 2, 3,
… 6, each morph a smooth point-interpolation (pointwiseBecomePartial /
Transform with matched sampling); rainbow gradient along arc length to
show locality. Beats: hold each order briefly; final order fills the
square visibly.

## 07 — Pendulum phase space ("Differential equations", 2019)
The (θ, ω) phase plane for θ'' = -(g/L)sin θ - μθ': background vector
field arrows colored by magnitude, then integrated trajectories
(streamlines) spiral into the attractors at θ = 2πk; one highlighted
trajectory animates with a dot + traced path while a small pendulum
drawing in the corner swings in sync. Beats: field fades in, streamlines
flow, the synced pendulum inset sells the correspondence.

## 08 — Taylor series ("Taylor series", 2017)
Axes with sin(x); successive Taylor polynomials P₁, P₃, P₅, … P₁₃ plotted
in a color ramp, each morphing from the previous and hugging sin(x)
further out; the series terms appear in MathTex as each degree lands.
Beats: each new term slides into the formula while the curve upgrades.

## 09 — Sphere unwrap ("But why is a sphere's surface area 4πr²?", 2018)
3D: a sphere's surface splits into thin horizontal rings; rings unroll
into flat strips that stack into a shape approaching a triangle whose
area is visibly 4πr² (against 4 unit circles). CPU z-buffer 3D + camera
orbit; the unroll is a parametric surface morph. Beats: orbit the sphere,
peel rings, flatten, stack, compare against the 4 circles.

## 10 — Neural network ("But what IS a neural network?", 2017)
Layered network 784-ish→16→16→10 drawn as columns of circles (input layer
abbreviated with dots), edges gray with weight-colored highlights;
forward pass: input column lights with an image's pixel values, activation
pulses travel edge bundles layer to layer, output neuron for the digit
lights up. Beats: network draws in layer by layer, pulse wave crosses,
argmax neuron glows.

---

**Rendering**: dark 3b1b-style background `#171d23`, manim color palette
(BLUE/GREEN/RED/YELLOW families already in ecmanim). Every scene ≤ ~25s,
receipts discipline as always. NO GPU: 09 uses the CPU z-buffer path.
