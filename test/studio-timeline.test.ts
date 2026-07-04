import { test } from "node:test";
import assert from "node:assert/strict";

import {
  timeToPixel, pixelToTime, frameToPixel, pixelToFrame,
  computeSectionThumbnails, renderSectionOverview, computeStepMarkers,
} from "../src/studio/timeline.ts";

test("timeToPixel / pixelToTime round-trip", () => {
  const opts = { duration: 10, pixelWidth: 500 };
  assert.equal(timeToPixel(5, opts), 250);
  assert.equal(timeToPixel(0, opts), 0);
  assert.equal(timeToPixel(10, opts), 500);
  assert.equal(pixelToTime(250, opts), 5);
});

test("frameToPixel / pixelToFrame round-trip", () => {
  const opts = { totalFrames: 300, pixelWidth: 600 };
  assert.equal(frameToPixel(150, opts), 300);
  assert.equal(pixelToFrame(300, opts), 150);
});

test("computeSectionThumbnails positions each section proportionally, clamped to minWidth", () => {
  const sections = [
    { name: "intro", startFrame: 0, endFrame: 10 },
    { name: "main", startFrame: 10, endFrame: 90 },
    { name: "outro", startFrame: 90, endFrame: 100 },
  ];
  const layout = computeSectionThumbnails(sections, { totalFrames: 100, pixelWidth: 1000, minWidth: 5 });
  assert.equal(layout.length, 3);
  assert.equal(layout[0].x, 0);
  assert.equal(layout[0].width, 100); // 10/100 * 1000
  assert.equal(layout[1].x, 100);
  assert.equal(layout[1].width, 800); // 80/100 * 1000
  assert.equal(layout[2].x, 900);
  assert.equal(layout[2].width, 100);
});

test("computeSectionThumbnails clamps a very short section to minWidth", () => {
  const sections = [{ name: "blip", startFrame: 0, endFrame: 1 }];
  const layout = computeSectionThumbnails(sections, { totalFrames: 1000, pixelWidth: 1000, minWidth: 24 });
  assert.equal(layout[0].width, 24); // raw would be 1px, clamped up
});

test("computeSectionThumbnails treats an open (endFrame < 0) section as extending to totalFrames", () => {
  const sections = [{ name: "live", startFrame: 50, endFrame: -1 }];
  const layout = computeSectionThumbnails(sections, { totalFrames: 100, pixelWidth: 1000 });
  assert.equal(layout[0].x, 500);
  assert.equal(layout[0].width, 500);
});

test("renderSectionOverview draws one thumbnail per section at its computed position", () => {
  const calls: any[] = [];
  const fakePlayer = {
    sections: () => [
      { name: "a", startFrame: 0, endFrame: 50 },
      { name: "b", startFrame: 50, endFrame: 100 },
    ],
    frameCount: 100,
    drawFrameTo: (ctx: any, frameIndex: number, opts: any) => calls.push({ frameIndex, opts }),
  };
  const layout = renderSectionOverview({}, fakePlayer, { pixelWidth: 200, height: 40 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].frameIndex, 0);
  assert.equal(calls[0].opts.x, 0);
  assert.equal(calls[1].frameIndex, 50);
  assert.equal(calls[1].opts.x, 100);
  assert.equal(layout.length, 2);
});

test("computeStepMarkers positions one marker per step at its start frame", () => {
  const steps = [
    { index: 0, startFrame: 0 },
    { index: 1, startFrame: 25 },
    { index: 2, startFrame: 75 },
  ];
  const markers = computeStepMarkers(steps, { totalFrames: 100, pixelWidth: 400 });
  assert.deepEqual(markers.map((m) => m.x), [0, 100, 300]);
});
