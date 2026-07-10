export default makeScene2D(function* (view) {
  const circle = createRef<Circle>();
  view.add(<Circle ref={circle} width={100} height={100} />);

  circle().fill('red');
  yield;
  circle().fill('blue');
  yield;
  circle().fill('red');
  yield;
});
