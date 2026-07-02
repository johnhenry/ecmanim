// Software rasterizer with a per-pixel depth buffer. Used for 3D scenes so that
// interpenetrating surfaces resolve correctly per pixel (a true z-test), which
// painter's-algorithm face sorting cannot do. Filled polygons become
// depth-tested triangles; strokes become depth-tested thick lines. Depth is the
// camera-space value from ThreeDCamera.projectionDepth (larger = nearer).

interface ZVertex {
  x: number;
  y: number;
  z: number;
  r?: number;
  g?: number;
  b?: number;
}

export class ZBuffer {
  width!: number;
  height!: number;
  color!: Uint8ClampedArray;
  depth!: Float32Array;

  constructor(width: number, height: number) {
    this.resize(width, height);
  }

  resize(width: number, height: number): void {
    if (this.width === width && this.height === height) return;
    this.width = width;
    this.height = height;
    this.color = new Uint8ClampedArray(width * height * 4);
    this.depth = new Float32Array(width * height);
  }

  clear(r: number, g: number, b: number): void {
    const { color, depth } = this;
    for (let i = 0; i < depth.length; i++) {
      const j = i * 4;
      color[j] = r; color[j + 1] = g; color[j + 2] = b; color[j + 3] = 255;
      depth[i] = -Infinity; // nothing drawn yet; larger depth wins
    }
  }

  _blend(idx: number, r: number, g: number, b: number, a: number): void {
    const j = idx * 4;
    const c = this.color;
    if (a >= 0.999) {
      c[j] = r; c[j + 1] = g; c[j + 2] = b; c[j + 3] = 255;
    } else {
      const ia = 1 - a;
      c[j] = r * a + c[j] * ia;
      c[j + 1] = g * a + c[j + 1] * ia;
      c[j + 2] = b * a + c[j + 2] * ia;
      c[j + 3] = 255;
    }
  }

  // v0,v1,v2: {x, y, z} in pixel space with camera depth z. color: [r,g,b] 0-255.
  triangle(v0: ZVertex, v1: ZVertex, v2: ZVertex, color: number[], alpha: number): void {
    const { width, height, depth } = this;
    let minX = Math.max(0, Math.floor(Math.min(v0.x, v1.x, v2.x)));
    let maxX = Math.min(width - 1, Math.ceil(Math.max(v0.x, v1.x, v2.x)));
    let minY = Math.max(0, Math.floor(Math.min(v0.y, v1.y, v2.y)));
    let maxY = Math.min(height - 1, Math.ceil(Math.max(v0.y, v1.y, v2.y)));
    if (minX > maxX || minY > maxY) return;

    const edge = (ax: number, ay: number, bx: number, by: number, px: number, py: number) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    const area = edge(v0.x, v0.y, v1.x, v1.y, v2.x, v2.y);
    if (area === 0) return;
    const inv = 1 / area;
    const [r, g, b] = color;

    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        let w0 = edge(v1.x, v1.y, v2.x, v2.y, px, py) * inv;
        let w1 = edge(v2.x, v2.y, v0.x, v0.y, px, py) * inv;
        let w2 = edge(v0.x, v0.y, v1.x, v1.y, px, py) * inv;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * v0.z + w1 * v1.z + w2 * v2.z;
        const idx = y * width + x;
        if (z > depth[idx]) {
          this._blend(idx, r, g, b, alpha);
          depth[idx] = z;
        }
      }
    }
  }

  // Like triangle(), but each vertex carries its own color {x,y,z,r,g,b} and the
  // color is barycentric-interpolated per pixel (Gouraud smooth shading).
  triangleGouraud(v0: ZVertex, v1: ZVertex, v2: ZVertex, alpha: number): void {
    const { width, height, depth } = this;
    let minX = Math.max(0, Math.floor(Math.min(v0.x, v1.x, v2.x)));
    let maxX = Math.min(width - 1, Math.ceil(Math.max(v0.x, v1.x, v2.x)));
    let minY = Math.max(0, Math.floor(Math.min(v0.y, v1.y, v2.y)));
    let maxY = Math.min(height - 1, Math.ceil(Math.max(v0.y, v1.y, v2.y)));
    if (minX > maxX || minY > maxY) return;

    const edge = (ax: number, ay: number, bx: number, by: number, px: number, py: number) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);
    const area = edge(v0.x, v0.y, v1.x, v1.y, v2.x, v2.y);
    if (area === 0) return;
    const inv = 1 / area;

    for (let y = minY; y <= maxY; y++) {
      const py = y + 0.5;
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const w0 = edge(v1.x, v1.y, v2.x, v2.y, px, py) * inv;
        const w1 = edge(v2.x, v2.y, v0.x, v0.y, px, py) * inv;
        const w2 = edge(v0.x, v0.y, v1.x, v1.y, px, py) * inv;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * v0.z + w1 * v1.z + w2 * v2.z;
        const idx = y * width + x;
        if (z > depth[idx]) {
          const r = w0 * (v0.r ?? 0) + w1 * (v1.r ?? 0) + w2 * (v2.r ?? 0);
          const g = w0 * (v0.g ?? 0) + w1 * (v1.g ?? 0) + w2 * (v2.g ?? 0);
          const b = w0 * (v0.b ?? 0) + w1 * (v1.b ?? 0) + w2 * (v2.b ?? 0);
          this._blend(idx, r, g, b, alpha);
          depth[idx] = z;
        }
      }
    }
  }

  // Depth-tested thick line between pixel-space endpoints (with depth z each).
  // `bias` nudges depth toward the viewer so edges sit atop the faces they trim.
  line(p0: ZVertex, p1: ZVertex, halfWidth: number, color: number[], alpha: number, bias = 0): void {
    const { width, height, depth } = this;
    const dx = p1.x - p0.x, dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(len));
    const hw = Math.max(0, Math.round(halfWidth));
    const [r, g, b] = color;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = Math.round(p0.x + dx * t);
      const cy = Math.round(p0.y + dy * t);
      const cz = p0.z + (p1.z - p0.z) * t + bias;
      for (let oy = -hw; oy <= hw; oy++) {
        const y = cy + oy;
        if (y < 0 || y >= height) continue;
        for (let ox = -hw; ox <= hw; ox++) {
          const x = cx + ox;
          if (x < 0 || x >= width) continue;
          const idx = y * width + x;
          if (cz > depth[idx]) {
            this._blend(idx, r, g, b, alpha);
            depth[idx] = cz;
          }
        }
      }
    }
  }

  // Copy the framebuffer into the 2D context.
  blitTo(ctx: CanvasRenderingContext2D): void {
    const img = ctx.createImageData(this.width, this.height);
    img.data.set(this.color);
    ctx.putImageData(img, 0, 0);
  }
}
