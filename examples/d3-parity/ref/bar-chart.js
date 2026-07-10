function _1(md){return(
md`# Bar Chart

<p style="background: #fffced; box-sizing: border-box; padding: 10px 20px; font-style: italic;">**Update May 2023:** This notebook has been deprecated and is no longer maintained; please see the newer [D3 bar chart example](/@d3/bar-chart/2) and [Observable Plot bar chart example](/@observablehq/plot-vertical-bar-chart).</p>

This chart shows the relative frequency of letters in the English language. A vertical bar chart such as this is sometimes called a *column* chart. Data: *Cryptological Mathematics*, Robert Lewand`
)}

function _chart(BarChart,alphabet,d3,width){return(
BarChart(alphabet, {
  x: d => d.letter,
  y: d => d.frequency,
  xDomain: d3.groupSort(alphabet, ([d]) => -d.frequency, d => d.letter), // sort by descending frequency
  yFormat: "%",
  yLabel: "↑ Frequency",
  width,
  height: 500,
  color: "steelblue"
})
)}

function _alphabet(FileAttachment){return(
FileAttachment("alphabet.csv").csv({typed: true})
)}

function _4(howto){return(
howto("BarChart")
)}

function _5(altplot){return(
altplot(`Plot.barY(alphabet, {x: "letter", y: "frequency"}).plot()`)
)}

function _BarChart(d3){return(
function BarChart(data, {
  x = (d, i) => i, // given d in data, returns the (ordinal) x-value
  y = d => d, // given d in data, returns the (quantitative) y-value
  title, // given d in data, returns the title text
  marginTop = 20, // the top margin, in pixels
  marginRight = 0, // the right margin, in pixels
  marginBottom = 30, // the bottom margin, in pixels
  marginLeft = 40, // the left margin, in pixels
  width = 640, // the outer width of the chart, in pixels
  height = 400, // the outer height of the chart, in pixels
  xDomain, // an array of (ordinal) x-values
  xRange = [marginLeft, width - marginRight], // [left, right]
  yType = d3.scaleLinear, // y-scale type
  yDomain, // [ymin, ymax]
  yRange = [height - marginBottom, marginTop], // [bottom, top]
  xPadding = 0.1, // amount of x-range to reserve to separate bars
  yFormat, // a format specifier string for the y-axis
  yLabel, // a label for the y-axis
  color = "currentColor" // bar fill color
} = {}) {
  // Compute values.
  const X = d3.map(data, x);
  const Y = d3.map(data, y);

  // Compute default domains, and unique the x-domain.
  if (xDomain === undefined) xDomain = X;
  if (yDomain === undefined) yDomain = [0, d3.max(Y)];
  xDomain = new d3.InternSet(xDomain);

  // Omit any data not present in the x-domain.
  const I = d3.range(X.length).filter(i => xDomain.has(X[i]));

  // Construct scales, axes, and formats.
  const xScale = d3.scaleBand(xDomain, xRange).padding(xPadding);
  const yScale = yType(yDomain, yRange);
  const xAxis = d3.axisBottom(xScale).tickSizeOuter(0);
  const yAxis = d3.axisLeft(yScale).ticks(height / 40, yFormat);

  // Compute titles.
  if (title === undefined) {
    const formatValue = yScale.tickFormat(100, yFormat);
    title = i => `${X[i]}\n${formatValue(Y[i])}`;
  } else {
    const O = d3.map(data, d => d);
    const T = title;
    title = i => T(O[i], i, data);
  }

  const svg = d3.create("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", [0, 0, width, height])
      .attr("style", "max-width: 100%; height: auto; height: intrinsic;");

  svg.append("g")
      .attr("transform", `translate(${marginLeft},0)`)
      .call(yAxis)
      .call(g => g.select(".domain").remove())
      .call(g => g.selectAll(".tick line").clone()
          .attr("x2", width - marginLeft - marginRight)
          .attr("stroke-opacity", 0.1))
      .call(g => g.append("text")
          .attr("x", -marginLeft)
          .attr("y", 10)
          .attr("fill", "currentColor")
          .attr("text-anchor", "start")
          .text(yLabel));

  const bar = svg.append("g")
      .attr("fill", color)
    .selectAll("rect")
    .data(I)
    .join("rect")
      .attr("x", i => xScale(X[i]))
      .attr("y", i => yScale(Y[i]))
      .attr("height", i => yScale(0) - yScale(Y[i]))
      .attr("width", xScale.bandwidth());

  if (title) bar.append("title")
      .text(title);

  svg.append("g")
      .attr("transform", `translate(0,${height - marginBottom})`)
      .call(xAxis);

  return svg.node();
}
)}

export default function define(runtime, observer) {
  const main = runtime.module();
  main.define("module 1", async () => runtime.module((await import("/@d3/example-components.js?v=4&resolutions=09403b146bada149@527")).default));
  const fileAttachments = new Map([
    ["alphabet.csv", {url: "https://static.observableusercontent.com/files/09f63bb9ff086fef80717e2ea8c974f918a996d2bfa3d8773d3ae12753942c002d0dfab833d7bee1e0c9cd358cd3578c1cd0f9435595e76901508adc3964bbdc", mimeType: "text/csv"}]
  ]);
  main.builtin("FileAttachment", runtime.fileAttachments(name => fileAttachments.get(name)));
  main.variable(observer()).define(["md"], _1);
  main.variable(observer("chart")).define("chart", ["BarChart","alphabet","d3","width"], _chart);
  main.variable(observer("alphabet")).define("alphabet", ["FileAttachment"], _alphabet);
  main.variable(observer()).define(["howto"], _4);
  main.variable(observer()).define(["altplot"], _5);
  main.variable(observer("BarChart")).define("BarChart", ["d3"], _BarChart);
  main.define("howto", ["module 1", "@variable"], (_, v) => v.import("howto", _));
  main.define("altplot", ["module 1", "@variable"], (_, v) => v.import("altplot", _));
  return main;
}
