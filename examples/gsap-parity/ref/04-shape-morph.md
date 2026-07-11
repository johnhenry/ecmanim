# Pattern 04 — SVG shape morph (one path interpolates into another)

**GSAP feature:** the MorphSVG pattern — animate the `d` attribute of one
`<path>` so it smoothly interpolates into a second path's shape, even
when the two paths have different anchor-point counts. **Note:**
MorphSVGPlugin is a paid/Club GreenSock plugin; we are recreating the
*pattern* — one shape's outline continuously deforming into another's —
not the plugin's point-matching algorithm internals.

**Source:** GSAP MorphSVGPlugin docs —
https://gsap.com/docs/v3/Plugins/MorphSVGPlugin/

**Quote (GreenSock docs, illustrative code sample):**

```javascript
gsap.registerPlugin(MorphSVGPlugin);

gsap.to("#diamond", {
  duration: 1,
  morphSVG: "#lightning",
});
```

Per the docs, the plugin "morphs an SVG `<path>` by animating the data
inside the `d` attribute," automatically reconciling shapes that have a
mismatched number of points into a smooth, natural-looking transition.

**Effect being demonstrated:** a single filled shape (e.g. a diamond)
smoothly deforms — vertices sliding and the outline reflowing — into a
visually distinct second shape (e.g. a lightning bolt) over the tween's
duration, rather than cross-fading between two separate shapes. A
recreation should hold shape identity throughout the interpolation (one
continuously-deforming path) so the morph reads as *transformation*, not
dissolve.
