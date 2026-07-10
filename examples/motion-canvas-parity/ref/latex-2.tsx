import {Latex, makeScene2D} from '@motion-canvas/2d';

export default makeScene2D(function* (view) {
  view.add(
    <Latex
      // Try editing the formula below:
      tex="a^2 + b^2 = c^2"
      fill="white"
      fontSize={32}
    />,
  );
});
