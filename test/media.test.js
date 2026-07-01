import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { ImageMobject } from "../src/mobject/image_mobject.js";
import { SVGMobject, parseXML, parseTransform } from "../src/mobject/svg_mobject.js";
import { Scene } from "../src/scene/Scene.js";
import * as V from "../src/core/math/vector.js";

test("ImageMobject sizes to aspect ratio and positions", () => {
  const fake = { width: 200, height: 100 };
  const im = new ImageMobject(fake, { height: 2, point: [1, 1, 0] });
  assert.ok(Math.abs(im.getHeight() - 2) < 1e-9);
  assert.ok(Math.abs(im.getWidth() - 4) < 1e-9); // aspect 2:1
  assert.ok(V.equals(im.getCenter(), [1, 1, 0], 1e-9));
  assert.equal(im._isImage, true);
});

test("SVGMobject parses shapes into animatable VMobjects", () => {
  const svg = `<svg viewBox="0 0 100 100"><g transform="translate(50,50)">
    <circle cx="0" cy="0" r="40" fill="none" stroke="#58C4DD" stroke-width="4"/>
    <path d="M -20 10 L 0 -25 L 20 10 Z" fill="#FC6255"/>
    <rect x="-6" y="12" width="12" height="18" fill="#83C167"/>
  </g></svg>`;
  const m = new SVGMobject(svg, { height: 3 });
  assert.ok(m.submobjects.length >= 3);
  for (const s of m.submobjects) {
    assert.ok(s.points.every((p) => p.every(Number.isFinite)));
    for (const sp of s.getSubpaths()) assert.equal((sp.length - 1) % 3, 0);
  }
  assert.ok(Math.abs(m.getHeight() - 3) < 0.2);
});

test("XML and transform parsers", () => {
  const tree = parseXML(`<svg><g transform="translate(1,2)"><rect x="0"/></g></svg>`);
  assert.equal(tree.tag, "svg");
  assert.equal(tree.children[0].tag, "g");
  assert.equal(tree.children[0].children[0].tag, "rect");
  assert.deepEqual(parseTransform("matrix(1 0 0 1 5 5)"), [1, 0, 0, 1, 5, 5]);
});

test("Scene.addSound records the clip at the current animation time", () => {
  const scene = new Scene();
  scene.time = 2.5;
  scene.addSound("a.wav", { gain: 0.5 });
  scene.addSound("b.wav", { timeOffset: 0 });
  assert.equal(scene.sounds.length, 2);
  assert.equal(scene.sounds[0].time, 2.5);
  assert.equal(scene.sounds[0].gain, 0.5);
  assert.equal(scene.sounds[1].time, 0);
});

test("Node render muxes sound into the video (audio stream present)", async () => {
  const { render } = await import("../src/node.js");
  const { Circle } = await import("../src/mobject/geometry.js");
  const { Create } = await import("../src/animation/Animation.js");
  const wav = join(tmpdir(), `mjtone_${process.pid}.wav`);
  const out = join(tmpdir(), `mjmedia_${process.pid}.mp4`);
  execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=0.4", wav], { stdio: "ignore" });
  await render(async (scene) => {
    scene.addSound(wav);
    await scene.play(new Create(new Circle({ radius: 1 })), { _playConfig: true, runTime: 0.3 });
  }, { output: out, quality: "low", fps: 10, verbose: false });

  const streams = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", out], { encoding: "utf8" });
  assert.ok(streams.includes("audio"), "output has an audio stream");
  assert.ok(streams.includes("video"));
  for (const f of [wav, out]) if (existsSync(f)) rmSync(f);
});
