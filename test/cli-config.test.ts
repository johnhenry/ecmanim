import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { resolveConfig, config } from "../src/_config.ts";
import { Scene, SectionType } from "../src/scene/Scene.ts";
import { render } from "../src/node.ts";
import { Circle } from "../src/mobject/geometry.ts";
import { Create } from "../src/animation/Animation.ts";

const CLI = fileURLToPath(new URL("../bin/manim-js.ts", import.meta.url));

function tmp(name: string): string {
  return join(tmpdir(), `mjcfg_${process.pid}_${name}`);
}

test("resolveConfig merges overrides over defaults", () => {
  const r = resolveConfig({ background: "#123456", fps: 12 });
  assert.equal(r.background, "#123456");
  assert.equal(r.fps, 12);
  // Untouched defaults remain.
  assert.equal(r.output_dir, config.output_dir);
  // Quality preset expands dimensions.
  const hi = resolveConfig({ quality: "high" });
  assert.equal(hi.pixelWidth, 1920);
  assert.equal(hi.pixelHeight, 1080);
  // snake_case / camelCase aliasing.
  const a = resolveConfig({ disableCaching: true, saveLastFrame: true });
  assert.equal(a.disable_caching, true);
  assert.equal(a.save_last_frame, true);
});

test("render(saveLastFrame) writes a PNG and no video", async () => {
  const out = tmp("slf.mp4");
  const png = out.replace(/\.mp4$/, ".png");
  const r = await render(async (s: any) => {
    await s.play(new Create(new Circle({ radius: 1 })), { _playConfig: true, runTime: 0.2 });
  }, { output: out, quality: "low", fps: 6, saveLastFrame: true, verbose: false });
  assert.ok(existsSync(png), "PNG frame written");
  assert.equal(r.output, png);
  assert.ok(!existsSync(out), "no mp4 produced");
  for (const f of [png, out]) if (existsSync(f)) rmSync(f, { force: true });
});

test("render still muxes audio when a sound is scheduled", async () => {
  const wav = tmp("tone.wav");
  const out = tmp("audio.mp4");
  execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.4", wav], { stdio: "ignore" });
  await render(async (s: any) => {
    s.addSound(wav);
    await s.play(new Create(new Circle({ radius: 1 })), { _playConfig: true, runTime: 0.3 });
  }, { output: out, quality: "low", fps: 8, verbose: false });
  const streams = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", out], { encoding: "utf8" });
  assert.ok(streams.includes("audio"), "output has an audio stream");
  assert.ok(streams.includes("video"), "output has a video stream");
  for (const f of [wav, out]) if (existsSync(f)) rmSync(f, { force: true });
  const partial = join(tmpdir(), "partial");
  if (existsSync(partial)) rmSync(partial, { recursive: true, force: true });
});

test("Scene.nextSection records a boundary", () => {
  const s = new Scene();
  s.nextSection("intro");
  assert.equal(s.sections.length, 1);
  assert.equal(s.sections[0].name, "intro");
  assert.equal(s.sections[0].startFrame, 0);
  assert.equal(s.sections[0].type, SectionType.NORMAL);
  s.frameCount = 10;
  s.nextSection("body", SectionType.SKIP, true);
  assert.equal(s.sections.length, 2);
  // Previous section closes at the current frame.
  assert.equal(s.sections[0].endFrame, 10);
  assert.equal(s.sections[1].skipAnimations, true);
});

test("caching reuses a partial movie file on the second render", async () => {
  const dir = tmp("cache");
  const out = join(dir, "c.mp4");
  const construct = async (s: any) => {
    await s.play(new Create(new Circle({ radius: 1 })), { _playConfig: true, runTime: 0.3 });
    await s.wait(0.2);
  };
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  const r1 = await render(construct, { output: out, quality: "low", fps: 6, verbose: false });
  assert.equal(r1.reusedPartials, 0);
  assert.ok(existsSync(join(dir, "partial")), "partial cache dir created");
  const r2 = await render(construct, { output: out, quality: "low", fps: 6, verbose: false });
  assert.ok(r2.reusedPartials >= 1, "second run reuses at least one partial");
  assert.ok(existsSync(out), "concatenated output exists");
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

test("render(format:png) writes a frame-sequence directory", async () => {
  const out = tmp("seq.mp4");
  const r = await render(async (s: any) => {
    await s.play(new Create(new Circle({ radius: 1 })), { _playConfig: true, runTime: 0.2 });
  }, { output: out, quality: "low", fps: 6, format: "png", verbose: false });
  assert.ok(existsSync(r.output), "frame directory exists");
  assert.ok(statSync(r.output).isDirectory(), "output is a directory");
  assert.ok(r.frames >= 1);
  if (existsSync(r.output)) rmSync(r.output, { recursive: true, force: true });
});

test("CLI checkhealth and plugins run", () => {
  const health = execFileSync("node", [CLI, "checkhealth"], { encoding: "utf8" });
  assert.ok(/checkhealth/.test(health));
  assert.ok(/node/.test(health) && /ffmpeg/.test(health));
  const plugins = execFileSync("node", [CLI, "plugins"], { encoding: "utf8" });
  assert.ok(/Mobjects/.test(plugins));
  assert.ok(/Circle/.test(plugins), "registry lists Circle");
});
