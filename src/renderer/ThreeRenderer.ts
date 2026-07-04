// WebGL renderer backed by Three.js. Reuses the exact same Scene / mobjects /
// animations as the Canvas-2D backend — only the draw step differs. Fills become
// vertex-colored triangle meshes, strokes become line segments, text becomes
// billboard sprites, all uploaded to the GPU. This gives a hardware depth buffer
// (perfect interpenetration for free), MSAA, and real-time interactivity.
//
// THREE is injected (not imported) so this module stays out of non-WebGL builds
// and can be unit-tested with a mock.

import * as V from "../core/math/vector.ts";
import { collectBuffers } from "./geometry_util.ts";
import { makeBezierStrokeMaterial, buildStrokeGeometry } from "./bezier_shader.ts";
import type { Mobject } from "../mobject/Mobject.ts";

export interface ThreeRendererOptions {
  camera?: any;
  background?: string;
  canvas?: any;
  antialias?: boolean;
  // Stroke rendering path. 'line' (default) = thin 1px THREE.LineSegments,
  // matching the original behavior. 'sdf' = thick, anti-aliased screen-space
  // signed-distance strokes via the bezier shader material.
  strokeMode?: "line" | "sdf";
  // Half/full pixel width for the SDF stroke path.
  strokeWidth?: number;
  // Enable GPU lighting for fill meshes (MeshStandardMaterial + normals + a
  // directional/ambient light). Default false keeps baked-color MeshBasicMaterial.
  lit?: boolean;
  [key: string]: any;
}

// Default scene light direction, matching the CPU shading normal.
const LIGHT_DIR: [number, number, number] = V.normalize([-1, -1, 1]) as [number, number, number];

export class ThreeRenderer {
  THREE: any;
  camera: any;
  background: string;
  renderer: any;
  scene: any;
  group: any;
  threeCamera: any;
  strokeMode: "line" | "sdf";
  strokeWidth: number;
  lit: boolean;

  constructor(THREE: any, opts: ThreeRendererOptions = {}) {
    this.THREE = THREE;
    this.camera = opts.camera;
    this.background = opts.background ?? "#000000";
    this.strokeMode = opts.strokeMode ?? "line";
    this.strokeWidth = opts.strokeWidth ?? 4;
    this.lit = opts.lit ?? false;

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
    if (this.lit) this._addLights();
    this.threeCamera = this._makeCamera();
  }

  // Add a directional + ambient light matching the CPU shading light direction,
  // used when `lit` is enabled and fills render with MeshStandardMaterial.
  _addLights(): void {
    const { THREE } = this;
    const dir = new THREE.DirectionalLight(0xffffff, 1.0);
    // Light points toward the origin from the LIGHT_DIR side.
    dir.position.set(LIGHT_DIR[0], LIGHT_DIR[1], LIGHT_DIR[2]);
    this.scene.add(dir);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.35));
  }

  is3D(): boolean {
    return typeof this.camera.projectionDepth === "function";
  }

  _makeCamera(): any {
    const { THREE, camera } = this;
    if (this.is3D()) {
      const fov = (2 * Math.atan((camera.frameHeight / 2) / camera.focalDistance) * 180) / Math.PI;
      return new THREE.PerspectiveCamera(fov, camera.pixelWidth / camera.pixelHeight, 0.01, camera.focalDistance * 40 + 200);
    }
    const w = camera.frameWidth / 2, h = camera.frameHeight / 2;
    return new THREE.OrthographicCamera(-w, w, h, -h, -1000, 1000);
  }

  // Position the Three camera to reproduce ThreeDCamera's phi/theta/focal view.
  syncCamera(): void {
    const { camera, threeCamera } = this;
    const center = camera.frameCenter ?? [0, 0, 0];
    if (this.is3D()) {
      // Inverse of ThreeDCamera.toCameraSpace: rotate camera-space basis into
      // world. gamma (roll) is applied first about the view axis (camera-space z),
      // then the phi/theta rotations, matching toCameraSpace's inverse order.
      const gamma = camera.gamma ?? 0;
      const rot = (v: number[]) => V.rotateVector(
        V.rotateVector(V.rotateVector(v, gamma, [0, 0, 1]), camera.phi, [1, 0, 0]),
        camera.theta + 90 * V.DEGREES, [0, 0, 1],
      );
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

  render(mobjects: any[]): void {
    const buf = collectBuffers(mobjects);
    this._clearGroup();

    if (buf.opaque.positions.length) this.group.add(this._mesh(buf.opaque, false, 1));
    for (const b of buf.transparent) this.group.add(this._mesh(b, true, b.alpha));
    if (buf.lines.positions.length) {
      this.group.add(this.strokeMode === "sdf" ? this._sdfStrokes(buf.lines) : this._lines(buf.lines));
    }
    for (const t of buf.texts) { const s = this._textSprite(t); if (s) this.group.add(s); }
    for (const im of buf.images) { const p = this._imageQuad(im); if (p) this.group.add(p); }

    this.syncCamera();
    this.renderer.render(this.scene, this.threeCamera);
  }

  /** SceneRenderer-shaped alias for render(), satisfying the shared interface
   *  in scene_renderer.ts. Purely delegating -- render() remains the
   *  primary, unchanged public method. */
  renderFrame(mobjects: Mobject[]): void {
    this.render(mobjects);
  }

  _mesh(buf: any, transparent: boolean, alpha: number): any {
    const { THREE } = this;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(buf.positions, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(buf.colors, 3));
    let m: any;
    if (this.lit) {
      // Real GPU lighting: compute normals from the triangle soup and shade with
      // a physically-based standard material (vertex colors as albedo).
      g.computeVertexNormals();
      m = new THREE.MeshStandardMaterial({
        vertexColors: true, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.0,
        transparent, opacity: transparent ? alpha : 1, depthWrite: !transparent,
      });
    } else {
      m = new THREE.MeshBasicMaterial({
        vertexColors: true, side: THREE.DoubleSide,
        transparent, opacity: transparent ? alpha : 1, depthWrite: !transparent,
      });
    }
    return new THREE.Mesh(g, m);
  }

  // Thick anti-aliased strokes via the screen-space SDF bezier material. Reuses
  // the same flat segment data (positions/colors) as the default line path.
  _sdfStrokes(buf: any): any {
    const { THREE, camera } = this;
    const geo = buildStrokeGeometry(THREE, buf.positions, null, buf.colors);
    const mat = makeBezierStrokeMaterial(THREE, {
      width: this.strokeWidth,
      resolution: [camera.pixelWidth, camera.pixelHeight],
    });
    return new THREE.Mesh(geo, mat);
  }

  _lines(buf: any): any {
    const { THREE } = this;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(buf.positions, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(buf.colors, 3));
    return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ vertexColors: true }));
  }

  _textSprite(mob: any): any {
    const { THREE } = this;
    if (typeof document === "undefined") return null; // headless / node: skip
    const lines = mob.text.split("\n");
    const fontPx = 64;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    ctx.font = `${mob.weight ?? "normal"} ${fontPx}px ${mob.font ?? "sans-serif"}`;
    const wPx = Math.max(1, ...lines.map((l: string) => ctx.measureText(l).width));
    canvas.width = Math.ceil(wPx);
    canvas.height = Math.ceil(fontPx * 1.3 * lines.length);
    const c2 = canvas.getContext("2d")!;
    c2.font = `${mob.weight ?? "normal"} ${fontPx}px ${mob.font ?? "sans-serif"}`;
    c2.textAlign = "center";
    c2.textBaseline = "middle";
    c2.fillStyle = mob.fillColor.toRGBAString((mob.fillOpacity ?? 1) * (mob.opacity ?? 1));
    lines.forEach((l: string, i: number) => c2.fillText(l, canvas.width / 2, fontPx * 1.3 * (i + 0.5)));
    const tex = new THREE.CanvasTexture(canvas);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    const center = mob.getCenter();
    sprite.position.set(center[0], center[1], center[2]);
    const wh = mob.getHeight() || mob.fontSize || 0.5;
    sprite.scale.set(wh * (canvas.width / canvas.height), wh, 1);
    return sprite;
  }

  // A textured quad built from the ImageMobject's four (possibly transformed)
  // corner points, so it lives correctly in 3D.
  _imageQuad(mob: any): any {
    const { THREE } = this;
    if (!mob.image) return null;
    const [tl, tr, br, bl] = mob.points;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([
      tl[0], tl[1], tl[2], bl[0], bl[1], bl[2], br[0], br[1], br[2],
      tl[0], tl[1], tl[2], br[0], br[1], br[2], tr[0], tr[1], tr[2],
    ], 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 1], 2));
    const tex = new THREE.Texture(mob.image);
    tex.needsUpdate = true;
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: mob.opacity ?? 1, side: THREE.DoubleSide });
    return new THREE.Mesh(g, m);
  }

  _clearGroup(): void {
    for (const child of this.group.children) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    }
    this.group.clear();
  }

  setSize(pixelWidth: number, pixelHeight: number): void {
    this.camera.pixelWidth = pixelWidth;
    this.camera.pixelHeight = pixelHeight;
    this.renderer.setSize(pixelWidth, pixelHeight, false);
    if (this.threeCamera.isPerspectiveCamera) this.threeCamera.aspect = pixelWidth / pixelHeight;
    this.threeCamera.updateProjectionMatrix();
  }

  dispose(): void {
    this._clearGroup();
    this.renderer.dispose();
  }
}
