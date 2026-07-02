// Production built-in formats — the payload of the Format layer. Each one is a
// complete topic/params → rendered-video pipeline that works with zero network
// access (an LLM provider is only ever an optional enhancer) and drives real
// Scene construction: sections, animations, voiceover, presets.
//
//   explainer    multi-section narrated explainer (title → sections → outro)
//   chart-reveal animated bar chart from data
//   quote-card   a social-format quote clip (any aspect preset)

import { registerFormat } from "./formats.ts";
import type { Format, FormatContext } from "./formats.ts";

// Word-wrap a string to lines of at most `width` chars (word boundaries).
function wrap(text: string, width = 38): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && (cur + " " + w).length > width) { lines.push(cur); cur = w; }
    else cur = cur ? cur + " " + w : w;
  }
  if (cur) lines.push(cur);
  return lines.join("\n");
}

// --- explainer ---------------------------------------------------------------

export interface ExplainerSection {
  heading: string;
  bullets?: string[];
  /** Inline diagram DSL (see docs/animation-presentation.md) shown beside/below the bullets. */
  diagram?: string;
  /** Narration text; spoken via the voiceover TTS provider named by params.tts. */
  narration?: string;
  /** Seconds to hold the section when there is no narration (default 2.5). */
  holdSeconds?: number;
}

export interface ExplainerPlan {
  title: string;
  subtitle?: string;
  sections: ExplainerSection[];
  outro?: string;
  style: string;
  tts: string;
}

export const explainerFormat: Format = {
  name: "explainer",
  description: "Multi-section narrated explainer video: title card, per-section heading + bullets (+ optional diagram), optional TTS narration, outro.",
  requiredProviders: ["render"],

  async plan(ctx: FormatContext): Promise<ExplainerPlan> {
    const p = ctx.params ?? {};
    let sections: ExplainerSection[] = p.sections ?? [];
    // Optional LLM expansion: topic → sections. Deterministic fallback: a
    // single section built from the topic so the format always runs.
    if (!sections.length && ctx.providers?.llm) {
      const out = await ctx.providers.llm.invoke({
        prompt: `Outline a 3-section explainer about "${ctx.topic}". ` +
          `Respond as JSON: [{"heading": str, "bullets": [str, str], "narration": str}]`,
      });
      try { sections = typeof out === "string" ? JSON.parse(out) : out; } catch { /* fall through */ }
    }
    if (!sections.length) {
      sections = [{ heading: ctx.topic ?? "Overview", bullets: ["(no sections given)"] }];
    }
    return {
      title: p.title ?? ctx.topic ?? "Untitled",
      subtitle: p.subtitle,
      sections,
      outro: p.outro,
      style: p.style ?? "3b1b-dark",
      tts: p.tts ?? "silent",
    };
  },

  async compose(plan: ExplainerPlan, _assets: any, ctx: FormatContext): Promise<any> {
    const renderP = ctx.providers!.render!;
    const build = async (scene: any) => {
      const idx = await import("../index.ts");
      const { voiceover } = await import("../voiceover/voiceover.ts");

      // Narrate a beat: with narration run the callback under voiceover so the
      // scene waits out the audio; without it, run the callback then hold.
      const beat = async (narration: string | undefined, hold: number, fn: () => Promise<void>) => {
        if (narration) await voiceover(scene, narration, fn, { provider: plan.tts });
        else { await fn(); await scene.wait(hold); }
      };

      // Title card.
      scene.nextSection("title");
      const title = new idx.Text(wrap(plan.title, 26), { fontSize: 0.85, point: [0, 0.6, 0], color: "#FFD700" });
      const sub = plan.subtitle
        ? new idx.Text(wrap(plan.subtitle, 40), { fontSize: 0.42, point: [0, -0.5, 0], color: "#DDDDDD" })
        : null;
      await beat(undefined, 0, async () => {
        await scene.play(new idx.Write(title), { _playConfig: true, runTime: 1 });
        if (sub) await scene.play(new idx.FadeIn(sub, { shift: [0, 0.3, 0] }), { _playConfig: true, runTime: 0.5 });
      });
      await scene.wait(0.8);
      await scene.play(new idx.FadeOut(new idx.VGroup(...[title, sub].filter((m): m is NonNullable<typeof m> => m != null))), { _playConfig: true, runTime: 0.5 });

      // Sections.
      for (const [i, sec] of plan.sections.entries()) {
        scene.nextSection(sec.heading || `section-${i + 1}`);
        const heading = new idx.Text(wrap(sec.heading, 30), { fontSize: 0.6, point: [0, 2.6, 0], color: "#58C4DD" });
        const items = (sec.bullets ?? []).map((b, j) => {
          const t = new idx.Text("• " + wrap(b, 44), { fontSize: 0.4, point: [0, 1.4 - j * 0.75, 0], align: "left" });
          // Anchor the LEFT edge at x = -5.6 (Text's `point` positions the center).
          t.shift([-5.6 - t.getBoundaryPoint([-1, 0, 0])[0], 0, 0]);
          return t;
        });
        const board = sec.diagram
          ? (await import("../diagram/diagram.ts")).diagram(sec.diagram)
          : null;
        if (board) {
          board.scale(0.8);
          board.moveTo([0, items.length ? -1.6 : -0.4, 0]);
        }
        await beat(sec.narration, sec.holdSeconds ?? 2.5, async () => {
          await scene.play(new idx.Write(heading), { _playConfig: true, runTime: 0.6 });
          for (const item of items) {
            await scene.play(new idx.FadeIn(item, { shift: [0.4, 0, 0] }), { _playConfig: true, runTime: 0.35 });
          }
          if (board) await scene.play(new idx.Create(board), { _playConfig: true, runTime: 1 });
        });
        const all = new idx.VGroup(...[heading, ...items, board].filter((m): m is NonNullable<typeof m> => m != null));
        await scene.play(new idx.FadeOut(all), { _playConfig: true, runTime: 0.4 });
      }

      // Outro.
      if (plan.outro) {
        scene.nextSection("outro");
        const out = new idx.Text(wrap(plan.outro, 34), { fontSize: 0.55, color: "#FFD700" });
        await scene.play(new idx.FadeIn(out, { scale: 1.15 }), { _playConfig: true, runTime: 0.7 });
        await scene.wait(1.2);
      }
    };
    return renderP.invoke({
      scene: build,
      options: { ...(ctx.params?.renderOptions ?? {}), style: plan.style },
    });
  },

  async revise(plan: ExplainerPlan, feedback: Partial<ExplainerPlan>): Promise<ExplainerPlan> {
    return { ...plan, ...feedback, sections: feedback.sections ?? plan.sections };
  },
};

// --- chart-reveal --------------------------------------------------------------

export interface ChartDatum { label: string; value: number; }
export interface ChartRevealPlan {
  title: string;
  data: ChartDatum[];
  unit?: string;
  color: string;
  style: string;
  holdSeconds: number;
}

export const chartRevealFormat: Format = {
  name: "chart-reveal",
  description: "Animated bar chart: bars grow from the baseline with value labels, staggered.",
  requiredProviders: ["render"],

  async plan(ctx: FormatContext): Promise<ChartRevealPlan> {
    const p = ctx.params ?? {};
    const data: ChartDatum[] = p.data ?? [];
    if (!data.length) throw new Error(`chart-reveal: params.data ([{label, value}, ...]) is required`);
    for (const d of data) {
      if (typeof d.value !== "number" || !Number.isFinite(d.value) || d.value < 0) {
        throw new Error(`chart-reveal: bad value for "${d.label}" (need a finite number >= 0)`);
      }
    }
    return {
      title: p.title ?? ctx.topic ?? "",
      data,
      unit: p.unit,
      color: p.color ?? "#58C4DD",
      style: p.style ?? "3b1b-dark",
      holdSeconds: p.holdSeconds ?? 2,
    };
  },

  async compose(plan: ChartRevealPlan, _assets: any, ctx: FormatContext): Promise<any> {
    const renderP = ctx.providers!.render!;
    const build = async (scene: any) => {
      const idx = await import("../index.ts");
      const n = plan.data.length;
      const maxV = Math.max(...plan.data.map((d) => d.value), 1e-9);
      const chartW = Math.min(10, n * 1.7);
      const barW = (chartW / n) * 0.62;
      const maxH = 4;
      const baseY = -2.2;
      const x = (i: number) => -chartW / 2 + (i + 0.5) * (chartW / n);

      scene.nextSection("chart");
      if (plan.title) {
        const t = new idx.Text(wrap(plan.title, 34), { fontSize: 0.55, point: [0, 3.1, 0], color: "#FFD700" });
        await scene.play(new idx.Write(t), { _playConfig: true, runTime: 0.6 });
      }
      const baseline = new idx.Line([-chartW / 2 - 0.4, baseY, 0], [chartW / 2 + 0.4, baseY, 0], { color: "#888888" });
      await scene.play(new idx.Create(baseline), { _playConfig: true, runTime: 0.4 });

      for (const [i, d] of plan.data.entries()) {
        const h = (d.value / maxV) * maxH;
        const bar = new idx.Rectangle({
          width: barW, height: Math.max(h, 1e-3),
          color: plan.color, fillColor: plan.color, fillOpacity: 0.75, strokeWidth: 2,
        });
        bar.moveTo([x(i), baseY + h / 2, 0]);
        const label = new idx.Text(wrap(d.label, 12), { fontSize: 0.32, point: [x(i), baseY - 0.45, 0] });
        const value = new idx.Text(
          `${d.value}${plan.unit ?? ""}`,
          { fontSize: 0.34, point: [x(i), baseY + h + 0.35, 0], color: plan.color },
        );
        scene.add(label);
        await scene.play(new idx.GrowFromEdge(bar, [0, -1, 0]), { _playConfig: true, runTime: 0.45 });
        await scene.play(new idx.FadeIn(value, { shift: [0, 0.15, 0] }), { _playConfig: true, runTime: 0.25 });
      }
      await scene.wait(plan.holdSeconds);
    };
    return renderP.invoke({
      scene: build,
      options: { ...(ctx.params?.renderOptions ?? {}), style: plan.style },
    });
  },

  async revise(plan: ChartRevealPlan, feedback: Partial<ChartRevealPlan>): Promise<ChartRevealPlan> {
    return { ...plan, ...feedback, data: feedback.data ?? plan.data };
  },
};

// --- quote-card ----------------------------------------------------------------

export interface QuoteCardPlan {
  quote: string;
  attribution?: string;
  aspectRatio: string;
  style: string;
  holdSeconds: number;
}

export const quoteCardFormat: Format = {
  name: "quote-card",
  description: "A quote + attribution clip in any aspect preset (16:9, 1:1, 9:16) — social-ready.",
  requiredProviders: ["render"],

  async plan(ctx: FormatContext): Promise<QuoteCardPlan> {
    const p = ctx.params ?? {};
    const quote = p.quote ?? ctx.topic;
    if (!quote) throw new Error("quote-card: params.quote (or a topic) is required");
    return {
      quote,
      attribution: p.attribution,
      aspectRatio: p.aspectRatio ?? "1:1",
      style: p.style ?? "3b1b-dark",
      holdSeconds: p.holdSeconds ?? 2.5,
    };
  },

  async compose(plan: QuoteCardPlan, _assets: any, ctx: FormatContext): Promise<any> {
    const renderP = ctx.providers!.render!;
    const narrow = plan.aspectRatio === "9:16";
    const build = async (scene: any) => {
      const idx = await import("../index.ts");
      scene.nextSection("quote");
      const q = new idx.Text(`“${wrap(plan.quote, narrow ? 20 : 30)}”`, {
        fontSize: narrow ? 0.5 : 0.6, point: [0, 0.4, 0], color: "#FFFFFF",
      });
      await scene.play(new idx.Write(q, { runTime: Math.min(2.4, 0.05 * plan.quote.length + 0.8) }), { _playConfig: true });
      if (plan.attribution) {
        const a = new idx.Text("— " + plan.attribution, {
          fontSize: narrow ? 0.36 : 0.4,
          point: [0, -(q.getHeight?.() ?? 1.5) / 2 - 0.9, 0],
          color: "#58C4DD",
        });
        await scene.play(new idx.FadeIn(a, { shift: [0, 0.25, 0] }), { _playConfig: true, runTime: 0.5 });
      }
      await scene.wait(plan.holdSeconds);
    };
    return renderP.invoke({
      scene: build,
      options: { aspectRatio: plan.aspectRatio, ...(ctx.params?.renderOptions ?? {}), style: plan.style },
    });
  },
};

for (const f of [explainerFormat, chartRevealFormat, quoteCardFormat]) registerFormat(f);
