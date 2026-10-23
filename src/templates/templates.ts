// Scene templates: pure factories returning { group, animateIn(), animateOut() }
// — they never auto-play, so pieces compose with Timeline / transitions / any
// scene flow. Every factory takes a Theme (or anything resolveTheme accepts)
// and derives colors/sizes/margins from it.

import { VGroup, VMobject } from "../mobject/VMobject.ts";
import { Group, Mobject } from "../mobject/Mobject.ts";
import { Text } from "../mobject/text/Text.ts";
import { Rectangle } from "../mobject/geometry.ts";
import { ValueTracker, DecimalNumber } from "../mobject/value_tracker.ts";
import { Animation, FadeIn, FadeOut, Create, Write, ApplyMethod } from "../animation/Animation.ts";
import { AnimationGroup, LaggedStart } from "../animation/composition.ts";
import { resolveTheme } from "./theme.ts";
import type { Theme, ThemeInput } from "./theme.ts";

export interface TemplatePiece {
  group: Group;
  animateIn(): Animation;
  animateOut(): Animation;
}

type ThemeArg = Theme | ThemeInput | string | undefined;
const theme = (t: ThemeArg): Theme =>
  t != null && typeof t === "object" && "preset" in t && "foreground" in t ? (t as Theme) : resolveTheme(t as ThemeInput | string);

// ---------------------------------------------------------------------------
// titleCard
// ---------------------------------------------------------------------------

export interface TitleCardOptions {
  subtitle?: string;
  theme?: ThemeArg;
  point?: number[];
}

/** A centered title with an accent rule and optional subtitle. */
export function titleCard(title: string, options: TitleCardOptions = {}): TemplatePiece & {
  title: Text; subtitle: Text | null; rule: VMobject;
} {
  const th = theme(options.theme);
  const titleText = new Text(title, { fontSize: 1.05 * th.fontScale, color: th.foreground });
  titleText.moveTo([0, 0.55, 0]);
  const rule = new Rectangle({
    width: Math.max(2, titleText.getWidth() * 0.7),
    height: 0.07,
    color: th.accent, fillOpacity: 1, strokeWidth: 0,
  });
  rule.moveTo([0, -0.15, 0]);
  let subtitleText: Text | null = null;
  const group = new VGroup(titleText, rule);
  if (options.subtitle) {
    subtitleText = new Text(options.subtitle, { fontSize: 0.5 * th.fontScale, color: th.foreground });
    subtitleText.setOpacity(0.75);
    subtitleText.moveTo([0, -0.75, 0]);
    group.add(subtitleText);
  }
  if (options.point) group.moveTo(options.point);
  return {
    group, title: titleText, subtitle: subtitleText, rule,
    animateIn: () => new LaggedStart(
      [new Write(titleText, { runTime: 1.5 }), new Create(rule, { lagRatio: 0 }), ...(subtitleText ? [new FadeIn(subtitleText, { shift: [0, -0.3, 0] })] : [])],
      { lagRatio: 0.3 },
    ),
    animateOut: () => new FadeOut(group),
  };
}

// ---------------------------------------------------------------------------
// lowerThird
// ---------------------------------------------------------------------------

export interface LowerThirdOptions {
  role?: string;
  theme?: ThemeArg;
  /** Frame size the piece anchors into (default 14.22 x 8). */
  frameWidth?: number;
  frameHeight?: number;
}

/** A name/role tag anchored to the bottom-left with an accent bar. */
export function lowerThird(name: string, options: LowerThirdOptions = {}): TemplatePiece & {
  name: Text; role: Text | null; bar: VMobject;
} {
  const th = theme(options.theme);
  const fw = options.frameWidth ?? 14.22;
  const fh = options.frameHeight ?? 8;
  const nameText = new Text(name, { fontSize: 0.55 * th.fontScale, color: th.foreground });
  let roleText: Text | null = null;
  if (options.role) {
    roleText = new Text(options.role, { fontSize: 0.38 * th.fontScale, color: th.foreground });
    roleText.setOpacity(0.7);
  }
  const blockH = roleText ? 1.1 : 0.7;
  const bar = new Rectangle({ width: 0.12, height: blockH, color: th.accent, fillOpacity: 1, strokeWidth: 0 });
  const group = new VGroup(bar, nameText);
  // Anchor: bar's left edge at margin from frame left, block bottom at margin.
  const left = -fw / 2 + th.margin;
  const bottom = -fh / 2 + th.margin;
  bar.moveTo([left + 0.06, bottom + blockH / 2, 0]);
  const textLeft = left + 0.35;
  nameText.moveTo([textLeft + nameText.getWidth() / 2, bottom + blockH - 0.25 * th.fontScale, 0]);
  if (roleText) {
    roleText.moveTo([textLeft + roleText.getWidth() / 2, bottom + 0.25 * th.fontScale, 0]);
    group.add(roleText);
  }
  return {
    group, name: nameText, role: roleText, bar,
    animateIn: () => new LaggedStart(
      [new FadeIn(bar, { shift: [0.4, 0, 0] }), new FadeIn(nameText, { shift: [0.4, 0, 0] }),
       ...(roleText ? [new FadeIn(roleText, { shift: [0.4, 0, 0] })] : [])],
      { lagRatio: 0.15 },
    ),
    animateOut: () => new FadeOut(group, { shift: [-0.4, 0, 0] }),
  };
}

// ---------------------------------------------------------------------------
// statCounter
// ---------------------------------------------------------------------------

export interface StatCounterOptions {
  from?: number;
  decimals?: number;
  unit?: string;
  theme?: ThemeArg;
  point?: number[];
}

/**
 * A big animated number with a label. `playThrough(runTime)` returns the
 * animation that counts from `from` to `to` (the DecimalNumber follows a
 * ValueTracker via an updater, so any tween/rate function works).
 */
export function statCounter(label: string, to: number, options: StatCounterOptions = {}): TemplatePiece & {
  tracker: ValueTracker; number: DecimalNumber; label: Text;
  playThrough(runTime?: number): Animation;
} {
  const th = theme(options.theme);
  const from = options.from ?? 0;
  const tracker = new ValueTracker(from);
  const number = new DecimalNumber(from, {
    numDecimalPlaces: options.decimals ?? 0,
    unit: options.unit ?? "",
    fontSize: 1.2 * th.fontScale,
    color: th.accent,
  });
  number.addUpdater(() => number.setValue(tracker.getValue()));
  number.moveTo([0, 0.35, 0]);
  const labelText = new Text(label, { fontSize: 0.45 * th.fontScale, color: th.foreground });
  labelText.setOpacity(0.8);
  labelText.moveTo([0, -0.55, 0]);
  const group = new Group(number, labelText);
  if (options.point) group.moveTo(options.point);
  return {
    group, tracker, number, label: labelText,
    animateIn: () => new FadeIn(group as any, { shift: [0, 0.3, 0] }),
    animateOut: () => new FadeOut(group as any),
    playThrough: (runTime = 2) => {
      const anim = new ApplyMethod(tracker, "setValue", to);
      anim.runTime = runTime;
      return anim;
    },
  };
}

// ---------------------------------------------------------------------------
// socialShort
// ---------------------------------------------------------------------------

export interface SocialShortOptions {
  header?: Mobject;
  content?: Mobject;
  caption?: Mobject;
  theme?: ThemeArg;
  /** 9:16 world frame (default 4.5 x 8 — frameHeight 8 at 9:16). */
  frameWidth?: number;
  frameHeight?: number;
}

/**
 * A 9:16 vertical-video scaffold: header / content / caption slots with safe
 * margins. Provided mobjects are moved into their slots (and scaled down to
 * fit the safe width if needed); each slot is also returned so demos can add
 * to them later.
 */
export function socialShort(options: SocialShortOptions = {}): TemplatePiece & {
  slots: { header: Group; content: Group; caption: Group };
} {
  const th = theme(options.theme);
  const fw = options.frameWidth ?? 4.5;
  const fh = options.frameHeight ?? 8;
  const safeW = fw - 2 * th.margin;
  const place = (mob: Mobject | undefined, cy: number, maxH: number): Group => {
    const slot = new Group();
    if (mob) {
      if (mob.getWidth() > safeW) mob.scale(safeW / mob.getWidth());
      if (mob.getHeight() > maxH) mob.scale(maxH / mob.getHeight());
      mob.moveTo([0, cy, 0]);
      slot.add(mob);
    }
    return slot;
  };
  const headerH = 1.2;
  const captionH = 1.4;
  const contentH = fh - 2 * th.margin - headerH - captionH - 0.4;
  const header = place(options.header, fh / 2 - th.margin - headerH / 2, headerH);
  const content = place(options.content, (captionH - headerH) / 2, contentH);
  const caption = place(options.caption, -fh / 2 + th.margin + captionH / 2, captionH);
  const group = new Group(header, content, caption);
  return {
    group, slots: { header, content, caption },
    animateIn: () => new LaggedStart(
      [header, content, caption].filter((s) => s.submobjects.length)
        .map((s) => new FadeIn(s as any, { shift: [0, -0.25, 0] })),
      { lagRatio: 0.2 },
    ),
    animateOut: () => new FadeOut(group as any),
  };
}

// ---------------------------------------------------------------------------
// chartReveal
// ---------------------------------------------------------------------------

export interface ChartRevealOptions {
  theme?: ThemeArg;
  lagRatio?: number;
}

/**
 * Staggered entrance for a chart: reveals a BarChart's `bars`, a PieChart's
 * `slices`, or any group's submobjects one by one.
 */
export function chartReveal(chart: any, options: ChartRevealOptions = {}): TemplatePiece {
  const items: Mobject[] =
    chart?.bars?.submobjects?.length ? chart.bars.submobjects
    : chart?.slices?.length ? chart.slices
    : chart?.submobjects ?? [];
  const rest: Mobject[] = chart?.bars?.submobjects?.length
    ? chart.submobjects.filter((m: Mobject) => m !== chart.bars)
    : [];
  return {
    group: chart,
    animateIn: () => new AnimationGroup([
      ...rest.map((m) => new FadeIn(m)),
      new LaggedStart(items.map((m) => new FadeIn(m, { scale: 0.8 })), { lagRatio: options.lagRatio ?? 0.15 }),
    ]),
    animateOut: () => new FadeOut(chart),
  };
}

// ---------------------------------------------------------------------------
// outroCard
// ---------------------------------------------------------------------------

export interface OutroCardOptions {
  handle?: string;
  url?: string;
  theme?: ThemeArg;
}

/** A closing card: call-to-action title, handle/url, accent frame. */
export function outroCard(title: string, options: OutroCardOptions = {}): TemplatePiece & {
  title: Text; handle: Text | null; frame: VMobject;
} {
  const th = theme(options.theme);
  const titleText = new Text(title, { fontSize: 0.85 * th.fontScale, color: th.foreground });
  titleText.moveTo([0, 0.45, 0]);
  const lines = [options.handle, options.url].filter(Boolean).join("   ");
  let handleText: Text | null = null;
  const group = new VGroup(titleText);
  if (lines) {
    handleText = new Text(lines, { fontSize: 0.45 * th.fontScale, color: th.accent });
    handleText.moveTo([0, -0.55, 0]);
    group.add(handleText);
  }
  const frame = new Rectangle({
    width: group.getWidth() + 1.2,
    height: group.getHeight() + 1.1,
    color: th.accent, fillOpacity: 0, strokeWidth: 3,
  });
  frame.moveTo(group.getCenter());
  group.add(frame);
  return {
    group, title: titleText, handle: handleText, frame,
    animateIn: () => new LaggedStart(
      [new Create(frame, { lagRatio: 0 }), new Write(titleText, { runTime: 1.5 }), ...(handleText ? [new FadeIn(handleText)] : [])],
      { lagRatio: 0.25 },
    ),
    animateOut: () => new FadeOut(group),
  };
}
