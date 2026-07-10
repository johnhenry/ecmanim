import {makeScene2D, Spline, Knot} from '@motion-canvas/2d';
import {createRef} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const spline = createRef<Spline>();

  view.add(
    <Spline ref={spline} lineWidth={4} fill={'#e13238'} closed>
      <Knot position={[-120, -30]} startHandle={[0, 70]} />
      <Knot
        position={[0, -50]}
        startHandle={[-40, -60]}
        endHandle={[40, -60]}
      />
      <Knot position={[120, -30]} startHandle={[0, -70]} />
      <Knot position={[0, 100]} startHandle={[5, 0]} />
    </Spline>,
  );

  yield* spline().scale(0.9, 0.6).to(1, 0.4);
});
