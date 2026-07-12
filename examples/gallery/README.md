# Examples gallery

Static, browsable HTML for all 196 demos across the 24 top-level feature
demos and 11 parity-campaign galleries — thumbnails + inline video players,
generated from the same READMEs and directory listings a human would read.

```bash
npm install                          # first time on a fresh clone
npm run gallery:render-missing       # render whatever isn't already rendered (see below)
npx serve .                           # from the REPO ROOT (not examples/) -- see "Serving"
```

Then open `/examples/gallery/index.html`.

## Fresh clone: nothing is rendered yet

**Rendered videos/thumbnails are gitignored, not committed** — they're
regenerated locally, so a fresh `git clone` starts with every demo showing
"not yet rendered." That's expected, not a bug. Fix it with one command from
the repo root:

```bash
npm run gallery:render-missing                       # renders everything missing, then rebuilds the site
npm run gallery:render-missing -- --category d3-parity  # just one gallery
npm run gallery:render-missing -- --limit 5              # try a few first, e.g. to sanity-check your setup
```

It renders sequentially at low quality (fast-ish, still 196 demos worth of
work for a full run), keeps going past any single demo's failure, and skips
anything that already has a video — safe to re-run, safe to interrupt with
`^C` and resume later. If a demo fails, run `npx ecmanim checkhealth` first
to rule out a missing system dependency (ffmpeg, `@napi-rs/canvas`, fonts) —
see [docs/external-tools.md](../../docs/external-tools.md).

## How it works

- **`manifest.ts`** scans `examples/*.ts` and `examples/*-parity/`, parses
  each campaign README's `## Scorecard` table (and the top-level README's
  `## Examples` table) for per-demo descriptions, and checks each demo's
  `out/*.mp4` / `thumbs/*.jpg` for existing renders — no demo file is
  imported or executed. It also links each demo to the original example it
  recreates, but **only from a URL already committed in the repo** — never
  invented or guessed. d3-parity/echarts-parity/gsap-parity/p5-parity get a
  per-demo link (parsed from each campaign's `ref/README.md` provenance
  table, or for d3 constructed from its documented `@d3/<slug>` fetch
  template matched against an exact `ref/<slug>.js` filename — no link when
  the match isn't exact, rather than a guess). manim-parity/showcase-parity/
  motion-canvas-parity/lottie-parity/mermaid-parity get one campaign-wide
  link instead (their README only cites a single source site, not one per
  demo). threeb1b-parity and reveal-slidev-parity get no link at all — their
  READMEs cite originals as plain-text titles with no URL anywhere in the
  repo to link to.
- **`thumbs.ts`** extracts a JPEG thumbnail from each demo that already has a
  rendered `.mp4` (via `ffmpeg`/`ffprobe`, one frame ~40% through), into a
  sibling `thumbs/` dir next to that campaign's `out/`. It never renders a
  demo itself — a demo with no video yet is reported and skipped, not
  rendered on the spot. Re-run any time after rendering more demos; it's
  idempotent (skips thumbnails that already exist).
- **`build.ts`** reads the manifest and writes plain HTML (no client-side JS,
  no framework) — `index.html` plus one `<category>.html` per gallery.
  Demos with a video get an inline `<video controls poster="thumb.jpg">`;
  demos without one show a placeholder with the exact command to render them.
  The index page also shows a setup banner when anything is unrendered.
- **`render-missing.ts`** is the one-command fix for a fresh clone: renders
  every demo lacking a video (`npx tsx` each file, sequentially, continuing
  past failures), then runs `thumbs.ts` and `build.ts` for you. Supports
  `--category <key>` and `--limit <n>`.

## Serving

Serve the **repo root**, not `examples/` — the top-level `README.md` lives
one level above `examples/`, so it's unreachable if `examples/` is the served
root. Every generated page sets `<base href="/examples/gallery/">`, which
pins relative-link resolution to that fixed path regardless of what the
address bar shows — several static file servers (e.g. `serve`'s clean-URL
redirect, which rewrites `index.html` → `index` or drops it entirely) mangle
plain relative hrefs otherwise.

## Regenerating after new demos land

Re-run `npm run gallery:build` (fast, no rendering) any time a demo is added,
renamed, or its README description changes. Run `npm run gallery:thumbs`
after actually rendering new demos to pick up their thumbnails — it's a
no-op for anything already thumbnailed.
