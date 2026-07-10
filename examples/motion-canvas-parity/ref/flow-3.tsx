import {makeScene2D, Rect} from '@motion-canvas/2d';
import {all, waitFor, makeRef, range} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const rects: Rect[] = [];

  // Create some rects
  view.add(
    range(5).map(i => (
      <Rect
        ref={makeRef(rects, i)}
        width={100}
        height={100}
        x={-250 + 125 * i}
        fill="#88C0D0"
        radius={10}
      />
    )),
  );

  yield* waitFor(1);

  // Animate them
  yield* all(
    ...rects.map(rect => rect.position.y(100, 1).to(-100, 2).to(0, 1)),
  );
});
