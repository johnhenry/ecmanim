# VideoMobject — external-video ingestion

`VideoMobject` places an external video clip inside a scene: it is an
`ImageMobject` whose displayed bitmap is swapped, per scene frame, to the clip's
frame for the current time. The clip stays in sync with scene time (updaters
accumulate `dt`), so it plays through `play()` and `wait()` like any other
mobject, and it composes with the partial-movie cache and parallel rendering
because the decode is deterministic.

The decode is **frame-accurate by construction** — instead of relying on
`<video>.currentTime` seeking (which snaps to keyframes), each backend extracts
the exact frame for a target time up front. The core (`VideoMobject`) is
isomorphic and depends only on a small `VideoFrameProvider` interface; the Node
and browser entry points each supply a provider.

## Node (`manim-js/node`)

Frames are extracted with **ffmpeg** into a content-hash-keyed decode cache, then
pre-decoded into memory so per-frame lookup is a synchronous index.

```js
import { render, loadVideo, Scene, Text, Write } from "manim-js/node";

class Clip extends Scene {
  async construct() {
    const video = await loadVideo("input.mp4", {
      width: 7,          // on-screen width in scene units (aspect preserved)
      fps: 30,           // decode fps (default = scene/source fps)
      scene: this,       // required to mux audio
      audio: true,       // extract the clip's audio track into the render
      start: 0, end: 4,  // optional trim (seconds)
      playbackRate: 1,   // optional speed
      loop: false,       // optional
    });
    this.add(video);     // starts playing as scene time advances
    await this.play(new Write(new Text("hi")));
    await this.wait(2);  // the clip keeps playing through the wait
  }
}

await render(Clip, { output: "out.mp4", fps: 30 });
```

- **Audio.** With `{ scene, audio: true }`, the clip's audio is extracted and
  registered via `scene.addSound(...)` at `audioOffset` (default = the scene time
  when `loadVideo` is called); the existing audio-mux path folds it into the
  render. The output mp4 then carries both video and audio streams.
- **Decode cache.** Keyed by `(abs path + mtime + fps + scale + trim)` under
  `<tmpdir>/manim-js-video/<hash>` (override with `cacheDir`). A warm cache skips
  ffmpeg entirely and is byte-identical, so it plays nicely with the content-hash
  partial-movie cache.
- **Memory.** All target frames are decoded to RGBA in memory
  (~`frames × W × H × 4` bytes; a 10s 1080p@30 clip ≈ 2.5 GB). Bound it with
  `scale`/`width` (downscale to on-screen size), `fps` (decode at scene fps, not
  source), and `start`/`end` (trim to the played span). `frameAt()` must be
  synchronous, so there is no lazy/streaming path by design.
- Lower-level helpers `probeVideo(path)` and `extractFrames(path, opts)` are
  exported too.

## Browser (`manim-js/browser`)

```js
import { loadVideo, play } from "manim-js/browser";

const video = await loadVideo("clip.mp4", { fps: 30, width: 7 }); // mode: "auto"
// ...add to a Scene and play()/record() as usual.
```

Three providers back it, selected by `mode` (default `"auto"`):

- **`webcodecs` — frame-accurate + single-pass (preferred).** Demuxes an mp4/mov
  with `mp4box.js` and decodes the whole stream in one pass through a WebCodecs
  `VideoDecoder`, then resamples the decoded frames onto the target fps grid as
  `ImageBitmap`s. Far faster than seek-and-capture (one decode pass vs. O(frames)
  seeks). Requires a browser with WebCodecs and an mp4/mov (h264/h265/av1) source.
- **`precapture` — frame-accurate, dependency-free fallback.** Seeks a `<video>`
  to each target time, waits for `seeked`, and captures the frame into an
  `ImageBitmap`. Works for any format the `<video>` can play; slower.
- **`live` — real-time.** Wraps a playing `<video>` and draws whatever it
  currently shows. Low-latency, not frame-accurate; right for live `play()`.

`"auto"` uses `webcodecs` for a URL source when the browser supports it and
transparently falls back to `precapture` otherwise (or on any demux/decode
failure). Force a path with `mode: "webcodecs" | "precapture" | "live"`;
`webcodecs` surfaces errors instead of falling back.

`loadVideo` accepts a URL or an `HTMLVideoElement` and normalizes it
(`crossOrigin`, `muted`, `playsInline`, awaits `loadedmetadata`). `mp4box` is
imported lazily (never at module load), so the module stays Node-import-safe and
unbundled-browser-safe; calling `loadVideo` without a DOM throws a clear error.
In an unbundled browser, add `mp4box` to your import map (like `gifenc` /
`mp4-muxer`) or use a bundler.

## Limitations

- Both backends hold all target frames in memory (see above) — downscale/trim
  long clips.
- Browser `webcodecs` is mp4/mov only (mp4box demux); other formats use the
  slower `precapture` seek-and-capture fallback.
- 3D/vector renderers draw a `VideoMobject` like any raster `ImageMobject`
  (projected bbox); it is not a textured 3D surface.
