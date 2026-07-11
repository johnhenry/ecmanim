# Pattern 01 — Timeline labels + position parameters

**GSAP feature:** `gsap.timeline()` sequencing via labels (`tl.addLabel()`)
and the "position parameter" — the third argument to `.to()`/`.from()`
calls that places a tween absolutely, relative to a label, or relative to
the previous tween (`"<"`, `">"`, `"-=0.5"`, `"+=1"`, `"label+=2"`).

**Source:** GSAP Timeline / position-parameter docs —
https://gsap.com/resources/position-parameter/
(cross-checked against https://gsap.com/docs/v3/GSAP/Timeline/)

**Quote (GreenSock docs, illustrative code sample):**

```javascript
const tl = gsap.timeline();

tl.to(element, { duration: 1, x: 200 })        // sequenced (default)
  .to(element, { duration: 1, y: 200 }, "<")   // starts with previous
  .to(element, { duration: 1, rotation: 360 }, ">")   // starts at previous's end
  .to(element, { duration: 1, scale: 4 }, "-=0.5")    // overlaps by 0.5s
  .to(element, { duration: 1, opacity: 0 }, "+=1")    // 1s gap after previous
  .addLabel("scene1", 2)
  .to(element, { duration: 1, skewY: 10 }, "scene1+=3"); // 3s after the label
```

Per the docs: the position parameter "controls the placement of your
tweens, labels, callbacks, pauses, and even nested timelines. In other
words, it tells the timeline exactly where to insert the animation."

**Effect being demonstrated:** a single timeline drives several tweens
whose start times are expressed *relative to each other* rather than as
hard-coded absolute offsets — some run back-to-back, some overlap
(cross-fades), some leave a deliberate gap, and one is anchored to a named
label placed earlier in the sequence. A recreation should show at least
one of each relationship (`<`, `>`, `-=`, `+=`, and a label reference) so
the timing graph is legible on playback, not just a flat sequential list.
