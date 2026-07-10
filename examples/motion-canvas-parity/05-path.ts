// Port of Motion Canvas docs: Path node (ref/path-1.tsx + ref/path-2.tsx) —
// an SVG squirrel outline that draws in then fills red, and a Rect riding a
// looping path (getPointAtPercentage -> pointFromProportion /
// tangentAtProportion), as sequential sections. MC `fill(color, 1)` from a
// null fill becomes a fillOpacity 0 -> 1 tween with the color preset.

import {
  Scene, Path, Square, tweenTo, tweenSignal, createSignal, computed,
} from "../../src/node.ts";
import { demoRender, px, pxLen, PPU } from "./_run.ts";

const SQUIRREL =
  "M 151.34904,307.20455 L 264.34904,307.20455 C 264.34904,291.14096 263.2021,287.95455 236.59904,287.95455 C 240.84904,275.20455 258.12424,244.35808 267.72404,244.35808 C 276.21707,244.35808 286.34904,244.82592 286.34904,264.20455 C 286.34904,286.20455 323.37171,321.67547 332.34904,307.20455 C 345.72769,285.63897 309.34904,292.21514 309.34904,240.20455 C 309.34904,169.05135 350.87417,179.18071 350.87417,139.20455 C 350.87417,119.20455 345.34904,116.50374 345.34904,102.20455 C 345.34904,83.30695 361.99717,84.403577 358.75805,68.734879 C 356.52061,57.911656 354.76962,49.23199 353.46516,36.143889 C 352.53959,26.857305 352.24452,16.959398 342.59855,17.357382 C 331.26505,17.824992 326.96549,37.77419 309.34904,39.204549 C 291.76851,40.631991 276.77834,24.238028 269.97404,26.579549 C 263.22709,28.901334 265.34904,47.204549 269.34904,60.204549 C 275.63588,80.636771 289.34904,107.20455 264.34904,111.20455 C 239.34904,115.20455 196.34904,119.20455 165.34904,160.20455 C 134.34904,201.20455 135.49342,249.3212 123.34904,264.20455 C 82.590696,314.15529 40.823919,293.64625 40.823919,335.20455 C 40.823919,353.81019 72.349045,367.20455 77.349045,361.20455 C 82.349045,355.20455 34.863764,337.32587 87.995492,316.20455 C 133.38711,298.16014 137.43914,294.47663 151.34904,307.20455 z";

const LOOP =
  "M -180 -21 C -180 -54.1371 -153.1371 -81 -120 -81 C -86.8629 -81 -60 -54.1371 -60 -21 C -60 12.1371 -33.1371 33 0 33 C 33.1371 33 48 3 48 -21 C 48 -45 30 -69 0 -69 C -30 -69 -48 -45 -48 -21 C -48 3 -33.1371 33 0 33 C 39 34.5 60 12 60 -21 C 60 -54.1371 86.8629 -81 120 -81 C 153.1371 -81 180 -54.1371 180 -21 C 180 12.1371 153.1371 39 120 39 L -120 39 C -153.1371 39 -180 12.1371 -180 -21 Z";

class PathNodes extends Scene {
  async construct() {
    // --- ref/path-1.tsx: draw in an SVG path, then fill it ---
    const path = new Path({
      strokeWidth: 4,
      strokeColor: "#e13238",
      data: SQUIRREL,
      scale: 0.5 / PPU, // MC scale={0.5} in its 1080p pixel space
      fillColor: "#e13238",
      fillOpacity: 0,
    });
    // position={[-100, -100]}: MC positions the node origin, and the path
    // data stays relative to it — shift (moveTo would center the bbox).
    path.shift(px(-100, -100));
    (path as any).strokeEnd = 0; // start={0} end={0}
    this.add(path);

    // path().end(1, 1) then path().fill('#e13238', 1) — one chain, not two
    // plays: same-shaped TweenChains on the same mobject share a partial-
    // movie hash (targets aren't hashed), so the 2nd play replays the 1st.
    await this.play(tweenTo(path, { end: 1 }, 1).to({ fillOpacity: 1 }, 1));
    this.remove(path);

    // --- ref/path-2.tsx: a Rect following a path ---
    const track = new Path({
      strokeWidth: 6,
      strokeColor: "lightgray",
      data: LOOP,
      scale: 1 / PPU,
    });

    const progress = createSignal(0);
    const pathPoint = computed(() => ({
      position: track.pointFromProportion(progress()),
      tangent: track.tangentAtProportion(progress()),
    }));

    const rect = new Square({
      sideLength: pxLen(26),
      fillColor: "lightseagreen",
      fillOpacity: 1,
      strokeWidth: 0,
    });
    // position={() => path().getPointAtPercentage(progress()).position}
    // rotation={() => path().getPointAtPercentage(progress()).tangent.degrees}
    let applied = 0; // rotate() is incremental; track the applied angle.
    rect.addUpdater(() => {
      const { position, tangent } = pathPoint();
      rect.moveTo(position);
      const angle = Math.atan2(tangent[1], tangent[0]);
      rect.rotate(angle - applied);
      applied = angle;
    });
    rect.update(0);
    this.add(track, rect);

    // progress(1, 2).to(0, 2) — a chained .to on a signal chain needs the
    // {value} State shape (raw `.to(0, 2)` spreads to {} and holds instead;
    // see the report: suspected tweenSignal chain bug).
    await this.play(tweenSignal(progress, 1, 2).to({ value: 0 } as any, 2));
  }
}

await demoRender(PathNodes, import.meta.url);
