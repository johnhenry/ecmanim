import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeFormat, partialExtension, resolveOutputFormat, isJsEncoderFormat,
} from "../src/core/render_format.ts";

// The OLD inline logic from node.ts render() / node-parallel.ts resolveRender(),
// copied verbatim so the shared function is proven equivalent for every
// pre-existing format string (epic #61, #70).
function legacyNode(options: { format?: string; output?: string; transparent?: boolean }) {
  const transparent = options.transparent ?? false;
  let output = options.output ?? "output.mp4";
  let format = options.format ?? "mp4";
  if (format === "png") format = "png-sequence";
  if (transparent && format === "mp4") {
    format = "mov";
    output = output.replace(/\.mp4$/i, ".mov");
    if (!/\.mov$/i.test(output)) output += ".mov";
  }
  if (transparent && format === "mov") {
    if (!/\.mov$/i.test(output)) output = output.replace(/\.[^.]+$/, ".mov");
  }
  return { format, output };
}
function legacyParallel(options: { format?: string }) {
  let format = options.format ?? "mp4";
  if (format === "png") format = "png-sequence";
  const partialExt = format === "webm" ? "webm" : format === "mov" ? "mov" : "mp4";
  return { format, partialExt };
}

const FORMATS = [undefined, "mp4", "png-sequence", "png", "webm", "gif", "mov", "svg", "weird"];
const OUTPUTS = [undefined, "out.mp4", "a/b/out.MP4", "out.webm", "out.mov", "out", "out.gif"];

test("resolveOutputFormat matches the legacy node.ts logic for every existing format/output/transparent combo", () => {
  for (const format of FORMATS) for (const output of OUTPUTS) for (const transparent of [undefined, false, true]) {
    const want = legacyNode({ format, output, transparent });
    const got = resolveOutputFormat({ format, output, transparent });
    assert.deepEqual(got, want, JSON.stringify({ format, output, transparent }));
  }
});

test("normalizeFormat + partialExtension match the legacy node-parallel.ts logic", () => {
  for (const format of FORMATS) {
    const want = legacyParallel({ format });
    const f = normalizeFormat(format);
    assert.equal(f, want.format);
    assert.equal(partialExtension(f), want.partialExt);
  }
});

test("new formats: apng / zip are JS-only and get a matching default output name", () => {
  assert.deepEqual(resolveOutputFormat({ format: "apng" }), { format: "apng", output: "output.apng" });
  assert.deepEqual(resolveOutputFormat({ format: "zip" }), { format: "zip", output: "output.zip" });
  assert.deepEqual(resolveOutputFormat({ format: "apng", output: "x/y.png" }), { format: "apng", output: "x/y.png" });
  // transparent does not rewrite them (alpha is native)
  assert.deepEqual(resolveOutputFormat({ format: "apng", transparent: true, output: "a.apng" }), { format: "apng", output: "a.apng" });
  assert.equal(partialExtension("apng"), "mp4"); // unused: JS formats never use partials
});

test("isJsEncoderFormat", () => {
  assert.equal(isJsEncoderFormat("apng"), true);
  assert.equal(isJsEncoderFormat("zip"), true);
  assert.equal(isJsEncoderFormat("gif"), false);
  assert.equal(isJsEncoderFormat("gif", "ffmpeg"), false);
  assert.equal(isJsEncoderFormat("gif", "js"), true);
  for (const f of ["mp4", "webm", "mov", "png-sequence", "svg"]) assert.equal(isJsEncoderFormat(f, "ffmpeg"), false);
});

test('encoder:"js" with mp4/webm/mov (and transparent mp4) throws a clear error', () => {
  for (const format of ["mp4", "webm", "mov", undefined]) {
    assert.throws(() => resolveOutputFormat({ format, encoder: "js" }), /encoder: "js".*(apng|zip|gif)/s);
  }
  assert.throws(() => resolveOutputFormat({ format: "mp4", encoder: "js", transparent: true }), /encoder: "js"/);
  assert.throws(() => resolveOutputFormat({ format: "gif", encoder: "bogus" as any }), /unknown encoder/);
  // allowed combos
  assert.deepEqual(resolveOutputFormat({ format: "gif", encoder: "js", output: "a.gif" }), { format: "gif", output: "a.gif" });
  assert.deepEqual(resolveOutputFormat({ format: "png", encoder: "js" }), { format: "png-sequence", output: "output.mp4" });
  assert.deepEqual(resolveOutputFormat({ format: "apng", encoder: "ffmpeg" }), { format: "apng", output: "output.apng" });
});
