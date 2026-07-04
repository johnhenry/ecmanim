import { test } from "node:test";
import assert from "node:assert/strict";

import {
  savePlaybackPosition, restorePlaybackPosition, enablePageTransitionResume,
} from "../src/page_transition.ts";

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() { return map.size; },
  } as Storage;
}

function fakeWindow(): any {
  const listeners = new Map<string, Set<(ev: any) => void>>();
  return {
    addEventListener(type: string, fn: any) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: any) { listeners.get(type)?.delete(fn); },
    dispatch(type: string, ev: any = {}) { for (const fn of [...(listeners.get(type) ?? [])]) fn(ev); },
  };
}

function fakePlayerEl(currentTime: number): any {
  const listeners = new Map<string, Set<(ev: any) => void>>();
  const canvas: any = { style: {}, toDataURL: () => "data:image/png;base64,fake", parentNode: { insertBefore() {} } };
  const el: any = {
    player: { currentTime, canvas, seekTime(t: number) { this.currentTime = t; } },
    canvas,
    addEventListener(type: string, fn: any) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type: string, fn: any) { listeners.get(type)?.delete(fn); },
    dispatch(type: string, ev: any = {}) { for (const fn of [...(listeners.get(type) ?? [])]) fn(ev); },
  };
  return el;
}

test("savePlaybackPosition + restorePlaybackPosition round-trip through storage", () => {
  const storage = fakeStorage();
  const player = { currentTime: 12.5 };
  savePlaybackPosition(player, { storage });

  const restoreTarget = { seekTime(_t: number) {} };
  let seekedTo: number | null = null;
  restoreTarget.seekTime = (t: number) => { seekedTo = t; };

  const restored = restorePlaybackPosition(restoreTarget, { storage });
  assert.deepEqual(restored, { time: 12.5 });
  assert.equal(seekedTo, 12.5);
});

test("restorePlaybackPosition is one-shot: a second call finds nothing", () => {
  const storage = fakeStorage();
  savePlaybackPosition({ currentTime: 3 }, { storage });
  const target = { seekTime() {} };
  assert.ok(restorePlaybackPosition(target, { storage }));
  assert.equal(restorePlaybackPosition(target, { storage }), null);
});

test("restorePlaybackPosition returns null with no saved position", () => {
  const storage = fakeStorage();
  assert.equal(restorePlaybackPosition({ seekTime() {} }, { storage }), null);
});

test("restorePlaybackPosition returns null and does not throw on corrupt JSON", () => {
  const storage = fakeStorage();
  storage.setItem("ecmanim:playback-position", "{not json");
  assert.doesNotThrow(() => {
    const result = restorePlaybackPosition({ seekTime() {} }, { storage });
    assert.equal(result, null);
  });
});

test("save/restore respect a custom storage key", () => {
  const storage = fakeStorage();
  savePlaybackPosition({ currentTime: 7 }, { storage, key: "myapp:pos" });
  assert.equal(storage.getItem("ecmanim:playback-position"), null);
  let seeked: number | null = null;
  restorePlaybackPosition({ seekTime: (t: number) => { seeked = t; } }, { storage, key: "myapp:pos" });
  assert.equal(seeked, 7);
});

test("savePlaybackPosition is a no-op with no storage backend (private-browsing-safe)", () => {
  assert.doesNotThrow(() => savePlaybackPosition({ currentTime: 1 }, { storage: null }));
});

test("enablePageTransitionResume: pagehide saves, the player's 'ready' event restores", () => {
  const storage = fakeStorage();
  const win = fakeWindow();
  const el = fakePlayerEl(9.5);

  enablePageTransitionResume(el, { storage, windowRef: win });
  win.dispatch("pagehide");
  assert.equal(JSON.parse(storage.getItem("ecmanim:playback-position")!).time, 9.5);

  // Simulate a fresh page: a new player element at t=0, restored via "ready".
  const el2 = fakePlayerEl(0);
  enablePageTransitionResume(el2, { storage, windowRef: win });
  el2.dispatch("ready");
  assert.equal(el2.player.currentTime, 9.5);
});

test("enablePageTransitionResume.detach() removes all listeners", () => {
  const storage = fakeStorage();
  const win = fakeWindow();
  const el = fakePlayerEl(5);
  const handle = enablePageTransitionResume(el, { storage, windowRef: win });
  handle.detach();

  win.dispatch("pagehide");
  assert.equal(storage.getItem("ecmanim:playback-position"), null, "detached: pagehide must not save");
});

test("viewTransition: false (default) never touches the canvas or creates a snapshot image", () => {
  const storage = fakeStorage();
  const win = fakeWindow();
  const el = fakePlayerEl(3);
  enablePageTransitionResume(el, { storage, windowRef: win });
  win.dispatch("pagehide");
  assert.equal(el.canvas.style.visibility, undefined);
});

test("viewTransition: true tags the canvas with a view-transition-name and hides it behind a snapshot <img> on pagehide", () => {
  const storage = fakeStorage();
  const win = fakeWindow();
  const doc = {
    createElement: (_tag: string) => ({ style: {}, remove() {} }),
  };
  const el = fakePlayerEl(4);
  let insertedImg: any = null;
  el.canvas.parentNode.insertBefore = (img: any) => { insertedImg = img; };

  enablePageTransitionResume(el, { storage, windowRef: win, documentRef: doc, viewTransition: true });
  win.dispatch("pagehide");

  assert.ok(insertedImg, "a snapshot <img> should have been inserted");
  assert.equal(insertedImg.style.viewTransitionName, "ecmanim-player-snapshot");
  assert.equal(el.canvas.style.visibility, "hidden");
});

test("viewTransition: true tags the incoming canvas with the same view-transition-name on 'ready'", () => {
  const storage = fakeStorage();
  const win = fakeWindow();
  const el = fakePlayerEl(0);
  enablePageTransitionResume(el, { storage, windowRef: win, viewTransition: true });
  el.dispatch("ready");
  assert.equal(el.canvas.style.viewTransitionName, "ecmanim-player-snapshot");
});

test("a custom viewTransitionName is honored on both sides of the handoff", () => {
  const storage = fakeStorage();
  const win = fakeWindow();
  const doc = { createElement: () => ({ style: {}, remove() {} }) };
  const el = fakePlayerEl(1);
  let insertedImg: any = null;
  el.canvas.parentNode.insertBefore = (img: any) => { insertedImg = img; };
  enablePageTransitionResume(el, {
    storage, windowRef: win, documentRef: doc, viewTransition: true, viewTransitionName: "my-transition",
  });
  win.dispatch("pagehide");
  assert.equal(insertedImg.style.viewTransitionName, "my-transition");
});
