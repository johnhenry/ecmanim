// Physics: an analytic electric field, a swinging pendulum, and bodies falling
// under gravity onto a floor. Run: node examples/physics.ts -> examples/out/physics.mp4

import {
  render, Scene, Dot, Line, ElectricField, Pendulum, physics, BLUE, RED, YELLOW,
} from "../src/node.ts";

class Physics extends Scene {
  async construct() {
    // A dipole electric field (arrows), drawn once.
    const field = new ElectricField([
      { position: [-2.5, -1.5, 0], magnitude: 1 },
      { position: [2.5, -1.5, 0], magnitude: -1 },
    ]);
    this.add(field);

    // A pendulum swings (its angle is integrated each frame).
    const pendulum = new Pendulum({ length: 1.8, initialAngle: 0.9, pivot: [-3, 3, 0], color: RED });
    this.add(pendulum);

    // Falling bodies bounce off a floor at y = -3.
    const floorY = -3;
    this.add(new Line([-6, floorY, 0], [6, floorY, 0], { color: YELLOW }));
    const engine = physics(this, { gravity: [0, -9.8, 0], floor: floorY, restitution: 0.6 });
    for (let i = 0; i < 4; i++) {
      const ball = new Dot({ point: [1 + i * 1.2, 3 - i * 0.3, 0], radius: 0.18, color: BLUE });
      this.add(ball);
      engine.addBody(ball, { velocity: [0, 0, 0] });
    }

    await this.wait(3);
  }
}

await render(Physics, {
  output: "examples/out/physics.mp4",
  style: "midnight",
  quality: "low",
});

console.log("Wrote examples/out/physics.mp4");
