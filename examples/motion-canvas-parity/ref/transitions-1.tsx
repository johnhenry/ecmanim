export default makeScene2D(function* (view) {
  // set up the scene:
  view.add(/* your nodes here */);

  // perform a slide transition to the left:
  yield* slideTransition(Direction.Left);

  // proceed with the animation
  yield* waitFor(3);
});
