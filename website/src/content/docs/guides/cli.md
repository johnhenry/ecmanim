---
title: "CLI reference"
---

The `ecmanim` command (`bin/ecmanim.ts`) is a JavaScript port of manim's
`manim` command. It runs directly on the `.ts` source under Node 25+.

```
ecmanim render <file> [scene] [options]
ecmanim cfg [--write]
ecmanim init [file]
ecmanim plugins
ecmanim checkhealth
```

Run `ecmanim` (or `-h` / `--help`) with no command to print usage.

---

## `render`

```
ecmanim render <file> [scene] [options]
```

Loads a scene file and renders one or more scenes to video (or a PNG). The scene
file may:

- **export a `Scene` subclass** — selected by `[scene]` positional, `--scene`, or
  the default export; or
- **export default an async function** `(scene) => { … }`; or
- **render itself on import** (fallback — the CLI reports it found no exported
  Scene and returns).

Scene selection order: `--scene`/positional name if it matches an export → the
default export → the first exported `Scene` subclass found. With `-a` /
`--write_all`, every exported `Scene` subclass is rendered.

### Options

| Flag | Long | Arg | Default | Meaning |
|------|------|-----|---------|---------|
| `-o` | `--output` | path | `media/<Scene>.<ext>` | Output file (only applied when rendering a single target) |
| `-q` | `--quality` | preset | `medium` | `low` \| `medium` \| `high` \| `fourk` \| `production` |
| `-r` | `--resolution` | `WxH` | — | Explicit resolution, e.g. `1920x1080` (overrides quality dims) |
|  | `--fps` | n | preset fps | Frames per second (overrides the preset) |
| `-f` | `--format` | fmt | `mp4` | `mp4` \| `webm` \| `gif` \| `mov` \| `png` |
| `-s` | `--save_last_frame` | — | off | Write only the final frame as a PNG (no video) |
| `-t` | `--transparent` | — | off | Preserve alpha (an `mp4` request falls back to `.mov` / ProRes 4444) |
| `-a` | `--write_all` | — | off | Render every exported `Scene` in the file |
| `-n` | `--from_upto` | `a,b` | — | Render only `play()` indices in `[a, b]` (either side may be empty) |
|  | `--disable_caching` | — | off | Bypass the partial-movie-file cache |
|  | `--flush_cache` | — | off | Delete the `media/partial` cache before rendering |
|  | `--save_sections` | — | off | Also write per-section videos + a JSON index |
| `-c` | `--config` | file | — | Load a `manim.config.{js,json}` before rendering |
|  | `--bg` | color | `#000000` | Background color |
|  | `--renderer` | r | `canvas` | `canvas` (default) \| `webgl` (browser-only; note printed) |
| `-v` | `--verbose` | — | off | Verbose ffmpeg output |
| `-h` | `--help` | — | — | Show help |

Notes:

- **`--scene <Name>`** is an alias for the `[scene]` positional.
- **Output extension** is derived from the format: `-s` forces `.png`; `-f png`
  writes a PNG sequence directory; `-t` with `mp4` yields `.mov`. When `-o` is
  given and exactly one scene is rendered, it wins; otherwise output goes to
  `media/<Scene>.<ext>`.
- **`--renderer webgl`** prints a note and still renders with the canvas
  renderer — WebGL is a browser-only backend (see
  `examples/browser-three/index.html`).
- Short boolean flags may be bundled (e.g. `-st`); a value-taking short flag must
  be the last char of a bundle.

### Examples

```bash
ecmanim render examples/basic.ts BasicScene -q high -o out.mp4
ecmanim render myscene.ts --scene IntroScene --format webm
ecmanim render scene.ts -s                 # just the final frame as PNG
ecmanim render scene.ts -n 2,5             # only play() indices 2..5
ecmanim render scene.ts -a                 # render every exported Scene
ecmanim render scene.ts --save_sections    # per-section videos + JSON index
ecmanim render scene.ts --flush_cache -q high
```

---

## `cfg`

```
ecmanim cfg [--config <file>] [--quality <q>] [--format <f>] [--bg <color>] [--write]
```

Prints the resolved default config as JSON (defaults < loaded config file <
overrides). `--write` saves it to `manim.config.json` in the current directory
instead of printing.

---

## `init`

```
ecmanim init [file] [--force]
```

Scaffolds a starter scene file (default `scene.js`). Refuses to overwrite an
existing file unless `--force` is passed. The starter demonstrates `Text`,
`Circle`, `Square`, `Create`, `Transform`, `FadeOut`, and a `nextSection()`
marker, and prints the render command to run next.

---

## `plugins`

```
ecmanim plugins
```

Lists everything currently registered in the shared registry: the installed
plugins (name + version), then the registered **mobjects**, **animations**,
**scenes**, **rate functions**, **renderers**, and **colors** with counts. Useful
for discovering names added by `use()` or `loadManifest()`.

---

## `checkhealth`

```
ecmanim checkhealth
```

Reports the environment the Node backend needs and exits non-zero if any check
fails:

- **node** — version
- **ffmpeg** / **ffprobe** — present on `PATH` (required for video/audio)
- **@napi-rs/canvas** — installed and exposing `createCanvas`
- **fonts** — number of font families auto-registered

---

## Config file format

`render` and `cfg` can load a `manim.config.{js,mjs,json}` (auto-discovered in the
cwd, or an explicit `--config <file>`). It feeds the **middle layer** of a
three-tier config (hard-coded defaults < config file < CLI/per-call overrides).

A JSON file is the settings object directly; a JS/MJS module may `export default`
either the settings or `{ config, plugins }` (the loader reads `config`). Field
names may be **snake_case or camelCase** — both resolve to the same value — and a
`quality` preset expands to `pixelWidth`/`pixelHeight`/`fps` unless you set those
explicitly.

```jsonc
// manim.config.json
{
  "quality": "high",          // low | medium | high | fourk | production
  "background": "#0d1117",     // alias: "bg"
  "format": "mp4",             // mp4 | webm | gif | mov | png | png-sequence
  "output_dir": "media",       // alias: outputDir
  "fps": 60,                    // alias: frame_rate
  "disable_caching": false,     // alias: disableCaching
  "transparent": false,
  "save_last_frame": false,     // alias: saveLastFrame
  "from_animation_number": null,// alias: fromAnimationNumber
  "upto_animation_number": null,// alias: uptoAnimationNumber
  "save_sections": false,       // alias: saveSections
  "renderer": "canvas"          // canvas | webgl
}
```

### Quality presets

| Preset | Resolution | fps |
|--------|-----------|-----|
| `low` | 854×480 | 15 |
| `medium` | 1280×720 | 30 |
| `high` | 1920×1080 | 60 |
| `fourk` | 3840×2160 | 60 |
| `production` | 2560×1440 | 60 |

`-r WxH` / `--resolution` and `--fps` override the preset's dimensions/fps.

---

## Output formats

| `--format` | Extension | Container / codec |
|------------|-----------|-------------------|
| `mp4` | `.mp4` | H.264 (the default) |
| `webm` | `.webm` | VP9/VP8 |
| `gif` | `.gif` | animated GIF |
| `mov` | `.mov` | QuickTime (used automatically for transparent mp4 → ProRes 4444) |
| `png` | directory | a PNG frame sequence |
| `-s` / `--save_last_frame` | `.png` | single final frame, no video |

Video encoding pipes `@napi-rs/canvas` PNG frames to `ffmpeg`; audio added via
`scene.addSound(...)` is muxed in during encoding. `ffmpeg` and `ffprobe` must be
on `PATH`.

---

## Caching (partial movie files)

Each `play()` / `wait()` segment is rendered to its own **partial movie file** in
a sibling `partial/` directory (next to the output), keyed by a **content hash**
of that segment. On re-render, segments whose hash is unchanged are **reused**
(their frames are not re-buffered), and all partials are concatenated with
ffmpeg's concat demuxer into the final video — so editing one animation only
re-renders that animation.

- `--disable_caching` — render everything fresh, no partials reused or written.
- `--flush_cache` — delete the `partial/` directory before rendering.

The render summary reports how many partials were reused.

---

## Sections

`scene.nextSection(name, type?, skipAnimations?)` marks section boundaries (the
starter from `init` shows one). With `--save_sections` (or `save_sections` in the
config), in addition to the full video, each section is written to
`media/sections/<name>.<ext>` alongside a `<Scene>.json` index in manim's
sections format (`[{ name, type, video, id, … }]`).
