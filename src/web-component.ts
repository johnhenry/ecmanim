// A framework-agnostic <manim-player> custom element wrapping the Player class.
//
// IMPORTANT — Node import safety:
// This module is imported by tests running under plain Node, where HTMLElement
// and customElements do NOT exist. Referencing `class X extends HTMLElement`
// at the top level of the module would throw at IMPORT time (HTMLElement is
// undefined). To stay import-safe we NEVER reference HTMLElement at module
// top-level. Instead:
//   - `buildElementClass()` builds the class body lazily, inside a function
//     guarded by `typeof HTMLElement !== "undefined"`.
//   - The exported `ManimPlayerElement` is either the real DOM-backed class
//     (in a browser) or a harmless placeholder class (in Node). In both cases
//     `typeof ManimPlayerElement === "function"`.
//   - `defineManimPlayer()` no-ops and returns false when customElements /
//     HTMLElement are unavailable, and returns true after registering.

import { Player, type PlayerOptions } from "./player.ts";

const G: any = globalThis as any;

/** True when we're in an environment with the DOM APIs we need to register. */
function hasDom(): boolean {
  return (
    typeof G.HTMLElement !== "undefined" &&
    typeof G.customElements !== "undefined" &&
    typeof G.customElements.define === "function"
  );
}

// Cache of the built class so repeated defineManimPlayer() calls reuse it.
let _builtClass: any = null;

/**
 * Build the DOM-backed custom element class. MUST only be called when
 * `typeof HTMLElement !== "undefined"`. Kept inside a function so the
 * `extends HTMLElement` reference is never evaluated at module import time.
 */
function buildElementClass(): any {
  if (_builtClass) return _builtClass;
  if (typeof G.HTMLElement === "undefined") {
    throw new Error("buildElementClass() called without HTMLElement in scope");
  }

  const HTMLElementRef = G.HTMLElement;

  class ManimPlayerElementImpl extends HTMLElementRef {
    static get observedAttributes(): string[] {
      return ["quality", "fps", "background", "autoplay", "loop", "controls", "width", "height"];
    }

    // Internal state ---------------------------------------------------------
    _player: Player | null = null;
    _canvas: any = null;
    _scene: any = null;
    _recording: Promise<void> | null = null;
    _controlsBar: any = null;
    _playBtn: any = null;
    _scrubber: any = null;
    _ready = false;

    // --- Lifecycle ----------------------------------------------------------
    connectedCallback(): void {
      if (this._canvas) return; // already set up
      this._setup();
    }

    disconnectedCallback(): void {
      try {
        this._player?.pause();
      } catch { /* ignore */ }
    }

    attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void {
      // Attribute changes after setup are best-effort: rebuild the player so
      // new quality/fps/size take effect. Only act once we're connected.
      if (oldValue === newValue) return;
      if (!this._canvas) return; // not connected yet; connectedCallback handles it
      // Re-setup with new options, preserving the scene.
      this._teardown();
      this._setup();
    }

    // --- Public imperative API ---------------------------------------------
    /** Set the Scene class (or construct fn). Records if already connected. */
    set scene(value: any) {
      this._scene = value;
      if (this._player && value != null) {
        this._record();
      }
    }

    get scene(): any {
      return this._scene;
    }

    get player(): Player | null {
      return this._player;
    }

    get currentFrame(): number {
      return this._player ? this._player.currentFrame : 0;
    }

    seekTo(frame: number): void {
      this._player?.seek(frame);
      this._syncScrubber();
    }

    seekToTime(sec: number): void {
      this._player?.seekTime(sec);
      this._syncScrubber();
    }

    play(): void {
      this._player?.play();
      this._syncPlayButton();
    }

    pause(): void {
      this._player?.pause();
      this._syncPlayButton();
    }

    // --- Internal helpers ---------------------------------------------------
    _readOptions(): PlayerOptions {
      const opts: PlayerOptions = {};
      const q = this.getAttribute("quality");
      if (q) opts.quality = q;
      const fps = this.getAttribute("fps");
      if (fps && !Number.isNaN(Number(fps))) opts.fps = Number(fps);
      const bg = this.getAttribute("background");
      if (bg) opts.background = bg;
      const w = this.getAttribute("width");
      if (w && !Number.isNaN(Number(w))) opts.pixelWidth = Number(w);
      const h = this.getAttribute("height");
      if (h && !Number.isNaN(Number(h))) opts.pixelHeight = Number(h);
      return opts;
    }

    _setup(): void {
      const doc = G.document;
      if (!doc) return;

      // Create the display canvas.
      this._canvas = doc.createElement("canvas");
      this._canvas.style.display = "block";
      this._canvas.style.maxWidth = "100%";
      this.appendChild(this._canvas);

      const opts = this._readOptions();
      opts.canvas = this._canvas;
      this._player = new Player(opts);

      // Wire onFrame -> "frame" event + "ended" detection.
      this._player.onFrame = (frame: number, time: number) => {
        this._syncScrubber();
        this._dispatch("frame", { frame, time });
        const last = this._player ? this._player.frameCount - 1 : 0;
        if (this._player && frame >= last && last >= 0 && !this._player.playing) {
          this._onEnded();
        }
      };

      if (this.hasAttribute("controls")) {
        this._buildControls();
      }

      if (this._scene != null) {
        this._record();
      }
    }

    _teardown(): void {
      try {
        this._player?.pause();
      } catch { /* ignore */ }
      // Remove any children we created (canvas + controls).
      if (this._canvas && this._canvas.parentNode === this) {
        this.removeChild(this._canvas);
      }
      if (this._controlsBar && this._controlsBar.parentNode === this) {
        this.removeChild(this._controlsBar);
      }
      this._canvas = null;
      this._controlsBar = null;
      this._playBtn = null;
      this._scrubber = null;
      this._player = null;
      this._ready = false;
      this._recording = null;
    }

    _record(): void {
      if (!this._player || this._scene == null) return;
      this._ready = false;
      const scene = this._scene;
      const rec = this._player
        .record(scene)
        .then(() => {
          this._ready = true;
          this._syncScrubber();
          const p = this._player;
          this._dispatch("ready", {
            duration: p ? p.duration : 0,
            frameCount: p ? p.frameCount : 0,
          });
          if (this.hasAttribute("autoplay")) {
            this.play();
          }
        })
        .catch((err: any) => {
          this._dispatch("error", { error: err });
        });
      this._recording = rec;
    }

    _onEnded(): void {
      this._syncPlayButton();
      this._dispatch("ended", {});
      if (this.hasAttribute("loop")) {
        this._player?.seek(0);
        this._player?.play();
        this._syncPlayButton();
      }
    }

    // --- Controls UI --------------------------------------------------------
    _buildControls(): void {
      const doc = G.document;
      if (!doc || this._controlsBar) return;

      const bar = doc.createElement("div");
      bar.style.display = "flex";
      bar.style.alignItems = "center";
      bar.style.gap = "8px";

      const btn = doc.createElement("button");
      btn.type = "button";
      btn.textContent = "Play";
      btn.addEventListener("click", () => {
        if (this._player && this._player.playing) {
          this.pause();
        } else {
          this.play();
        }
      });

      const scrubber = doc.createElement("input");
      scrubber.type = "range";
      scrubber.min = "0";
      scrubber.max = "0";
      scrubber.step = "1";
      scrubber.value = "0";
      scrubber.style.flex = "1";
      scrubber.addEventListener("input", () => {
        const v = Number(scrubber.value);
        if (!Number.isNaN(v)) this.seekTo(v);
      });

      bar.appendChild(btn);
      bar.appendChild(scrubber);
      this.appendChild(bar);

      this._controlsBar = bar;
      this._playBtn = btn;
      this._scrubber = scrubber;
    }

    _syncScrubber(): void {
      if (!this._scrubber || !this._player) return;
      const max = Math.max(0, this._player.frameCount - 1);
      this._scrubber.max = String(max);
      this._scrubber.value = String(this._player.currentFrame);
      this._syncPlayButton();
    }

    _syncPlayButton(): void {
      if (!this._playBtn || !this._player) return;
      this._playBtn.textContent = this._player.playing ? "Pause" : "Play";
    }

    _dispatch(type: string, detail: any): void {
      try {
        if (typeof G.CustomEvent === "function") {
          this.dispatchEvent(new G.CustomEvent(type, { detail, bubbles: true }));
        } else if (typeof this.dispatchEvent === "function") {
          const ev: any = { type, detail };
          this.dispatchEvent(ev);
        }
      } catch { /* dispatch not supported in this host — ignore */ }
    }
  }

  _builtClass = ManimPlayerElementImpl;
  return _builtClass;
}

/**
 * The exported custom element class.
 *
 * In a browser this is the real DOM-backed element. In Node (no HTMLElement)
 * it is a harmless placeholder so that `typeof ManimPlayerElement === "function"`
 * always holds and importing this module never throws.
 */
export const ManimPlayerElement: any = (() => {
  if (typeof G.HTMLElement !== "undefined") {
    try {
      return buildElementClass();
    } catch {
      // Fall through to placeholder if building fails for any reason.
    }
  }
  // Node placeholder: a plain class that does not extend HTMLElement.
  return class ManimPlayerElement {
    static get observedAttributes(): string[] {
      return ["quality", "fps", "background", "autoplay", "loop", "controls", "width", "height"];
    }
  };
})();

/**
 * Register the <manim-player> custom element.
 *
 * @param tag Custom element tag name (defaults to "manim-player").
 * @returns true if registered, false if no DOM is available (Node).
 */
export function defineManimPlayer(tag = "manim-player"): boolean {
  if (!hasDom()) return false;
  try {
    // Reuse an existing registration if the tag is already defined.
    if (typeof G.customElements.get === "function" && G.customElements.get(tag)) {
      return true;
    }
    const cls = buildElementClass();
    G.customElements.define(tag, cls);
    return true;
  } catch {
    return false;
  }
}
