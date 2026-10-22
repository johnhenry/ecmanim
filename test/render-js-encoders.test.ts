// Node render() with the first-party JS encoders (epic #61, #70): format
// "apng" | "zip", and format "gif" + encoder:"js". The default gif path must
// stay on ffmpeg.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status === 0;

async function mkScene() {
  const { Circle } = await import("../src/mobject/geometry.ts");
  return async (s: any) => {
    s.add(new Circle({ radius: 1 }));
    await s.wait(0.5);
  };
}
const OPTS = { quality: "low", fps: 10, resolution: [64, 36] as [number, number], disableCaching: true };

function chunkTypes(b: Uint8Array): string[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: string[] = [];
  for (let o = 8; o < b.length; o += 12 + v.getUint32(o)) out.push(String.fromCharCode(...b.subarray(o + 4, o + 8)));
  return out;
}

test('render({format:"apng"}) writes a valid APNG with one frame per emitted frame', async () => {
  const { render } = await import("../src/node.ts");
  const dir = mkdtempSync(join(tmpdir(), "js-apng-"));
  try {
    const out = join(dir, "o.apng");
    const res = await render(await mkScene(), { ...OPTS, output: out, format: "apng" });
    assert.equal(res.output, out);
    const b = new Uint8Array(readFileSync(out));
    const types = chunkTypes(b);
    assert.equal(types[0], "IHDR"); assert.equal(types[1], "acTL"); assert.equal(types.at(-1), "IEND");
    assert.equal(types.filter((t) => t === "fcTL").length, res.frames);
    assert.equal(new DataView(b.buffer, b.byteOffset).getUint32(8 + 8 + 13 + 4 + 8), res.frames); // acTL.num_frames
    assert.ok(res.frames >= 5);
    assert.deepEqual(readdirSync(dir), ["o.apng"], "no temp files left");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('render({format:"zip"}) writes a ZIP of numbered PNGs + animation.json', async () => {
  const { render } = await import("../src/node.ts");
  const dir = mkdtempSync(join(tmpdir(), "js-zip-"));
  try {
    const out = join(dir, "o.zip");
    const res = await render(await mkScene(), { ...OPTS, output: out, format: "zip" });
    const b = new Uint8Array(readFileSync(out));
    const v = new DataView(b.buffer, b.byteOffset);
    const eocd = b.length - 22;
    assert.equal(v.getUint32(eocd, true), 0x06054b50);
    assert.equal(v.getUint16(eocd + 10, true), res.frames + 1);
    // last central entry is animation.json -> read it via its local header
    let o = v.getUint32(eocd + 16, true), last = o;
    for (let i = 0; i < res.frames + 1; i++) { last = o; o += 46 + v.getUint16(o + 28, true) + v.getUint16(o + 30, true) + v.getUint16(o + 32, true); }
    const lho = v.getUint32(last + 42, true);
    const csize = v.getUint32(lho + 18, true);
    const data = b.subarray(lho + 30 + v.getUint16(lho + 26, true), lho + 30 + v.getUint16(lho + 26, true) + csize);
    const m = JSON.parse(new TextDecoder().decode(v.getUint16(lho + 8, true) === 8 ? inflateRawSync(data) : data));
    assert.equal(m.frameCount, res.frames); assert.equal(m.fps, 10); assert.equal(m.width, 64); assert.equal(m.height, 36);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('render({format:"gif", encoder:"js"}) writes a GIF without ffmpeg', async () => {
  const { render } = await import("../src/node.ts");
  const dir = mkdtempSync(join(tmpdir(), "js-gif-"));
  const savedPath = process.env.PATH;
  try {
    process.env.PATH = "/nonexistent"; // prove ffmpeg is not needed
    const out = join(dir, "o.gif");
    const res = await render(await mkScene(), { ...OPTS, output: out, format: "gif", encoder: "js" });
    const b = readFileSync(out);
    assert.equal(b.subarray(0, 6).toString("latin1"), "GIF89a");
    assert.equal(b.readUInt16LE(6), 64);
    let n = 0;
    for (let i = 0; i < b.length - 3; i++) if (b[i] === 0x21 && b[i + 1] === 0xf9 && b[i + 2] === 4) n++;
    assert.equal(n, res.frames);
  } finally { process.env.PATH = savedPath; rmSync(dir, { recursive: true, force: true }); }
});

test('render({encoder:"js", format:"mp4"|"webm"|"mov"}) throws before rendering', async () => {
  const { render } = await import("../src/node.ts");
  for (const format of ["mp4", "webm", "mov"]) {
    await assert.rejects(() => render(async () => {}, { ...OPTS, format, encoder: "js", output: join(tmpdir(), "never." + format) }), /encoder: "js"/);
  }
});

test("default gif path is unchanged: still encoded by ffmpeg (palettegen), not the JS encoder", { skip: !hasFfmpeg && "ffmpeg not available" }, async () => {
  const { render } = await import("../src/node.ts");
  const dir = mkdtempSync(join(tmpdir(), "ff-gif-"));
  try {
    const a = join(dir, "a.gif"), b = join(dir, "b.gif");
    const scene = await mkScene();
    await render(scene, { ...OPTS, output: a, format: "gif" });
    await render(scene, { ...OPTS, output: b, format: "gif", encoder: "ffmpeg" });
    const A = readFileSync(a), B = readFileSync(b);
    assert.equal(A.subarray(0, 6).toString("latin1"), "GIF89a");
    assert.ok(A.equals(B), "encoder:'ffmpeg' is byte-identical to the default");
    assert.ok(A.includes(Buffer.from("NETSCAPE2.0")), "ffmpeg gif carries its loop extension");
    // gifenc writes no "Lavc"/ffmpeg marker either way; the real distinguisher is that the JS
    // path was not taken: rendering the same scene with encoder:"js" must differ in bytes.
    const c = join(dir, "c.gif");
    await render(scene, { ...OPTS, output: c, format: "gif", encoder: "js" });
    assert.ok(!readFileSync(c).equals(A));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("ffprobe validates a rendered APNG (optional)", { skip: !hasFfmpeg && "ffmpeg not available" }, async () => {
  const { render } = await import("../src/node.ts");
  const dir = mkdtempSync(join(tmpdir(), "js-apng-probe-"));
  try {
    const out = join(dir, "o.apng");
    const res = await render(await mkScene(), { ...OPTS, output: out, format: "apng" });
    const r = spawnSync("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=codec_name,nb_read_frames", "-of", "json", out], { encoding: "utf8" });
    const s = JSON.parse(r.stdout).streams[0];
    assert.equal(s.codec_name, "apng");
    assert.equal(Number(s.nb_read_frames), res.frames);
    assert.ok(existsSync(out));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ---- browser dispatcher, driven with a Node canvas standing in for the DOM one
test("browser recordApng / recordZip / recordVideo({format}) produce valid blobs", async () => {
  const { recordApng, recordZip, recordVideo } = await import("../src/browser.ts");
  const { createCanvas } = await import("@napi-rs/canvas");
  const scene = await mkScene();
  const o = () => ({ canvas: createCanvas(1, 1), pixelWidth: 32, pixelHeight: 18, fps: 10 });
  const apng = await recordApng(scene, o());
  assert.equal(apng.type, "image/apng");
  const ab = new Uint8Array(await apng.arrayBuffer());
  assert.deepEqual(chunkTypes(ab).slice(0, 2), ["IHDR", "acTL"]);
  const viaDispatch = await recordVideo(scene, { ...o(), format: "apng" });
  assert.deepEqual(new Uint8Array(await viaDispatch.arrayBuffer()), ab, "recordVideo apng === recordApng");
  const zip = await recordZip(scene, o());
  assert.equal(zip.type, "application/zip");
  const zb = new Uint8Array(await zip.arrayBuffer());
  assert.equal(new DataView(zb.buffer).getUint32(0, true), 0x04034b50);
  const viaZip = await recordVideo(scene, { ...o(), format: "zip" });
  assert.equal(viaZip.size, zip.size);
  await assert.rejects(() => recordVideo(scene, { ...o(), format: "bogus" as any }), /apng.*zip/);
});
