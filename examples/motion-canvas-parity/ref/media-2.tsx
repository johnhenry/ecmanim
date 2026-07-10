// ...
import {all, createRef} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const imageRef = createRef<Img>();

  view.add(<Img ref={imageRef} src={examplePng} scale={2} />);

  yield* all(
    imageRef().scale(2.5, 1.5).to(2, 1.5),
    imageRef().absoluteRotation(90, 1.5).to(0, 1.5),
  );
});
