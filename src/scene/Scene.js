// The Scene orchestrates mobjects and animations and emits frames at a fixed
// fps. It is backend-agnostic: a backend sets `frameHandler` (called with the
// list of top-level mobjects once per frame) and awaits `render()`.

export class Scene {
  constructor(config = {}) {
    this.mobjects = [];
    this.fps = config.fps ?? 30;
    this.camera = config.camera ?? null;
    this.frameHandler = config.frameHandler ?? (async () => {});
    this.time = 0;
    this.frameCount = 0;
    this.sounds = [];
  }

  // Schedule an audio clip. Defaults to the current animation time, so calling
  // it between play()/wait() lines lands the sound at that moment. The Node
  // backend muxes these into the video with ffmpeg; the browser backend plays
  // them live during playback.
  addSound(file, { timeOffset, gain = 1 } = {}) {
    this.sounds.push({ file, time: timeOffset ?? this.time, gain });
    return this;
  }

  add(...mobs) {
    for (const m of mobs.flat()) {
      if (m && !this.mobjects.includes(m)) this.mobjects.push(m);
    }
    return this;
  }

  remove(...mobs) {
    const set = new Set(mobs.flat());
    this.mobjects = this.mobjects.filter((m) => !set.has(m));
    return this;
  }

  bringToFront(mob) {
    this.remove(mob);
    this.mobjects.push(mob);
    return this;
  }

  clear() {
    this.mobjects = [];
    return this;
  }

  // Override in subclasses (or pass config.construct) to define the animation.
  async construct() {}

  async emitFrame() {
    await this.frameHandler(this.mobjects, this.frameCount, this.time);
    this.frameCount++;
  }

  updateMobjects(dt) {
    for (const m of this.mobjects) m.update(dt);
  }

  hasUpdaters() {
    return this.mobjects.some((m) => m.hasUpdaters());
  }

  // Play one or more animations in parallel for max(runTime).
  async play(...animations) {
    let config = {};
    if (animations.length && animations[animations.length - 1] && animations[animations.length - 1]._playConfig) {
      config = animations.pop();
    }
    const anims = animations.flat().filter(Boolean).map((a) =>
      a && a._isAnimateBuilder ? a.build() : a);
    if (anims.length === 0) return this;

    const runTimeOverride = config.runTime;
    for (const a of anims) {
      if (runTimeOverride != null) a.runTime = runTimeOverride;
      a.begin();
      for (const m of a.getMobjectsToIntroduce()) this.add(m);
    }

    const totalTime = Math.max(...anims.map((a) => a.runTime));
    const nFrames = Math.max(1, Math.round(totalTime * this.fps));
    const dt = totalTime / nFrames;

    for (let f = 1; f <= nFrames; f++) {
      const elapsed = (f / nFrames) * totalTime;
      for (const a of anims) {
        const localAlpha = a.runTime === 0 ? 1 : Math.max(0, Math.min(1, elapsed / a.runTime));
        a.interpolate(localAlpha);
      }
      this.updateMobjects(dt);
      this.time += dt;
      await this.emitFrame();
    }

    for (const a of anims) {
      a.finish();
      for (const m of a.getMobjectsToIntroduce()) this.add(m);
      for (const m of a.getMobjectsToRemove()) this.remove(m);
      // ReplacementTransform introduces its target explicitly.
      if (a.introduced) this.add(a.introduced);
    }
    return this;
  }

  // Hold the current frame for `duration` seconds (runs updaters each frame).
  async wait(duration = 1) {
    const nFrames = Math.max(1, Math.round(duration * this.fps));
    const dt = duration / nFrames;
    for (let f = 0; f < nFrames; f++) {
      this.updateMobjects(dt);
      this.time += dt;
      await this.emitFrame();
    }
    return this;
  }

  // Add mobjects and show them for a moment (manim's self.add + a frame).
  async pause(duration = 0.5) {
    return this.wait(duration);
  }

  // Full run: emit an initial frame, then the user's construct().
  async render() {
    await this.construct();
    return this;
  }
}
