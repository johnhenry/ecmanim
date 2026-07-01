// Rate functions map animation progress t in [0,1] to eased progress in [0,1].
// Names mirror manim.utils.rate_functions.

export const linear = (t) => t;

export function smooth(t, inflection = 10) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const error = sigmoid(-inflection / 2);
  return Math.min(Math.max((sigmoid(inflection * (t - 0.5)) - error) / (1 - 2 * error), 0), 1);
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

export const rushInto = (t) => 2 * smooth(t / 2);
export const rushFrom = (t) => 2 * smooth(t / 2 + 0.5) - 1;
export const slowInto = (t) => Math.sqrt(1 - (1 - t) * (1 - t));
export const doubleSmooth = (t) => (t < 0.5 ? 0.5 * smooth(2 * t) : 0.5 * (1 + smooth(2 * t - 1)));

export const thereAndBack = (t, inflection = 10) => {
  const s = t < 0.5 ? 2 * t : 2 * (1 - t);
  return smooth(s, inflection);
};

export const thereAndBackWithPause = (t, pauseRatio = 1 / 3) => {
  const a = 1 / pauseRatio;
  if (t < 0.5 - pauseRatio / 2) return smooth(a * t);
  if (t < 0.5 + pauseRatio / 2) return 1;
  return smooth(a - a * t);
};

export const easeInSine = (t) => 1 - Math.cos((t * Math.PI) / 2);
export const easeOutSine = (t) => Math.sin((t * Math.PI) / 2);
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
export const easeInQuad = (t) => t * t;
export const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
export const easeInOutQuad = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeInCubic = (t) => t * t * t;
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export const thereAndBackClamp = thereAndBack;

export function running(name) {
  return typeof name === "function" ? name : (RATE_FUNCTIONS[name] ?? smooth);
}

export const RATE_FUNCTIONS = {
  linear, smooth, rushInto, rushFrom, slowInto, doubleSmooth,
  thereAndBack, thereAndBackWithPause,
  easeInSine, easeOutSine, easeInOutSine,
  easeInQuad, easeOutQuad, easeInOutQuad,
  easeInCubic, easeOutCubic, easeInOutCubic,
};
