import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { cliEncoderOption } from "../src/core/cli_encoder.ts";

const CLI = fileURLToPath(new URL("../bin/ecmanim.ts", import.meta.url));

test("cliEncoderOption: absent flag adds nothing (existing invocations unchanged)", () => {
  assert.deepEqual(cliEncoderOption({}), {});
  assert.deepEqual(cliEncoderOption({ format: "mp4" }), {});
  assert.deepEqual(cliEncoderOption({ format: "gif" }), {});
});

test("cliEncoderOption: accepts ffmpeg|js", () => {
  assert.deepEqual(cliEncoderOption({ encoder: "js", format: "gif" }), { encoder: "js" });
  assert.deepEqual(cliEncoderOption({ encoder: "js", format: "apng" }), { encoder: "js" });
  assert.deepEqual(cliEncoderOption({ encoder: "ffmpeg", format: "mp4" }), { encoder: "ffmpeg" });
});

test("cliEncoderOption: rejects unknown encoder and js with video formats", () => {
  assert.throws(() => cliEncoderOption({ encoder: "wasm" }), /unknown --encoder/);
  assert.throws(() => cliEncoderOption({ encoder: true }), /unknown --encoder/);
  for (const f of ["mp4", "webm", "mov", undefined]) {
    assert.throws(() => cliEncoderOption({ encoder: "js", format: f }), /--encoder js/);
  }
  assert.throws(() => cliEncoderOption({ encoder: "js", format: "png" }), /--encoder js/);
});

const dir = join(tmpdir(), `mjclienc_${process.pid}`);
const scene = join(dir, "s.ts");
const srcUrl = (p: string) => JSON.stringify(fileURLToPath(new URL(p, import.meta.url)));

function setup() {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  writeFileSync(scene, `import { Scene } from ${srcUrl("../src/scene/Scene.ts")};
import { Circle } from ${srcUrl("../src/mobject/geometry.ts")};
import { Create } from ${srcUrl("../src/animation/Animation.ts")};
export default class S extends Scene { async construct() { await this.play(new Create(new Circle({ radius: 1 })), { runTime: 0.2 }); } }
`);
}
function run(...a: string[]) {
  return spawnSync(process.execPath, [CLI, "render", scene, ...a], { cwd: dir, encoding: "utf8" });
}

test("CLI renders --format apng and --format zip", () => {
  setup();
  for (const f of ["apng", "zip"]) {
    const out = join(dir, `o.${f}`);
    const r = run("-f", f, "-q", "low", "--fps", "6", "-o", out);
    assert.equal(r.status, 0, r.stderr);
    const b = readFileSync(out);
    assert.equal(b.subarray(0, 4).toString("hex"), f === "apng" ? "89504e47" : "504b0304");
  }
  rmSync(dir, { recursive: true, force: true });
});

test("CLI renders gif with --encoder js (no ffmpeg path)", () => {
  setup();
  const out = join(dir, "o.gif");
  const r = run("-f", "gif", "--encoder", "js", "-q", "low", "--fps", "6", "-o", out);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(out).subarray(0, 3).toString(), "GIF");
  rmSync(dir, { recursive: true, force: true });
});

test("CLI errors for --encoder js with mp4 and for unknown encoder", () => {
  setup();
  const a = run("-f", "mp4", "--encoder", "js", "-o", join(dir, "o.mp4"));
  assert.notEqual(a.status, 0);
  assert.match(a.stderr, /--encoder js/);
  const b = run("--encoder", "bogus");
  assert.notEqual(b.status, 0);
  assert.match(b.stderr, /unknown --encoder/);
  assert.ok(!existsSync(join(dir, "o.mp4")));
  rmSync(dir, { recursive: true, force: true });
});
