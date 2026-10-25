import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { setImmediate } from "node:timers/promises";

// Execute the actual homepage script, replacing only the browser library
// import and DOM/encoder boundaries. Event listeners' promises are deliberately
// ignored, just as the browser ignores them when dispatching a click.
const page = readFileSync(new URL("../website/src/content/docs/index.md", import.meta.url), "utf8");
const script = page.match(/<script type="module">([\s\S]*?)<\/script>/)![1]
  .replace(/import\s*\{[^}]*\}\s*from\s*'\/ecmanim-dist\/browser\.js';/, "");

function mount(play: () => Promise<unknown>, record: () => Promise<unknown>) {
  const listeners: Record<string, () => void> = {};
  const warnings: unknown[][] = [];
  const timers: Array<{ callback: () => void; delay: number }> = [];
  const downloads: Array<{ href: string; download: string }> = [];
  const created: unknown[] = [], revoked: string[] = [];
  runInNewContext(script, {
    Scene: class {}, play, record,
    console: { warn: (...args: unknown[]) => warnings.push(args) },
    document: {
      getElementById: (id: string) => ({ addEventListener: (_event: string, handler: () => void) => { listeners[id] = handler; } }),
      createElement: () => {
        const anchor = { href: "", download: "", click() { downloads.push({ href: this.href, download: this.download }); } };
        return anchor;
      },
    },
    URL: {
      createObjectURL: (blob: unknown) => { created.push(blob); return "blob:demo"; },
      revokeObjectURL: (url: string) => revoked.push(url),
    },
    setTimeout: (callback: () => void, delay: number) => timers.push({ callback, delay }),
  });
  return { listeners, warnings, timers, downloads, created, revoked };
}

const pending = () => new Promise(() => {});

for (const [operation, label] of [
  ["playback", "ecmanim demo playback stopped:"],
  ["replay", "ecmanim demo replay failed:"],
  ["download", "ecmanim demo download failed:"],
]) {
  test(`homepage ${operation} reports the original rejection with its stack`, async () => {
    const error = new TypeError(`${operation} failed inside the scene`);
    let plays = 0;
    const demo = mount(
      () => (++plays === 1 && operation !== "playback") ? pending() : Promise.reject(error),
      () => Promise.reject(error),
    );
    if (operation !== "playback") demo.listeners[operation]();
    await setImmediate();
    assert.equal(demo.warnings.length, 1);
    assert.equal(demo.warnings[0][0], label);
    assert.equal(demo.warnings[0][1], error, "log the Error object, preserving its message and stack");
    assert.equal(demo.downloads.length, 0);
    assert.equal(demo.created.length, 0, "a failed recording must not start a download");
    assert.equal(demo.timers.length, 0, "failed autoplay must stop rather than retry forever");
  });
}

test("homepage successful download still clicks the WebM link and revokes its URL", async () => {
  const blob = new Blob(["video"], { type: "video/webm" });
  const demo = mount(pending, async () => blob);
  demo.listeners.download();
  await setImmediate();
  assert.deepEqual(demo.warnings, []);
  assert.deepEqual(demo.created, [blob]);
  assert.deepEqual(demo.downloads, [{ href: "blob:demo", download: "ecmanim-demo.webm" }]);
  assert.equal(demo.timers.length, 1);
  assert.equal(demo.timers[0].delay, 1000);
  demo.timers[0].callback();
  assert.deepEqual(demo.revoked, ["blob:demo"]);
});
