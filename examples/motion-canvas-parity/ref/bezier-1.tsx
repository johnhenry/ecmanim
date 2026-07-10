// snippet Cubic Bézier
import {makeScene2D, CubicBezier} from '@motion-canvas/2d';
import {createRef} from '@motion-canvas/core';

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
      end={0}
    />,
  );

  yield* bezier().end(1, 1);
  yield* bezier().start(1, 1).to(0, 1);
});

// snippet Quadratic Bézier
import {makeScene2D, QuadBezier} from '@motion-canvas/2d';
import {createRef} from '@motion-canvas/core';

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
      end={0}
    />,
  );

  yield* bezier().end(1, 1);
  yield* bezier().start(1, 1).to(0, 1);
});
