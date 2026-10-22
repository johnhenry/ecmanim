# Stick Nodes cross-validation fixtures

Each `<name>.nodes` is a Stick Nodes figure of our own design, written by
[sticknodes-rs](https://github.com/vinceTheProgrammer/sticknodes-rs) (MIT,
Copyright (c) 2025 vinceTheProgrammer; commit e946a8f, crate 4.0.0-alpha).
Each `<name>.json` is what sticknodes-rs itself decoded when it read that file
back (`Stickfigure::from_bytes` -> `to_serializable()`, plus the geometry it
derives from lengths and angles). `test/sticknodes-crossval.test.ts` asserts
`parseStickNodes()` agrees with every JSON field.

These are NOT files saved by the Stick Nodes app. They validate our reading of
the layout against an independent implementation, not the axis convention or the
project formats (see `docs/skeletal.md`).

Figures: `humanoid-*` (rigs with colours, gradient, polyfills, segment scale),
`shapes-*` (every node type incl. both right-triangle directions, trapezoid,
polygon, curve), `flags-*` (angle locks, drag lock, smart stretch, floaty),
`connectors-*`. The suffix is `<version>-<build>`.

Known reference limits worked around by the generator: sticknodes-rs's writer
cannot round-trip build 36, or a connector node sharing a parent with a plain
sibling, and its writer only emits raw big-endian files (so the zlib-wrapped
path is covered by synthetic tests, not these fixtures).

## Regenerating (dev only; not shipped: `test/` is outside package `files`)

`generator/` is a Rust crate depending on a local checkout of sticknodes-rs.

    git clone https://github.com/vinceTheProgrammer/sticknodes-rs /tmp/sticknodes-rs
    git -C /tmp/sticknodes-rs checkout e946a8f
    cd test/fixtures/sticknodes/generator
    # RUSTC_BOOTSTRAP=1: sticknodes-rs's byteorder-core2 enables core2's
    # `nightly` feature, which stable rustc rejects. Cargo.lock pins the
    # yanked core2 0.4.0 that the reference itself uses.
    RUSTC_BOOTSTRAP=1 cargo run -- ..
