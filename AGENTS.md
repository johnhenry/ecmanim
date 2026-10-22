# Agent playbook

`@johnhenry/ecmanim` — a TypeScript port of manim rendering the same `Scene`
code in Node (via `@napi-rs/canvas` + ffmpeg) and the browser (Canvas-2D or
optional WebGL/Three.js). Single package, Node >= 25 (type-stripping runs
`.ts` sources directly in dev; `tsc` emits `dist/` + `.d.ts` for publishing
and browser bundlers via the `exports` map). Most changes touch either the
isomorphic core (`src/`, runs in both Node and browser) or one backend's
glue (`src/node.ts`, `src/browser.ts`, `src/browser-three.ts`) — know which
one you're in, since a fix that only makes sense for one backend (e.g. a
canvas/ffmpeg detail) does not belong in `src/`.

`CLAUDE.md` in this directory is a symlink to this file.

## The verification loop (before every push)

1. `npm run type-check` — `tsc --noEmit`.
2. `npm test` — `node --test 'test/**/*.test.ts'`, 1500+ tests. Includes
   `test/golden/` (6 synthetic golden-frame checks, tight tolerance) —
   these must show **0 skipped**, not just 0 failed.
3. `npm run test:golden-parity` — the looser, font-aware golden-frame suite
   over 33 real campaign demos (`test/golden/parity/`). Regenerate goldens
   only after a deliberate visual change; see
   `test/golden/parity/README.md`.
4. `npm run build` — `tsc` → `dist/` (JS + `.d.ts` + sourcemaps); read
   `npm pack --dry-run`'s file list after any `exports`/`files` change, not
   just the exit code.
5. A genuinely fresh clone before a release:
   `git clone . /tmp/ecmanim-verifyN && cd $_ && npm ci && npm run build && npm test`.
   This is the only way to catch "works on my checked-out tree" bugs
   (missing files in `package.json`'s `files`, undeclared deps).
6. Commit, push, close the issue with a comment naming the commit SHA.

CI (`.github/workflows/ci.yml`) runs type-check, test, and build in this
order; match it locally. `npx -p . ecmanim checkhealth` is the fastest way
to confirm ffmpeg/ffprobe/canvas/fonts are actually on `PATH` before
debugging a Node-render failure that looks like a code bug but isn't.

## Repo-specific gotchas

- **A few classes of bug only show up under a real audit, not unit tests.**
  A bug-hunt pass (#51) found `Code.diffTo()` leaving permanently
  overlapping/ghosted text, an orphaned `ffmpeg` process on early
  cancellation, a dev-server path-traversal hole, `NaN` propagating silently
  through the physics integrator, a WebGL backend that silently dropped an
  unsupported effect instead of warning, and a plugin `use()` call that
  wasn't isolated from a previous plugin's registry mutations. None of these
  were caught by the existing 1500+ tests — treat "renders without throwing"
  as necessary, not sufficient, for anything touching process lifecycle,
  filesystem paths, or numeric integration.
- **Golden-frame tests are the regression guard for "still runs but looks
  wrong."** Functional tests (`npm test`) can't catch a visually broken
  scene that doesn't throw. Two tiers exist for a reason: `test/golden/`
  (tight tolerance, synthetic scenes, fast) and
  `test/golden/parity/` (loose, font-aware, 33 real campaign demos, slower)
  — don't loosen the tight tier's tolerance to make the loose tier's demos
  pass; that defeats the tight tier's purpose.
- **`packages/manim-wasm/manim_core.wasm` is a compiled, committed
  artifact**, not built by `npm run build`. If you touch `packages/manim-wasm/lib.rs`,
  rebuild it via `build.sh` and commit the new `.wasm` alongside the Rust
  source — `loadWasm()` falls back to pure JS silently if it's stale or
  missing, so a stale WASM binary won't fail loudly, it'll just quietly not
  reflect your Rust change.
- **Parity-campaign directories (`examples/<target>-parity/`) are the
  receipts for specific parity claims**, each with its own scorecard README
  and a licensed reference corpus (`ref/`). Don't edit a campaign's demos
  without updating its scorecard — the numbers in the root README's
  campaign table (`k/n demos`) are read from those scorecards, not derived
  automatically.
- **Renamed to `@johnhenry/ecmanim` at `0.0.0`** (#43). The last unscoped
  release is `ecmanim@0.11.1`, which is deprecated on npm. There are three
  eras with overlapping version numbers (`manim-js` 1.x–2.0, unscoped
  `ecmanim` 0.0.1–0.11.1, scoped 0.0.0→), described in the era table at the
  top of `CHANGELOG.md`. Don't reintroduce the old unscoped install command in
  docs/examples, and don't create `v`-prefixed tags (see "Releases").

## API compatibility rules (standing)

The public surface is machine-checked; these rules apply to every PR (they
were set by epic #61).

1. **Additive only.** Never remove, rename, or change the signature/runtime
   default of an existing export. New behaviour lives behind new exports, new
   *optional* fields, or new format strings, whose defaults equal today's
   behaviour.
2. **Byte-identical defaults, proven by test.** When extending an existing
   class/option, add a test showing the old path is untouched (same output for
   the same input/seed). Never regenerate an existing golden image to make a
   change pass -- that is a red flag.
3. **No type narrowing of existing fields.** Don't turn `format?: string` into
   a strict union; widen with `"gif" | "apng" | (string & {})`.
4. **Guardrails you will hit:**
   - `test/api-surface.test.ts` compares the runtime `name: typeof` surface of
     every `package.json` `exports` subpath with
     `test/api-surface.snapshot.json`. Removals/kind changes fail (breaking);
     additions fail until you regenerate on purpose:
     `UPDATE_API=1 node --test test/api-surface.test.ts`, then confirm
     `git diff test/api-surface.snapshot.json` is additions only. A new
     subpath must be added to `exports` *and* the snapshot. Subpaths needing
     an uninstalled optional dependency are reported as SKIPPED (never
     silently passed).
   - `test/types/api.test-d.ts` (run by `npm run type-check`) pins the current
     keys/types of `RenderOptions`, `RecordVideoOptions`, `BrowserOptions`,
     `Keyframe`, `KeyframeTrackOptions`, `ParticleSystemConfig`, and `Camera`.
     Adding an optional field is free; to pin it, *add* a line to the pin.
     Never edit or delete an existing pin line.
   - `test/exports-map.test.ts` (after `npm run build`) checks every
     `exports`/`main`/`types`/`bin` target exists in `dist/` and in the npm
     tarball. It skips with a message if `dist/` isn't built.
5. **Deprecating instead of removing.** Keep the old export working for at
   least one minor release: add a JSDoc `@deprecated Use {@link newName}.`
   tag, call `deprecate("<stable-id>", "Use newName() instead.")` from
   `src/core/deprecate.ts` (exported from the root barrel; warns once per id),
   and list it under **Deprecated** in `CHANGELOG.md`. Only remove it in a
   later release, under **Removed**.
6. **CHANGELOG headings.** Under `## Unreleased` use only these `###`
   headings, in this order: **Added**, **Changed** (mark API-visible breaks
   `Changed (breaking)`), **Deprecated**, **Removed**, **Fixed**. While 0.x,
   ship features as minor bumps containing only **Added**.

## Definition of done

A change is done when all of the following hold, not just when tests pass:
- A regression test exists for any bug fixed — fixing a bug without a test
  that would have caught it means it can come back unnoticed. For anything
  visual, that may mean a new golden-frame fixture, not just a functional
  assertion.
- Anything the feature does **not** do is stated in the README's "Honest
  divergences" section (API parity table) or the relevant `docs/*.md`, not
  only in an issue comment.
- `CHANGELOG.md` has an entry.
- If the change affects a parity campaign's coverage, that campaign's own
  scorecard README is updated to match.

## Non-goals

The parity-campaign galleries (`examples/*-parity/`) are recreations of
other tools' own example suites, not authoring guidance — the
[`skills/`](skills/) Claude Code skill package is the authoring-guidance
surface. Don't fold campaign-specific scoring narrative into the general
skills.

## Releases

**Main is the release branch.** To release, bump `version` in
`package.json` (`npm version X.Y.Z --no-git-tag-version`, which also updates
`package-lock.json`) and turn the `## Unreleased` CHANGELOG entries into a
`## X.Y.Z — YYYY-MM-DD` section, all in one PR. Merging it to `main` makes
`.github/workflows/publish.yml` publish to npm, which is a no-op if the
version is already there. It then creates the tag and GitHub Release. Don't
run `gh release create` by hand.

**Tags are scoped: `@johnhenry/ecmanim@X.Y.Z`, never `vX.Y.Z`.** The `v`
tags `v0.1.0`–`v0.11.1` belong to the old unscoped `ecmanim` package, and
`v1.0.0`/`v1.1.0` to `manim-js`. `publish.yml` passes
`tag-prefix: "@johnhenry/ecmanim@"` to the shared workflow, so the tag and
Release are created automatically. See the era table at the top of
`CHANGELOG.md`.
