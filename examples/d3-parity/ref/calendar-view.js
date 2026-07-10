function _1(dji,md){return(
md`# Calendar

<p style="background: #fffced; box-sizing: border-box; padding: 10px 20px; font-style: italic;">**Update May 2023:** This notebook has been deprecated and is no longer maintained; please see the newer [D3 calendar example](/@d3/calendar/2) and [Observable Plot calendar example](/@observablehq/plot-calendar).</p>

This chart shows daily changes of the Dow Jones Industrial Average from ${dji[0].Date.getUTCFullYear()} to ${dji[dji.length - 1].Date.getUTCFullYear()}. Days the index went up are green, and down are pink. Data: [Yahoo Finance](https://finance.yahoo.com/quote/%5EDJI/history/)`
)}

function _weekday(Inputs){return(
Inputs.select(new Map([
  ["Weekdays only", "weekday"],
  ["Sunday-based weeks", "sunday"],
  ["Monday-based weeks", "monday"],
]))
)}

function _key(Legend,chart){return(
Legend(chart.scales.color, {title: "Daily change", tickFormat: "+%", marginLeft: 40})
)}

function _chart(Calendar,dji,weekday,width){return(
Calendar(dji, {
  x: d => d.Date,
  y: (d, i, data) => i > 0 ? (d.Close - data[i - 1].Close) / data[i - 1].Close : NaN, // relative change
  yFormat: "+%", // show percent change on hover
  weekday,
  width
})
)}

function _5(md){return(
md`For comparison, here’s daily trading volume. Darker green indicates higher volume.`
)}

function _6(Calendar,dji,weekday,width){return(
Calendar(dji, {
  x: d => d.Date,
  y: d => d.Volume,
  weekday,
  width
})
)}

function _dji(FileAttachment){return(
FileAttachment("^DJI@2.csv").csv({typed: true})
)}

function _8(howto){return(
howto('Calendar')
)}

function _Calendar(d3){return(
function Calendar(data, {
  x = ([x]) => x, // given d in data, returns the (temporal) x-value
  y = ([, y]) => y, // given d in data, returns the (quantitative) y-value
  title, // given d in data, returns the title text
  width = 928, // width of the chart, in pixels
  cellSize = 17, // width and height of an individual day, in pixels
  weekday = "monday", // either: weekday, sunday, or monday
  formatDay = i => "SMTWTFS"[i], // given a day number in [0, 6], the day-of-week label
  formatMonth = "%b", // format specifier string for months (above the chart)
  yFormat, // format specifier string for values (in the title)
  colors = d3.interpolatePiYG
} = {}) {
  // Compute values.
  const X = d3.map(data, x);
  const Y = d3.map(data, y);
  const I = d3.range(X.length);

  const countDay = weekday === "sunday" ? i => i : i => (i + 6) % 7;
  const timeWeek = weekday === "sunday" ? d3.utcSunday : d3.utcMonday;
  const weekDays = weekday === "weekday" ? 5 : 7;
  const height = cellSize * (weekDays + 2);

  // Compute a color scale. This assumes a diverging color scheme where the pivot
  // is zero, and we want symmetric difference around zero.
  const max = d3.quantile(Y, 0.9975, Math.abs);
  const color = d3.scaleSequential([-max, +max], colors).unknown("none");

  // Construct formats.
  formatMonth = d3.utcFormat(formatMonth);

  // Compute titles.
  if (title === undefined) {
    const formatDate = d3.utcFormat("%B %-d, %Y");
    const formatValue = color.tickFormat(100, yFormat);
    title = i => `${formatDate(X[i])}\n${formatValue(Y[i])}`;
  } else if (title !== null) {
    const T = d3.map(data, title);
    title = i => T[i];
  }

  // Group the index by year, in reverse input order. (Assuming that the input is
  // chronological, this will show years in reverse chronological order.)
  const years = d3.groups(I, i => X[i].getUTCFullYear()).reverse();

  function pathMonth(t) {
    const d = Math.max(0, Math.min(weekDays, countDay(t.getUTCDay())));
    const w = timeWeek.count(d3.utcYear(t), t);
    return `${d === 0 ? `M${w * cellSize},0`
        : d === weekDays ? `M${(w + 1) * cellSize},0`
        : `M${(w + 1) * cellSize},0V${d * cellSize}H${w * cellSize}`}V${weekDays * cellSize}`;
  }

  const svg = d3.create("svg")
      .attr("width", width)
      .attr("height", height * years.length)
      .attr("viewBox", [0, 0, width, height * years.length])
      .attr("style", "max-width: 100%; height: auto; height: intrinsic;")
      .attr("font-family", "sans-serif")
      .attr("font-size", 10);

  const year = svg.selectAll("g")
    .data(years)
    .join("g")
      .attr("transform", (d, i) => `translate(40.5,${height * i + cellSize * 1.5})`);

  year.append("text")
      .attr("x", -5)
      .attr("y", -5)
      .attr("font-weight", "bold")
      .attr("text-anchor", "end")
      .text(([key]) => key);

  year.append("g")
      .attr("text-anchor", "end")
    .selectAll("text")
    .data(weekday === "weekday" ? d3.range(1, 6) : d3.range(7))
    .join("text")
      .attr("x", -5)
      .attr("y", i => (countDay(i) + 0.5) * cellSize)
      .attr("dy", "0.31em")
      .text(formatDay);

  const cell = year.append("g")
    .selectAll("rect")
    .data(weekday === "weekday"
        ? ([, I]) => I.filter(i => ![0, 6].includes(X[i].getUTCDay()))
        : ([, I]) => I)
    .join("rect")
      .attr("width", cellSize - 1)
      .attr("height", cellSize - 1)
      .attr("x", i => timeWeek.count(d3.utcYear(X[i]), X[i]) * cellSize + 0.5)
      .attr("y", i => countDay(X[i].getUTCDay()) * cellSize + 0.5)
      .attr("fill", i => color(Y[i]));

  if (title) cell.append("title")
      .text(title);

  const month = year.append("g")
    .selectAll("g")
    .data(([, I]) => d3.utcMonths(d3.utcMonth(X[I[0]]), X[I[I.length - 1]]))
    .join("g");

  month.filter((d, i) => i).append("path")
      .attr("fill", "none")
      .attr("stroke", "#fff")
      .attr("stroke-width", 3)
      .attr("d", pathMonth);

  month.append("text")
      .attr("x", d => timeWeek.count(d3.utcYear(d), timeWeek.ceil(d)) * cellSize + 2)
      .attr("y", -5)
      .text(formatMonth);

  return Object.assign(svg.node(), {scales: {color}});
}
)}

export default function define(runtime, observer) {
  const main = runtime.module();
  main.define("module 1", async () => runtime.module((await import("/@d3/color-legend.js?v=4&resolutions=35ba7e5ebbf04804@809")).default));
  main.define("module 2", async () => runtime.module((await import("/@d3/example-components.js?v=4&resolutions=35ba7e5ebbf04804@809")).default));
  const fileAttachments = new Map([
    ["dji.csv", {url: "https://static.observableusercontent.com/files/c7e43d511a4e613d00c99bbb6498bd5cf1e717fb4fb12d29559e58fe2305cc543e02016c952c8155612562b08f651794ec927df4fe2265e5b27bfb2dcc1d125d", mimeType: "text/csv"}],
    ["^DJI.csv", {url: "https://static.observableusercontent.com/files/dec1df1e2e0613d4911e15fda4af47992139b3473dcdc65920de58b688ed73388a806fc67380c5fb23246329fd0623654e08570fa1623402f9d776bf3b6d3e64", mimeType: "text/csv"}],
    ["^DJI@1.csv", {url: "https://static.observableusercontent.com/files/d76914e7130919dcb10a3e7465eec4f7e14e1bdf3fc381748ecdf8bae35598e2456ed9b8f179ae555611c78f741c892310ac7d40cf0717f93ec3b148a2b7c006", mimeType: "text/csv"}],
    ["^DJI@2.csv", {url: "https://static.observableusercontent.com/files/754e2916be7548300012f5d0d6406308809baff7a2419cca200561b60eb4e788a826f8a588c66afdecbe119eea3b03725a5182fca591c03bc8cdfb1071436085", mimeType: "text/csv"}]
  ]);
  main.builtin("FileAttachment", runtime.fileAttachments(name => fileAttachments.get(name)));
  main.variable(observer()).define(["dji","md"], _1);
  main.variable(observer("viewof weekday")).define("viewof weekday", ["Inputs"], _weekday);
  main.variable(observer("weekday")).define("weekday", ["Generators", "viewof weekday"], (G, _) => G.input(_));
  main.variable(observer("key")).define("key", ["Legend","chart"], _key);
  main.variable(observer("chart")).define("chart", ["Calendar","dji","weekday","width"], _chart);
  main.variable(observer()).define(["md"], _5);
  main.variable(observer()).define(["Calendar","dji","weekday","width"], _6);
  main.variable(observer("dji")).define("dji", ["FileAttachment"], _dji);
  main.variable(observer()).define(["howto"], _8);
  main.variable(observer("Calendar")).define("Calendar", ["d3"], _Calendar);
  main.define("Legend", ["module 1", "@variable"], (_, v) => v.import("Legend", _));
  main.define("howto", ["module 2", "@variable"], (_, v) => v.import("howto", _));
  return main;
}
