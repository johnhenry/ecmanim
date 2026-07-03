# ecmanim skills

A hierarchical set of [Claude Code Skills](https://docs.claude.com/en/docs/claude-code/skills)
for authoring, rendering, and iterating on [ecmanim](../README.md) content
with an LLM agent.

This directory is **not** `.claude/skills/` — it ships as plain reference
material so nothing auto-activates just because you cloned or installed the
package. Nothing here runs on `npm install`; you (or your tooling) opt in
explicitly, either way below.

### Option A: `skills-npm` (recommended if you already use it)

This folder follows the [`skills-npm`](https://github.com/antfu/skills-npm)
convention — a `skills/<name>/SKILL.md` layout that its CLI discovers across
your `node_modules` and symlinks into whichever agent directories you have
(`.claude/skills/`, `.cursor/skills/`, etc). If `ecmanim` is a dependency of
your project:

```bash
npx skills-npm
```

This is a command *you* run — nothing installs automatically as a side effect
of `npm install ecmanim`. See the `skills-npm` README for config (`agents`,
`include`/`exclude`, a `prepare`-script setup mode, etc).

### Option B: copy/symlink manually

```bash
# all of them, into your project's skills
cp -r skills/ecmanim* /path/to/your-project/.claude/skills/

# or just the root skill + one domain, into your personal skills
ln -s "$(pwd)/skills/ecmanim" ~/.claude/skills/ecmanim
ln -s "$(pwd)/skills/ecmanim-voiceover" ~/.claude/skills/ecmanim-voiceover
```

## Layout

Start with [`ecmanim/SKILL.md`](ecmanim/SKILL.md) — the root skill. It covers
the core authoring loop (Plan → Code → Render → Verify → Iterate) and routes
to the domain skill that fits the task at hand:

| Skill | Covers |
|---|---|
| [`ecmanim`](ecmanim/SKILL.md) | Root: quickstart, authoring loop, routing table |
| [`ecmanim-timeline`](ecmanim-timeline/SKILL.md) | `Timeline` position grammar, expression drivers, `VectorDecimalNumber`, style/aspect-ratio presets, `renderStill` |
| [`ecmanim-captions-audio`](ecmanim-captions-audio/SKILL.md) | Captions (SRT/karaoke/TikTok-style), audio-reactive visuals (FFT/waveform) |
| [`ecmanim-voiceover`](ecmanim-voiceover/SKILL.md) | `voiceover()`, bookmarks, TTS provider abstraction |
| [`ecmanim-presentation`](ecmanim-presentation/SKILL.md) | Shared-element transforms, slide/presenter controls, diagram-as-code |
| [`ecmanim-interchange`](ecmanim-interchange/SKILL.md) | Lottie, OpenTimelineIO export, real-TeX, watermarking |
| [`ecmanim-physics`](ecmanim-physics/SKILL.md) | Analytic EM/wave/optics fields, rigid-body simulation |
| [`ecmanim-authoring-pipeline`](ecmanim-authoring-pipeline/SKILL.md) | `ecmanim/authoring`: plan-IR/dry-run, quality gates, Format lifecycle, providers, built-in formats |
| [`ecmanim-studio`](ecmanim-studio/SKILL.md) | `ecmanim/studio`: live-reload dev server, schema→controls |
| [`ecmanim-render-cli`](ecmanim-render-cli/SKILL.md) | The `ecmanim` CLI, quality/output presets, caching, renderer backends |
| [`ecmanim-practical-authoring`](ecmanim-practical-authoring/SKILL.md) | Layout math (frame geometry, measured text width, `Axes` centering), a verification discipline for catching problems before render, confirmed library gotchas with workarounds, a bug-report template |

## Design notes

These skills follow the [skill-creator](https://github.com/anthropics/skills)
convention (YAML frontmatter `name`/`description`, lean SKILL.md bodies,
progressive disclosure into `docs/`) and were grounded directly in ecmanim's
own `docs/*.md` and source — every code sample and flag/gotcha was verified
against the actual API, not recalled from training data.

The shared authoring loop and the `ecmanim-authoring-pipeline` skill's
plan/quality-gate/Format-lifecycle design were informed by a survey of
existing LLM-driven animation tooling: Manim-specific agent frameworks
(render-in-the-loop self-correction, code-writer/code-reviewer splits,
vision-in-the-loop escalation), `scrollmark/showrunner`'s
plan → generateAssets → compose → revise Format contract and provider
abstraction, and `OpenMontage`'s layered tools/skills/knowledge-pack
architecture and pre/post-render validation gates. ecmanim's own
`ecmanim/authoring` subpath already implements the engine-level version of
these ideas (see that skill) — the skills here are the missing agent-facing
layer on top of it.

`ecmanim-practical-authoring` was synthesized from a field report of real
scene-authoring work and re-verified line by line against current `main`
before merging — every constant (frame geometry, the `Text` width formula),
every behavioral claim (`Axes` coordinate mapping), and every "confirmed" bug
status was independently re-checked, not copied on trust. That process
caught real drift: two of the three reported bugs turned out to still be
open as of the version the report cited them fixed against — both landed
real fixes on `main` by the time this skill merged, so the skill documents
their actual current status rather than repeating a stale claim.
