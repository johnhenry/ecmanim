---
name: ecmanim-render-cli
description: Covers the `ecmanim` command-line tool — the render/plan/cfg/init/plugins/checkhealth subcommands, render flags (-q quality presets, -f output formats, -o output path, -t transparent, -a write_all, -n from_upto, --save_sections), the manim.config file, the partial-movie-file cache (--disable_caching/--flush_cache), and the three renderer backends (default CPU Canvas-2D, browser-only Three.js/WebGL, headless-GPU renderGL, plus SVG output). Use this skill when invoking `ecmanim` from a shell, choosing a quality/output preset, debugging a caching or section-export issue, or deciding which renderer backend a task needs.
metadata:
  tags: ecmanim, cli, render, webgl, cache, sections
---

# ecmanim-render-cli

Domain skill for the `ecmanim` binary (`bin/ecmanim.ts`) and the renderer
backends it drives. Assumes the root `ecmanim` skill's Plan → Code → Render →
Verify → Iterate loop and checkhealth-first guidance — see that skill for the
authoring workflow; this one is about CLI mechanics and backend selection.
Ground every flag claim in [../../docs/cli.md](../../docs/cli.md) and every
renderer claim in [../../docs/renderers.md](../../docs/renderers.md) rather
than recalling them — both are short enough to re-read before asserting a
flag's default or a backend's capability.

## All subcommands

`docs/cli.md`'s intro usage block and the CLI's own `--help` text are both
stale — neither lists `plan`. The real dispatch (`bin/ecmanim.ts`, `switch
(cmd)`) has six:

```
ecmanim render <file> [scene] [options]   # render to video/PNG (see below)
ecmanim plan <file> [scene] [options]     # dry-run: scene structure as JSON, no rendering
ecmanim cfg [--config <file>] [--write]   # print/save resolved config
ecmanim init [file] [--force]             # scaffold a starter scene file
ecmanim plugins                           # list registered mobjects/animations/scenes/etc.
ecmanim checkhealth                       # environment check, exit 0/1
```

- **`plan`** — `ecmanim plan file.ts [Scene] [--scene name] [--fps n] [--output file]`.
  Calls `toPlanIR()` from `ecmanim/authoring` and prints (or writes) the
  resulting Plan IR as JSON — it harvests scene structure without buffering
  frames or invoking ffmpeg. This is the CLI entry point for the
  `ecmanim-authoring-pipeline` skill's dry-run step; reach for it before a
  full render when you just need to confirm beat structure/timing.
- **`cfg`** — prints the resolved three-tier config (defaults < config file <
  CLI overrides) as JSON; `--write` saves it to `manim.config.json` instead.
- **`init`** — scaffolds `scene.js` (or `[file]`) with `Text`, `Circle`,
  `Square`, `Create`, `Transform`, `FadeOut`, and a `nextSection()` marker;
  refuses to overwrite without `--force`.
- **`plugins`** — lists installed plugins plus registered mobjects,
  animations, scenes, rate functions, renderers, and colors, with counts —
  useful for discovering names a plugin's `use()`/`loadManifest()` added.
- **`checkhealth`** — see the root skill; exits non-zero if node/ffmpeg/
  ffprobe/@napi-rs/canvas/fonts checks fail.

## `render`: the high-value flags

Full flag table: [../../docs/cli.md](../../docs/cli.md#render). Highest-value
subset:

| Flag | Meaning |
|---|---|
| `-q` / `--quality` | `low` (854×480@15) \| `medium` (1280×720@30, default) \| `high` (1920×1080@60) \| `fourk` (3840×2160@60) \| `production` (2560×1440@60) |
| `-s` / `--save_last_frame` | final frame only, as PNG — the cheapest render, use this first per the root skill's loop |
| `-f` / `--format` | `mp4` (default, H.264) \| `webm` \| `gif` \| `mov` \| `png` (frame-sequence directory) |
| `-o` / `--output` | output path; only honored when a single scene target is rendered, else `media/<Scene>.<ext>` |
| `-n` / `--from_upto` | render only `play()` indices `a,b` (either side optional) — cheap way to re-check one beat |
| `-a` / `--write_all` | render every exported `Scene` subclass in the file |
| `-t` / `--transparent` | preserve alpha |
| `--save_sections` | also write per-section videos + a JSON index (needs `scene.nextSection(...)` calls) |
| `--disable_caching` / `--flush_cache` | see Caching below |
| `--renderer` | `canvas` (default) \| `webgl` — see Gotchas |
| `-c` / `--config` | load a `manim.config.{js,mjs,json}` |

Scene selection: `--scene`/positional name if it matches an export → the
default export → the first exported `Scene` subclass found (or `-a` for all).

### Config file

`ecmanim cfg --write` seeds `manim.config.json` in the cwd; `render`/`cfg`
auto-discover it (or take `--config <file>`). Field names may be snake_case
or camelCase; a `quality` preset expands to `pixelWidth`/`pixelHeight`/`fps`
unless those are set explicitly. Precedence is hard-coded defaults < config
file < CLI/per-call overrides. Full field list:
[../../docs/cli.md#config-file-format](../../docs/cli.md).

## Caching (partial movie files)

Each `play()`/`wait()` segment renders to its own partial movie file in a
sibling `partial/` directory, keyed by a content hash of that segment. Editing
one animation and re-rendering reuses every unchanged segment's cached
partial and only rebuilds what changed; the render summary reports the reuse
count. `--disable_caching` renders everything fresh without reading or
writing partials; `--flush_cache` deletes `partial/` before rendering (use
when you suspect a stale/corrupt cache rather than a genuine code change).

## Sections

`scene.nextSection(name, type?, skipAnimations?)` marks a boundary (the
`init` starter shows one call). Pass `--save_sections` (or set
`save_sections` in the config) to additionally emit
`media/sections/<name>.<ext>` per section plus a `<Scene>.json` index in
manim's sections format (`[{ name, type, video, id, … }]`) — useful for
presentation tooling that needs to seek/skip by section rather than play the
whole video (see `ecmanim-presentation`).

## Renderer backends

Full detail: [../../docs/renderers.md](../../docs/renderers.md). All
backends consume the same backend-agnostic `mobjects[]` tree.

| Renderer | Where | Output | Deterministic | Needs |
|---|---|---|:---:|---|
| **Canvas-2D** (default) | Node + browser | mp4/webm/gif/mov/png | yes | `@napi-rs/canvas`, `ffmpeg` (Node) |
| **SVG / vector** | Node + browser | `.svg` frame(s) | yes | nothing |
| **Three.js / WebGL** | browser only | live `<canvas>` + WebM | no (GPU) | a WebGL2 context |
| **Headless GPU** (`renderGL`) | Node | mp4/webm/mov | no (GPU) | a CDP-accessible Chrome |

- **CPU Canvas-2D is the default and CLI-only path** — `ecmanim render` never
  produces GPU output. Its determinism is *why* it's the default: it's what
  makes the content-hash partial-movie cache and reproducible CI snapshots
  sound.
- **The CPU renderer also does true 3D** without a GPU: it's a Canvas-2D
  rasterizer with its own per-pixel z-buffer and Gouraud/per-pixel-Phong
  shading for 3D mobjects (interpenetrating surfaces resolve correctly),
  unlike the SVG backend's painter's-order vector approximation of 3D (no
  z-buffer there — order-only, and it never throws on a 3D scene, it just
  isn't exact).
- **WebGL/Three.js is browser-only.** There is no CLI flag that makes
  `ecmanim render` actually use it — see Gotchas.
- **Headless GPU (`renderGL`, Node-only, not CLI)** runs the real
  Three.js/WebGL backend inside a headless Chrome (Mesa llvmpipe/ANGLE
  software rasterizer — no physical GPU required) and captures frames back to
  disk, for real per-pixel lighting/MSAA/GPU strokes when the CPU renderer's
  fidelity isn't enough. It is **not** fed into the content-hash cache (GPU
  output isn't bit-reproducible across drivers) and capture is throttled to
  real wall-clock `fps`, so it takes at least as long as the scene's
  `runTime` to capture — not something to reach for on a fast inner loop.
  Called from code (`import { renderGL } from "ecmanim/node"`), not from the
  `ecmanim` CLI. On trycooy specifically, `renderGL`/CDP Chrome is a
  shared machine-wide instance — take the `~/gpu.lock` convention before
  driving it (see the root skill / system CLAUDE.md).

## Gotchas

- **`--renderer webgl` on the CLI is a no-op that still renders with
  canvas.** `cmdRender` prints "Note: the WebGL renderer runs in the browser
  ... The Node CLI renders with the canvas renderer" and proceeds with
  Canvas-2D regardless. WebGL only actually runs via
  `examples/browser-three/index.html` in a browser, or via `renderGL` in
  Node.
- **`-t`/`--transparent` with the default `mp4` format silently becomes
  `.mov`.** Alpha isn't representable in H.264/mp4, so a transparent request
  falls back to ProRes 4444 in a `.mov` container — check the actual output
  extension, don't assume `.mp4` when `-t` is set.
- **Short boolean flags bundle; a value-taking short flag must be last in the
  bundle.** e.g. `-st` is valid (`-s -t`); a bundle mixing a value flag like
  `-q` must put `-q` last (`-tq high`), not first.
- **`-o`/`--output` is only honored for a single render target.** With `-a`
  (`--write_all`) or multiple matched scenes, `-o` is ignored and each scene
  writes to `media/<Scene>.<ext>` instead — don't expect `-o` to rename an
  `-a` batch.
- **`-f png` writes a directory, not a file** (a PNG frame-sequence
  directory), distinct from `-s`/`--save_last_frame` which writes exactly one
  `.png` (the final frame, no video encode at all).
- **`checkhealth` exits non-zero on any failed required check** (node,
  ffmpeg, ffprobe, `@napi-rs/canvas`, fonts) — run it before trusting that a
  render failure is a code bug rather than a missing binary, per the root
  skill.
