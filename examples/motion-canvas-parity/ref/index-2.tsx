import {makeScene2D, Code} from '@motion-canvas/2d';

export default makeScene2D(function* (view) {
  view.add(
    // prettier-ignore
    <Code
      fontSize={28}
      code={'const number = 7;'}
    />,
  );
});
