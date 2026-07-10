// snippet Filters Property
import {Img, makeScene2D} from '@motion-canvas/2d';
import {createRef} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  view.fill('#141414');

  const iconRef = createRef<Img>();
  yield view.add(<Img src={'/img/logo_dark.svg'} size={200} ref={iconRef} />);
  // Modification happens by accessing the `filters` property.
  // Individual filters don't need to be initialized. If a filter you set doesn't
  // exists, it will be automatically created and added to the list of filters.
  // If you have multiple filters of the same type, this will only
  // modify the first instance (you can use the array method for more control).
  yield* iconRef().filters.blur(10, 1);
  yield* iconRef().filters.blur(0, 1);
});

// snippet Filters Array
import {makeScene2D, Img, blur} from '@motion-canvas/2d';
import {createSignal} from '@motion-canvas/core';

export default makeScene2D(function* (view) {
  view.fill('#141414');

  const blurSignal = createSignal(0);
  yield view.add(
    <Img
      src={'/img/logo_dark.svg'}
      size={200}
      /* Modification happens by changing the Filters inside the 'filters' array */
      filters={[blur(blurSignal)]}
    />,
  );
  yield* blurSignal(10, 1);
  yield* blurSignal(0, 1);
});
