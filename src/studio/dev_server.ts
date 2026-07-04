// ecmanim Studio — a live-preview dev server. It serves a page that renders your
// Scene in a <manim-player>, watches the scene file, and hot-reloads the browser
// (via Server-Sent Events) on every save. Node-only. No dependency: uses node:http
// + node:fs.watch. The heavier Studio pieces (checkpoint replay, mouse camera, an
// eval REPL, a schema-driven props panel) build on this foundation.

export interface StudioOptions {
  /** Browser-importable ES module exporting the scene (relative to `root`). */
  sceneModule: string;
  /** Named export (default "default"). */
  sceneExport?: string;
  /** Files/dirs to watch for changes (default: the scene module's dir). */
  watch?: string[];
  /** Static root served over http (default cwd; must contain dist/browser.js). */
  root?: string;
  port?: number;
  /** Bind address. Default "127.0.0.1" (localhost-only, the safe default —
   *  this dev server has no auth). Pass "0.0.0.0" to expose it on the LAN
   *  (e.g. to view from another device, or over a remote/SSH-tunneled
   *  session where "127.0.0.1" only means the *server's own* loopback, not
   *  yours). Understand the exposure before doing this on an untrusted network. */
  host?: string;
  quality?: string;
  background?: string;
  /** Attach pointer-driven pan/zoom/orbit to the live preview (default false). */
  interactive?: boolean;
  /** Draw a waveform strip below the player for each of the scene's sounds
   *  (via addSound()), on the shared time axis (default false). */
  waveform?: boolean;
  /** Render a props panel (from the scene's `static schema`) below the
   *  player; edits re-render via parameter-only re-render, not a full file
   *  reload (default false). */
  props?: boolean;
}

/** The live-reload harness page HTML (importmap + <manim-player> + SSE reload). */
export function buildStudioHarness(opts: { sceneModuleUrl: string; sceneExport: string; browserUrl: string; studioUrl: string; quality: string; background: string; interactive: boolean; waveform?: boolean; props?: boolean }): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ecmanim Studio</title>
<style>body{margin:0;background:#0b0d12;color:#cdd6f4;font:14px system-ui;display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px}manim-player{max-width:96vw;box-shadow:0 4px 30px #0008}#bar{opacity:.7}</style>
<script type="importmap">{"imports":{"ecmanim/browser":"${opts.browserUrl}","ecmanim/studio":"${opts.studioUrl}"}}</script></head>
<body>
<div id="bar">ecmanim Studio — editing <code>${opts.sceneExport}</code> · saves hot-reload${opts.interactive ? " · drag to pan/orbit, scroll to zoom" : ""}</div>
<manim-player id="p" quality="${opts.quality}" background="${opts.background}" controls></manim-player>
${opts.waveform ? `<canvas id="waveform" style="display:block;margin-top:4px"></canvas>` : ""}
${opts.props ? `<div id="props" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:4px"></div>` : ""}
<script type="module">
  import { defineManimPlayer } from "ecmanim/browser";
  defineManimPlayer();
  const el = document.getElementById("p");
  ${opts.interactive ? `
  let detachInteractive = null;
  el.addEventListener("ready", async () => {
    detachInteractive?.detach();
    const { attachInteractiveCamera } = await import("ecmanim/studio");
    const player = el.player;
    if (!player?.canvas || !player.camera) return;
    detachInteractive = attachInteractiveCamera(player.canvas, player.camera, {
      render: () => player.rerenderCurrentFrame(),
    });
  });` : ""}
  ${opts.waveform ? `
  const waveformCanvas = document.getElementById("waveform");
  const waveformCache = new Map();
  el.addEventListener("ready", async () => {
    const player = el.player;
    const scene = player?.scene;
    const wctx = waveformCanvas.getContext("2d");
    const width = player?.pixelWidth ?? 0;
    const height = 48;
    waveformCanvas.width = width;
    waveformCanvas.height = height;
    wctx.clearRect(0, 0, width, height);
    if (!player || !scene?.sounds?.length) return;
    const { getAudioData, getWaveformPortion } = await import("ecmanim/browser");
    const { renderWaveform, timeToPixel } = await import("ecmanim/studio");
    const axis = { duration: player.duration, pixelWidth: width };
    for (const sound of scene.sounds) {
      let audioData = waveformCache.get(sound.file);
      if (!audioData) {
        try { audioData = await getAudioData(sound.file); } catch { continue; }
        waveformCache.set(sound.file, audioData);
      }
      const x = timeToPixel(sound.time, axis);
      const durationInSeconds = Math.max(0, player.duration - sound.time);
      const numberOfSamples = Math.max(1, Math.round(width - x));
      const samples = getWaveformPortion({ audioData, startTimeInSeconds: 0, durationInSeconds, numberOfSamples });
      renderWaveform(wctx, samples, { pixelWidth: width - x, height, x, y: 0 });
    }
  });` : ""}
  ${opts.props ? `
  const propsPanel = document.getElementById("props");
  let currentSchema = null;
  let rerenderTimer = null;
  function makeControl(c, value) {
    let input;
    if (c.control === "select") {
      input = document.createElement("select");
      for (const opt of c.options ?? []) {
        const o = document.createElement("option"); o.value = opt; o.textContent = opt;
        input.appendChild(o);
      }
      input.value = value;
    } else if (c.control === "checkbox") {
      input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!value;
    } else {
      input = document.createElement("input");
      input.type = c.control === "number" ? "number" : c.control === "color" ? "color" : "text";
      if (c.min != null) input.min = c.min;
      if (c.max != null) input.max = c.max;
      input.value = value ?? "";
    }
    input.dataset.propName = c.name;
    input.addEventListener("input", onPropChange);
    return input;
  }
  function collectPropValues() {
    const values = {};
    for (const input of propsPanel.querySelectorAll("[data-prop-name]")) {
      const name = input.dataset.propName;
      values[name] = input.type === "checkbox" ? input.checked
        : input.type === "number" ? Number(input.value)
        : input.value;
    }
    return values;
  }
  function onPropChange() {
    // Debounced (mirrors the 80ms file-save SSE debounce below) so rapid
    // slider drags don't each trigger their own full re-record.
    clearTimeout(rerenderTimer);
    rerenderTimer = setTimeout(() => {
      if (!currentSchema) return;
      const result = currentSchema.safeParse(collectPropValues());
      if (result.ok) el.rerender(result.value);
    }, 80);
  }
  el.addEventListener("ready", async () => {
    const schema = el.scene?.schema ?? null;
    // A rerender() (panel-edit) "ready" event carries the SAME schema
    // object as before -- only a fresh file-save load() (a new module
    // import, thus a fresh defineSchema() object) resets the panel.
    if (schema === currentSchema) return;
    currentSchema = schema;
    propsPanel.innerHTML = "";
    if (!schema) return;
    const { schemaToControls } = await import("ecmanim/studio");
    const defaults = schema.safeParse({});
    const values = defaults.ok ? defaults.value : {};
    for (const c of schemaToControls(schema)) {
      const label = document.createElement("label");
      label.style.cssText = "display:flex;flex-direction:column;font-size:11px;gap:2px";
      label.textContent = c.label;
      label.appendChild(makeControl(c, values[c.name]));
      propsPanel.appendChild(label);
    }
  });` : ""}
  async function load() {
    try {
      const mod = await import("${opts.sceneModuleUrl}?t=" + Date.now()); // cache-bust
      el.scene = mod["${opts.sceneExport}"] ?? mod.default;
    } catch (e) { document.getElementById("bar").textContent = "error: " + e.message; }
  }
  load();
  const es = new EventSource("/__studio_events");
  es.onmessage = () => load();  // re-import + re-render on file change
</script></body></html>`;
}

export interface StudioHandle {
  /** Best-guess browsable URL: the bind host itself, or (when bound to the
   *  wildcard "0.0.0.0"/"::") the first discovered LAN address -- falling
   *  back to "127.0.0.1" if none is found. See `urls` for every candidate. */
  url: string;
  /** Every URL the server is actually reachable at (loopback + LAN, when
   *  wildcard-bound) -- useful when accessing from a different device than
   *  the one running the server. */
  urls: string[];
  port: number;
  close: () => void;
}

/** Start the Studio dev server. Returns a handle with the URL and a close(). */
export async function startStudio(options: StudioOptions): Promise<StudioHandle> {
  const http = await import("node:http");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(options.root ?? process.cwd());
  const sceneExport = options.sceneExport ?? "default";
  const quality = options.quality ?? "medium";
  const background = options.background ?? "#0d1117";
  const interactive = options.interactive ?? false;
  const waveform = options.waveform ?? false;
  const props = options.props ?? false;
  const sceneUrlPath = "/" + path.relative(root, path.resolve(root, options.sceneModule)).split(path.sep).join("/");

  const clients: any[] = [];
  const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".map": "application/json", ".json": "application/json", ".wasm": "application/wasm", ".css": "text/css" };

  const server = http.createServer((req: any, res: any) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    if (url === "/" || url === "/index.html") {
      const html = buildStudioHarness({ sceneModuleUrl: sceneUrlPath, sceneExport, browserUrl: "/dist/browser.js", studioUrl: "/dist/studio.js", quality, background, interactive, waveform, props });
      res.writeHead(200, { "content-type": "text/html" });
      res.end(html);
      return;
    }
    if (url === "/__studio_events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      res.write("\n");
      clients.push(res);
      req.on("close", () => { const i = clients.indexOf(res); if (i >= 0) clients.splice(i, 1); });
      return;
    }
    // static
    const p = path.normalize(path.join(root, url));
    if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
    res.writeHead(200, { "content-type": MIME[path.extname(p)] ?? "application/octet-stream" });
    res.end(fs.readFileSync(p));
  });

  const host = options.host ?? "127.0.0.1";
  const port = await new Promise<number>((resolve) => {
    server.listen(options.port ?? 0, host, () => resolve((server.address() as any).port));
  });

  // "0.0.0.0"/"::" (wildcard bind) isn't reliably browsable as a literal URL
  // (behavior varies by browser/OS) -- enumerate actual reachable addresses
  // instead, so a device other than the one running the server has a real
  // address to use.
  let urls: string[];
  if (host === "0.0.0.0" || host === "::") {
    const os = await import("node:os");
    const lan: string[] = [];
    for (const addrs of Object.values(os.networkInterfaces())) {
      for (const addr of addrs ?? []) {
        if (addr.family === "IPv4" && !addr.internal) lan.push(addr.address);
      }
    }
    urls = [`http://127.0.0.1:${port}/`, ...lan.map((ip) => `http://${ip}:${port}/`)];
  } else {
    urls = [`http://${host}:${port}/`];
  }

  // Watch for changes → notify SSE clients.
  const watchTargets = options.watch ?? [path.dirname(path.resolve(root, options.sceneModule))];
  const watchers: any[] = [];
  let debounce: any = null;
  const notify = () => { clearTimeout(debounce); debounce = setTimeout(() => { for (const c of clients) c.write("data: reload\n\n"); }, 80); };
  for (const t of watchTargets) {
    try { watchers.push(fs.watch(path.resolve(root, t), { recursive: true }, notify)); }
    catch { try { watchers.push(fs.watch(path.resolve(root, t), notify)); } catch { /* ignore */ } }
  }

  return {
    url: urls[0],
    urls,
    port,
    close: () => { for (const w of watchers) try { w.close(); } catch { /* */ } try { server.close(); } catch { /* */ } },
  };
}
