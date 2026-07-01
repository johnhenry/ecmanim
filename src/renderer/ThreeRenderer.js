// WebGL renderer backed by Three.js. Reuses the exact same Scene / mobjects /
// animations as the Canvas-2D backend — only the draw step differs. Fills become
// vertex-colored triangle meshes, strokes become line segments, text becomes
// billboard sprites, all uploaded to the GPU. This gives a hardware depth buffer
// (perfect interpenetration for free), MSAA, and real-time interactivity.
//
// THREE is injected (not imported) so this module stays out of non-WebGL builds
// and can be unit-tested with a mock.

import * as V from "../core/math/vector.js";
import { collectBuffers } from "./geometry_util.js";

export class ThreeRenderer {
  constructor(THREE, opts = {}) {
    this.THREE = THREE;
    this.camera = opts.camera;
    this.background = opts.background ?? "#000000";

    // Pass our 0..1 colors straight through (no linear/sRGB conversion) so the
    // WebGL output matches the CPU renderer.
    if (THREE.ColorManagement) THREE.ColorManagement.enabled = false;

    this.renderer = new THREE.WebGLRenderer({ canvas: opts.canvas, antialias: opts.antialias ?? true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(this.camera.pixelWidth, this.camera.pixelHeight, false);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(this.background);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.threeCamera = this._makeCamera();
  }

  is3D() {
    return typeof this.camera.projectionDepth === "function";
  }

  _makeCamera() {
    const { THREE, camera } = this;
    if (this.is3D()) {
      const fov = (2 * Math.atan((camera.frameHeight / 2) / camera.focalDistance) * 180) / Math.PI;
      return new THREE.PerspectiveCamera(fov, camera.pixelWidth / camera.pixelHeight, 0.01, camera.focalDistance * 40 + 200);
    }
    const w = camera.frameWidth / 2, h = camera.frameHeight / 2;
    return new THREE.OrthographicCamera(-w, w, h, -h, -1000, 1000);
  }

  // Position the Three camera to reproduce ThreeDCamera's phi/theta/focal view.
  syncCamera() {
    const { camera, threeCamera } = this;
    const center = camera.frameCenter ?? [0, 0, 0];
    if (this.is3D()) {
      // Inverse of ThreeDCamera.toCameraSpace: rotate camera-space basis into world.
      const rot = (v) => V.rotateVector(V.rotateVector(v, camera.phi, [1, 0, 0]), camera.theta + 90 * V.DEGREES, [0, 0, 1]);
      const eye = V.add(center, rot([0, 0, camera.focalDistance]));
      const up = rot([0, 1, 0]);
      threeCamera.position.set(eye[0], eye[1], eye[2]);
      threeCamera.up.set(up[0], up[1], up[2]);
      threeCamera.lookAt(center[0], center[1], center[2]);
      threeCamera.fov = (2 * Math.atan((camera.frameHeight / 2) / camera.focalDistance) * 180) / Math.PI;
      threeCamera.zoom = camera.zoom ?? 1;
    } else {
      threeCamera.position.set(center[0], center[1], 100);
      threeCamera.up.set(0, 1, 0);
      threeCamera.lookAt(center[0], center[1], 0);
      threeCamera.zoom = camera.zoom ?? 1;
    }
    threeCamera.updateProjectionMatrix();
  }

  render(mobjects) {
    const buf = collectBuffers(mobjects);
    this._clearGroup();

    if (buf.opaque.positions.length) this.group.add(this._mesh(buf.opaque, false, 1));
    for (const b of buf.transparent) this.group.add(this._mesh(b, true, b.alpha));
    if (buf.lines.positions.length) this.group.add(this._lines(buf.lines));
    for (const t of buf.texts) { const s = this._textSprite(t); if (s) this.group.add(s); }

    this.syncCamera();
    this.renderer.render(this.scene, this.threeCamera);
  }

  _mesh(buf, transparent, alpha) {
    const { THREE } = this;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(buf.positions, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(buf.colors, 3));
    const m = new THREE.MeshBasicMaterial({
      vertexColors: true, side: THREE.DoubleSide,
      transparent, opacity: transparent ? alpha : 1, depthWrite: !transparent,
    });
    return new THREE.Mesh(g, m);
  }

  _lines(buf) {
    const { THREE } = this;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(buf.positions, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(buf.colors, 3));
    return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }));
  }

  _textSprite(mob) {
    const { THREE } = this;
    if (typeof document === "undefined") return null; // headless / node: skip
    const lines = mob.text.split("\n");
    const fontPx = 64;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.font = `${mob.weight ?? "normal"} ${fontPx}px ${mob.font ?? "sans-serif"}`;
    const wPx = Math.max(1, ...lines.map((l) => ctx.measureText(l).width));
    canvas.width = Math.ceil(wPx);
    canvas.height = Math.ceil(fontPx * 1.3 * lines.length);
    const c2 = canvas.getContext("2d");
    c2.font = `${mob.weight ?? "normal"} ${fontPx}px ${mob.font ?? "sans-serif"}`;
    c2.textAlign = "center";
    c2.textBaseline = "middle";
    c2.fillStyle = mob.fillColor.toRGBAString((mob.fillOpacity ?? 1) * (mob.opacity ?? 1));
    lines.forEach((l, i) => c2.fillText(l, canvas.width / 2, fontPx * 1.3 * (i + 0.5)));
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    const center = mob.getCenter();
    sprite.position.set(center[0], center[1], center[2]);
    const wh = mob.getHeight() || mob.fontSize || 0.5;
    sprite.scale.set(wh * (canvas.width / canvas.height), wh, 1);
    return sprite;
  }

  _clearGroup() {
    for (const child of this.group.children) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    }
    this.group.clear();
  }

  setSize(pixelWidth, pixelHeight) {
    this.camera.pixelWidth = pixelWidth;
    this.camera.pixelHeight = pixelHeight;
    this.renderer.setSize(pixelWidth, pixelHeight, false);
    if (this.threeCamera.isPerspectiveCamera) this.threeCamera.aspect = pixelWidth / pixelHeight;
    this.threeCamera.updateProjectionMatrix();
  }

  dispose() {
    this._clearGroup();
    this.renderer.dispose();
  }
}
