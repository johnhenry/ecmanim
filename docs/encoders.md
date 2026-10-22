# JS encoders: APNG, frame-ZIP, ffmpeg-free GIF

First-party, canvas-free, `node:`-free encoders in `src/encoders/`. RGBA frames
in, `Uint8Array` out, streaming `addFrame(rgba, delayMs?)` / `finish()`.
Exposed raw as the `@johnhenry/ecmanim/encoders` subpath and wired into the
Node and browser render paths.

```ts
import { ApngEncoder, ZipSequenceEncoder, GifEncoder, ZipWriter, crc32 } from "@johnhenry/ecmanim/encoders";

const apng = new ApngEncoder({ width, height, fps: 30, loops: 0 });
apng.addFrame(ctx.getImageData(0, 0, width, height).data);       // default delay = 1000/fps ms
apng.addFrame(rgba, 250);                                        // explicit per-frame delay (ms)
const bytes = apng.finish();

const gif = await GifEncoder.create({ width, height, fps: 20 }); // gifenc, loaded lazily
```

| Encoder | Output | Notes |
|---|---|---|
| `ApngEncoder` | `.apng` (PNG with `acTL`/`fcTL`/`fdAT`) | lossless, full alpha; every frame is full-canvas, `dispose_op` NONE, `blend_op` SOURCE; rational delays (exact for integer ms, 16-bit-precise otherwise) |
| `ZipSequenceEncoder` | `.zip` | `frame-000001.png` ... + `animation.json` (`fps`, `width`, `height`, `frameCount`, `pattern`, `frames`, and `delaysMs` only when delays differ from `1000/fps`); PNG entries stored, manifest deflated |
| `ZipWriter` | `.zip` | generic store/deflate writer; deterministic (fixed DOS timestamp), UTF-8 names, no ZIP64 (max 65,534 entries, 4 GiB) |
| `GifEncoder` | `.gif` | thin wrapper over `gifenc`; per-frame palette, `maxColors` cap |

Deflate is provided by [`fflate`](https://github.com/101arrowz/fflate) (MIT,
pure JS, ~8 kB gzipped for the parts used). It is the one new runtime
dependency: the isomorphic code cannot use `node:zlib`, and the browser's
`CompressionStream` is async-only and unavailable in older runtimes.

## Node: `RenderOptions.encoder`

```ts
await render(MyScene, { format: "apng", output: "out.apng" });             // JS-only format
await render(MyScene, { format: "zip",  output: "out.zip"  });             // JS-only format
await render(MyScene, { format: "gif",  encoder: "js", output: "o.gif" }); // no ffmpeg needed
```

* `encoder` defaults to `"ffmpeg"`: every existing format takes exactly the path
  it took before (the default `format: "gif"` still uses ffmpeg `palettegen`).
* `encoder: "js"` with `mp4` / `webm` / `mov` throws immediately with a message
  naming the supported combinations.
* `apng` and `zip` are always JS-encoded, so `encoder: "ffmpeg"` is ignored for them.
* The service accepts `format: "apng" | "zip"` (artifact extension and content
  type follow).

## Browser

`recordApng`, `recordZip`, `downloadApng`, `downloadZip`, and
`recordVideo({ format: "apng" | "zip" })` (the `format` union only widened).

## Renderer-support matrix

| Feature | Node `render()` | `renderParallel` | Browser | SVG renderer | WebGL |
|---|:-:|:-:|:-:|:-:|:-:|
| APNG | yes | sequential fallback | yes (`recordApng`) | n/a | n/a |
| Frame ZIP | yes | sequential fallback | yes (`recordZip`) | n/a | n/a |
| GIF without ffmpeg | `encoder: "js"` | sequential fallback | yes (`recordGif`, existing) | n/a | n/a |

## Honest divergences

* **No partial-movie cache.** JS formats re-render every frame; they bypass the
  content-hash cache that the ffmpeg path uses.
* **No parallel rendering.** `renderParallel` falls back to a sequential
  `render()` for these formats (partials are ffmpeg containers).
* **Audio, `saveSections` and `watermark` are not applied.** None of the three
  formats carries audio; `watermark` throws, `saveSections` is ignored.
* **Memory.** Frames are compressed as they arrive but the whole file is
  assembled in memory (APNG needs the final frame count up front, `acTL`).
* **APNG compression** uses filter type 0 only (no adaptive filtering), so files
  are larger than an optimizer's output; they are always lossless and valid.
* **GIF** keeps gifenc's per-frame palette without dithering; the ffmpeg path's
  `palettegen/paletteuse` generally looks better and is the default.
* `transparent` is not needed: alpha is whatever the canvas holds. The default
  background is opaque, so pass a transparent `background` for transparent output.

Implemented from the W3C PNG specification (3rd ed.), the APNG chunk
specification, and PKWARE's APPNOTE.TXT.
