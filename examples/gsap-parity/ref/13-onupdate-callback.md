# Pattern 13 — onUpdate callback driving custom logic

**GSAP feature:** the `onUpdate` tween callback, which fires on every
tick of the tween (not just at start/complete) so arbitrary custom code
can run in sync with the animation's progress — e.g. reading
`this.progress()` to update a readout, redraw a canvas, or sync a second
unrelated visual to the tween's current value.

**Source:** GSAP Tween docs (callbacks) —
https://gsap.com/docs/v3/GSAP/Tween/

**Quote (GreenSock docs, illustrative code sample):**

```javascript
gsap.to(".box", {
  x: 200,
  duration: 2,
  onUpdate: function () {
    console.log("Progress:", this.progress());
  },
});
```

`onUpdate` runs once per rendered frame of the tween's lifetime, giving
the callback access to the tween instance itself (`this`) so it can
query live values like `progress()`, `time()`, or the animated
property's current value.

**Effect being demonstrated:** while a tween plays visually (e.g. a bar
filling or an object moving), a separate piece of UI or drawing —
a numeric readout, a canvas redraw, a second element's property not
itself tweened — updates in lockstep every frame, driven by reading the
tween's live progress rather than by its own independent animation. A
recreation should pair one GSAP-driven tween with one clearly
callback-driven side effect so the "driving vs. driven" relationship is
visible.
