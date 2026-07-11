# Pattern 06 — FLIP layout transition

**GSAP feature:** the `Flip` plugin's First-Last-Invert-Play technique —
`Flip.getState()` captures an element's current position/size (the
"First" state), the layout is then changed some other way (DOM
reorder, class toggle, CSS change), and `Flip.from(state, {...})`
animates from the captured state to the new ("Last") state.

**Source:** GSAP Flip plugin docs —
https://gsap.com/docs/v3/Plugins/Flip/

**Quote (GreenSock docs, illustrative code sample):**

```javascript
// 1. Capture initial state
const state = Flip.getState(".box");

// 2. Make the DOM/styling change that produces the new layout
element.classList.toggle("full-screen");

// 3. Animate from the captured state to the new one
Flip.from(state, {
  duration: 1,
  ease: "power1.inOut",
});
```

Per the docs, Flip "records the current position/size/rotation of your
elements, you make whatever changes you want, and then Flip applies
offsets to make them **look** like they never moved... Lastly Flip
animates the **removal** of those offsets."

**Effect being demonstrated:** an element that jumps to a structurally
different layout position (e.g. a card moving from a grid into a
full-screen/detail slot) instead glides smoothly from its old
bounding box to its new one — the viewer never sees the instantaneous
layout jump, only a continuous move/resize. A recreation needs two
distinct layout states for the same object plus an interpolated
in-between motion (position and scale both animating), not a cut.
