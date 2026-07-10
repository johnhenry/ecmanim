function _1(md){return(
md`# Bar Chart Transitions

<p style="background: #fffced; box-sizing: border-box; padding: 10px 20px; font-style: italic;">**Update July 2023:** This notebook has been deprecated and is no longer maintained; please see the newer [D3 bar chart transitions](/@d3/bar-chart-transitions/2) and [Plot bar chart transitions](https://observablehq.com/@observablehq/plot-bar-chart-transitions) examples.</p>

This [bar chart](/@d3/bar-chart) supports animated transitions. For [object constancy](https://bost.ocks.org/mike/constancy/), bars are keyed by name, making it possible to follow changes in value and order across transitions. Use the dropdown menu to change the sort order.`
)}

function _order(Inputs,d3){return(
Inputs.select(new Map([
  ["Alphabetical", (a, b) => d3.ascending(a.letter, b.letter)],
  ["Frequency, ascending", (a, b) => d3.ascending(a.frequency, b.frequency)],
  ["Frequency, descending", (a, b) => d3.descending(a.frequency, b.frequency)]
]), {label: "Order"})
)}

function _chart(BarChart,alphabet,width){return(
BarChart(alphabet, {
  x: d => d.letter,
  y: d => d.frequency,
  yFormat: "%",
  yLabel: "↑ Frequency",
  width,
  height: 500,
  color: "#9642f6",
  duration: 750 // slow transition for demonstration
})
)}

function _update(chart,d3,alphabet,order){return(
chart.update(d3.sort(alphabet, order))
)}

function _alphabet(FileAttachment){return(
FileAttachment("alphabet.csv").csv({typed: true})
)}

function _6(howto){return(
howto("BarChart")
)}

function _7(altplot){return(
altplot(`Plot.barY(alphabet, {x: "letter", y: "frequency"}).plot()`)
)}

function _BarChart(d3){return(
function BarChart(data, {
  x = (d, i) => i, // given d in data, returns the (ordinal) x-value
  y = d => d, // given d in data, returns the (quantitative) y-value
  marginTop = 20, // the top margin, in pixels
  marginRight = 0, // the right margin, in pixels
  marginBottom = 30, // the bottom margin, in pixels
  marginLeft = 40, // the left margin, in pixels
  width = 640, // the outer width of the chart, in pixels
  height = 400, // the outer height of the chart, in pixels
  xDomain, // an array of (ordinal) x-values
  xRange = [marginLeft, width - marginRight], // [left, right]
  yType = d3.scaleLinear, // type of y-scale
  yDomain, // [ymin, ymax]
  yRange = [height - marginBottom, marginTop], // [bottom, top]
  xPadding = 0.1, // amount of x-range to reserve to separate bars
  yFormat, // a format specifier string for the y-axis
  yLabel, // a label for the y-axis
  color = "currentColor", // bar fill color
  duration: initialDuration = 250, // transition duration, in milliseconds
  delay: initialDelay = (_, i) => i * 20 // per-element transition delay, in milliseconds
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
  const format = yScale.tickFormat(100, yFormat);

  const svg = d3.create("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", [0, 0, width, height])
      .attr("style", "max-width: 100%; height: auto; height: intrinsic;");

  const yGroup = svg.append("g")
      .attr("transform", `translate(${marginLeft},0)`)
      .call(yAxis)
      .call(g => g.select(".domain").remove())
      .call(g => g.selectAll(".tick").call(grid))
      .call(g => g.append("text")
          .attr("x", -marginLeft)
          .attr("y", 10)
          .attr("fill", "currentColor")
          .attr("text-anchor", "start")
          .text(yLabel));

  let rect = svg.append("g")
      .attr("fill", color)
    .selectAll("rect")
    .data(I)
    .join("rect")
      .property("key", i => X[i]) // for future transitions
      .call(position, i => xScale(X[i]), i => yScale(Y[i]))
      .style("mix-blend-mode", "multiply")
      .call(rect => rect.append("title")
          .text(i => [X[i], format(Y[i])].join("\n")));

  const xGroup = svg.append("g")
      .attr("transform", `translate(0,${height - marginBottom})`)
      .call(xAxis);

  // A helper method for updating the position of bars.
  function position(rect, x, y) {
    return rect
        .attr("x", x)
        .attr("y", y)
        .attr("height", typeof y === "function" ? i => yScale(0) - y(i) : i => yScale(0) - y)
        .attr("width", xScale.bandwidth());
  }

  // A helper method for generating grid lines on the y-axis.
  function grid(tick) {
    return tick.append("line")
        .attr("class", "grid")
        .attr("x2", width - marginLeft - marginRight)
        .attr("stroke", "currentColor")
        .attr("stroke-opacity", 0.1);
  }

  // Call chart.update(data, options) to transition to new data.
  return Object.assign(svg.node(), {
    update(data, {
      xDomain, // an array of (ordinal) x-values
      yDomain, // [ymin, ymax]
      duration = initialDuration, // transition duration, in milliseconds
      delay = initialDelay // per-element transition delay, in milliseconds
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

      // Update scale domains.
      xScale.domain(xDomain);
      yScale.domain(yDomain);

      // Start a transition.
      const t = svg.transition().duration(duration);

      // Join the data, applying enter and exit.
      rect = rect
          .data(I, function(i) { return this.tagName === "rect" ? this.key : X[i]; })
          .join(
            enter => enter.append("rect")
                .property("key", i => X[i]) // for future transitions
                .call(position, i => xScale(X[i]), yScale(0))
                .style("mix-blend-mode", "multiply")
                .call(enter => enter.append("title")),
            update => update,
            exit => exit.transition(t)
                .delay(delay)
                .attr("y", yScale(0))
                .attr("height", 0)
                .remove()
          );

      // Update the title text on all entering and updating bars.
      rect.select("title")
          .text(i => [X[i], format(Y[i])].join("\n"));

      // Transition entering and updating bars to their new position. Note
      // that this assumes that the input data and the x-domain are in the
      // same order, or else the ticks and bars may have different delays.
      rect.transition(t)
          .delay(delay)
          .call(position, i => xScale(X[i]), i => yScale(Y[i]));

      // Transition the x-axis (using a possibly staggered delay per tick).
      xGroup.transition(t)
          .call(xAxis)
          .call(g => g.selectAll(".tick").delay(delay));

      // Transition the y-axis, then post process for grid lines etc.
      yGroup.transition(t)
          .call(yAxis)
        .selection()
          .call(g => g.select(".domain").remove())
          .call(g => g.selectAll(".tick").selectAll(".grid").data([,]).join(grid));
    }
  });
}
)}

function _10(md){return(
md`The *trigger* cell below uses a timeout to change the selected value in the *order* input above, triggering an animation on page load for demonstrative purposes. If the user interacts with the menu prior to the timeout, the timeout is cleared. You don’t need this cell to use the chart above.`
)}

function _trigger($0,Event,invalidation)
{
  const input = $0.input;
  const interval = setInterval(() => {
    input.selectedIndex = (input.selectedIndex + 1) % input.length;
    input.dispatchEvent(new Event("input", {bubbles: true}));
  }, 4000);
  const clear = () => clearInterval(interval);
  input.addEventListener("change", clear, {once: true});
  invalidation.then(() => (clear(), input.removeEventListener("change", clear)));
}


export default function define(runtime, observer) {
  const main = runtime.module();
  main.define("module 1", async () => runtime.module((await import("/@d3/example-components.js?v=4&resolutions=a1836d740ee4badd@483")).default));
  const fileAttachments = new Map([
    ["alphabet.csv", {url: "https://static.observableusercontent.com/files/09f63bb9ff086fef80717e2ea8c974f918a996d2bfa3d8773d3ae12753942c002d0dfab833d7bee1e0c9cd358cd3578c1cd0f9435595e76901508adc3964bbdc", mimeType: "text/csv"}]
  ]);
  main.builtin("FileAttachment", runtime.fileAttachments(name => fileAttachments.get(name)));
  main.variable(observer()).define(["md"], _1);
  main.variable(observer("viewof order")).define("viewof order", ["Inputs","d3"], _order);
  main.variable(observer("order")).define("order", ["Generators", "viewof order"], (G, _) => G.input(_));
  main.variable(observer("chart")).define("chart", ["BarChart","alphabet","width"], _chart);
  main.variable(observer("update")).define("update", ["chart","d3","alphabet","order"], _update);
  main.variable(observer("alphabet")).define("alphabet", ["FileAttachment"], _alphabet);
  main.variable(observer()).define(["howto"], _6);
  main.variable(observer()).define(["altplot"], _7);
  main.variable(observer("BarChart")).define("BarChart", ["d3"], _BarChart);
  main.define("howto", ["module 1", "@variable"], (_, v) => v.import("howto", _));
  main.define("altplot", ["module 1", "@variable"], (_, v) => v.import("altplot", _));
  main.variable(observer()).define(["md"], _10);
  main.variable(observer("trigger")).define("trigger", ["viewof order","Event","invalidation"], _trigger);
  return main;
}
