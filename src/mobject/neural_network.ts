// Neural network ("But what IS a neural network?", 2017 — 3b1b canon 10).
// Columns of stroked circles (neurons) joined by weight-tinted Line edges;
// forwardPass() lights the input column, pulses activations across each edge
// bundle (ShowPassingFlash), and lights each next layer by the propagated
// activations. Fully deterministic: weights come from the config or a seeded
// mulberry32 stream; the forward pass is a pure function of (weights, input).
//
// Isomorphic: no node: imports, no DOM.

import { Group } from "./Mobject.ts";
import { Circle, Line } from "./geometry.ts";
import { Animation } from "../animation/Animation.ts";
import type { AnimationConfig } from "../animation/Animation.ts";
import { AnimationGroup, Succession } from "../animation/composition.ts";
import { ShowPassingFlash } from "../animation/indication_extra.ts";
import { Indicate } from "../animation/extra.ts";
import { mulberry32 } from "../core/noise.ts";
import { Color } from "../core/color.ts";
import type { ColorLike } from "../core/types.ts";

/** Activation nonlinearity used when propagating a forward pass. */
export type ActivationFunction = "sigmoid" | "tanh";

export interface NeuralNetworkConfig {
  /** Neurons per layer, e.g. [8, 6, 6, 4] (or [784, 16, 16, 10] — big layers
   *  are abbreviated to `maxNeuronsShown` with a vertical ellipsis). */
  layerSizes: number[];
  /** Horizontal distance between layer columns (default 2). */
  layerSpacing?: number;
  /** Vertical distance between neuron centers in a column (default 0.4). */
  neuronSpacing?: number;
  /** Neuron circle radius (default 0.15). */
  neuronRadius?: number;
  /** Layers larger than this render this many neurons split around a
   *  3-dot vertical ellipsis (default 16). */
  maxNeuronsShown?: number;
  /** Base stroke opacity of edges (default 0.35). */
  edgeOpacity?: number;
  /** Edge tint by weight sign (defaults: negative RED, positive BLUE). */
  weightColors?: { negative?: ColorLike; positive?: ColorLike };
  /** Seed for the deterministic random weights (default 1). */
  seed?: number;
  /** Per-gap weight matrices over SHOWN neurons: weights[gap][from][to].
   *  Missing entries fall back to 0. Wins over `seed`. */
  weights?: number[][][];
  /** Neuron stroke color (default 3b1b BLUE). */
  neuronStrokeColor?: ColorLike;
}

export interface ForwardPassConfig extends AnimationConfig {
  /** Nonlinearity for propagation (default "sigmoid"). */
  activation?: ActivationFunction;
  /** Seconds per stage: each layer-lighting and each pulse wave (default 1). */
  stepTime?: number;
  /** timeWidth handed to each edge's ShowPassingFlash (default 0.3). */
  pulseTimeWidth?: number;
}

// Ramp a mobject's fillOpacity from its value at begin() to `target`.
// Deterministic under scrubbing within a play (alpha-driven from startState).
class FillRamp extends Animation {
  target: number;
  private from: number;

  constructor(mobject: Circle, target: number, config: AnimationConfig = {}) {
    super(mobject, config);
    this.target = Math.max(0, Math.min(1, target));
    this.from = 0;
  }

  setup(): void {
    this.from = this.mobject.fillOpacity ?? 0;
  }

  interpolateMobject(alpha: number): void {
    this.mobject.fillOpacity = this.from + (this.target - this.from) * alpha;
  }
}

/**
 * NeuralNetworkMobject: layered network drawn as columns of circles with
 * straight edges between consecutive layers. Edge strokeWidth scales with
 * |weight|; edge color lerps from grey toward the positive/negative tint by
 * |weight|. Neurons default to WHITE fill at fillOpacity 0 (dark against the
 * 3b1b background) so a neuron's fillOpacity IS its displayed activation.
 */
export class NeuralNetworkMobject extends Group {
  layerSizes: number[];
  /** Shown (possibly abbreviated) neuron count per layer. */
  shownSizes: number[];
  /** Per layer, the shown neuron circles (ellipsis dots excluded). */
  neurons: Circle[][];
  /** Per layer, the 3 ellipsis dots when the layer is abbreviated (else []). */
  ellipsisDots: Circle[][];
  /** edges[gap][from][to] over shown neurons. */
  edges: Line[][][];
  /** weights[gap][from][to] over shown neurons. */
  weights: number[][][];
  layerSpacing: number;
  neuronSpacing: number;
  neuronRadius: number;
  maxNeuronsShown: number;
  edgeOpacity: number;

  constructor(config: NeuralNetworkConfig) {
    super();
    this.layerSizes = [...config.layerSizes];
    this.layerSpacing = config.layerSpacing ?? 2;
    this.neuronSpacing = config.neuronSpacing ?? 0.4;
    this.neuronRadius = config.neuronRadius ?? 0.15;
    this.maxNeuronsShown = config.maxNeuronsShown ?? 16;
    this.edgeOpacity = config.edgeOpacity ?? 0.35;
    const negColor = Color.parse(config.weightColors?.negative ?? "#FC6255");
    const posColor = Color.parse(config.weightColors?.positive ?? "#58C4DD");
    const greyColor = Color.parse("#888888");
    const neuronStroke = config.neuronStrokeColor ?? "#58C4DD";

    this.shownSizes = this.layerSizes.map((s) =>
      Math.min(s, this.maxNeuronsShown),
    );

    // --- weights (deterministic) ------------------------------------------
    const rand = mulberry32(config.seed ?? 1);
    this.weights = [];
    for (let g = 0; g < this.shownSizes.length - 1; g++) {
      const rows: number[][] = [];
      for (let i = 0; i < this.shownSizes[g]; i++) {
        const row: number[] = [];
        for (let j = 0; j < this.shownSizes[g + 1]; j++) {
          const given = config.weights?.[g]?.[i]?.[j];
          // Always consume the stream so provided/generated layouts stay
          // aligned with the same seed.
          const generated = rand() * 2 - 1;
          row.push(config.weights ? given ?? 0 : generated);
        }
        rows.push(row);
      }
      this.weights.push(rows);
    }

    // --- layout -------------------------------------------------------------
    const L = this.layerSizes.length;
    const positions: number[][][] = []; // positions[layer][neuron] = [x, y, z]
    const dotPositions: number[][][] = [];
    for (let l = 0; l < L; l++) {
      const x = (l - (L - 1) / 2) * this.layerSpacing;
      const truncated = this.layerSizes[l] > this.shownSizes[l];
      const { ys, dotYs } = this._columnYs(this.shownSizes[l], truncated);
      positions.push(ys.map((y) => [x, y, 0]));
      dotPositions.push(dotYs.map((y) => [x, y, 0]));
    }

    // --- edges (added first, so neurons draw on top) ------------------------
    this.edges = [];
    for (let g = 0; g < L - 1; g++) {
      const gap: Line[][] = [];
      for (let i = 0; i < this.shownSizes[g]; i++) {
        const row: Line[] = [];
        for (let j = 0; j < this.shownSizes[g + 1]; j++) {
          const w = this.weights[g][i][j];
          const mag = Math.min(1, Math.abs(w));
          const tint = w >= 0 ? posColor : negColor;
          const edge = new Line(positions[g][i], positions[g + 1][j], {
            strokeColor: Color.lerp(greyColor, tint, mag).toHex(),
            strokeWidth: 0.5 + 2.5 * mag,
            strokeOpacity: this.edgeOpacity,
          });
          row.push(edge);
          this.add(edge);
        }
        gap.push(row);
      }
      this.edges.push(gap);
    }

    // --- neurons + ellipsis dots --------------------------------------------
    this.neurons = [];
    this.ellipsisDots = [];
    for (let l = 0; l < L; l++) {
      const layer: Circle[] = [];
      for (const p of positions[l]) {
        const neuron = new Circle({
          radius: this.neuronRadius,
          arcCenter: p,
          strokeColor: neuronStroke,
          strokeWidth: 2,
          fillColor: "#FFFFFF",
          fillOpacity: 0,
        });
        layer.push(neuron);
        this.add(neuron);
      }
      this.neurons.push(layer);
      const dots: Circle[] = [];
      for (const p of dotPositions[l]) {
        const dot = new Circle({
          radius: this.neuronRadius * 0.25,
          arcCenter: p,
          strokeWidth: 0,
          fillColor: "#888888",
          fillOpacity: 1,
        });
        dots.push(dot);
        this.add(dot);
      }
      this.ellipsisDots.push(dots);
    }
  }

  // Vertical positions for one column (top → bottom), centered on y = 0.
  // Abbreviated layers split around a gap holding the 3 ellipsis dots.
  private _columnYs(
    shown: number,
    truncated: boolean,
  ): { ys: number[]; dotYs: number[] } {
    const s = this.neuronSpacing;
    const ys: number[] = [];
    const dotYs: number[] = [];
    if (!truncated) {
      for (let i = 0; i < shown; i++) ys.push(-i * s);
    } else {
      const topCount = Math.ceil(shown / 2);
      const botCount = shown - topCount;
      const gap = 2 * s; // vertical-ellipsis gap
      for (let i = 0; i < topCount; i++) ys.push(-i * s);
      const lastTop = -(topCount - 1) * s;
      for (let k = 1; k <= 3; k++) dotYs.push(lastTop - (gap * k) / 4);
      for (let i = 0; i < botCount; i++) ys.push(lastTop - gap - i * s);
    }
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const mid = (minY + maxY) / 2;
    return {
      ys: ys.map((y) => y - mid),
      dotYs: dotYs.map((y) => y - mid),
    };
  }

  /**
   * Propagate activations through the SHOWN network: a_{l+1}[j] =
   * σ(Σ_i weights[l][i][j] · a_l[i]). Input is truncated/zero-padded to the
   * shown input size. Returns one activation array per layer. Pure.
   */
  computeActivations(
    activations0: number[],
    activation: ActivationFunction = "sigmoid",
  ): number[][] {
    const sigma =
      activation === "tanh"
        ? (z: number) => Math.tanh(z)
        : (z: number) => 1 / (1 + Math.exp(-z));
    const a0: number[] = [];
    for (let i = 0; i < this.shownSizes[0]; i++) a0.push(activations0[i] ?? 0);
    const all = [a0];
    for (let g = 0; g < this.weights.length; g++) {
      const prev = all[g];
      const next: number[] = [];
      for (let j = 0; j < this.shownSizes[g + 1]; j++) {
        let z = 0;
        for (let i = 0; i < this.shownSizes[g]; i++) {
          z += this.weights[g][i][j] * prev[i];
        }
        next.push(sigma(z));
      }
      all.push(next);
    }
    return all;
  }

  /**
   * Forward-pass animation: lights layer 0 fills by the input activations,
   * then for each gap sends a pulse (ShowPassingFlash) along every edge and
   * lights the next layer by the propagated activations. Deterministic —
   * same weights + input → the same animation every time. Displayed
   * fillOpacity = activation clamped to [0, 1].
   */
  forwardPass(activations0: number[], config: ForwardPassConfig = {}): Animation {
    const stepTime = config.stepTime ?? 1;
    const pulseTimeWidth = config.pulseTimeWidth ?? 0.3;
    const acts = this.computeActivations(
      activations0,
      config.activation ?? "sigmoid",
    );

    const stages: Animation[] = [];
    stages.push(
      new AnimationGroup(
        this.neurons[0].map(
          (n, i) => new FillRamp(n, acts[0][i], { runTime: stepTime }),
        ),
        { runTime: stepTime },
      ),
    );
    for (let g = 0; g < this.edges.length; g++) {
      const pulses: Animation[] = [];
      for (const row of this.edges[g]) {
        for (const edge of row) {
          pulses.push(
            new ShowPassingFlash(edge, {
              timeWidth: pulseTimeWidth,
              runTime: stepTime,
            }),
          );
        }
      }
      stages.push(new AnimationGroup(pulses, { runTime: stepTime }));
      stages.push(
        new AnimationGroup(
          this.neurons[g + 1].map(
            (n, j) => new FillRamp(n, acts[g + 1][j], { runTime: stepTime }),
          ),
          { runTime: stepTime },
        ),
      );
    }
    return new Succession(stages, {
      runTime: config.runTime,
      rateFunc: config.rateFunc,
    });
  }

  /** Small pulse/glow on one output-layer neuron (the argmax beat). */
  highlightOutput(index: number, config: AnimationConfig = {}): Animation {
    const outputLayer = this.neurons[this.neurons.length - 1];
    const neuron = outputLayer[Math.max(0, Math.min(outputLayer.length - 1, index))];
    return new Indicate(neuron, {
      scaleFactor: 1.4,
      color: "#FFFF00",
      runTime: config.runTime ?? 1,
      ...config,
    });
  }
}
