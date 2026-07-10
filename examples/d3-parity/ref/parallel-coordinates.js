function _1(md){return(
md`<div style="color: grey; font: 13px/25.5px var(--sans-serif); text-transform: uppercase;"><h1 style="display: none;">Parallel coordinates</h1><a href="https://d3js.org/">D3</a> › <a href="/@d3/gallery">Gallery</a></div>

# Parallel coordinates

Compare with the [brushable version](/@d3/brushable-parallel-coordinates).`
)}

function _keyz(html,keys)
{
  const form = html`<form>${Object.assign(html`<select name=select>${keys.map(key => Object.assign(html`<option>`, {value: key, textContent: key}))}</select>`, {value: "weight (lb)"})} <i style="font-size:smaller;">color encoding</i>`;
  form.select.onchange = () => (form.value = form.select.value, form.dispatchEvent(new CustomEvent("input")));
  form.select.onchange();
  return form;
}


function _legend(Legend,chart,keyz){return(
Legend({color: chart.scales.color, title: keyz})
)}

function _chart(keys,d3,data,keyz)
{

  // Specify the chart’s dimensions.
  const width = 928;
  const height = keys.length * 120;
  const marginTop = 20;
  const marginRight = 10;
  const marginBottom = 20;
  const marginLeft = 10;

  // Create an horizontal (*x*) scale for each key.
  const x = new Map(Array.from(keys, key => [key, d3.scaleLinear(d3.extent(data, d => d[key]), [marginLeft, width - marginRight])]));

  // Create the vertical (*y*) scale.
  const y = d3.scalePoint(keys, [marginTop, height - marginBottom]);

  // Create the color scale.
  const color = d3.scaleSequential(x.get(keyz).domain(), t => d3.interpolateBrBG(1 - t));

  // Create the SVG container.
  const svg = d3.create("svg")
      .attr("viewBox", [0, 0, width, height])
      .attr("width", width)
      .attr("height", height)
      .attr("style", "max-width: 100%; height: auto;");

  // Append the lines.
  const line = d3.line()
    .defined(([, value]) => value != null)
    .x(([key, value]) => x.get(key)(value))
    .y(([key]) => y(key));

  svg.append("g")
      .attr("fill", "none")
      .attr("stroke-width", 1.5)
      .attr("stroke-opacity", 0.4)
    .selectAll("path")
    .data(data.slice().sort((a, b) => d3.ascending(a[keyz], b[keyz])))
    .join("path")
      .attr("stroke", d => color(d[keyz]))
      .attr("d", d => line(d3.cross(keys, [d], (key, d) => [key, d[key]])))
    .append("title")
      .text(d => d.name);

  // Append the axis for each key.
  svg.append("g")
    .selectAll("g")
    .data(keys)
    .join("g")
      .attr("transform", d => `translate(0,${y(d)})`)
      .each(function(d) { d3.select(this).call(d3.axisBottom(x.get(d))); })
      .call(g => g.append("text")
        .attr("x", marginLeft)
        .attr("y", -6)
        .attr("text-anchor", "start")
        .attr("fill", "currentColor")
        .text(d => d))
      .call(g => g.selectAll("text")
        .clone(true).lower()
        .attr("fill", "none")
        .attr("stroke-width", 5)
        .attr("stroke-linejoin", "round")
        .attr("stroke", "white"));

  return Object.assign(svg.node(), {scales: {color}});
}


function _data(FileAttachment){return(
FileAttachment("cars.csv").csv({typed: true})
)}

function _keys(data){return(
data.columns.slice(1)
)}

function _8(md){return(
md`For an alternative using [Observable Plot](/plot/)’s concise API, see [Plot: Parallel coordinates](https://observablehq.com/@observablehq/plot-parcoords).`
)}

export default function define(runtime, observer) {
  const main = runtime.module();
  main.define("module 1", async () => runtime.module((await import("/@d3/color-legend.js?v=4&resolutions=27257746414b83a1@208")).default));
  const fileAttachments = new Map([
    ["cars.csv", {url: "https://static.observableusercontent.com/files/4cb40b94ee98c9296d28913c84e041a1bba5e6821131116b506dcbbfa383592985d94310ad25deb564b61d14ed20fd17c014ed38ab465d0a717dd81e4ea5759e", mimeType: "text/csv"}]
  ]);
  main.builtin("FileAttachment", runtime.fileAttachments(name => fileAttachments.get(name)));
  main.variable(observer()).define(["md"], _1);
  main.variable(observer("viewof keyz")).define("viewof keyz", ["html","keys"], _keyz);
  main.variable(observer("keyz")).define("keyz", ["Generators", "viewof keyz"], (G, _) => G.input(_));
  main.variable(observer("legend")).define("legend", ["Legend","chart","keyz"], _legend);
  main.variable(observer("chart")).define("chart", ["keys","d3","data","keyz"], _chart);
  main.variable(observer("data")).define("data", ["FileAttachment"], _data);
  main.variable(observer("keys")).define("keys", ["data"], _keys);
  main.define("Legend", ["module 1", "@variable"], (_, v) => v.import("legend", "Legend", _));
  main.variable(observer()).define(["md"], _8);
  return main;
}
