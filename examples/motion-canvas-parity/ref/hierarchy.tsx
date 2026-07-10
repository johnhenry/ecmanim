import {makeScene2D, Layout, Txt, Circle, Rect, is} from '@motion-canvas/2d';
import {all} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  view.add(
    <Layout layout gap={20} alignItems={'center'}>
      <Txt fill={'white'}>Example</Txt>
      <Rect fill={'#f3303f'} padding={20} gap={20}>
        <Txt fill={'white'}>42</Txt>
        <Circle size={60} fill={'#FFC66D'} />
        <Txt fill={'white'}>!!!</Txt>
      </Rect>
    </Layout>,
  );

  const texts = view.findAll(is(Txt));

  yield* all(...texts.map(text => text.fill('#FFC66D', 1).back(1)));
});
