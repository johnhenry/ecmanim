# Parity-campaign golden frames

One PNG per demo in [`../../golden-parity-demos.ts`](../../golden-parity-demos.ts)
(the same 33 demos `.github/workflows/ci.yml`'s `demo-smoke` matrix already
renders — 3 per campaign). Each is a single frame (50% through the demo's
duration) extracted from that demo's real rendered `.mp4`, checked by
[`../../golden-parity.test.ts`](../../golden-parity.test.ts) via
[`../../_parity_snapshot_util.ts`](../../_parity_snapshot_util.ts).

## Why this exists

`../` (the original `test/golden/`) only covers 6 synthetic, vector-only
scenes — deliberately no text, so they're stable across machines/font stacks.
That leaves the actual campaign demos (charts, diagrams, captions — heavy
text users) with no regression protection beyond "did it crash." This adds
that, at a looser tolerance (±20/channel, 3% of pixels — vs. the core
goldens' ±8/channel, 0.5%) to absorb font hinting/anti-aliasing differences
across environments without absorbing real regressions (wrong colors, missing
content, blank/collapsed layouts).

## Regenerating

```bash
npm run gallery:render-missing -- --category d3-parity   # or whichever suite changed
UPDATE_SNAPSHOTS=1 npm run test:golden-parity              # writes/overwrites goldens for whatever's rendered
```

Only regenerate what actually changed intentionally — review the diff (or the
`.actual.png` written next to a failing golden) before overwriting, same as
`../../_snapshot_util.ts`'s convention.

## If CI drifts from a locally-baselined golden

These goldens were first generated on a NixOS dev machine, not CI's
`ubuntu-latest` + `fonts-dejavu-core`. `demo-smoke`'s golden-frame step ran
`continue-on-error: true` for its first two runs to confirm that wasn't going
to cause false failures — both passed clean (the first run's one failure
turned out to be 2 lottie-parity goldens baselined from stale medium-quality
mp4s, a real bug, not font/AA drift — see commit `09d5346`), so it's now a
hard gate. If it ever does fail from a genuine font/AA difference rather than
a real regression:

1. Download that job's `golden-parity-actuals-<suite>` artifact (the
   `.actual.png` files it captured from CI's own render).
2. Replace the corresponding golden(s) in this directory with them.
3. Commit.
