import {makeScene2D, Video} from '@motion-canvas/2d';

import exampleMp4 from '../../videos/example.mp4';

export default makeScene2D(function* (view) {
  view.add(<Video src={exampleMp4} />);
});
