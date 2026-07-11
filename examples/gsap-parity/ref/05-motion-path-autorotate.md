# Pattern 05 — Motion path with autoRotate

**GSAP feature:** `MotionPathPlugin`'s `motionPath` special property,
which moves a target along an SVG/bezier path; `autoRotate: true`
additionally rotates the target to match the path's tangent angle at
each point along the way.

**Source:** GSAP MotionPathPlugin docs —
https://gsap.com/docs/v3/Plugins/MotionPathPlugin/

**Quote (GreenSock docs, illustrative code sample):**

```javascript
gsap.to("#div", {
  motionPath: {
    path: "#path",
    align: "#path",
    alignOrigin: [0.5, 0.5],
    autoRotate: true,
  },
  transformOrigin: "50% 50%",
  duration: 5,
  ease: "power1.inOut",
});
```

Per the docs, `autoRotate: true` "matches the angle of the path exactly,"
so the element's rotation tracks its direction of travel as it moves
along the curve (a numeric value instead offsets the rotation by that
many degrees).

**Effect being demonstrated:** an object travels along a curved path
(not a straight line) and visibly reorients itself to face "forward"
along the curve's tangent as it goes — most legible on a path with at
least one sharp curve or loop, where a non-rotating object would look
wrong (e.g. an arrow pointing sideways through a turn) but the
auto-rotated object clearly banks/turns with the path.
