# Pattern 07 — Scroll-scrubbed timeline

**GSAP feature:** `ScrollTrigger`'s `scrub` option, which links a
timeline's (or tween's) playhead progress directly to scroll position
instead of to wall-clock time — the animation plays "scrubbed" forward
and backward as the user scrolls up/down.

**Source:** GSAP ScrollTrigger docs —
https://gsap.com/docs/v3/Plugins/ScrollTrigger/

**Quote (GreenSock docs, illustrative code sample):**

```javascript
let tl = gsap.timeline({
  scrollTrigger: {
    trigger: ".container",
    start: "top top",
    end: "+=800",
    scrub: 1, // smooth 1-second catch-up
  },
});

tl.to(".box", { x: 500, duration: 2 })
  .to(".box", { rotation: 360, duration: 2 }, 0);
```

Per the docs, `scrub` "links the progress of the animation directly to
the scrollbar so it acts like a scrubber"; passing a number (instead of
`true`) is "the amount of time (in seconds) that it takes for the
playhead to catch up" — a smoothing lag rather than 1:1 instant binding.

**Effect being demonstrated:** the timeline has no independent
timeline of its own — its playhead position is a pure function of scroll
offset within a defined start/end range, so scrolling down plays it
forward, scrolling up plays it backward, and stopping mid-scroll freezes
it mid-animation. A recreation should map a scene's playhead to a scroll
(or scroll-equivalent) input and demonstrate both directions, not just a
one-way forward play.
