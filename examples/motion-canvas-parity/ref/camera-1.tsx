import {Camera, Circle, makeScene2D, Rect} from '@motion-canvas/2d';
import {all, createRef} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const camera = createRef<Camera>();
  const rect = createRef<Rect>();
  const circle = createRef<Circle>();

  view.add(
    <>
      <Camera ref={camera}>
        <Rect
          ref={rect}
          fill={'lightseagreen'}
          size={100}
          position={[100, -50]}
        />
        <Circle
          ref={circle}
          fill={'hotpink'}
          size={120}
          position={[-100, 50]}
        />
      </Camera>
    </>,
  );

  yield* all(
    camera().centerOn(rect(), 3),
    camera().rotation(180, 3),
    camera().zoom(1.8, 3),
  );
  yield* camera().centerOn(circle(), 2);
  yield* camera().reset(1);
});
