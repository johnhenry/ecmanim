# Campaign 5 (Lottie) — Handoff

_Auto-written during session recovery on 2026-07-10 after the working session
repeatedly OOM-crashed. Treat git history and the per-agent reports as the
source of truth; this is a pointer, not a full record._

## Where things stand

**Committed & pushed (main):**
- `6c79a00` Lottie corpus — 5 lottie-web demos (MIT) + feature census
- `27a0a1a` Lottie demo harness
- `b8e0504` Lottie L1: deterministic player — `loadLottie` -> `LottieMobject`

**Just committed during recovery:**
- L2 demo sources: `examples/lottie-parity/01-bodymovin.ts` … `05-navidad.ts`
  (all 5, type-check clean). 4 of 5 have rendered `.mp4`s in
  `examples/lottie-parity/out/` (01–04); **05-navidad is NOT yet rendered.**

## Known blocker — DO NOT render blindly

Rendering a single Lottie demo through the canvas/frame path consumed **12 GB+
of RAM and was OOM-killed** every time (the render of `05-navidad` specifically
killed the session ~4 times on 2026-07-10). This is native (off-JS-heap) memory,
so `--max-old-space-size` does not bound it. Almost certainly an unbounded
accumulation / leak in the render frame path (same family as the earlier
`@napi-rs/canvas` text OOM).

**Before rendering again:** investigate frame-buffer accumulation in the render
loop (`src/node.ts` render path) and cap it, and always render inside a memory
cgroup, e.g.:

```
systemd-run --user --scope -p MemoryMax=8G -p MemorySwapMax=0 \
  node --experimental-strip-types examples/lottie-parity/05-navidad.ts
```

so a runaway render dies as one process instead of taking the machine (or the
remote-control session) down.

## Suggested next steps

1. Fix/limit the render-path memory growth (above).
2. Render `05-navidad` under a cgroup cap; verify frames.
3. Continue Campaign 5 in a **fresh session** — the prior session's history had
   grown to ~96 MB / 750k tokens and cost 12+ GB just to load, which is what
   forced this recovery. Its pre-2026-07-10 transcript is archived at
   `~/.claude/projects/-home-christopher-claude-hub/2d90d953-….jsonl.full-backup-20260710`;
   the six completed agents' final reports are in that session's `subagents/` dir.
