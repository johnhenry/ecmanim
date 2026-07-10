function _1(md){return(
md`# Treemap component

Introduced by [Ben Shneiderman](http://www.cs.umd.edu/hcil/treemap-history/), treemaps recursively partition space into rectangles according to each node’s associated value. D3 supports several treemap tiling methods. See also [nested](/@d3/nested-treemap), [zoomable](/@d3/zoomable-treemap) and [animated](/@d3/animated-treemap) treemaps.`
)}

function _tile(Inputs,d3){return(
Inputs.select(
  new Map([
    ["binary", d3.treemapBinary],
    ["squarify", d3.treemapSquarify],
    ["slice-dice", d3.treemapSliceDice],
    ["slice", d3.treemapSlice],
    ["dice", d3.treemapDice]
  ]),
  {label: "Tiling method", value: d3.treemapBinary}
)
)}

function _key(Swatches,chart){return(
Swatches(chart.scales.color)
)}

function _chart(Treemap,flare,tile){return(
Treemap(flare, {
  path: d => d.name.replace(/\./g, "/"), // e.g., "flare/animate/Easing"
  value: d => d.size, // size of each node (file); null for internal nodes (folders)
  group: d => d.name.split(".")[1], // e.g., "animate" in "flare.animate.Easing"; for color
  label: (d, n) => [...d.name.split(".").pop().split(/(?=[A-Z][a-z])/g), n.value.toLocaleString("en")].join("\n"),
  title: (d, n) => `${d.name}\n${n.value.toLocaleString("en")}`, // text to show on hover
  link: (d, n) => `https://github.com/prefuse/Flare/blob/master/flare/src${n.id}.as`,
  tile, // e.g., d3.treemapBinary; set by input above
  width: 1152,
  height: 1152
})
)}

function _5(md){return(
md`This example uses a CSV file to represent the hierarchy as tabular data: each row in the file represents a node in the tree. If a *path* option is specified, the Treemap function can automatically impute the internal (parent) nodes and hence the CSV only needs to include leaves; however, if you use the *id* and *parentId* options instead, then the CSV file must include the internal nodes as well as the leaves. See the [JSON treemap](/@d3/json-treemap) example for using a JSON data source.`
)}

function _flare(FileAttachment){return(
FileAttachment("flare-2.csv").csv({typed: true})
)}

function _7(howto){return(
howto("Treemap", {alternatives: `[D3 treemap example](/@d3/treemap-stratify)`})
)}

function _Treemap(d3,location){return(
function Treemap(data, { // data is either tabular (array of objects) or hierarchy (nested objects)
  path, // as an alternative to id and parentId, returns an array identifier, imputing internal nodes
  id = Array.isArray(data) ? d => d.id : null, // if tabular data, given a d in data, returns a unique identifier (string)
  parentId = Array.isArray(data) ? d => d.parentId : null, // if tabular data, given a node d, returns its parent’s identifier
  children, // if hierarchical data, given a d in data, returns its children
  value, // given a node d, returns a quantitative value (for area encoding; null for count)
  sort = (a, b) => d3.descending(a.value, b.value), // how to sort nodes prior to layout
  label, // given a leaf node d, returns the name to display on the rectangle
  group, // given a leaf node d, returns a categorical value (for color encoding)
  title, // given a leaf node d, returns its hover text
  link, // given a leaf node d, its link (if any)
  linkTarget = "_blank", // the target attribute for links (if any)
  tile = d3.treemapBinary, // treemap strategy
  width = 640, // outer width, in pixels
  height = 400, // outer height, in pixels
  margin = 0, // shorthand for margins
  marginTop = margin, // top margin, in pixels
  marginRight = margin, // right margin, in pixels
  marginBottom = margin, // bottom margin, in pixels
  marginLeft = margin, // left margin, in pixels
  padding = 1, // shorthand for inner and outer padding
  paddingInner = padding, // to separate a node from its adjacent siblings
  paddingOuter = padding, // shorthand for top, right, bottom, and left padding
  paddingTop = paddingOuter, // to separate a node’s top edge from its children
  paddingRight = paddingOuter, // to separate a node’s right edge from its children
  paddingBottom = paddingOuter, // to separate a node’s bottom edge from its children
  paddingLeft = paddingOuter, // to separate a node’s left edge from its children
  round = true, // whether to round to exact pixels
  colors = d3.schemeTableau10, // array of colors
  zDomain, // array of values for the color scale
  fill = "#ccc", // fill for node rects (if no group color encoding)
  fillOpacity = group == null ? null : 0.6, // fill opacity for node rects
  stroke, // stroke for node rects
  strokeWidth, // stroke width for node rects
  strokeOpacity, // stroke opacity for node rects
  strokeLinejoin, // stroke line join for node rects
} = {}) {

  // If id and parentId options are specified, or the path option, use d3.stratify
  // to convert tabular data to a hierarchy; otherwise we assume that the data is
  // specified as an object {children} with nested objects (a.k.a. the “flare.json”
  // format), and use d3.hierarchy.

  // We take special care of any node that has both a value and children, see
  // https://observablehq.com/@d3/treemap-parent-with-value.
  const stratify = data => (d3.stratify().path(path)(data)).each(node => {
    if (node.children?.length && node.data != null) {
      const child = new d3.Node(node.data);
      node.data = null;
      child.depth = node.depth + 1;
      child.height = 0;
      child.parent = node;
      child.id = node.id + "/";
      node.children.unshift(child);
    }
  });
  const root = path != null ? stratify(data)
      : id != null || parentId != null ? d3.stratify().id(id).parentId(parentId)(data)
      : d3.hierarchy(data, children);

  // Compute the values of internal nodes by aggregating from the leaves.
  value == null ? root.count() : root.sum(d => Math.max(0, d ? value(d) : null));

  // Prior to sorting, if a group channel is specified, construct an ordinal color scale.
  const leaves = root.leaves();
  const G = group == null ? null : leaves.map(d => group(d.data, d));
  if (zDomain === undefined) zDomain = G;
  zDomain = new d3.InternSet(zDomain);
  const color = group == null ? null : d3.scaleOrdinal(zDomain, colors);

  // Compute labels and titles.
  const L = label == null ? null : leaves.map(d => label(d.data, d));
  const T = title === undefined ? L : title == null ? null : leaves.map(d => title(d.data, d));

  // Sort the leaves (typically by descending value for a pleasing layout).
  if (sort != null) root.sort(sort);

  // Compute the treemap layout.
  d3.treemap()
      .tile(tile)
      .size([width - marginLeft - marginRight, height - marginTop - marginBottom])
      .paddingInner(paddingInner)
      .paddingTop(paddingTop)
      .paddingRight(paddingRight)
      .paddingBottom(paddingBottom)
      .paddingLeft(paddingLeft)
      .round(round)
    (root);

  const svg = d3.create("svg")
      .attr("viewBox", [-marginLeft, -marginTop, width, height])
      .attr("width", width)
      .attr("height", height)
      .attr("style", "max-width: 100%; height: auto; height: intrinsic;")
      .attr("font-family", "sans-serif")
      .attr("font-size", 10);

  const node = svg.selectAll("a")
    .data(leaves)
    .join("a")
      .attr("xlink:href", link == null ? null : (d, i) => link(d.data, d))
      .attr("target", link == null ? null : linkTarget)
      .attr("transform", d => `translate(${d.x0},${d.y0})`);

  node.append("rect")
      .attr("fill", color ? (d, i) => color(G[i]) : fill)
      .attr("fill-opacity", fillOpacity)
      .attr("stroke", stroke)
      .attr("stroke-width", strokeWidth)
      .attr("stroke-opacity", strokeOpacity)
      .attr("stroke-linejoin", strokeLinejoin)
      .attr("width", d => d.x1 - d.x0)
      .attr("height", d => d.y1 - d.y0);

  if (T) {
    node.append("title").text((d, i) => T[i]);
  }

  if (L) {
    // A unique identifier for clip paths (to avoid conflicts).
    const uid = `O-${Math.random().toString(16).slice(2)}`;

    node.append("clipPath")
       .attr("id", (d, i) => `${uid}-clip-${i}`)
     .append("rect")
       .attr("width", d => d.x1 - d.x0)
       .attr("height", d => d.y1 - d.y0);

    node.append("text")
        .attr("clip-path", (d, i) => `url(${new URL(`#${uid}-clip-${i}`, location)})`)
      .selectAll("tspan")
      .data((d, i) => `${L[i]}`.split(/\n/g))
      .join("tspan")
        .attr("x", 3)
        .attr("y", (d, i, D) => `${(i === D.length - 1) * 0.3 + 1.1 + i * 0.9}em`)
        .attr("fill-opacity", (d, i, D) => i === D.length - 1 ? 0.7 : null)
        .text(d => d);   
  }

  return Object.assign(svg.node(), {scales: {color}});
}
)}

export default function define(runtime, observer) {
  const main = runtime.module();
  main.define("module 1", async () => runtime.module((await import("/@d3/color-legend.js?v=4&resolutions=a1fd3857bac219b0@497")).default));
  main.define("module 2", async () => runtime.module((await import("/@d3/example-components.js?v=4&resolutions=a1fd3857bac219b0@497")).default));
  const fileAttachments = new Map([
    ["flare-2.json", {url: "https://static.observableusercontent.com/files/e65374209781891f37dea1e7a6e1c5e020a3009b8aedf113b4c80942018887a1176ad4945cf14444603ff91d3da371b3b0d72419fa8d2ee0f6e815732475d5de", mimeType: "application/json"}],
    ["flare.csv", {url: "https://static.observableusercontent.com/files/d052aab63b560a567148976b3573bd8c5629d0c8abd600aa7b49f80606cc99bfc1f378400bae48bcf82363691710199a37479333b7e1a377b252488fe651a86d", mimeType: "text/csv"}],
    ["flare-2.csv", {url: "https://static.observableusercontent.com/files/a6b0d94a7f5828fd133765a934f4c9746d2010e2f342d335923991f31b14120de96b5cb4f160d509d8dc627f0107d7f5b5070d2516f01e4c862b5b4867533000", mimeType: "text/csv"}]
  ]);
  main.builtin("FileAttachment", runtime.fileAttachments(name => fileAttachments.get(name)));
  main.variable(observer()).define(["md"], _1);
  main.variable(observer("viewof tile")).define("viewof tile", ["Inputs","d3"], _tile);
  main.variable(observer("tile")).define("tile", ["Generators", "viewof tile"], (G, _) => G.input(_));
  main.variable(observer("key")).define("key", ["Swatches","chart"], _key);
  main.variable(observer("chart")).define("chart", ["Treemap","flare","tile"], _chart);
  main.variable(observer()).define(["md"], _5);
  main.variable(observer("flare")).define("flare", ["FileAttachment"], _flare);
  main.variable(observer()).define(["howto"], _7);
  main.variable(observer("Treemap")).define("Treemap", ["d3","location"], _Treemap);
  main.define("Swatches", ["module 1", "@variable"], (_, v) => v.import("Swatches", _));
  main.define("howto", ["module 2", "@variable"], (_, v) => v.import("howto", _));
  return main;
}
