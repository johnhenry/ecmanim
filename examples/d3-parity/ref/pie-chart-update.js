function _1(md){return(
md`# Pie chart update

This variation of a [donut chart](https://observablehq.com/@d3/donut-chart/2) demonstrates how to update values with an animated transition. Clicking on the radio buttons changes the displayed metric.`
)}

function _dataset(Inputs,chart)
{
  const radio = Inputs.radio(new Map([["Apples", "apples"], ["Oranges", "oranges"]]), {label: "dataset", value: "apples"});
  const timeout = setTimeout(() => chart.change(radio.value = "oranges"), 2000);
  radio.addEventListener("input", () => (clearTimeout(timeout), chart.change(radio.value)));
  return radio;
}


function _chart(width,d3,data)
{
  const height = Math.min(500, width / 2);
  const outerRadius = height / 2 - 10;
  const innerRadius = outerRadius * 0.75;
  const tau = 2 * Math.PI;
  const color = d3.scaleOrdinal(d3.schemeObservable10);

  const svg = d3.create("svg")
      .attr("viewBox", [-width/2, -height/2, width, height]);

  const arc = d3.arc()
        .innerRadius(innerRadius)
        .outerRadius(outerRadius);

  const pie = d3.pie().sort(null).value((d) => d["apples"]);
  
  const path = svg.datum(data).selectAll("path")
      .data(pie)
    .join("path")
      .attr("fill", (d, i) => color(i))
      .attr("d", arc)
      .each(function(d) { this._current = d; }); // store the initial angles

  function change(value) {
    pie.value((d) => d[value]); // change the value function
    path.data(pie); // compute the new angles
    path.transition().duration(750).attrTween("d", arcTween); // redraw the arcs
  }

  // Store the displayed angles in _current.
  // Then, interpolate from _current to the new angles.
  // During the transition, _current is updated in-place by d3.interpolate.
  function arcTween(a) {
    const i = d3.interpolate(this._current, a);
    this._current = i(0);
    return (t) => arc(i(t));
  }

  // Return the svg node to be displayed.
  return Object.assign(svg.node(), {change});
  
}


function _data(d3){return(
d3.tsvParse(`apples	oranges
53245	200
28479	200
19697	200
24037	200
40245	200`, d3.autoType)
)}

export default function define(runtime, observer) {
  const main = runtime.module();
  main.variable(observer()).define(["md"], _1);
  main.variable(observer("viewof dataset")).define("viewof dataset", ["Inputs","chart"], _dataset);
  main.variable(observer("dataset")).define("dataset", ["Generators", "viewof dataset"], (G, _) => G.input(_));
  main.variable(observer("chart")).define("chart", ["width","d3","data"], _chart);
  main.variable(observer("data")).define("data", ["d3"], _data);
  return main;
}
