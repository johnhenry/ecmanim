# Pattern 11 — Infinite repeat + yoyo (ping-pong)

**GSAP feature:** the tween special properties `repeat: -1` (repeat
indefinitely) combined with `yoyo: true` (reverse direction on alternate
repeats instead of restarting from the beginning each time).

**Source:** GSAP Tween special-properties docs —
https://gsap.com/docs/v3/GSAP/Tween/

**Quote (GreenSock docs, illustrative code sample):**

```javascript
gsap.to(".box", {
  x: 100,
  duration: 1,
  repeat: -1,
  yoyo: true,
});
```

`repeat: -1` makes the tween loop forever; `yoyo: true` makes alternate
iterations play in reverse rather than snapping back to the start, so
the animation smoothly ping-pongs between its start and end values
instead of sawtoothing.

**Effect being demonstrated:** an object moves continuously back and
forth between two states (e.g. left/right position, or two colors) with
no visible reset/jump cut at the loop boundary — each leg of the motion
uses the same eased curve, so reversing direction still looks smooth
rather than instantaneous. A recreation should run long enough (several
full back-and-forth cycles) to make clear it never terminates and never
snaps.
