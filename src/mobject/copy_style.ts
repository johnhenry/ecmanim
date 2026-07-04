// Shared denylist-based memberwise style copy, extracted from
// Mobject.become() (previously the only place this existed, with its own
// doc comment literally calling it "the primitive behind always_redraw and
// transform-less morphs"). alwaysRedraw() (value_tracker.ts) and reactive()
// (reactive/signal.ts) each independently hardcoded their OWN allowlist of
// "common style fields" -- different subsets (alwaysRedraw's 7-property list
// was missing "radius", which reactive()'s 9-property list had) -- so a
// custom field on a user's Mobject subclass would silently fail to redraw
// depending on which of the three code paths built it. A denylist (copy
// everything except identity/structural fields) instead of an allowlist
// fixes this class of bug for any current or future subclass field.

/** Fields that must NEVER be copied wholesale from one mobject to another:
 *  identity, already-explicitly-handled geometry, or animation/updater state
 *  that copying would corrupt (e.g. silently un-suspending a mid-animation
 *  mobject, or aliasing another mobject's saved-state/target references). */
const BASE_EXCLUDE = [
  "id", "points", "submobjects", "color", "_color",
  "updaters", "savedState", "target", "updatingSuspended",
];

/**
 * Copy every enumerable own property from `src` to `dest` except identity/
 * structural fields (see BASE_EXCLUDE) and any caller-supplied `extraExclude`.
 * Used by Mobject.become(), alwaysRedraw(), and reactive()'s rebuild step so
 * all three redraw a mobject's custom style fields identically.
 */
export function copyMemberwiseStyle(dest: any, src: any, extraExclude: string[] = []): void {
  const exclude = extraExclude.length ? new Set([...BASE_EXCLUDE, ...extraExclude]) : new Set(BASE_EXCLUDE);
  for (const key of Object.keys(src)) {
    if (exclude.has(key)) continue;
    dest[key] = src[key];
  }
}
