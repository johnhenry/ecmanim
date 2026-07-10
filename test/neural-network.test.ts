import { test } from "node:test";
import assert from "node:assert/strict";
import { NeuralNetworkMobject } from "../src/mobject/neural_network.ts";
import { Scene } from "../src/scene/Scene.ts";
import { Animation } from "../src/animation/Animation.ts";

const silentScene = () => new Scene({ fps: 10, frameHandler: async () => {} });

test("builds the right layer and neuron counts", () => {
  const net = new NeuralNetworkMobject({ layerSizes: [8, 6, 6, 4] });
  assert.equal(net.neurons.length, 4);
  assert.deepEqual(net.neurons.map((l) => l.length), [8, 6, 6, 4]);
  // No abbreviation → no ellipsis dots anywhere.
  assert.deepEqual(net.ellipsisDots.map((d) => d.length), [0, 0, 0, 0]);
});

test("maxNeuronsShown abbreviates large layers with a 3-dot ellipsis", () => {
  const net = new NeuralNetworkMobject({ layerSizes: [40, 5] });
  assert.deepEqual(net.shownSizes, [16, 5]); // default maxNeuronsShown = 16
  assert.equal(net.neurons[0].length, 16);
  assert.equal(net.neurons[1].length, 5);
  assert.equal(net.ellipsisDots[0].length, 3);
  assert.equal(net.ellipsisDots[1].length, 0);

  // The ellipsis dots sit inside the column's vertical extent, in the gap.
  const ys = net.neurons[0].map((n) => n.getCenter()[1]);
  const dotYs = net.ellipsisDots[0].map((d) => d.getCenter()[1]);
  for (const y of dotYs) {
    assert.ok(y < Math.max(...ys) && y > Math.min(...ys));
  }

  const custom = new NeuralNetworkMobject({
    layerSizes: [40, 5],
    maxNeuronsShown: 10,
  });
  assert.equal(custom.neurons[0].length, 10);
});

test("edge count equals the sum of adjacent shown-layer products", () => {
  const net = new NeuralNetworkMobject({ layerSizes: [8, 6, 6, 4] });
  assert.equal(net.edges.length, 3);
  const counts = net.edges.map((gap) => gap.flat().length);
  assert.deepEqual(counts, [8 * 6, 6 * 6, 6 * 4]);

  // Over SHOWN neurons when abbreviated.
  const big = new NeuralNetworkMobject({ layerSizes: [40, 5] });
  assert.equal(big.edges[0].flat().length, 16 * 5);
});

test("weights are deterministic per seed", () => {
  const a = new NeuralNetworkMobject({ layerSizes: [4, 3, 2], seed: 42 });
  const b = new NeuralNetworkMobject({ layerSizes: [4, 3, 2], seed: 42 });
  const c = new NeuralNetworkMobject({ layerSizes: [4, 3, 2], seed: 7 });
  assert.deepEqual(a.weights, b.weights);
  assert.notDeepEqual(a.weights, c.weights);
  // All in [-1, 1].
  for (const w of a.weights.flat(2)) {
    assert.ok(w >= -1 && w <= 1);
  }
});

test("explicit per-gap weight matrices are honored", () => {
  const net = new NeuralNetworkMobject({
    layerSizes: [2, 2],
    weights: [
      [
        [3, -3],
        [3, -3],
      ],
    ],
  });
  assert.deepEqual(net.weights, [
    [
      [3, -3],
      [3, -3],
    ],
  ]);
});

test("computeActivations propagates through sigmoid deterministically", () => {
  const net = new NeuralNetworkMobject({
    layerSizes: [2, 2],
    weights: [
      [
        [3, -3],
        [3, -3],
      ],
    ],
  });
  const acts = net.computeActivations([1, 1]);
  assert.equal(acts.length, 2);
  const sig = (z: number) => 1 / (1 + Math.exp(-z));
  assert.ok(Math.abs(acts[1][0] - sig(6)) < 1e-12);
  assert.ok(Math.abs(acts[1][1] - sig(-6)) < 1e-12);
  // tanh option
  const t = net.computeActivations([1, 1], "tanh");
  assert.ok(Math.abs(t[1][0] - Math.tanh(6)) < 1e-12);
});

test("forwardPass returns an Animation with runTime > 0 and lights layers through a silent Scene", async () => {
  const net = new NeuralNetworkMobject({
    layerSizes: [2, 2],
    weights: [
      [
        [3, -3],
        [3, -3],
      ],
    ],
  });
  const anim = net.forwardPass([1, 1]);
  assert.ok(anim instanceof Animation);
  assert.ok(anim.runTime > 0);

  const scene = silentScene();
  scene.add(net);
  await scene.play(anim);

  // Input layer lit to its activations (clamped to [0, 1]).
  assert.ok(Math.abs(net.neurons[0][0].fillOpacity - 1) < 1e-9);
  assert.ok(Math.abs(net.neurons[0][1].fillOpacity - 1) < 1e-9);

  // Output layer: the max-activation neuron ends brighter than the min one.
  const out = net.neurons[1].map((n) => n.fillOpacity);
  assert.ok(out[0] > out[1] + 0.5, `expected ${out[0]} >> ${out[1]}`);

  // The pulse restored every edge's stroke window.
  for (const edge of net.edges.flat(2)) {
    assert.equal(edge.strokeStart, 0);
    assert.equal(edge.strokeEnd, 1);
  }
});

test("forwardPass with seeded weights plays through a multi-layer network", async () => {
  const net = new NeuralNetworkMobject({ layerSizes: [4, 3, 2], seed: 42 });
  const anim = net.forwardPass([1, 0.2, 0.8, 0.5], { stepTime: 0.4 });
  assert.ok(anim.runTime > 0);
  const scene = silentScene();
  scene.add(net);
  await scene.play(anim);

  const acts = net.computeActivations([1, 0.2, 0.8, 0.5]);
  const out = net.neurons[2].map((n) => n.fillOpacity);
  // Final opacities equal the computed (clamped) activations.
  for (let j = 0; j < out.length; j++) {
    const expected = Math.max(0, Math.min(1, acts[2][j]));
    assert.ok(Math.abs(out[j] - expected) < 1e-9, `${out[j]} vs ${expected}`);
  }
  const max = Math.max(...out);
  const min = Math.min(...out);
  assert.ok(max > min, "output layer activations should differ");
});

test("highlightOutput plays a pulse on one output neuron and restores it", async () => {
  const net = new NeuralNetworkMobject({ layerSizes: [3, 2], seed: 1 });
  const neuron = net.neurons[1][1];
  const before = neuron.points.map((p) => [...p]);
  const anim = net.highlightOutput(1);
  assert.ok(anim instanceof Animation);
  assert.ok(anim.runTime > 0);

  const scene = silentScene();
  scene.add(net);
  await scene.play(anim);

  // Indicate restores geometry when finished.
  for (let i = 0; i < before.length; i++) {
    assert.ok(Math.abs(neuron.points[i][0] - before[i][0]) < 1e-9);
    assert.ok(Math.abs(neuron.points[i][1] - before[i][1]) < 1e-9);
  }
});
