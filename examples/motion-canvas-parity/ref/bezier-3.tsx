// snippet Drawing Bézier curves
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

  yield* bezier().end(1, 2).to(0, 2);
});

// snippet Moving nodes along a curve
import {makeScene2D, CubicBezier, Rect} from '@motion-canvas/2d';
import {
  createRef,
  waitFor,
  createSignal,
  createComputed,
} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const bezier = createRef<CubicBezier>();

  const progress = createSignal(0);
  const curvePoint = createComputed(() =>
    bezier().getPointAtPercentage(progress()),
  );

  view.add(
    <>
      <CubicBezier
        ref={bezier}
        lineWidth={6}
        stroke={'lightgray'}
        p0={[-300, -70]}
        p1={[120, -120]}
        p2={[-120, 120]}
        p3={[300, 70]}
      />
      <Rect
        size={25}
        fill={'lightseagreen'}
        position={() => curvePoint().position}
        rotation={() => curvePoint().tangent.degrees}
      />
    </>,
  );

  yield* progress(1, 2);
  yield* waitFor(0.5);
  yield* progress(0, 2);
  yield* waitFor(0.5);
});
