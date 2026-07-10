// snippet Cubic Bézier
import {makeScene2D, CubicBezier} from '@motion-canvas/2d';
import {createRef, waitFor} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const bezier = createRef<CubicBezier>();

  view.add(
    <CubicBezier
      ref={bezier}
      lineWidth={6}
      stroke={'lightseagreen'}
      p0={[-200, -70]}
      p1={[120, -120]}
      p2={[-120, 120]}
      p3={[200, 70]}
    />,
  );

  yield* waitFor(1);
});

// snippet Quadratic Bézier
import {makeScene2D, QuadBezier} from '@motion-canvas/2d';
import {createRef, waitFor} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const bezier = createRef<QuadBezier>();

  view.add(
    <QuadBezier
      ref={bezier}
      lineWidth={6}
      stroke={'lightseagreen'}
      p0={[-150, 50]}
      p1={[0, -120]}
      p2={[150, 50]}
    />,
  );

  yield* waitFor(1);
});
