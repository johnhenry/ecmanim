// 3D vector / point math. Points are plain [x, y, z] arrays, mirroring manim's
// numpy points of shape (3,). All functions are pure and return new arrays.

export const vec = (x = 0, y = 0, z = 0) => [x, y, z];

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const mul = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
export const neg = (a) => [-a[0], -a[1], -a[2]];

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const length = (a) => Math.hypot(a[0], a[1], a[2]);
export const distance = (a, b) => length(sub(a, b));

export const normalize = (a) => {
  const l = length(a);
  return l === 0 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
};

// Linear interpolation between two points (or numbers).
export const lerp = (a, b, t) =>
  typeof a === "number" ? a + (b - a) * t : [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];

export const midpoint = (a, b) => lerp(a, b, 0.5);
export const clone = (a) => [a[0], a[1], a[2]];
export const equals = (a, b, eps = 1e-8) =>
  Math.abs(a[0] - b[0]) < eps && Math.abs(a[1] - b[1]) < eps && Math.abs(a[2] - b[2]) < eps;

// Angle of a 2D vector (radians), and rotate a point about z-axis.
export const angleOf = (a) => Math.atan2(a[1], a[0]);

export function rotateVector(a, angle, axis = [0, 0, 1]) {
  // Rodrigues' rotation formula.
  const k = normalize(axis);
  const cosT = Math.cos(angle);
  const sinT = Math.sin(angle);
  const term1 = scale(a, cosT);
  const term2 = scale(cross(k, a), sinT);
  const term3 = scale(k, dot(k, a) * (1 - cosT));
  return add(add(term1, term2), term3);
}

// Common direction constants (manim uses unit vectors for these).
export const ORIGIN = [0, 0, 0];
export const UP = [0, 1, 0];
export const DOWN = [0, -1, 0];
export const RIGHT = [1, 0, 0];
export const LEFT = [-1, 0, 0];
export const OUT = [0, 0, 1];
export const IN = [0, 0, -1];
export const UL = [-1, 1, 0];
export const UR = [1, 1, 0];
export const DL = [-1, -1, 0];
export const DR = [1, -1, 0];

export const PI = Math.PI;
export const TAU = 2 * Math.PI;
export const DEGREES = Math.PI / 180;
