// Scene construction for the character-explainer format (kept apart from
// character_explainer.ts so that file stays pure / DOM-free; this one is only
// ever imported lazily from compose()). Presenter = Skeleton driven by a hidden
// "controller" pose (what PoseTween animates) + idle sway + an IK pointing
// overlay blended in by a ValueTracker.

import {
  PRESENTER_BONES, createPresenterPoseLibrary, scheduleCues, layoutVisuals, STAGE,
} from "./character_explainer.ts";
import type { CharacterExplainerPlan, CharacterVisual, CharacterBeat, CharacterCue, Box } from "./character_explainer.ts";

const PRESENTER_X = -3.7;
const PRESENTER_Y = -1.3;
const ARM_REACH = 1.0 + 0.95;
const MAX_STEP = 0.9;
const POINT_HOLD = 2.4;
const MAX_PER_REGION = 2;

const wrap = (text: string, width: number): string => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > width) { lines.push(cur); cur = w; } else cur = cur ? cur + " " + w : w;
  }
  if (cur) lines.push(cur);
  return lines.join("\n");
};

interface VisualRec {
  def: CharacterVisual;
  mob: any;
  w0: number;
  h0: number;
  scale: number;
  maxScale: number;
  shown: boolean;
}

export async function runPresenterScene(scene: any, plan: CharacterExplainerPlan): Promise<void> {
  const idx = await import("../index.ts");
  const sk = await import("../skeletal.ts");
  const { voiceover } = await import("../voiceover/voiceover.ts");
  const { diagram } = await import("../diagram/diagram.ts");

  const play = (anims: any[], runTime: number) => scene.play(...anims, { _playConfig: true, runTime });

  // --- presenter -------------------------------------------------------------
  const ctrl = new sk.SkeletonModel(PRESENTER_BONES, { root: [PRESENTER_X, PRESENTER_Y] });
  const poses = createPresenterPoseLibrary();
  ctrl.setPose(poses.get("neutral")!);
  const skin = "#F6D3AE";
  const figure = new sk.Skeleton(PRESENTER_BONES, {
    root: [PRESENTER_X, PRESENTER_Y],
    color: "#E8EDF5",
    strokeWidth: 8,
    heads: [
      { joint: "head", radius: 0.44, color: "#E8EDF5", fillColor: skin, fillOpacity: 1, strokeWidth: 5 },
      { joint: "eyeA", radius: 0.045, color: "#1b1b24", fillColor: "#1b1b24", fillOpacity: 1, strokeWidth: 1, zIndex: 2 },
      { joint: "eyeB", radius: 0.045, color: "#1b1b24", fillColor: "#1b1b24", fillOpacity: 1, strokeWidth: 1, zIndex: 2 },
      { joint: "handL", radius: 0.11, color: skin, fillColor: skin, fillOpacity: 1, strokeWidth: 2 },
      { joint: "handR", radius: 0.11, color: skin, fillColor: skin, fillOpacity: 1, strokeWidth: 2 },
    ],
    fills: [{ joints: ["hipL", "hipR", "shoulderR", "shoulderL"], color: "#3D7BFF", opacity: 1 }],
  });
  figure.setPose(ctrl.getPose());

  const pointW = new idx.ValueTracker(0);
  const aimX = new idx.ValueTracker(0);
  const aimY = new idx.ValueTracker(0);
  const stepX = new idx.ValueTracker(0); // presenter steps toward far targets while pointing
  let bendSide: "left" | "right" = "right";
  const chain = new sk.IKChain(figure, {
    bones: ["armR", "foreR"],
    target: () => [aimX.getValue(), aimY.getValue()],
    bendSide: "right",
  });

  const TAU = Math.PI * 2;
  const drive = () => {
    const t = scene.time;
    const w = pointW.getValue();
    const pose = ctrl.getPose();
    const b = pose.bones;
    // Idle: breathing + sway + a slow head drift, so the presenter is never frozen.
    const br = Math.sin((TAU * t) / 3.4);
    b.spine.angle += 0.012 * br + 0.01 * Math.sin((TAU * t) / 7.3);
    b.neck.angle += 0.03 * Math.sin((TAU * t) / 4.7 + 1);
    b.armR.angle += 0.022 * Math.sin((TAU * t) / 3.4 + 0.6);
    b.armL.angle -= 0.022 * Math.sin((TAU * t) / 3.4 + 0.9);
    b.foreL.angle += 0.02 * Math.sin((TAU * t) / 2.9);
    pose.root = [pose.root[0] + stepX.getValue(), pose.root[1] + 0.012 * br];
    b.spine.angle -= 0.07 * w; // lean toward what we point at
    figure.setPose(pose);
    if (w > 1e-3) {
      const fk = figure.model.getPose().bones;
      const a0 = fk.armR.angle, f0 = fk.foreR.angle;
      chain.bendSide = bendSide;
      chain.solve();
      const ik = figure.model.getPose().bones;
      figure.model.setAngle("armR", a0 + sk.wrapAngle(ik.armR.angle - a0) * w);
      figure.model.setAngle("foreR", f0 + sk.wrapAngle(ik.foreR.angle - f0) * w);
      figure.refresh();
    }
  };
  figure.addUpdater(drive as any, {
    hashExtra: () => `presenter:${scene.time.toFixed(4)}:${pointW.getValue().toFixed(3)}:${stepX.getValue().toFixed(3)}:${aimX.getValue().toFixed(3)},${aimY.getValue().toFixed(3)}`,
  });
  scene.add(figure);

  // --- stage / visuals ---------------------------------------------------------
  const recs = new Map<string, VisualRec>();
  const order: string[] = []; // currently visible, oldest first

  const makeVisual = (v: CharacterVisual): VisualRec => {
    let mob: any;
    let maxScale = 1.2;
    if (v.kind === "text") {
      mob = new idx.Text(wrap(v.content, 26), { fontSize: 0.7, lineSpacing: 1.7, color: "#FFFFFF" });
      maxScale = 1.25;
    } else if (v.kind === "math") {
      mob = new idx.MathTex(v.content, { fontSize: 1.5, color: "#FFFFFF" });
      maxScale = 1.1;
    } else if (v.kind === "diagram") {
      try { mob = diagram(v.content); } catch { mob = new idx.Text(wrap(v.content, 24), { fontSize: 0.5, color: "#FFFFFF" }); }
      maxScale = 1.3;
    } else {
      mob = buildBarChart(idx, v.content);
      maxScale = 1.0;
    }
    return { def: v, mob, w0: Math.max(mob.getWidth(), 1e-3), h0: Math.max(mob.getHeight(), 1e-3), scale: 1, maxScale, shown: false };
  };

  const fitScale = (r: VisualRec, box: Box) => Math.min(box.maxW / r.w0, box.maxH / r.h0, r.maxScale);

  // Show `ids` (new) and relayout. Returns animations to play together.
  // `pre` (fade-outs of evicted visuals) must finish before `main` starts, so
  // an outgoing and an incoming visual never overlap in the same slot.
  const revealAnims = (ids: string[]): { pre: any[]; main: any[] } => {
    const anims: any[] = [];
    const pre: any[] = [];
    for (const id of ids) {
      if (!recs.has(id)) recs.set(id, makeVisual(plan.visuals.find((v) => v.id === id)!));
    }
    const fresh = ids.filter((id) => !recs.get(id)!.shown);
    for (const id of fresh) { order.push(id); recs.get(id)!.shown = true; }
    // Cap each region; evict oldest.
    const region = (id: string) => recs.get(id)!.def.at ?? "right";
    const evicted: string[] = [];
    for (const reg of ["right", "top", "bottom"]) {
      const inReg = order.filter((id) => region(id) === reg);
      while (inReg.length > MAX_PER_REGION) { const gone = inReg.shift()!; evicted.push(gone); order.splice(order.indexOf(gone), 1); }
    }
    for (const id of evicted) { const r = recs.get(id)!; r.shown = false; pre.push(new idx.FadeOut(r.mob)); }
    const boxes = layoutVisuals(order.map((id) => ({ id, at: recs.get(id)!.def.at })));
    for (const id of order) {
      const r = recs.get(id)!;
      const box = boxes[id];
      const s = fitScale(r, box);
      if (fresh.includes(id)) {
        r.mob.scale(s).moveTo([box.cx, box.cy, 0]);
        r.scale = s;
        const kind = r.def.kind;
        anims.push(kind === "text" || kind === "math" ? new idx.Write(r.mob) : kind === "diagram" ? new idx.Create(r.mob) : new idx.FadeIn(r.mob, { shift: [0, 0.3, 0] }));
      } else {
        const f = s / r.scale;
        const moved = Math.abs(f - 1) > 1e-3 || Math.hypot(r.mob.getCenter()[0] - box.cx, r.mob.getCenter()[1] - box.cy) > 1e-3;
        if (moved) { anims.push(r.mob.animate.scale(f).moveTo([box.cx, box.cy, 0])); r.scale = s; }
      }
    }
    return { pre, main: anims };
  };

  // --- cue actions ----------------------------------------------------------------
  const state = { pointId: 0, pointing: false, lastWave: 0 };

  const poseTween = (name: string, runTime = 0.55) => new sk.PoseTween(ctrl as any, poses.get(name)!, { runTime });

  const releasePoint = (): any[] => {
    if (!state.pointing) return [];
    state.pointing = false;
    return [pointW.animate.setValue(0), stepX.animate.setValue(0)];
  };

  // Where to aim, and how far the presenter should step toward the target.
  const aimAt = (rec: VisualRec): { aim: number[]; step: number } => {
    const S = figure.model.boneStart("armR") as number[];
    const S0 = [S[0] - stepX.getValue(), S[1]];
    const c = rec.mob.getCenter();
    const hw = rec.mob.getWidth() / 2, hh = rec.mob.getHeight() / 2;
    const P = [Math.min(Math.max(S0[0], c[0] - hw), c[0] + hw), Math.min(Math.max(S0[1], c[1] - hh), c[1] + hh)];
    const reach = ARM_REACH * 0.985;
    const step = Math.min(Math.max(Math.hypot(P[0] - S0[0], P[1] - S0[1]) - reach * 0.97, 0), MAX_STEP);
    const Sn = [S0[0] + step, S0[1]];
    let dx = P[0] - Sn[0], dy = P[1] - Sn[1];
    const dist = Math.hypot(dx, dy) || 1e-6;
    dx /= dist; dy /= dist;
    const len = dist > reach ? reach : Math.max(dist - 0.15, 0.6);
    bendSide = dx >= 0 ? "right" : "left";
    return { aim: [Sn[0] + dx * len, Sn[1] + dy * len], step };
  };

  const fxAnchor = (target: string | undefined): { c: number[]; r: number } => {
    const rec = target ? recs.get(target) : undefined;
    if (rec) return { c: rec.mob.getCenter(), r: Math.max(rec.mob.getWidth(), rec.mob.getHeight()) / 2 };
    return { c: [PRESENTER_X, PRESENTER_Y + 1.6, 0], r: 1.4 };
  };

  type Pending = { time: number; seq: number; run: () => Promise<void> };

  const runBeat = async (beat: CharacterBeat, bi: number) => {
    scene.nextSection(`beat-${bi + 1}`);
    await voiceover(scene, beat.narration, async (tracker: any) => {
      const t0 = scene.time;
      const duration: number = tracker.duration;
      // Bookmark times (relative) -- exact with word boundaries, else proportional.
      const names = Array.from(beat.narration.matchAll(/<bookmark\s+mark\s*=\s*["']([^"']+)["']/g)).map((m) => m[1]);
      const times: Record<string, number> = {};
      for (const n of names) { try { times[n] = tracker.timeAtBookmark(n) - t0; } catch { /* leave to proportional */ } }
      const events = scheduleCues(beat, times, duration);

      // Cues at t=0 that are poses fold into the reveal play (parallel).
      const early = events.filter((e) => e.time <= 1e-6 && e.cue.do === "pose");
      const rest = events.filter((e) => !early.includes(e));
      const { pre, main: reveal } = revealAnims(beat.show ?? []);
      if (pre.length) await play(pre, 0.4);
      const earlyAnims = early.map((e) => poseTween(e.cue.pose!));
      if (early.length) state.lastWave = 0;
      if (reveal.length || earlyAnims.length) {
        await play([...reveal, ...earlyAnims, ...(early.length ? releasePoint() : [])], reveal.length ? 0.8 : 0.55);
      }

      const queue: Pending[] = [];
      let seq = 0;
      const push = (time: number, run: () => Promise<void>) => {
        queue.push({ time, seq: seq++, run });
        queue.sort((a, b) => a.time - b.time || a.seq - b.seq);
      };
      const endT = Math.max(duration - 0.05, 0);

      const doCue = (cue: CharacterCue, at: number) => async () => {
        if (cue.do === "pose") {
          await play([poseTween(cue.pose!), ...releasePoint()], 0.55);
          if (cue.pose === "wave") {
            for (const f of [24, 58, 28]) await play([new sk.PoseTween(ctrl as any, { bones: { foreR: { angle: (f * Math.PI) / 180 } } }, { runTime: 0.22 })], 0.22);
          }
        } else if (cue.do === "show") {
          const rec = recs.get(cue.target!) ?? null;
          if (rec?.shown) return;
          const { pre: out, main } = revealAnims([cue.target!]);
          if (out.length) await play(out, 0.4);
          if (main.length) await play(main, 0.8);
        } else if (cue.do === "point") {
          const rec = recs.get(cue.target!);
          if (!rec) return;
          const { aim: [ax, ay], step } = aimAt(rec);
          const id = ++state.pointId;
          const anims: any[] = [pointW.animate.setValue(1), stepX.animate.setValue(step)];
          if (state.pointing) { anims.push(aimX.animate.setValue(ax), aimY.animate.setValue(ay)); }
          else { aimX.setValue(ax); aimY.setValue(ay); }
          state.pointing = true;
          // Hands rest toward neutral while pointing (the other arm).
          await play(anims, 0.45);
          push(Math.min(at + POINT_HOLD, endT + 0.4), async () => {
            if (state.pointId === id && state.pointing) await play(releasePoint(), 0.45);
          });
        } else if (cue.do === "camera") {
          const cam = scene.camera;
          if (!cam?.addEffect) return;
          const start = scene.time;
          if (cue.camera === "impact") cam.addEffect(new idx.CameraImpact({ magnitude: 0.3 }), { start, duration: 1.4, fadeOut: 0.3 });
          else if (cue.camera === "pulse") cam.addEffect(new idx.ZoomPulse({ amount: 0.07, period: 0.7 }), { start, duration: 0.7 });
          else cam.addEffect(new idx.CameraShake({ amplitude: 0.1, roll: 0.01, decay: 0 }), { start, duration: 0.6, fadeOut: 0.3 });
        } else if (cue.do === "fx") {
          const a = fxAnchor(cue.target);
          const t = scene.time;
          let fx: any, life = 2.4;
          if (cue.fx === "aura") { fx = new idx.Aura({ style: cue.target ? "radiant" : "arcane", radius: cue.target ? Math.max(1, a.r * 0.8) : 1.8, center: cue.target ? a.c : [PRESENTER_X, PRESENTER_Y + 1.1, 0], intensity: 0.4, autoAdvance: false }); life = 2.6; }
          else if (cue.fx === "explosion") { fx = new idx.Explosion({ style: "confetti", size: 1.0, intensity: 0.5, center: cue.target ? a.c : [PRESENTER_X, PRESENTER_Y + 2.2, 0], autoAdvance: false }); life = 2.6; }
          else if (cue.fx === "smoke") { fx = new idx.Smoke({ style: "wisp", width: Math.max(1, a.r), center: [a.c[0], a.c[1] - a.r, 0], autoAdvance: false }); life = 2.6; }
          else {
            const hand = figure.model.jointPosition("foreR") as number[];
            const to = cue.target ? [Math.max(a.c[0] - a.r, STAGE.left), a.c[1]] : [STAGE.left + 1, hand[1]];
            fx = new idx.Beam({ style: "plasma", from: [hand[0], hand[1], 0], to: [to[0], to[1], 0], autoAdvance: false });
            life = 1.8;
          }
          fx.addUpdater(() => fx.setTime(scene.time - t), { hashExtra: () => `fx:${cue.fx}:${(scene.time - t).toFixed(3)}` });
          fx.setTime(0);
          scene.add(fx);
          push(at + life, async () => { scene.remove(fx); });
        }
      };

      for (const e of rest) push(e.time, doCue(e.cue, e.time));
      while (queue.length) {
        const ev = queue.shift()!;
        const dt = t0 + ev.time - scene.time;
        if (dt > 1e-3) await scene.wait(dt);
        await ev.run();
      }
    }, { provider: plan.tts });
    // Don't carry a pointing arm into the next beat.
    if (state.pointing) await play(releasePoint(), 0.4);
  };

  // --- run ---------------------------------------------------------------------------
  scene.nextSection("intro");
  const title = new idx.Text(wrap(plan.title, 60), { fontSize: 0.36, color: "#FFD700", point: [0, 3.5, 0] });
  await play([new idx.Write(title)], 0.8);
  for (const [bi, beat] of plan.beats.entries()) await runBeat(beat, bi);
  await scene.wait(1);
}

// A small bar chart (same drawing language as the chart-reveal format).
function buildBarChart(idx: any, data: Array<{ label: string; value: number }>): any {
  const n = data.length;
  const maxV = Math.max(...data.map((d) => d.value), 1e-9);
  const chartW = Math.min(6.5, n * 1.9);
  const barW = (chartW / n) * 0.62;
  const maxH = 3.0;
  const baseY = 0;
  const x = (i: number) => -chartW / 2 + (i + 0.5) * (chartW / n);
  const parts: any[] = [new idx.Line([-chartW / 2 - 0.2, baseY, 0], [chartW / 2 + 0.2, baseY, 0], { color: "#888888" })];
  data.forEach((d, i) => {
    const h = Math.max((d.value / maxV) * maxH, 0.02);
    const bar = new idx.Rectangle({ width: barW, height: h, color: "#58C4DD", fillColor: "#58C4DD", fillOpacity: 0.8, strokeWidth: 2 });
    bar.moveTo([x(i), baseY + h / 2, 0]);
    parts.push(bar);
    parts.push(new idx.Text(wrap(d.label, 7), { fontSize: 0.26, point: [x(i), baseY - 0.4, 0] }));
    parts.push(new idx.Text(String(d.value), { fontSize: 0.32, color: "#58C4DD", point: [x(i), baseY + h + 0.3, 0] }));
  });
  return new idx.VGroup(...parts);
}
