import {makeScene2D, Layout, Circle} from '@motion-canvas/2d';
import {createSignal, linear, range} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const count = createSignal(10);

  view.add(
    <Layout layout>
      {() => range(count()).map(() => <Circle size={32} fill={'white'} />)}
    </Layout>,
  );

  yield* count(3, 2, linear).wait(1).back(2);
});
