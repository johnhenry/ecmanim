# Pattern 08 — Pinned element + scroll progress

**GSAP feature:** `ScrollTrigger`'s `pin: true` option, which fixes
("pins") a triggering element in the viewport for the duration of its
scroll range while the rest of the page continues to scroll underneath
it, typically paired with an associated animation driven by the same
scroll range.

**Source:** GSAP ScrollTrigger docs (pinning) —
https://gsap.com/docs/v3/Plugins/ScrollTrigger/

**Quote (GreenSock docs, illustrative code sample):**

```javascript
let tl = gsap.timeline({
  scrollTrigger: {
    trigger: ".container",
    pin: true,
    start: "top top",
    end: "+=500",
  },
});
```

The pinned element stays fixed in the viewport while the associated
scroll range is active; once the range completes (scroll position passes
`end`), the element unpins and resumes normal document flow.

**Effect being demonstrated:** a section of the page holds still on
screen — visually "stuck" — while the user keeps scrolling and an
animation (progress bar, counter, illustration reveal, etc.) tied to
that same scroll distance plays out; once the scroll passes the pinned
range's end, the section releases and normal scrolling resumes. A
recreation should show the pinned subject staying visually static while
something *else* in the frame (a progress indicator, a growing shape) is
clearly driven by the same underlying scroll-progress value.
