import {makeScene2D, Img} from '@motion-canvas/2d';

import examplePng from '../../images/example.png';

export default makeScene2D(function* (view) {
  view.add(<Img src={examplePng} />);
});
