import {makeScene2D, Path, Rect} from '@motion-canvas/2d';
import {createRef, createSignal} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const path = createRef<Path>();
  const progress = createSignal(0);

  view.add(
    <>
      <Path
        ref={path}
        lineWidth={6}
        stroke={'lightgray'}
        data={
          'M -180 -21 C -180 -54.1371 -153.1371 -81 -120 -81 C -86.8629 -81 -60 -54.1371 -60 -21 C -60 12.1371 -33.1371 33 0 33 C 33.1371 33 48 3 48 -21 C 48 -45 30 -69 0 -69 C -30 -69 -48 -45 -48 -21 C -48 3 -33.1371 33 0 33 C 39 34.5 60 12 60 -21 C 60 -54.1371 86.8629 -81 120 -81 C 153.1371 -81 180 -54.1371 180 -21 C 180 12.1371 153.1371 39 120 39 L -120 39 C -153.1371 39 -180 12.1371 -180 -21 Z'
        }
      />
      <Rect
        size={26}
        fill={'lightseagreen'}
        position={() => path().getPointAtPercentage(progress()).position}
        rotation={() => path().getPointAtPercentage(progress()).tangent.degrees}
      />
    </>,
  );

  yield* progress(1, 2).to(0, 2);
});
