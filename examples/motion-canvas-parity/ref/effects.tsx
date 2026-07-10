import {Circle, Layout, makeScene2D} from '@motion-canvas/2d';
import {
  createEffect,
  createRef,
  createSignal,
  spawn,
  waitFor,
} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const count = createSignal(0);
  const container = createRef<Layout>();

  view.add(<Layout alignItems={'center'} ref={container} layout />);

  const circles: Circle[] = [];
  createEffect(() => {
    const targetCount = Math.round(count());
    let i = circles.length;
    // add any missing circles
    for (; i < targetCount; i++) {
      const circle = (<Circle fill={'white'} />) as Circle;
      circles.push(circle);
      container().add(circle);
      spawn(circle.size(80, 0.3));
    }
    // remove any extra circles
    for (; i > targetCount; i--) {
      const circle = circles.pop()!;
      spawn(circle.size(0, 0.3).do(() => circle.remove()));
    }
  });

  count(1);
  yield* waitFor(1);
  count(6);
  yield* waitFor(1);
  count(4);
  yield* count(0, 2);
  yield* waitFor(1);
});
