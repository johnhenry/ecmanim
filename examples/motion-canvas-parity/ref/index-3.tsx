import {makeScene2D, Code} from '@motion-canvas/2d';
import {waitFor} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  const nameSignal = Code.createSignal('number');
  view.add(
    // prettier-ignore
    <Code
      fontSize={28}
      code={`const ${nameSignal()} = 7;`}
    />,
  );

  yield* waitFor(1);
  nameSignal('newValue');
  // The code snippet still displays "number" instead of "newValue".
  yield* waitFor(1);
});
