// Deprecation helper (epic #61 compatibility rules; see AGENTS.md).
//
// Convention for deprecating a public API instead of removing it:
//   1. Keep the old export working, unchanged, for at least one minor release.
//   2. Mark it with a JSDoc `@deprecated` tag naming the replacement.
//   3. Call `deprecate("<stable-id>", "<what to use instead>")` on its first
//      use so users see the warning once at runtime.
//   4. List it under "Deprecated" in CHANGELOG.md; it may only be removed in a
//      later release, listed under "Removed" / "Changed (breaking)".
//
//   /** @deprecated Use {@link newName}. */
//   export function oldName(...args) {
//     deprecate("oldName", "Use newName() instead.");
//     return newName(...args);
//   }

const warned = new Set<string>();

/**
 * Emit a one-time `console.warn` for a deprecated API. Repeated calls with the
 * same `id` are silent, so it is safe to call from hot paths. Isomorphic: no
 * Node-only APIs.
 *
 * @param id Stable identifier for the deprecated thing (the dedupe key).
 * @param message What to do instead, e.g. "Use newName() instead."
 */
export function deprecate(id: string, message: string): void {
  if (warned.has(id)) return;
  warned.add(id);
  console.warn(`[ecmanim] "${id}" is deprecated. ${message}`);
}

/** @internal Test-only: forget which ids have warned. Not part of the public API. */
export function _resetDeprecations(): void {
  warned.clear();
}
