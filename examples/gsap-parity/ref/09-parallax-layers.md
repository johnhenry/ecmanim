# Pattern 09 — Parallax layers (differential scroll speed)

**GSAP feature:** `ScrollSmoother`'s `data-speed` attribute, which is
GSAP's built-in parallax primitive — elements tagged with different
`data-speed` values move at different rates relative to native scroll
distance as the page scrolls, without any hand-written scroll-position
math.

**Source:** GSAP ScrollSmoother docs —
https://gsap.com/docs/v3/Plugins/ScrollSmoother/

**Quote (GreenSock docs, illustrative code sample):**

```html
<div id="smooth-wrapper">
  <div id="smooth-content">
    <div data-speed="0.5">Background Layer</div>
    <div data-speed="1">Normal Speed Layer</div>
    <div data-speed="1.5">Fast Moving Layer</div>
  </div>
</div>
```

Per the docs, elements move at different velocities relative to scroll
speed based on their `data-speed`: values below 1 lag behind scroll
(reading as a distant background), values above 1 move faster than
native scroll (reading as foreground); "elements will hit their natural
position in the **CENTER** of the viewport."

**Effect being demonstrated:** several layers stacked in the same
frame (e.g. a far background, a mid-ground, and a foreground subject)
scroll at visibly different speeds relative to one another, producing an
illusion of depth — the background layer barely moves while the
foreground layer moves noticeably more per unit of scroll. A recreation
needs at least three layers with distinct speed multipliers, all driven
by one shared scroll-progress input, so the differential rates are
readable side-by-side.
