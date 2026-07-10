function _1(md){return(
md`# Sankey diagram component

This diagram show how energy is converted or transmitted before being consumed or lost: *supplies* are on the left, and *demands* are on the right. Data: [Department of Energy & Climate Change](http://www.decc.gov.uk/en/content/cms/tackling/2050/calculator_on/calculator_on.aspx) via [Tom Counsell](https://tamc.github.io/Sankey/)`
)}

function _linkColor(Inputs,URLSearchParams,html){return(
Inputs.select(new Map([
  ["static", "#aaa"],
  ["source-target", "source-target"],
  ["source", "source"],
  ["target", "target"],
]), {
  value: new URLSearchParams(html`<a href>`.search).get("color") || "source-target",
  label: "Link color"
})
)}

function _nodeAlign(Inputs){return(
Inputs.select(["left", "right", "center", "justify"], {
  value: "justify",
  label: "Node alignment"
})
)}

function _chart(SankeyChart,energy,nodeAlign,linkColor,d3,width){return(
SankeyChart({
  links: energy
}, {
  nodeGroup: d => d.id.split(/\W/)[0], // take first word for color
  nodeAlign, // e.g., d3.sankeyJustify; set by input above
  linkColor, // e.g., "source" or "target"; set by input above
  format: (f => d => `${f(d)} TWh`)(d3.format(",.1~f")),
  width,
  height: 600
})
)}

function _energy(FileAttachment){return(
FileAttachment("energy.csv").csv({typed: true})
)}

function _6(howto){return(
howto("SankeyChart", {imports: {d3: "d3", d3Sankey: "d3-sankey"}, alternatives: `[Sankey diagram example](/@d3/sankey/2)`})
)}

function _SankeyChart(d3Sankey,d3){return(
function SankeyChart({
  nodes, // an iterable of node objects (typically [{id}, …]); implied by links if missing
  links // an iterable of link objects (typically [{source, target}, …])
}, {
  format = ",", // a function or format specifier for values in titles
  align = "justify", // convenience shorthand for nodeAlign
  nodeId = d => d.id, // given d in nodes, returns a unique identifier (string)
  nodeGroup, // given d in nodes, returns an (ordinal) value for color
  nodeGroups, // an array of ordinal values representing the node groups
  nodeLabel, // given d in (computed) nodes, text to label the associated rect
  nodeTitle = d => `${d.id}\n${format(d.value)}`, // given d in (computed) nodes, hover text
  nodeAlign = align, // Sankey node alignment strategy: left, right, justify, center
  nodeSort, // comparator function to order nodes
  nodeWidth = 15, // width of node rects
  nodePadding = 10, // vertical separation between adjacent nodes
  nodeLabelPadding = 6, // horizontal separation between node and label
  nodeStroke = "currentColor", // stroke around node rects
  nodeStrokeWidth, // width of stroke around node rects, in pixels
  nodeStrokeOpacity, // opacity of stroke around node rects
  nodeStrokeLinejoin, // line join for stroke around node rects
  linkSource = ({source}) => source, // given d in links, returns a node identifier string
  linkTarget = ({target}) => target, // given d in links, returns a node identifier string
  linkValue = ({value}) => value, // given d in links, returns the quantitative value
  linkPath = d3Sankey.sankeyLinkHorizontal(), // given d in (computed) links, returns the SVG path
  linkTitle = d => `${d.source.id} → ${d.target.id}\n${format(d.value)}`, // given d in (computed) links
  linkColor = "source-target", // source, target, source-target, or static color
  linkStrokeOpacity = 0.5, // link stroke opacity
  linkMixBlendMode = "multiply", // link blending mode
  colors = d3.schemeTableau10, // array of colors
  width = 640, // outer width, in pixels
  height = 400, // outer height, in pixels
  marginTop = 5, // top margin, in pixels
  marginRight = 1, // right margin, in pixels
  marginBottom = 5, // bottom margin, in pixels
  marginLeft = 1, // left margin, in pixels
} = {}) {
  // Convert nodeAlign from a name to a function (since d3-sankey is not part of core d3).
  if (typeof nodeAlign !== "function") nodeAlign = {
    left: d3Sankey.sankeyLeft,
    right: d3Sankey.sankeyRight,
    center: d3Sankey.sankeyCenter
  }[nodeAlign] ?? d3Sankey.sankeyJustify;

  // Compute values.
  const LS = d3.map(links, linkSource).map(intern);
  const LT = d3.map(links, linkTarget).map(intern);
  const LV = d3.map(links, linkValue);
  if (nodes === undefined) nodes = Array.from(d3.union(LS, LT), id => ({id}));
  const N = d3.map(nodes, nodeId).map(intern);
  const G = nodeGroup == null ? null : d3.map(nodes, nodeGroup).map(intern);

  // Replace the input nodes and links with mutable objects for the simulation.
  nodes = d3.map(nodes, (_, i) => ({id: N[i]}));
  links = d3.map(links, (_, i) => ({source: LS[i], target: LT[i], value: LV[i]}));

  // Ignore a group-based linkColor option if no groups are specified.
  if (!G && ["source", "target", "source-target"].includes(linkColor)) linkColor = "currentColor";

  // Compute default domains.
  if (G && nodeGroups === undefined) nodeGroups = G;

  // Construct the scales.
  const color = nodeGroup == null ? null : d3.scaleOrdinal(nodeGroups, colors);

  // Compute the Sankey layout.
  d3Sankey.sankey()
      .nodeId(({index: i}) => N[i])
      .nodeAlign(nodeAlign)
      .nodeWidth(nodeWidth)
      .nodePadding(nodePadding)
      .nodeSort(nodeSort)
      .extent([[marginLeft, marginTop], [width - marginRight, height - marginBottom]])
    ({nodes, links});

  // Compute titles and labels using layout nodes, so as to access aggregate values.
  if (typeof format !== "function") format = d3.format(format);
  const Tl = nodeLabel === undefined ? N : nodeLabel == null ? null : d3.map(nodes, nodeLabel);
  const Tt = nodeTitle == null ? null : d3.map(nodes, nodeTitle);
  const Lt = linkTitle == null ? null : d3.map(links, linkTitle);

  // A unique identifier for clip paths (to avoid conflicts).
  const uid = `O-${Math.random().toString(16).slice(2)}`;

  const svg = d3.create("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", [0, 0, width, height])
      .attr("style", "max-width: 100%; height: auto; height: intrinsic;");

  const node = svg.append("g")
      .attr("stroke", nodeStroke)
      .attr("stroke-width", nodeStrokeWidth)
      .attr("stroke-opacity", nodeStrokeOpacity)
      .attr("stroke-linejoin", nodeStrokeLinejoin)
    .selectAll("rect")
    .data(nodes)
    .join("rect")
      .attr("x", d => d.x0)
      .attr("y", d => d.y0)
      .attr("height", d => d.y1 - d.y0)
      .attr("width", d => d.x1 - d.x0);

  if (G) node.attr("fill", ({index: i}) => color(G[i]));
  if (Tt) node.append("title").text(({index: i}) => Tt[i]);

  const link = svg.append("g")
      .attr("fill", "none")
      .attr("stroke-opacity", linkStrokeOpacity)
    .selectAll("g")
    .data(links)
    .join("g")
      .style("mix-blend-mode", linkMixBlendMode);

  if (linkColor === "source-target") link.append("linearGradient")
      .attr("id", d => `${uid}-link-${d.index}`)
      .attr("gradientUnits", "userSpaceOnUse")
      .attr("x1", d => d.source.x1)
      .attr("x2", d => d.target.x0)
      .call(gradient => gradient.append("stop")
          .attr("offset", "0%")
          .attr("stop-color", ({source: {index: i}}) => color(G[i])))
      .call(gradient => gradient.append("stop")
          .attr("offset", "100%")
          .attr("stop-color", ({target: {index: i}}) => color(G[i])));

  link.append("path")
      .attr("d", linkPath)
      .attr("stroke", linkColor === "source-target" ? ({index: i}) => `url(#${uid}-link-${i})`
          : linkColor === "source" ? ({source: {index: i}}) => color(G[i])
          : linkColor === "target" ? ({target: {index: i}}) => color(G[i])
          : linkColor)
      .attr("stroke-width", ({width}) => Math.max(1, width))
      .call(Lt ? path => path.append("title").text(({index: i}) => Lt[i]) : () => {});

  if (Tl) svg.append("g")
      .attr("font-family", "sans-serif")
      .attr("font-size", 10)
    .selectAll("text")
    .data(nodes)
    .join("text")
      .attr("x", d => d.x0 < width / 2 ? d.x1 + nodeLabelPadding : d.x0 - nodeLabelPadding)
      .attr("y", d => (d.y1 + d.y0) / 2)
      .attr("dy", "0.35em")
      .attr("text-anchor", d => d.x0 < width / 2 ? "start" : "end")
      .text(({index: i}) => Tl[i]);

  function intern(value) {
    return value !== null && typeof value === "object" ? value.valueOf() : value;
  }

  return Object.assign(svg.node(), {scales: {color}});
}
)}

function _8(md){return(
md`d3-sankey is not part of core D3; it must be loaded separately. Here we’re using [require](/@observablehq/require) to load it, while also ensuring that its dependencies on d3-array and d3-shape resolve to the copy of D3 that we’re using elsewhere in this notebook. We don’t want to load multiple copies of these libraries!`
)}

function _d3Sankey(require,d3){return(
require.alias({"d3-array": d3, "d3-shape": d3})("d3-sankey")
)}

export default function define(runtime, observer) {
  const main = runtime.module();
  main.define("module 1", async () => runtime.module((await import("/@d3/example-components.js?v=4&resolutions=99b2e903e7df3b0a@685")).default));
  const fileAttachments = new Map([
    ["energy.json", {url: "https://static.observableusercontent.com/files/06b66dcc9101498358545c18f3c5e8d3d0d2d29cf38b35459f717529f3d915b132763a9772b2ee4f8f47c35c7e5dfb2a6e144bd1d8ec798bc5e43afacacfd55d", mimeType: "application/json"}],
    ["energy.csv", {url: "https://static.observableusercontent.com/files/d6774e9422bd72369f195a30d3a6b33ff9d41676cff4d89c93511e1a458efb3cfd16cbb7ce3fecdd8dd2466121e10c9bfe57fd73c7520bf358d352a92b898614", mimeType: "text/csv"}]
  ]);
  main.builtin("FileAttachment", runtime.fileAttachments(name => fileAttachments.get(name)));
  main.variable(observer()).define(["md"], _1);
  main.variable(observer("viewof linkColor")).define("viewof linkColor", ["Inputs","URLSearchParams","html"], _linkColor);
  main.variable(observer("linkColor")).define("linkColor", ["Generators", "viewof linkColor"], (G, _) => G.input(_));
  main.variable(observer("viewof nodeAlign")).define("viewof nodeAlign", ["Inputs"], _nodeAlign);
  main.variable(observer("nodeAlign")).define("nodeAlign", ["Generators", "viewof nodeAlign"], (G, _) => G.input(_));
  main.variable(observer("chart")).define("chart", ["SankeyChart","energy","nodeAlign","linkColor","d3","width"], _chart);
  main.variable(observer("energy")).define("energy", ["FileAttachment"], _energy);
  main.variable(observer()).define(["howto"], _6);
  main.variable(observer("SankeyChart")).define("SankeyChart", ["d3Sankey","d3"], _SankeyChart);
  main.variable(observer()).define(["md"], _8);
  main.variable(observer("d3Sankey")).define("d3Sankey", ["require","d3"], _d3Sankey);
  main.define("howto", ["module 1", "@variable"], (_, v) => v.import("howto", _));
  return main;
}
