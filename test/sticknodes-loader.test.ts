// Stick Nodes (.nodes) importer (epic #61, #73). Fixtures are built by the
// test-only encoder in test/helpers (no third-party sample files).
import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { parseStickNodes, loadStickNodes, StickNodesParseError } from "../src/loaders/sticknodes_loader.ts";
import { unzlibSync, zlibSync } from "fflate";
import { encodeNodes, zlibStored } from "./helpers/sticknodes_encoder.ts";
import type { EncFigure, EncNode } from "./helpers/sticknodes_encoder.ts";
import { Skeleton } from "../src/mobject/skeleton.ts";

const near = (a: number, b: number, eps = 1e-4) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

// root(0) -> torso(1, len 100, 90deg) -> arm(2, len 50, +90deg rel) ; root -> leg(3)
function fig(version: number, build = 72, extra: Partial<EncFigure> = {}): EncFigure {
  const arm: EncNode = { draw: 2, type: 1, length: 50, localAngle: 90, thickness: 20, useSegmentColor: true, color: [255, 0, 0, 128] };
  const torso: EncNode = { draw: 1, type: 0, length: 100, localAngle: 90, thickness: 40, children: [arm] };
  const leg: EncNode = { draw: 3, type: 0, length: 80, localAngle: -90, defaultLocalAngle: -45, thickness: 30 };
  return { version, build, root: { draw: 0, type: -1, children: [torso, leg] }, ...extra };
}

test("parses a raw (big-endian) modern figure into a flat node list", () => {
  const f = parseStickNodes(encodeNodes(fig(423, 72)));
  assert.equal(f.version, 423);
  assert.equal(f.build, 72);
  assert.equal(f.compressed, false);
  assert.deepEqual(f.nodes.map((n) => [n.drawIndex, n.parent]), [[0, null], [1, 0], [2, 1], [3, 0]]);
  assert.equal(f.nodes[0].type, "root");
  assert.equal(f.nodes[1].type, "roundedSegment");
  assert.equal(f.nodes[2].type, "segment");
  near(f.nodes[2].length, 50);
  assert.equal(f.nodes[2].useSegmentColor, true);
  assert.deepEqual(f.nodes[2].color, { r: 255, g: 0, b: 0, a: 128 });
  near(f.nodes[3].defaultLocalAngle, -45);
});

test("parses a zlib-wrapped little-endian figure (stored and real deflate)", () => {
  const raw = encodeNodes(fig(430, 80, { compress: true }));
  const f = parseStickNodes(raw);
  assert.equal(f.compressed, true);
  assert.equal(f.version, 430);
  assert.equal(f.nodes.length, 4);
  // same payload through node's real deflate (dynamic/fixed huffman paths)
  const inner = unzlibSync(raw);
  const real = parseStickNodes(new Uint8Array(deflateSync(inner)));
  assert.deepEqual(real.nodes, f.nodes);
});

test("older versions (no build field, fewer node fields) parse", () => {
  for (const v of [160, 200, 250, 300, 350, 402]) {
    const f = parseStickNodes(encodeNodes(fig(v)));
    assert.equal(f.nodes.length, 4, `v${v}`);
    near(f.nodes[1].length, 100);
    near(f.nodes[1].localAngle, 90);
  }
});

test("every build boundary in the 403 line parses identically", () => {
  for (const b of [10, 20, 21, 36, 38, 39, 40, 41, 45, 46, 48, 50, 51, 56, 57, 63, 64, 65, 67, 72]) {
    const f = parseStickNodes(encodeNodes(fig(403, b)));
    assert.equal(f.nodes.length, 4, `build ${b}`);
    near(f.nodes[2].length, 50);
    assert.deepEqual(f.nodes[2].color, { r: 255, g: 0, b: 0, a: 128 }, `build ${b}`);
  }
});

test("connector nodes, connector end links and polyfills are read", () => {
  const conn: EncNode = { draw: 4, type: 1, length: 10, connector: { localX: 1, localY: 2, percent: 0.5, percentDefault: 0.25, value: 3, method: 1, reversed: true, ancestral: 1.5 } };
  const f0 = fig(423, 72, { polyfills: [{ anchor: 1, color: [1, 2, 3, 4], use: true, attached: [2, 3] }], connectors: [[4, 2]] });
  f0.root.children![0].children!.push(conn);
  const f = parseStickNodes(encodeNodes(f0));
  const c = f.nodes.find((n) => n.drawIndex === 4)!;
  assert.equal(c.connector?.method, "byValue");
  assert.equal(c.connector?.reversed, true);
  near(c.connector!.percentDefault, 0.25);
  assert.equal(c.connector?.endDrawIndex, 2);
  assert.equal(f.polyfills.length, 1);
  assert.deepEqual(f.polyfills[0].attachedDrawIndices, [2, 3]);
  assert.deepEqual(f.polyfills[0].color, { r: 1, g: 2, b: 3, a: 4 });
});

test("malformed input throws StickNodesParseError with a clear reason", () => {
  assert.throws(() => parseStickNodes(new Uint8Array(0)), StickNodesParseError);
  const good = encodeNodes(fig(423));
  assert.throws(() => parseStickNodes(good.subarray(0, good.length - 40)), /truncated|end of data/i);
  assert.throws(() => parseStickNodes(Uint8Array.from([0x50, 0x4b, 3, 4, 0, 0, 0, 0])), /project|zip|\.stknds/i);
  assert.throws(() => parseStickNodes(new Uint8Array([0x78, 0x9c, 0xff, 0xff])), StickNodesParseError);
  // duplicate draw indices
  const dup = fig(423); dup.root.children![1].draw = 1;
  assert.throws(() => parseStickNodes(encodeNodes(dup)), /duplicate/i);
});

test("newer-than-known versions and trailing bytes become warnings, not failures", () => {
  const f = parseStickNodes(encodeNodes(fig(423, 99)));
  assert.ok(f.warnings.some((w) => /newer|build/i.test(w)));
  const t = parseStickNodes(encodeNodes(fig(430, 80, { compress: true, trailing: [1, 2, 3] })));
  assert.ok(t.warnings.some((w) => /trailing/i.test(w)));
});

test("parser is pure: input bytes are not mutated", () => {
  const b = encodeNodes(fig(423));
  const copy = b.slice();
  parseStickNodes(b);
  assert.deepEqual(b, copy);
});

test("loadStickNodes builds a Skeleton whose FK matches the file's node chain", () => {
  const r = loadStickNodes(encodeNodes(fig(423)), { unitsPerPixel: 0.01 });
  assert.ok(r.skeleton instanceof Skeleton);
  const m = r.skeleton.model;
  assert.deepEqual([...m.ids].sort(), ["n1", "n2", "n3"]);
  assert.equal(m.parentOf("n2"), "n1");
  assert.equal(m.parentOf("n1"), null);
  // torso: 100px up (90deg) -> (0,1); arm: 50px at 90+90=180deg -> (-0.5, 1)
  const t = m.jointPosition("n1"); near(t[0], 0); near(t[1], 1);
  const a = m.jointPosition("n2"); near(a[0], -0.5); near(a[1], 1);
  const l = m.jointPosition("n3"); near(l[0], 0); near(l[1], -0.8);
  assert.equal(r.meta.nodeCount, 4);
  assert.equal(r.meta.version, 423);
  assert.equal(r.meta.boneIdByDrawIndex[2], "n2");
});

test("root node angle rotates the whole figure; flipY mirrors it", () => {
  const f = fig(423); f.root.localAngle = 90;
  const r = loadStickNodes(encodeNodes(f));
  const t = r.skeleton.model.jointPosition("n1"); // torso world 180deg
  near(t[0], -1); near(t[1], 0);
  const fl = loadStickNodes(encodeNodes(fig(423)), { flipY: true });
  const t2 = fl.skeleton.model.jointPosition("n1"); near(t2[1], -1);
});

test("poses: current pose and the file's default pose; track samples the current pose", () => {
  const r = loadStickNodes(encodeNodes(fig(423)));
  assert.deepEqual(r.poses.names().sort(), ["default", "pose"]);
  const def = r.poses.get("default")!;
  near(def.bones!.n3.angle!, (-45 * Math.PI) / 180);
  const cur = r.poses.get("pose")!;
  near(cur.bones!.n3.angle!, (-90 * Math.PI) / 180);
  const sampled = r.track.valueAt(0.7);
  near(sampled.bones.n3.angle, (-90 * Math.PI) / 180);
  r.skeleton.bindPoseTrack(r.track);
  r.skeleton.setTime(1);
  near(r.skeleton.model.jointPosition("n3")[1], -0.8);
  // default pose applies and tweens through the library
  r.poses.apply(r.skeleton, "default");
  near(r.skeleton.model.getAngle("n3"), (-45 * Math.PI) / 180);
});

test("styling: thickness -> stroke width, segment colour/alpha applied, figure colour default", () => {
  const r = loadStickNodes(encodeNodes(fig(423, 72, { color: [0, 255, 0, 255] })), { unitsPerPixel: 0.01 });
  const arm = r.skeleton.getBoneMobject("n2");
  assert.equal(arm.strokeColor.toHex?.().toLowerCase(), "#ff0000");
  near(arm.strokeOpacity, 128 / 255, 1e-3);
  near(arm.strokeWidth, 20 * 0.01 * 135, 1e-3);
  const torso = r.skeleton.getBoneMobject("n1");
  assert.equal(torso.strokeColor.toHex?.().toLowerCase(), "#00ff00");
});

test("unsupported features are reported as warnings with draw indices", () => {
  const f = fig(423);
  f.root.children![0].isFloaty = true;
  f.root.children![1].angleLocked = true;
  f.root.children![1].type = 2; // circle node
  f.polyfills = [{ anchor: 1, color: [0, 0, 0, 255], use: false, attached: [2] }];
  const r = loadStickNodes(encodeNodes(f));
  const text = r.meta.warnings.join("\n");
  assert.match(text, /floaty/i);
  assert.match(text, /angle.?lock/i);
  assert.match(text, /circle/i);
  assert.match(text, /polyfill/i);
  assert.ok(r.skeleton instanceof Skeleton); // still loads
});

test("zlib-wrapped figures load through loadStickNodes too", () => {
  const r = loadStickNodes(encodeNodes(fig(430, 80, { compress: true })));
  assert.equal(r.meta.compressed, true);
  assert.equal(r.skeleton.model.ids.length, 3);
});

test("zlib bodies: stored, fixed and dynamic blocks all load; corrupt or oversized input is rejected", () => {
  const raw = encodeNodes(fig(430, 80, { compress: true }));
  const inner = unzlibSync(raw);
  const want = parseStickNodes(raw).nodes;
  for (const level of [1, 6, 9] as const) assert.deepEqual(parseStickNodes(zlibSync(inner, { level })).nodes, want);
  assert.deepEqual(parseStickNodes(zlibStored(inner)).nodes, want);
  assert.throws(() => parseStickNodes(new Uint8Array([0x78, 0x9c, 0x07])), StickNodesParseError);
  const truncated = raw.slice(0, raw.length - 12);
  assert.throws(() => parseStickNodes(truncated), StickNodesParseError);
  // decompression bomb: ~70 MiB of zeros compresses to ~70 KiB
  const bomb = zlibSync(new Uint8Array(70 * 1024 * 1024), { level: 9 });
  assert.ok(bomb.length < 1024 * 1024);
  assert.throws(() => parseStickNodes(bomb), /limit/);
});

test("loader source is node-free and credits sticknodes-rs", () => {
  for (const f of ["src/loaders/sticknodes_loader.ts"]) {
    const s = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.ok(!/from\s+["']node:/.test(s), `${f} imports node:`);
  }
  const s = readFileSync(new URL("../src/loaders/sticknodes_loader.ts", import.meta.url), "utf8");
  assert.match(s, /sticknodes-rs/);
  assert.match(s, /MIT/);
});
