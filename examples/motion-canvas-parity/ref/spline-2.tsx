import {makeScene2D, Spline} from '@motion-canvas/2d';

export default makeScene2D(function* (view) {
  view.add(
    <Spline
      lineWidth={6}
      stroke={'lightseagreen'}
      points={[
        [-300, 0],
        [-150, -100],
        [150, 100],
        [300, 0],
      ]}
    />,
  );
});
