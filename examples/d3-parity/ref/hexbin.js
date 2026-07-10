function _1(md){return(
md`<div style="color: grey; font: 13px/25.5px var(--sans-serif); text-transform: uppercase;"><h1 style="display: none;">Hexbin</h1><a href="https://d3js.org/">D3</a> › <a href="/@d3/gallery">Gallery</a></div>

# Hexbin

A demonstration of [d3-hexbin](https://github.com/d3/d3-hexbin) with a color encoding; compare to [area](/@d3/hexbin-area).`
)}

function _radius(Inputs){return(
Inputs.range([2, 20], {step: 1, value: 8, label: "radius"})
)}

function _chart(d3,data,radius)
{

  // Specify the chart’s dimensions.
  const width = 928;
  const height = width;
  const marginTop = 20;
  const marginRight = 20;
  const marginBottom = 30;
  const marginLeft = 40;

  // Create the positional scales.
  const x = d3.scaleLog()
      .domain(d3.extent(data, d => d["carat"]))
      .range([marginLeft, width - marginRight]);

  const y = d3.scaleLog()
      .domain(d3.extent(data, d => d["price"]))
      .rangeRound([height - marginBottom, marginTop]);

  // Bin the data.
  const hexbin = d3.hexbin()
    .x(d => x(d["carat"]))
    .y(d => y(d["price"]))
    .radius(radius * width / 928)
    .extent([[marginLeft, marginTop], [width - marginRight, height - marginBottom]]);

  const bins = hexbin(data);

  // Create the color scale.
  const color = d3.scaleSequential(d3.interpolateBuPu)
    .domain([0, d3.max(bins, d => d.length) / 2]);
  
  // Create the container SVG.
  const svg = d3.create("svg")
      .attr("viewBox", [0, 0, width, height]);

  // Append the axes.
  svg.append("g")
      .attr("transform", `translate(0,${height - marginBottom})`)
      .call(d3.axisBottom(x).ticks(width / 80, ""))
      .call(g => g.select(".domain").remove())
      .call(g => g.append("text")
          .attr("x", width - marginRight)
          .attr("y", -4)
          .attr("fill", "currentColor")
          .attr("font-weight", "bold")
          .attr("text-anchor", "end")
          .text("Carats"));

  svg.append("g")
      .attr("transform", `translate(${marginLeft},0)`)
      .call(d3.axisLeft(y).ticks(null, ".1s"))
      .call(g => g.select(".domain").remove())
      .call(g => g.append("text")
          .attr("x", 4)
          .attr("y", marginTop)
          .attr("dy", ".71em")
          .attr("fill", "currentColor")
          .attr("font-weight", "bold")
          .attr("text-anchor", "start")
          .text("$ Price"));

  // Append the scaled hexagons.
  svg.append("g")
      .attr("fill", "#ddd")
      .attr("stroke", "black")
    .selectAll("path")
    .data(bins)
    .enter().append("path")
      .attr("transform", d => `translate(${d.x},${d.y})`)
      .attr("d", hexbin.hexagon())
      .attr("fill", bin => color(bin.length));

  return svg.node();
}


function _data(FileAttachment){return(
FileAttachment("diamonds.csv").csv({typed: true})
)}

function _d3(require){return(
require("d3@7", "d3-hexbin@0.2")
)}

function _6(md){return(
md`Or, using [Observable Plot](/plot/)’s concise API:`
)}

function _7(Plot,data){return(
Plot.plot({
  width: 928,
  height: 928,
  inset: 10,
  x: { type: "log" },
  y: { type: "log" },
  color: {scheme: "BuPu", range: [0, 2]},
  marks: [
    Plot.hexagon(
      data,
      Plot.hexbin(
        {fill: "count"},
        {
          binWidth: 12,
          x: "carat",
          y: "price",
          fill: "#ccc",
          stroke: "#000",
          strokeWidth: 0.75
        }
      )
    )
  ]
})
)}

export default function define(runtime, observer) {
  const main = runtime.module();
  const fileAttachments = new Map([
    ["diamonds.csv", {url: "https://static.observableusercontent.com/files/b7255a952ef1deae136ddf9edb9495165ac68f275cd37d03094e920b56bd4bd9567831275771ed449cd0cf9ffe9089eff934dcd5e5c5221ab1a294a8fc97ac3e", mimeType: "text/csv"}]
  ]);
  main.builtin("FileAttachment", runtime.fileAttachments(name => fileAttachments.get(name)));
  main.variable(observer()).define(["md"], _1);
  main.variable(observer("viewof radius")).define("viewof radius", ["Inputs"], _radius);
  main.variable(observer("radius")).define("radius", ["Generators", "viewof radius"], (G, _) => G.input(_));
  main.variable(observer("chart")).define("chart", ["d3","data","radius"], _chart);
  main.variable(observer("data")).define("data", ["FileAttachment"], _data);
  main.variable(observer("d3")).define("d3", ["require"], _d3);
  main.variable(observer()).define(["md"], _6);
  main.variable(observer()).define(["Plot","data"], _7);
  return main;
}
