import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toISODuration, metaDuration, chaptersFrom,
  toVideoObject, toVideoObjectScript,
  toIIIFManifest, resolveIIIFVideo, isIIIFManifest,
  IPTC_ALGORITHMIC_MEDIA, MANIM_JS_VERSION,
} from "../src/metadata.ts";

// A render-result-ish input: 150 frames @ 30fps = 5s, 1920x1080, 2 sections.
const SAMPLE = {
  frames: 150, fps: 30, width: 1920, height: 1080,
  id: "https://ex.org/v/42",
  contentUrl: "https://ex.org/v/42.mp4",
  name: "Intro", description: "A demo", uploadDate: "2026-07-02",
  encodingFormat: "video/mp4",
  sections: [
    { name: "Opening", startFrame: 0, endFrame: 60 },   // 0..2s
    { name: "Reveal", startFrame: 60, endFrame: 150 },   // 2..5s
  ],
};

test("toISODuration formats H/M/S and drops empty parts", () => {
  assert.equal(toISODuration(0), "PT0S");
  assert.equal(toISODuration(5), "PT5S");
  assert.equal(toISODuration(90), "PT1M30S");
  assert.equal(toISODuration(3661), "PT1H1M1S");
  assert.equal(toISODuration(2.5), "PT2.5S");
});

test("metaDuration derives from frames/fps or explicit seconds", () => {
  assert.equal(metaDuration({ frames: 150, fps: 30 }), 5);
  assert.equal(metaDuration({ durationSeconds: 12 }), 12);
  assert.equal(metaDuration({}), 0);
});

test("chaptersFrom maps sections to seconds (explicit chapters win)", () => {
  const ch = chaptersFrom(SAMPLE);
  assert.equal(ch.length, 2);
  assert.deepEqual(ch[0], { label: "Opening", start: 0, end: 2 });
  assert.deepEqual(ch[1], { label: "Reveal", start: 2, end: 5 });
  const explicit = chaptersFrom({ ...SAMPLE, chapters: [{ label: "X", start: 1, end: 2 }] });
  assert.equal(explicit.length, 1);
  assert.equal(explicit[0].label, "X");
});

test("toVideoObject emits schema.org JSON-LD with duration, chapters, provenance", () => {
  const v = toVideoObject({ ...SAMPLE, provenance: true });
  assert.equal(v["@context"], "https://schema.org");
  assert.equal(v["@type"], "VideoObject");
  assert.equal(v.name, "Intro");
  assert.equal(v.duration, "PT5S");
  assert.equal(v.contentUrl, "https://ex.org/v/42.mp4");
  assert.equal(v.width, 1920);
  assert.equal(v.encodingFormat, "video/mp4");
  // chapters -> hasPart Clips
  assert.equal(v.hasPart.length, 2);
  assert.equal(v.hasPart[0]["@type"], "Clip");
  assert.equal(v.hasPart[1].startOffset, 2);
  // provenance
  assert.equal(v.creator["@type"], "SoftwareApplication");
  assert.equal(v.creator.name, "ecmanim");
  assert.equal(v.creator.softwareVersion, MANIM_JS_VERSION);
  assert.equal(v.additionalProperty[0].value, IPTC_ALGORITHMIC_MEDIA);
});

test("toVideoObject omits absent fields and provenance when not requested", () => {
  const v = toVideoObject({ frames: 30, fps: 30 });
  assert.equal(v.duration, "PT1S");
  assert.equal("name" in v, false);
  assert.equal("contentUrl" in v, false);
  assert.equal("creator" in v, false);
  assert.equal("additionalProperty" in v, false);
});

test("toVideoObjectScript wraps valid JSON in a ld+json script tag", () => {
  const s = toVideoObjectScript(SAMPLE);
  assert.match(s, /^<script type="application\/ld\+json">/);
  assert.match(s, /<\/script>$/);
  const json = s.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
  const parsed = JSON.parse(json);
  assert.equal(parsed["@type"], "VideoObject");
});

test("toIIIFManifest builds a valid v3 shape: Manifest -> Canvas -> painting Video", () => {
  const m = toIIIFManifest({ ...SAMPLE, provenance: true });
  assert.equal(m["@context"], "http://iiif.io/api/presentation/3/context.json");
  assert.equal(m.type, "Manifest");
  assert.deepEqual(m.label, { none: ["Intro"] });
  assert.equal(m.items.length, 1);
  const canvas = m.items[0];
  assert.equal(canvas.type, "Canvas");
  assert.equal(canvas.duration, 5);
  assert.equal(canvas.width, 1920);
  const anno = canvas.items[0].items[0];
  assert.equal(anno.motivation, "painting");
  assert.equal(anno.body.type, "Video");
  assert.equal(anno.body.id, "https://ex.org/v/42.mp4");
  assert.equal(anno.body.duration, 5);
  assert.equal(anno.target, canvas.id);
  // structures (chapters) as Ranges with temporal fragments
  assert.equal(m.structures.length, 2);
  assert.equal(m.structures[0].type, "Range");
  assert.match(m.structures[0].items[0].id, /#t=0,2$/);
  assert.match(m.structures[1].items[0].id, /#t=2,5$/);
  // provenance metadata
  assert.ok(m.metadata.some((e: any) => e.value.none[0].includes("ecmanim")));
});

test("resolveIIIFVideo round-trips toIIIFManifest (url, dims, duration, chapters)", () => {
  const m = toIIIFManifest(SAMPLE);
  const r = resolveIIIFVideo(m);
  assert.equal(r.url, "https://ex.org/v/42.mp4");
  assert.equal(r.width, 1920);
  assert.equal(r.height, 1080);
  assert.equal(r.duration, 5);
  assert.equal(r.chapters.length, 2);
  assert.deepEqual(r.chapters[0], { label: "Opening", start: 0, end: 2 });
  assert.deepEqual(r.chapters[1], { label: "Reveal", start: 2, end: 5 });
});

test("resolveIIIFVideo tolerates a body array and a Choice wrapper", () => {
  const canvasId = "https://ex.org/c/1";
  const mkManifest = (body: any) => ({
    type: "Manifest",
    items: [{
      type: "Canvas", id: canvasId, duration: 3, width: 640, height: 360,
      items: [{ type: "AnnotationPage", items: [{ type: "Annotation", motivation: "painting", body, target: canvasId }] }],
    }],
  });
  const asArray = resolveIIIFVideo(mkManifest([{ type: "Video", id: "a.mp4", format: "video/mp4" }]));
  assert.equal(asArray.url, "a.mp4");
  const asChoice = resolveIIIFVideo(mkManifest({ type: "Choice", items: [{ type: "Video", id: "b.mp4" }] }));
  assert.equal(asChoice.url, "b.mp4");
});

test("resolveIIIFVideo throws clearly on non-manifests / missing video", () => {
  assert.throws(() => resolveIIIFVideo(null), /not a IIIF manifest/);
  assert.throws(() => resolveIIIFVideo({ type: "Manifest", items: [] }), /no Canvas/);
});

test("isIIIFManifest detects manifests by type or @context", () => {
  assert.equal(isIIIFManifest({ type: "Manifest" }), true);
  assert.equal(isIIIFManifest({ "@context": "http://iiif.io/api/presentation/3/context.json" }), true);
  assert.equal(isIIIFManifest({ "@context": "https://schema.org", "@type": "VideoObject" }), false);
  assert.equal(isIIIFManifest("clip.mp4"), false);
  assert.equal(isIIIFManifest(null), false);
});
