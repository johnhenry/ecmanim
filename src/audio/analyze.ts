// Audio analysis for audio-reactive animation (adapted from Remotion's
// @remotion/media-utils): decode audio to PCM, get per-frame frequency spectra
// (visualizeAudio), waveform slices, and a smooth SVG path builder. Decoding is
// backend-specific (Node: ffmpeg → f32le; browser: decodeAudioData); everything
// else is pure math. Import-safe under Node (no top-level ffmpeg/DOM).

import { magnitudeSpectrum, nextPow2 } from "./fft.ts";

export interface AudioData {
  /** One Float32Array of samples per channel. */
  channelWaveforms: Float32Array[];
  sampleRate: number;
  durationInSeconds: number;
  numberOfChannels: number;
}

const isNode = typeof process !== "undefined" && !!(process as any).versions?.node && typeof (globalThis as any).window === "undefined";

/**
 * Decode an audio file/URL to PCM. Node: shells out to ffmpeg (f32le). Browser:
 * fetch + AudioContext.decodeAudioData. Returns mono unless `channels` > 1.
 */
export async function getAudioData(src: string, opts: { sampleRate?: number; channels?: number } = {}): Promise<AudioData> {
  const sampleRate = opts.sampleRate ?? 44100;
  const channels = opts.channels ?? 1;
  if (isNode) return getAudioDataNode(src, sampleRate, channels);
  return getAudioDataBrowser(src);
}

async function getAudioDataNode(src: string, sampleRate: number, channels: number): Promise<AudioData> {
  const { spawn } = await import("node:child_process");
  const buf: Buffer = await new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const ff = spawn("ffmpeg", [
      "-v", "error", "-i", src,
      "-f", "f32le", "-acodec", "pcm_f32le",
      "-ac", String(channels), "-ar", String(sampleRate), "pipe:1",
    ], { stdio: ["ignore", "pipe", "inherit"] });
    ff.stdout.on("data", (d: Buffer) => chunks.push(d));
    ff.on("error", reject);
    ff.on("close", (code: number) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error("ffmpeg pcm decode exited " + code))));
  });
  const interleaved = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  const frames = Math.floor(interleaved.length / channels);
  const channelWaveforms: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    const ch = new Float32Array(frames);
    for (let i = 0; i < frames; i++) ch[i] = interleaved[i * channels + c];
    channelWaveforms.push(ch);
  }
  return { channelWaveforms, sampleRate, durationInSeconds: frames / sampleRate, numberOfChannels: channels };
}

async function getAudioDataBrowser(src: string): Promise<AudioData> {
  const g: any = globalThis as any;
  const Ctx = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctx) throw new Error("getAudioData: no AudioContext in this environment");
  const arr = await fetch(src).then((r) => r.arrayBuffer());
  const ctx = new Ctx();
  const audioBuffer = await ctx.decodeAudioData(arr);
  const channelWaveforms: Float32Array[] = [];
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) channelWaveforms.push(audioBuffer.getChannelData(c));
  try { ctx.close?.(); } catch { /* ignore */ }
  return {
    channelWaveforms,
    sampleRate: audioBuffer.sampleRate,
    durationInSeconds: audioBuffer.duration,
    numberOfChannels: audioBuffer.numberOfChannels,
  };
}

/**
 * A frequency spectrum for the given frame — `numberOfSamples` values in [0,1],
 * left = low freq (bass) → right = highs. `numberOfSamples` should be a power of
 * two. Mirrors Remotion's visualizeAudio.
 */
export function visualizeAudio(opts: {
  audioData: AudioData;
  frame: number;
  fps: number;
  numberOfSamples: number;
  smoothing?: boolean;
  channel?: number;
}): number[] {
  const { audioData, frame, fps, numberOfSamples } = opts;
  const smoothing = opts.smoothing ?? true;
  const wave = audioData.channelWaveforms[opts.channel ?? 0] ?? new Float32Array(0);
  const size = nextPow2(numberOfSamples * 2);
  const center = Math.floor((frame / fps) * audioData.sampleRate);
  const start = Math.max(0, Math.min(wave.length - size, center - (size >> 1)));
  const win = wave.subarray(start, start + size);
  const spec = magnitudeSpectrum(win, size); // size/2 bins
  // Map the lower half of the spectrum onto numberOfSamples bins (log-ish scaling).
  const out: number[] = new Array(numberOfSamples).fill(0);
  const usable = spec.length; // size/2
  for (let i = 0; i < numberOfSamples; i++) {
    const lo = Math.floor((i / numberOfSamples) * usable);
    const hi = Math.max(lo + 1, Math.floor(((i + 1) / numberOfSamples) * usable));
    let m = 0;
    for (let j = lo; j < hi && j < usable; j++) m = Math.max(m, spec[j]);
    // Perceptual-ish scaling + clamp.
    out[i] = Math.max(0, Math.min(1, Math.sqrt(m) * 2));
  }
  if (smoothing) {
    const s = out.slice();
    for (let i = 1; i < out.length - 1; i++) out[i] = (s[i - 1] + 2 * s[i] + s[i + 1]) / 4;
  }
  return out;
}

/** A downsampled waveform amplitude slice (each value in [-1,1]) — for oscilloscopes. */
export function getWaveformPortion(opts: {
  audioData: AudioData;
  startTimeInSeconds: number;
  durationInSeconds: number;
  numberOfSamples: number;
  channel?: number;
}): number[] {
  const { audioData, startTimeInSeconds, durationInSeconds, numberOfSamples } = opts;
  const wave = audioData.channelWaveforms[opts.channel ?? 0] ?? new Float32Array(0);
  const startIdx = Math.max(0, Math.floor(startTimeInSeconds * audioData.sampleRate));
  const count = Math.floor(durationInSeconds * audioData.sampleRate);
  const out: number[] = new Array(numberOfSamples).fill(0);
  for (let i = 0; i < numberOfSamples; i++) {
    const lo = startIdx + Math.floor((i / numberOfSamples) * count);
    const hi = startIdx + Math.max(lo + 1, Math.floor(((i + 1) / numberOfSamples) * count));
    let peak = 0;
    for (let j = lo; j < hi && j < wave.length; j++) if (Math.abs(wave[j]) > Math.abs(peak)) peak = wave[j];
    out[i] = peak;
  }
  return out;
}

/**
 * Build a smooth SVG path string through `points` (Catmull-Rom → cubic Bézier).
 * Handy for turning a spectrum/waveform into a flowing line.
 */
export function createSmoothSvgPath(points: Array<[number, number]>, tension = 0.5): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0][0]} ${points[0][1]}`;
  let d = `M ${points[0][0]} ${points[0][1]}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1[0] + ((p2[0] - p0[0]) / 6) * tension * 2;
    const c1y = p1[1] + ((p2[1] - p0[1]) / 6) * tension * 2;
    const c2x = p2[0] - ((p3[0] - p1[0]) / 6) * tension * 2;
    const c2y = p2[1] - ((p3[1] - p1[1]) / 6) * tension * 2;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2[0]} ${p2[1]}`;
  }
  return d;
}
