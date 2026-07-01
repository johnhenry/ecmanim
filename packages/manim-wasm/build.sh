#!/usr/bin/env bash
# Build the shared math core to WebAssembly. Uses a transient `lld` (wasm-ld) via
# nix-shell so no system change is required; needs `rustc` with the
# wasm32-unknown-unknown target (bundled). Output: manim_core.wasm.
set -euo pipefail
cd "$(dirname "$0")"

build() {
  rustc --target wasm32-unknown-unknown --crate-type cdylib -C linker=wasm-ld \
    -C opt-level=3 -C lto=fat -C panic=abort \
    lib.rs -o manim_core.wasm
}

if command -v wasm-ld >/dev/null 2>&1; then
  build
else
  nix-shell -p lld --run "$(declare -f build); build"
fi

ls -l manim_core.wasm
echo "built manim_core.wasm"
