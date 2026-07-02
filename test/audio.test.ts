import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { fftInPlace, magnitudeSpectrum, nextPow2 } from "../src/audio/fft.ts";
import { getAudioData, visualizeAudio, getWaveformPortion, createSmoothSvgPath } from "../src/audio/analyze.ts";

function ffmpegAvailable() {
  try { execSync("ffmpeg -version", { stdio: "ignore" }); return true; } catch { return false; }
}

test("nextPow2", () => {
  assert.equal(nextPow2(1), 1);
  assert.equal(nextPow2(3), 4);
  assert.equal(nextPow2(1024), 1024);
  assert.equal(nextPow2(1025), 2048);
});

test("fftInPlace of a delta yields flat magnitude", () => {
  const N = 8;
  const re = new Float64Array(N); const im = new Float64Array(N);
  re[0] = 1; // impulse → all bins magnitude 1
  fftInPlace(re, im);
  for (let i = 0; i < N; i++) assert.ok(Math.abs(Math.hypot(re[i], im[i]) - 1) < 1e-9);
});

test("magnitudeSpectrum peaks at the bin of a pure sine", () => {
  const size = 1024;
  const sr = 1024; // 1 sample/Hz for easy bin math
  const freqBin = 64; // cycles across the window
  const buf = new Float32Array(size);
  for (let i = 0; i < size; i++) buf[i] = Math.sin((2 * Math.PI * freqBin * i) / size);
  const spec = magnitudeSpectrum(buf, size);
  // Find the peak bin; should be near freqBin.
  let peak = 0, peakIdx = 0;
  for (let i = 1; i < spec.length; i++) if (spec[i] > peak) { peak = spec[i]; peakIdx = i; }
  assert.ok(Math.abs(peakIdx - freqBin) <= 2, `peak at ${peakIdx}, expected ~${freqBin}`);
  void sr;
});

test("visualizeAudio returns numberOfSamples values in [0,1]", () => {
  const sr = 44100;
  const wave = new Float32Array(sr); // 1s
  for (let i = 0; i < sr; i++) wave[i] = Math.sin((2 * Math.PI * 440 * i) / sr);
  const audioData = { channelWaveforms: [wave], sampleRate: sr, durationInSeconds: 1, numberOfChannels: 1 };
  const bins = visualizeAudio({ audioData, frame: 15, fps: 30, numberOfSamples: 16 });
  assert.equal(bins.length, 16);
  for (const b of bins) assert.ok(b >= 0 && b <= 1);
  assert.ok(bins.some((b) => b > 0), "a 440Hz tone excites some bins");
});

test("getWaveformPortion returns amplitude slice", () => {
  const sr = 1000;
  const wave = new Float32Array(sr);
  for (let i = 0; i < sr; i++) wave[i] = i < 500 ? 1 : -1;
  const audioData = { channelWaveforms: [wave], sampleRate: sr, durationInSeconds: 1, numberOfChannels: 1 };
  const w = getWaveformPortion({ audioData, startTimeInSeconds: 0, durationInSeconds: 1, numberOfSamples: 4 });
  assert.equal(w.length, 4);
  assert.ok(w[0] > 0 && w[3] < 0);
});

test("createSmoothSvgPath builds a valid path", () => {
  const d = createSmoothSvgPath([[0, 0], [1, 1], [2, 0], [3, 1]]);
  assert.match(d, /^M 0 0/);
  assert.match(d, /C /);
  assert.ok(!/NaN|undefined/.test(d));
});

test("getAudioData decodes a synthesized clip (skips without ffmpeg)", { skip: !ffmpegAvailable() }, async () => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const dir = mkdtempSync(path.join(os.tmpdir(), "mjs-audio-"));
  const clip = path.join(dir, "tone.wav");
  execSync(`ffmpeg -v error -f lavfi -i "sine=frequency=440:duration=1" -ar 44100 -ac 1 -y ${clip}`);
  try {
    const data = await getAudioData(clip, { sampleRate: 44100, channels: 1 });
    assert.equal(data.sampleRate, 44100);
    assert.ok(Math.abs(data.durationInSeconds - 1) < 0.1);
    assert.equal(data.channelWaveforms.length, 1);
    assert.ok(data.channelWaveforms[0].length > 40000);
    // A 440Hz tone should be non-silent.
    assert.ok(data.channelWaveforms[0].some((s) => Math.abs(s) > 0.1));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
