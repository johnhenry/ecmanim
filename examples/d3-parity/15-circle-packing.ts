// Port of D3 gallery: Zoomable circle packing (ref/zoomable-circle-packing.js)
// — Flare hierarchy as nested circles; internal nodes colored by depth on an
// HCL ramp, leaves white. Data: flare-2.json.
// The ref's scaleLinear().domain([0,5]).range(["hsl(152,80%,80%)","hsl(228,30%,40%)"])
// .interpolate(interpolateHcl) is interpolateHcl("#a3f5cf", "#475485") over depth/5;
// the page background is color(0), matching the ref's svg background.
// Surpass (interpolateZoom showcase): the camera dives into flare.analytics,
// then its "cluster" leaf group, then back out — CameraFrameTween {path:"zoom"}
// follows the same van Wijk path as the ref's click-to-zoom transitions.

import {
  MovingCameraScene, Circle, Text, Group, hierarchy, pack, interpolateHcl,
  LaggedStart, AnimationGroup, GrowFromCenter, FadeIn, FadeOut,
} from "../../src/node.ts";
// Library gap: CameraFrameTween is not re-exported from src/index.ts (PORTING.md
// documents it as available) — deep-import it from the defining module.
import { CameraFrameTween } from "../../src/scene/moving_camera_scene.ts";
import { demoRender, loadJson, svgFrame } from "./_run.ts";

const flare = loadJson("flare-2.json");
const ramp = interpolateHcl("#a3f5cf", "#475485");
const color = (depth: number) => ramp(depth / 5);

class CirclePacking extends MovingCameraScene {
  async construct() {
    const width = 928, height = 928;
    const f = svgFrame(width, height);

    const root = hierarchy(flare)
      .sum((d: any) => d.value ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    pack().size([width, height]).padding(3)(root);

    // Nodes (ref draws descendants().slice(1); the root disc is the page
    // background). Breadth-first order keeps parents painted under children.
    const byDepth = new Map<number, GrowFromCenter[]>();
    for (const d of root.descendants().slice(1)) {
      const c = new Circle({
        radius: f.len(d.r!), point: f.pt(d.x!, d.y!),
        fillColor: d.children ? color(d.depth) : "#ffffff", fillOpacity: 1, strokeWidth: 0,
      });
      this.add(c);
      if (!byDepth.has(d.depth)) byDepth.set(d.depth, []);
      byDepth.get(d.depth)!.push(new GrowFromCenter(c));
    }
    // Labels for the root's children (the ref shows exactly these initially).
    const labels = new Group();
    for (const d of root.children!) {
      const label = new Text((d.data as any).name, { fontSize: f.len(18), color: "#000000" });
      label.moveTo(f.pt(d.x!, d.y!));
      labels.add(label);
    }

    const depths = [...byDepth.keys()].sort((a, b) => a - b);
    await this.play(new LaggedStart(
      depths.map((d) => new AnimationGroup(byDepth.get(d)!)),
      { lagRatio: 0.4, runTime: 2 },
    ));
    await this.play(new FadeIn(labels, { runTime: 0.5 }));
    await this.wait(0.5);

    // van Wijk zooms: mid-depth node -> leaf cluster -> back out.
    const analytics = root.find((d) => (d.data as any).name === "analytics" && d.depth === 1)!;
    const cluster = root.find((d) => (d.data as any).name === "cluster" && d.depth === 2)!;
    const frame = this.getFrame();
    const aspect = frame.getWidth() / frame.getHeight();
    const stop = (d: any) => ({
      center: f.pt(d.x, d.y),
      height: f.len(d.r * 2) * 1.1,
      width: f.len(d.r * 2) * 1.1 * aspect,
    });
    await this.play(
      new CameraFrameTween(frame, stop(analytics), { path: "zoom", runTime: 2 }),
      new FadeOut(labels, { runTime: 0.8 }),
    );
    await this.wait(0.5);
    await this.play(new CameraFrameTween(frame, stop(cluster), { path: "zoom", runTime: 1.6 }));
    await this.wait(0.5);
    // Library footgun: FadeOut leaves family opacities at 0 and FadeIn
    // captures CURRENT opacities as its targets — restore them first.
    labels.setOpacity(1);
    await this.play(
      new CameraFrameTween(frame, { center: [0, 0, 0], width: 14.222, height: 8 }, { path: "zoom", runTime: 2.2 }),
      new FadeIn(labels, { runTime: 2.2 }),
    );
    await this.wait(1);
  }
}

await demoRender(CirclePacking, import.meta.url, { background: color(0) });
