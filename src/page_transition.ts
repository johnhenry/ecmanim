// Resume <manim-player> playback across a full page navigation. Browser-only
// (sessionStorage + pagehide/pageshow are browser concepts) -- exported from
// "ecmanim/browser", not the isomorphic core.
//
// Two composable pieces:
//   - savePlaybackPosition()/restorePlaybackPosition(): the actual state
//     (just {time}), read/written directly -- no event wiring, fully testable
//     without faking `window`.
//   - enablePageTransitionResume(): the convenience auto-wiring (pagehide ->
//     save, player "ready" -> restore), plus an opt-in View Transitions
//     snapshot handoff.
//
// There is no prior art for this in the codebase (no persistence code
// existed anywhere before this module). What needs to survive a navigation
// is tiny -- which scene, and a time-in-seconds -- so `Player.record()` is
// meant to just re-run fresh on the new page as always; this module only
// restores the PLAYBACK POSITION afterward, not the recorded frames
// themselves.

export interface PlaybackPosition {
  time: number;
}

export interface SavePositionOptions {
  /** sessionStorage key. Default "ecmanim:playback-position". */
  key?: string;
  /** Injectable storage, for testing. Defaults to window.sessionStorage. */
  storage?: Storage | null;
}

function resolveStorage(storage?: Storage | null): Storage | null {
  if (storage !== undefined) return storage;
  const g: any = globalThis as any;
  return typeof g.sessionStorage !== "undefined" ? g.sessionStorage : null;
}

/** Save a player's current playback position. No-op if no storage backend
 *  is available (e.g. sessionStorage disabled/unavailable). */
export function savePlaybackPosition(player: { currentTime: number }, opts: SavePositionOptions = {}): void {
  const storage = resolveStorage(opts.storage);
  if (!storage) return;
  const key = opts.key ?? "ecmanim:playback-position";
  try {
    storage.setItem(key, JSON.stringify({ time: player.currentTime } satisfies PlaybackPosition));
  } catch {
    // storage full/unavailable (e.g. private browsing quota) -- best-effort only.
  }
}

/**
 * Restore (and consume -- one-shot, so a plain reload doesn't keep re-seeking)
 * a previously-saved playback position onto `player` via `seekTime()`.
 * Returns the restored position, or null if none was saved / it was corrupt.
 */
export function restorePlaybackPosition(
  player: { seekTime(seconds: number): void },
  opts: SavePositionOptions = {},
): PlaybackPosition | null {
  const storage = resolveStorage(opts.storage);
  if (!storage) return null;
  const key = opts.key ?? "ecmanim:playback-position";
  const raw = storage.getItem(key);
  if (!raw) return null;
  storage.removeItem(key);
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed?.time !== "number") return null;
    player.seekTime(parsed.time);
    return parsed;
  } catch {
    return null;
  }
}

export interface PageTransitionOptions extends SavePositionOptions {
  /**
   * Opt-in: also perform a View-Transitions-API snapshot handoff around the
   * navigation. Canvases don't participate in the browser's DOM-snapshot
   * mechanism directly, so this captures the outgoing frame into a plain
   * `<img>` positioned over the live canvas (tagged with a
   * `view-transition-name`) right before the page unloads, and tags the
   * incoming page's canvas with the same name so the browser can cross-fade/
   * morph between them. Default false (the plain sessionStorage + seekTime()
   * resume above covers position; this only adds visual continuity).
   */
  viewTransition?: boolean;
  /** The view-transition-name shared between the outgoing snapshot and the
   *  incoming canvas. Default "ecmanim-player-snapshot". */
  viewTransitionName?: string;
  /** Injectable window (for the pagehide listener) and document (for the
   *  snapshot <img>), for testing. Default the real globals. */
  windowRef?: any;
  documentRef?: any;
}

export interface PageTransitionHandle {
  detach(): void;
}

/**
 * Auto-wires a `<manim-player>` element's playback position to survive a
 * full page navigation: saves on `pagehide`, restores on the player's own
 * "ready" event (dispatched after every `record()`, i.e. once the new
 * page's fresh recording is ready to be seeked).
 */
export function enablePageTransitionResume(playerEl: any, opts: PageTransitionOptions = {}): PageTransitionHandle {
  const win = opts.windowRef ?? (typeof window !== "undefined" ? window : null);
  const doc = opts.documentRef ?? (typeof document !== "undefined" ? document : null);
  const viewTransitionName = opts.viewTransitionName ?? "ecmanim-player-snapshot";

  const onPageHide = (): void => {
    const player = playerEl.player;
    if (player) savePlaybackPosition(player, opts);
  };

  const onReady = (): void => {
    const player = playerEl.player;
    if (player) restorePlaybackPosition(player, opts);
  };

  let snapshotImg: any = null;
  const onPageHideSnapshot = (): void => {
    if (!opts.viewTransition || !doc) return;
    const canvas = playerEl.player?.canvas ?? playerEl.canvas;
    if (!canvas?.toDataURL) return;
    try {
      const img = doc.createElement("img");
      img.src = canvas.toDataURL();
      img.style.cssText = "position:absolute;inset:0;width:100%;height:100%";
      img.style.viewTransitionName = viewTransitionName;
      canvas.parentNode?.insertBefore(img, canvas);
      if (canvas.style) canvas.style.visibility = "hidden";
      snapshotImg = img;
    } catch {
      // canvas may be tainted (cross-origin content) or toDataURL unsupported -- skip silently.
    }
  };

  const onReadyIncomingName = (): void => {
    if (!opts.viewTransition) return;
    const canvas = playerEl.player?.canvas ?? playerEl.canvas;
    if (canvas?.style) canvas.style.viewTransitionName = viewTransitionName;
  };

  win?.addEventListener?.("pagehide", onPageHide);
  win?.addEventListener?.("pagehide", onPageHideSnapshot);
  playerEl.addEventListener?.("ready", onReady);
  playerEl.addEventListener?.("ready", onReadyIncomingName);

  return {
    detach(): void {
      win?.removeEventListener?.("pagehide", onPageHide);
      win?.removeEventListener?.("pagehide", onPageHideSnapshot);
      playerEl.removeEventListener?.("ready", onReady);
      playerEl.removeEventListener?.("ready", onReadyIncomingName);
      snapshotImg?.remove?.();
    },
  };
}
