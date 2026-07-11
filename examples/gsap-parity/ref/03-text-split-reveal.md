# Pattern 03 — Text split into chars/words/lines + staggered reveal

**GSAP feature:** the SplitText pattern — break a text node into
individually-positioned DOM elements per character, word, and/or line,
then animate the resulting array with a stagger. **Note:** SplitText is a
paid/Club GreenSock plugin (folded into core in newer GSAP versions); we
are recreating the *pattern* — split-then-stagger-animate positioned
glyph/word/line boxes — not the plugin's internal text-measurement code.

**Source:** GSAP SplitText docs —
https://gsap.com/docs/v3/Plugins/SplitText/

**Quote (GreenSock docs, illustrative code sample):**

```javascript
let split = SplitText.create(".headline", {
  type: "words, chars",
});

gsap.from(split.chars, {
  duration: 1,
  y: 100,
  autoAlpha: 0,
  stagger: 0.05,
});
```

Per the docs, SplitText "splits an HTML element's text into individual
characters, words, and/or lines (each in its own, newly-created element)"
so they can be targeted and animated independently.

**Effect being demonstrated:** a line of text is decomposed into one
element per character (or word), each starting invisible and offset
below its final baseline position; a stagger reveals them in sequence
left-to-right so the line appears to "type on" or "rise into place"
character by character rather than fading/appearing as one block. A
recreation needs per-glyph positioned text elements (measured, not just
split as strings) so the stagger timing is visible against a fixed
baseline.
