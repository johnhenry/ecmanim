import {makeScene2D, Camera, Rect, Circle} from '@motion-canvas/2d';
import {createRef} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const camera = createRef<Camera>();

  view.add(
    <Camera ref={camera}>
      <Rect size={100} fill={'lightseagreen'} position={[-100, -30]} />
      <Circle size={80} fill={'hotpink'} position={[100, 30]} />
    </Camera>,
  );

  yield* camera().position([-100, -30], 1);
  yield* camera().position([100, -30], 1);
  yield* camera().position(0, 1);
});
