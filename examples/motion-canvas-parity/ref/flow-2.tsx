import {createRef, ThreadGenerator} from '@motion-canvas/core';
import {makeScene2D, Circle} from '@motion-canvas/2d';

export default makeScene2D(function* (view) {
  const circle = createRef<Circle>();
  view.add(<Circle ref={circle} width={100} height={100} />);

  yield* flicker(circle());
});

function* flicker(circle: Circle): ThreadGenerator {
  circle.fill('red');
  yield;
  circle.fill('blue');
  yield;
  circle.fill('red');
  yield;
}
