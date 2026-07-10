function _1(md){return(
md`# Choropleth

<p style="background: #fffced; box-sizing: border-box; padding: 10px 20px; font-style: italic;">**Update May 2023:** This notebook has been deprecated and is no longer maintained; please see the newer [D3 choropleth example](/@d3/choropleth/2) and [Observable Plot choropleth example](/@observablehq/plot-choropleth).</p>

Unemployment rate by U.S. county, August 2016. Data: [Bureau of Labor Statistics](http://www.bls.gov/lau/#tables).`
)}

function _key(Legend,chart){return(
Legend(chart.scales.color, {title: "Unemployment rate (%)"})
)}

function _chart(Choropleth,unemployment,d3,statemap,counties,statemesh){return(
Choropleth(unemployment, {
  id: d => d.id,
  value: d => d.rate,
  scale: d3.scaleQuantize,
  domain: [1, 10],
  range: d3.schemeBlues[9],
  title: (f, d) => `${f.properties.name}, ${statemap.get(f.id.slice(0, 2)).properties.name}\n${d?.rate}%`,
  features: counties,
  borders: statemesh,
  width: 975,
  height: 610
})
)}

function _4(md){return(
md`In the *unemployment* dataset, we don’t use automatic type inference for CSV (*a.k.a.*, typed: true) as that would coerce the FIPS identifiers to numbers, which then wouldn’t match the identifiers in our GeoJSON. However, we still want to coerce the *rate* values to numbers, so we do that explicitly.`
)}

async function _unemployment(FileAttachment){return(
(await FileAttachment("unemployment-x.csv").csv()).map(d => ({...d, rate: +d.rate}))
)}

function _6(md){return(
md`The geometries used in this example are from the [TopoJSON U.S. Atlas](https://github.com/topojson/us-atlas), which are derived from the U.S. Census Bureau shapefiles, 2017 edition. (There’s also the [TopoJSON World Atlas](https://github.com/topojson/world-atlas), which is derived from [Natural Earth](https://www.naturalearthdata.com).) The *counties* feature collection is all U.S. counties, using the five-digit FIPS identifier. The *statemap* lets us lookup the name of the state that contains a given county; a state’s two-digit identifier corresponds to the first two digits of its counties’ identifiers.`
)}

function _us(FileAttachment){return(
FileAttachment("counties-albers-10m.json").json()
)}

function _counties(topojson,us){return(
topojson.feature(us, us.objects.counties)
)}

function _states(topojson,us){return(
topojson.feature(us, us.objects.states)
)}

function _statemap(states){return(
new Map(states.features.map(d => [d.id, d]))
)}

function _11(md){return(
md`The *statemesh* is just the internal borders between states, *i.e.*, everything but the coastlines and country borders. This avoids an additional stroke on the perimeter of the map, which would otherwise mask intricate features such as islands and inlets. (Try removing the last argument to topojson.mesh below to see the effect.)`
)}

function _statemesh(topojson,us){return(
topojson.mesh(us, us.objects.states, (a, b) => a !== b)
)}

function _13(howto){return(
howto("Choropleth")
)}

function _14(linkplot){return(
linkplot("https://observablehq.com/@observablehq/build-your-first-choropleth-map-with-observable-plot", {title: "Build your first Choropleth map with Observable Plot"})
)}

function _Choropleth(d3){return(
function Choropleth(data, {
  id = d => d.id, // given d in data, returns the feature id
  value = () => undefined, // given d in data, returns the quantitative value
  title, // given a feature f and possibly a datum d, returns the hover text
  format, // optional format specifier for the title
  scale = d3.scaleSequential, // type of color scale
  domain, // [min, max] values; input of color scale
  range = d3.interpolateBlues, // output of color scale
  width = 640, // outer width, in pixels
  height, // outer height, in pixels
  projection, // a D3 projection; null for pre-projected geometry
  features, // a GeoJSON feature collection
  featureId = d => d.id, // given a feature, returns its id
  borders, // a GeoJSON object for stroking borders
  outline = projection && projection.rotate ? {type: "Sphere"} : null, // a GeoJSON object for the background
  unknown = "#ccc", // fill color for missing data
  fill = "white", // fill color for outline
  stroke = "white", // stroke color for borders
  strokeLinecap = "round", // stroke line cap for borders
  strokeLinejoin = "round", // stroke line join for borders
  strokeWidth, // stroke width for borders
  strokeOpacity, // stroke opacity for borders
} = {}) {
  // Compute values.
  const N = d3.map(data, id);
  const V = d3.map(data, value).map(d => d == null ? NaN : +d);
  const Im = new d3.InternMap(N.map((id, i) => [id, i]));
  const If = d3.map(features.features, featureId);

  // Compute default domains.
  if (domain === undefined) domain = d3.extent(V);

  // Construct scales.
  const color = scale(domain, range);
  if (color.unknown && unknown !== undefined) color.unknown(unknown);

  // Compute titles.
  if (title === undefined) {
    format = color.tickFormat(100, format);
    title = (f, i) => `${f.properties.name}\n${format(V[i])}`;
  } else if (title !== null) {
    const T = title;
    const O = d3.map(data, d => d);
    title = (f, i) => T(f, O[i]);
  }

  // Compute the default height. If an outline object is specified, scale the projection to fit
  // the width, and then compute the corresponding height.
  if (height === undefined) {
    if (outline === undefined) {
      height = 400;
    } else {
      const [[x0, y0], [x1, y1]] = d3.geoPath(projection.fitWidth(width, outline)).bounds(outline);
      const dy = Math.ceil(y1 - y0), l = Math.min(Math.ceil(x1 - x0), dy);
      projection.scale(projection.scale() * (l - 1) / l).precision(0.2);
      height = dy;
    }
  }

  // Construct a path generator.
  const path = d3.geoPath(projection);

  const svg = d3.create("svg")
      .attr("width", width)
      .attr("height", height)
      .attr("viewBox", [0, 0, width, height])
      .attr("style", "width: 100%; height: auto; height: intrinsic;");

  if (outline != null) svg.append("path")
      .attr("fill", fill)
      .attr("stroke", "currentColor")
      .attr("d", path(outline));

  svg.append("g")
    .selectAll("path")
    .data(features.features)
    .join("path")
      .attr("fill", (d, i) => color(V[Im.get(If[i])]))
      .attr("d", path)
    .append("title")
      .text((d, i) => title(d, Im.get(If[i])));

  if (borders != null) svg.append("path")
      .attr("pointer-events", "none")
      .attr("fill", "none")
      .attr("stroke", stroke)
      .attr("stroke-linecap", strokeLinecap)
      .attr("stroke-linejoin", strokeLinejoin)
      .attr("stroke-width", strokeWidth)
      .attr("stroke-opacity", strokeOpacity)
      .attr("d", path(borders));

  return Object.assign(svg.node(), {scales: {color}});
}
)}

export default function define(runtime, observer) {
  const main = runtime.module();
  main.define("module 1", async () => runtime.module((await import("/@d3/example-components.js?v=4&resolutions=2695158caff5fb0c@599")).default));
  main.define("module 2", async () => runtime.module((await import("/@d3/color-legend.js?v=4&resolutions=2695158caff5fb0c@599")).default));
  const fileAttachments = new Map([
    ["unemployment-x.csv", {url: "https://static.observableusercontent.com/files/8a6057f29caa4e010854bfc31984511e074ff9042ec2a99f30924984821414fbaeb75e59654e9303db359dfa0c1052534691dac86017c4c2f992d23b874f9b6e", mimeType: "text/csv"}],
    ["counties-albers-10m.json", {url: "https://static.observableusercontent.com/files/6b1776f5a0a0e76e6428805c0074a8f262e3f34b1b50944da27903e014b409958dc29b03a1c9cc331949d6a2a404c19dfd0d9d36d9c32274e6ffbc07c11350ee", mimeType: "application/json"}]
  ]);
  main.builtin("FileAttachment", runtime.fileAttachments(name => fileAttachments.get(name)));
  main.variable(observer()).define(["md"], _1);
  main.variable(observer("key")).define("key", ["Legend","chart"], _key);
  main.variable(observer("chart")).define("chart", ["Choropleth","unemployment","d3","statemap","counties","statemesh"], _chart);
  main.variable(observer()).define(["md"], _4);
  main.variable(observer("unemployment")).define("unemployment", ["FileAttachment"], _unemployment);
  main.variable(observer()).define(["md"], _6);
  main.variable(observer("us")).define("us", ["FileAttachment"], _us);
  main.variable(observer("counties")).define("counties", ["topojson","us"], _counties);
  main.variable(observer("states")).define("states", ["topojson","us"], _states);
  main.variable(observer("statemap")).define("statemap", ["states"], _statemap);
  main.variable(observer()).define(["md"], _11);
  main.variable(observer("statemesh")).define("statemesh", ["topojson","us"], _statemesh);
  main.variable(observer()).define(["howto"], _13);
  main.variable(observer()).define(["linkplot"], _14);
  main.variable(observer("Choropleth")).define("Choropleth", ["d3"], _Choropleth);
  main.define("howto", ["module 1", "@variable"], (_, v) => v.import("howto", _));
  main.define("linkplot", ["module 1", "@variable"], (_, v) => v.import("linkplot", _));
  main.define("Legend", ["module 2", "@variable"], (_, v) => v.import("Legend", _));
  return main;
}
