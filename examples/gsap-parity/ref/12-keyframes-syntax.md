# Pattern 12 — Keyframes syntax (single tween, multiple states)

**GSAP feature:** the `keyframes` special property, which lets one
`gsap.to()` call sequence several distinct states one after another
(each with its own duration/ease) instead of chaining multiple separate
`.to()` calls on a timeline.

**Source:** GSAP Tween docs (keyframes) —
https://gsap.com/docs/v3/GSAP/Tween/

**Quote (GreenSock docs, illustrative code sample):**

```javascript
gsap.to(".box", {
  keyframes: [
    { x: 100, duration: 1 },
    { y: 100, duration: 0.5 },
    { rotation: 360, duration: 1 },
  ],
});
```

Each keyframe object fully completes (runs its own duration/ease) before
the next one begins, so the single tween call produces a multi-stage
animation sequence on one target.

**Effect being demonstrated:** one object visibly passes through several
distinct, sequential motion stages — first moving horizontally, then
vertically, then rotating — driven by a single animation definition
rather than a hand-chained sequence of separate calls. A recreation
should make the stage boundaries legible (a clear change of *what*
property is animating at each step) so the keyframe structure reads as
one continuous multi-part motion.
