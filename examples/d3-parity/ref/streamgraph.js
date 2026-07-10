function _1(md){return(
md`# Stacked Area Chart, Streamgraph

<p style="background: #fffced; box-sizing: border-box; padding: 10px 20px; font-style: italic;">**Update June 2023:** This notebook has been deprecated and is no longer maintained; please see the newer [D3 streamgraph](/@d3/streamgraph/2) and [Observable Plot streamgraph](/@observablehq/plot-stack-offset) examples.</p>

This chart shows unemployed persons by industry, 2000–2010. Compare to [stacked area charts](/@d3/stacked-area-chart) and [normalized stacked area charts](/@d3/normalized-stacked-area-chart). Data: [BLS](https://www.bls.gov/)`
)}

function _key(Swatches,chart){return(
Swatches(chart.scales.color, {columns: "180px"})
)}

function _chart(Streamgraph,unemployment,width){return(
Streamgraph(unemployment, {
  x: d => d.date,
  y: d => d.unemployed,
  z: d => d.industry,
  yLabel: "↑ Unemployed persons",
  width,
  height: 600
})
)}

function _unemployment(FileAttachment){return(
FileAttachment("unemployment.csv").csv({typed: true})
)}

function _5(howto){return(
howto("Streamgraph")
)}

function _6(altplot){return(
altplot(`Plot.areaY(
  unemployment,
  Plot.stackY({
    offset: "wiggle",
    order: "inside-out",
    x: "date",
    y: "unemployed",
    fill: "industry"
  })
).plot()`)
)}

function _Streamgraph(d3){return(
function Streamgraph(data, {
  x = ([x]) => x, // given d in data, returns the (ordinal) x-value
  y = ([, y]) => y, // given d in data, returns the (quantitative) y-value
  z = () => 1, // given d in data, returns the (categorical) z-value
  marginTop = 20, // top margin, in pixels
  marginRight = 30, // right margin, in pixels
  marginBottom = 30, // bottom margin, in pixels
  marginLeft = 20, // left margin, in pixels
  width = 640, // outer width, in pixels
  height = 400, // outer height, in pixels
  xType = d3.scaleUtc, // type of x-scale
  xDomain, // [xmin, xmax]
  xRange = [marginLeft, width - marginRight], // [left, right]
  yType = d3.scaleLinear, // type of y-scale
  yDomain, // [ymin, ymax]
  yRange = [height - marginBottom, marginTop], // [bottom, top]
  zDomain, // array of z-values
  offset = d3.stackOffsetWiggle, // stack offset method
  order = d3.stackOrderInsideOut, // stack order method
  xFormat, // a format specifier string for the x-axis
  yFormat, // a format specifier string for the y-axis
  yLabel, // a label for the y-axis
  colors = d3.schemeTableau10,
} = {}) {
  // Compute values.
  const X = d3.map(data, x);
  const Y = d3.map(data, y);
  const Z = d3.map(data, z);

  // Compute default x- and z-domains, and unique the z-domain.
  if (xDomain === undefined) xDomain = d3.extent(X);
  if (zDomain === undefined) zDomain = Z;
  zDomain = new d3.InternSet(zDomain);

  // Omit any data not present in the z-domain.
  const I = d3.range(X.length).filter(i => zDomain.has(Z[i]));

  // Compute a nested array of series where each series is [[y1, y2], [y1, y2],
  // [y1, y2], …] representing the y-extent of each stacked rect. In addition,
  // each tuple has an i (index) property so that we can refer back to the
  // original data point (data[i]). This code assumes that there is only one
  // data point for a given unique x- and z-value.
  const series = d3.stack()
      .keys(zDomain)
      .value(([x, I], z) => Y[I.get(z)])
      .order(order)
      .offset(offset)
    (d3.rollup(I, ([i]) => i, i => X[i], i => Z[i]))
    .map(s => s.map(d => Object.assign(d, {i: d.data[1].get(s.key)})));

  // Compute the default y-domain. Note: diverging stacks can be negative.
  if (yDomain === undefined) yDomain = d3.extent(series.flat(2));

  // Construct scales and axes.
  const xScale = xType(xDomain, xRange);
  const yScale = yType(yDomain, yRange);
  const color = d3.scaleOrdinal(zDomain, colors);
  const xAxis = d3.axisBottom(xScale).ticks(width / 80, xFormat).tickSizeOuter(0);

  const area = d3.area()
      .x(({i}) => xScale(X[i]))
      .y0(([y1]) => yScale(y1))
      .y1(([, y2]) => yScale(y2));

  const svg = d3.create("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", [0, 0, width, height])
      .attr("style", "max-width: 100%; height: auto; height: intrinsic;");

  svg.append("g")
    .selectAll("path")
    .data(series)
    .join("path")
      .attr("fill", ([{i}]) => color(Z[i]))
      .attr("d", area)
    .append("title")
      .text(([{i}]) => Z[i]);

  svg.append("g")
      .attr("transform", `translate(0,${height - marginBottom})`)
      .call(xAxis)
      .call(g => g.select(".domain").remove());

  svg.append("g")
      .attr("transform", `translate(${marginLeft},0)`)
      .call(g => g.append("text")
          .attr("x", -marginLeft)
          .attr("y", 10)
          .attr("font-family", "sans-serif")
          .attr("font-size", 10)
          .text(yLabel));

  return Object.assign(svg.node(), {scales: {color}});
}
)}

export default function define(runtime, observer) {
  const main = runtime.module();
  main.define("module 1", async () => runtime.module((await import("/@d3/color-legend.js?v=4&resolutions=9bcde4cc5ba575eb@642")).default));
  main.define("module 2", async () => runtime.module((await import("/@d3/example-components.js?v=4&resolutions=9bcde4cc5ba575eb@642")).default));
  const fileAttachments = new Map([
    ["unemployment-2.csv", {url: "https://static.observableusercontent.com/files/7cbdbc28fc4f3b5cb40e26cdf411c88807dd134ad13cac7576ee0abe81f834d1fc9d8dcddca522d9f52d329396319a5c7e61e43c83074080c3e3f97189909ee3", mimeType: "text/csv"}],
    ["unemployment.csv", {url: "https://static.observableusercontent.com/files/76f13741128340cc88798c0a0b7fa5a2df8370f57554000774ab8ee9ae785ffa2903010cad670d4939af3e9c17e5e18e7e05ed2b38b848ac2fc1a0066aa0005f", mimeType: "text/csv"}]
  ]);
  main.builtin("FileAttachment", runtime.fileAttachments(name => fileAttachments.get(name)));
  main.variable(observer()).define(["md"], _1);
  main.variable(observer("key")).define("key", ["Swatches","chart"], _key);
  main.variable(observer("chart")).define("chart", ["Streamgraph","unemployment","width"], _chart);
  main.variable(observer("unemployment")).define("unemployment", ["FileAttachment"], _unemployment);
  main.variable(observer()).define(["howto"], _5);
  main.variable(observer()).define(["altplot"], _6);
  main.variable(observer("Streamgraph")).define("Streamgraph", ["d3"], _Streamgraph);
  main.define("Swatches", ["module 1", "@variable"], (_, v) => v.import("Swatches", _));
  main.define("howto", ["module 2", "@variable"], (_, v) => v.import("howto", _));
  main.define("altplot", ["module 2", "@variable"], (_, v) => v.import("altplot", _));
  return main;
}
