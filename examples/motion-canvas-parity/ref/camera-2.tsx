// highlight-start
import {makeScene2D, Camera, Rect, Circle} from '@motion-canvas/2d';
//highlight-end
import {createRef} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  // highlight-start
  const camera = createRef<Camera>();
  //highlight-end

  view.add(
    // highlight-start
    <Camera ref={camera}>
      //highlight-end
      <Rect size={100} fill={'lightseagreen'} position={[-100, -30]} />
      <Circle size={80} fill={'hotpink'} position={[100, 30]} />
      // highlight-start
    </Camera>,
    //highlight-end
  );
});
