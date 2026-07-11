# Pattern 10 — Elastic and back easing

**GSAP feature:** the built-in `"elastic"` and `"back"` eases used as a
tween's `ease`, each parameterized — `elastic.out(amplitude, period)` and
`back.out(overshoot)` — to control how springy/overshoot-y the motion
feels.

**Source:** GSAP Eases docs —
https://gsap.com/docs/v3/Eases/

**Quote (GreenSock docs, illustrative code sample):**

```javascript
// Elastic ease - spring-like, oscillating motion
gsap.to(target, {
  duration: 1,
  ease: "elastic.out(1, 0.3)",
  y: -500,
});

// Back ease - overshoots the target, then settles
gsap.to(target, {
  duration: 1,
  ease: "back.out(1.7)",
  x: 400,
});
```

Per the docs, "simply changing the ease can adjust the entire feel and
personality of your animation" — elastic produces a bouncy, oscillating
settle (like a weight on a stretched spring), while back overshoots past
the destination before smoothly returning to rest.

**Effect being demonstrated:** the same simple property tween (a move or
a scale) plays twice, once under each ease, so the two curves are
directly comparable — `elastic.out` visibly oscillates several times
around the final value before settling, while `back.out` overshoots once
past the target and eases back, distinct from a plain `power`/linear
ease that arrives monotonically.
