# Pattern 02 — Stagger distributions (grid / center / edges / random)

**GSAP feature:** the object form of the `stagger` special property on
`gsap.to()`, which offsets each target's start time according to a
distribution rather than plain array order — `each`, `from`
(`"start"`/`"center"`/`"end"`/`"edges"`/`"random"`/a numeric index),
`grid`, and `axis`.

**Source:** GSAP Staggers docs —
https://gsap.com/resources/getting-started/Staggers

**Quote (GreenSock docs, illustrative code sample):**

```javascript
gsap.to(".box", {
  y: 100,
  stagger: {
    each: 0.1,
    from: "center",
    grid: [3, 4],
    axis: "x",
    ease: "power2.inOut",
  },
});
```

Per the docs, `from` determines where the stagger originates: `"start"`
cascades forward from the first element, `"center"` starts nearest the
middle and expands outward in both directions, `"edges"` starts at the
perimeter and waves inward, `"end"` runs backward from the last element,
`"random"` distributes start times with no predictable order, and a
numeric index emanates from that specific element. `grid` treats a flat
array of elements as a 2D `[rows, cols]` layout so `from` can compute
proximity spatially (e.g. true visual "center", not array-middle).

**Effect being demonstrated:** a grid of many identical elements (e.g. a
tile/dot grid) animates the same property (scale, y, opacity) with
staggered start times whose *shape* is visibly a wave — a recreation
should render the same grid under at least two distributions (`"center"`
and `"edges"` or `"random"`) so the different propagation patterns read
clearly frame-by-frame, not just "staggered vs. not staggered."
