---
title: "Bug: <one-line symptom, in backticks where it's a literal error/API name>"
labels: []
severity: "" # blocking (no workaround found) | major (workaround exists, but affects a documented happy path) | minor (narrow/cosmetic)
version: "" # `npx ecmanim checkhealth` or `require("ecmanim/package.json").version`
regression: "" # "yes, worked in <version>" | "no, first time this path was exercised" | "unknown"
---

<!--
This is a drafting template, not a GitHub Issue Form (this repo has none —
see .github/). Fill it in locally, then `gh issue create` the body once it's
complete. Modeled on this repo's own best real bug reports (issues #1-#3,
all filed by the maintainer against exactly the failure modes this skill
documents) — the difference between a report that gets fixed quickly and one
that doesn't is almost always whether "Root cause" is backed by a minimal
reproduction, not just a description of the symptom.

Use this ONLY for something confirmed to live in ecmanim's own source
(src/, dist/, bin/) via a minimal reproduction — not for a mistake in your
own scene script (wrong position, wrong shift value, a misused option).
That distinction matters: half of what looks like a library bug during
scene authoring turns out to be a layout assumption that was wrong, not the
library — rule that out first (see "Verify by measurement" and "Iterate on
one thing at a time" in SKILL.md) before writing this up as one.
-->

## Summary

<!-- One sentence: what's broken and the user-visible symptom. -->

## Environment
- ecmanim version:
- Node version:
- OS:

## Repro (minimal)

<!-- Strip the scene down to the smallest snippet that still shows the bug —
     see "Iterate on one thing at a time" below. A report built around a
     50-line scene is much harder to act on than one built around 5 lines
     that isolate exactly the failing call. -->

`<path>`:
```ts
// minimal reproduction here
```

Run:
```
<exact command>
```

Result:
```
<exact output — full stack trace if there is one, not a paraphrase>
```

## Expected

<!-- What should have happened instead. -->

## Root cause

<!-- Only fill this in once you've actually traced it in the source — don't
     guess. State clearly whether this is CONFIRMED (you stepped through it /
     added a probe and observed the exact mechanism) or INFERRED (plausible
     from reading the code, not directly observed) — that distinction is
     what makes a report actionable instead of just a symptom description. -->

## Confirmed fix / workaround

<!-- Something you've actually verified works, right now, without waiting
     for a real fix — even if it's not the ideal API. -->

## Suggested real fix

<!-- Optional: where you'd point a maintainer, if you have a specific idea.
     Keep this clearly labeled as a suggestion, not a directive -- the
     maintainer may have context (API constraints, a different fix already
     in flight) that changes the right approach. -->
