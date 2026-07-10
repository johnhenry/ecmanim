export default makeScene2D(function* (view) {
  yield* animationOne();
  // trigger the transition early:
  finishScene();
  // continue animating:
  yield* animationTwo();
});
