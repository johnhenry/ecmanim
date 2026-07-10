import {makeScene2D, Spline} from '@motion-canvas/2d';
import {createRef} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const spline = createRef<Spline>();

  view.add(
    <Spline
      ref={spline}
      lineWidth={6}
      stroke={'lightseagreen'}
      smoothness={0.4}
      points={[
        [-300, 0],
        [-150, -100],
        [150, 100],
        [300, 0],
      ]}
    />,
  );

  yield* spline().smoothness(0, 1).to(1, 1).to(0.4, 1);
});
