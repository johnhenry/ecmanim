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
  quality?: string;
  background?: string;
  /** Attach pointer-driven pan/zoom/orbit to the live preview (default false). */
  interactive?: boolean;
}

/** The live-reload harness page HTML (importmap + <manim-player> + SSE reload). */
export function buildStudioHarness(opts: { sceneModuleUrl: string; sceneExport: string; browserUrl: string; studioUrl: string; quality: string; background: string; interactive: boolean }): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ecmanim Studio</title>
<style>body{margin:0;background:#0b0d12;color:#cdd6f4;font:14px system-ui;display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px}manim-player{max-width:96vw;box-shadow:0 4px 30px #0008}#bar{opacity:.7}</style>
<script type="importmap">{"imports":{"ecmanim/browser":"${opts.browserUrl}","ecmanim/studio":"${opts.studioUrl}"}}</script></head>
<body>
<div id="bar">ecmanim Studio — editing <code>${opts.sceneExport}</code> · saves hot-reload${opts.interactive ? " · drag to pan/orbit, scroll to zoom" : ""}</div>
<manim-player id="p" quality="${opts.quality}" background="${opts.background}" controls></manim-player>
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

export interface StudioHandle { url: string; port: number; close: () => void; }

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
  const sceneUrlPath = "/" + path.relative(root, path.resolve(root, options.sceneModule)).split(path.sep).join("/");

  const clients: any[] = [];
  const MIME: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".map": "application/json", ".json": "application/json", ".wasm": "application/wasm", ".css": "text/css" };

  const server = http.createServer((req: any, res: any) => {
    const url = decodeURIComponent((req.url || "/").split("?")[0]);
    if (url === "/" || url === "/index.html") {
      const html = buildStudioHarness({ sceneModuleUrl: sceneUrlPath, sceneExport, browserUrl: "/dist/browser.js", studioUrl: "/dist/studio.js", quality, background, interactive });
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

  const port = await new Promise<number>((resolve) => {
    server.listen(options.port ?? 0, "127.0.0.1", () => resolve((server.address() as any).port));
  });

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
    url: `http://127.0.0.1:${port}/`,
    port,
    close: () => { for (const w of watchers) try { w.close(); } catch { /* */ } try { server.close(); } catch { /* */ } },
  };
}
