function _1(md){return(
md`# Volcano Contours

<p style="background: #fffced; box-sizing: border-box; padding: 10px 20px; font-style: italic;">**Update June 2023:** This notebook has been deprecated and is no longer maintained; please see the newer [D3 volcano contours example](/@d3/volcano-contours/2) and [Observable Plot filled contours example](/@observablehq/plot-filled-contours).</p>

Showing the topography of [Maungawhau](https://en.wikipedia.org/wiki/Maungawhau) (the classic \`volcano\` dataset and \`terrain.colors\` from R) with [d3-contour](https://github.com/d3/d3-contour) and [d3-hsv](https://github.com/d3/d3-hsv).`
)}

function* _chart(d3,wide,width,height,thresholds,path,contours,data,color)
{
  const svg = d3.create("svg")
      .attr("viewBox", wide ? [0, 0, width, height] : [0, 0, height, width])
      .style("display", "block")
      .style("margin", "0 -14px")
      .style("width", "calc(100% + 28px)")
      .style("height", "auto");

  const g = svg.append("g")
      .attr("transform", wide ? null : `
        rotate(90 ${width/2},${height/2})
        translate(${(width - height) / 2},${(width - height) / 2})
      `)
      .attr("stroke", "white")
      .attr("stroke-width", 0.03);
  
  for (const threshold of thresholds) {
    g.append("path")
        .attr("d", path(contours.contour(data.values, threshold)))
        .attr("fill", color(threshold));

    yield svg.node();
  }
}


function _path(d3){return(
d3.geoPath()
)}

function _contours(d3,width,height){return(
d3.contours().size([width, height])
)}

function _width(data){return(
data.width
)}

function _height(data){return(
data.height
)}

function _wide(Generators,innerWidth,addEventListener,removeEventListener){return(
Generators.observe(notify => {
  let wide;
  function resized() {
    let w = innerWidth > 640;
    if (w !== wide) notify(wide = w);
  }
  resized();
  addEventListener("resize", resized);
  return () => removeEventListener("resize", resized);
})
)}

function _color(d3,interpolateTerrain,data){return(
d3.scaleSequential(interpolateTerrain).domain(d3.extent(data.values)).nice()
)}

function _thresholds(color){return(
color.ticks(20)
)}

function _data(FileAttachment){return(
FileAttachment("volcano.json").json()
)}

function _interpolateTerrain(d3)
{
  const i0 = d3.interpolateHsvLong(d3.hsv(120, 1, 0.65), d3.hsv(60, 1, 0.90));
  const i1 = d3.interpolateHsvLong(d3.hsv(60, 1, 0.90), d3.hsv(0, 0, 0.95));
  return t => t < 0.5 ? i0(t * 2) : i1((t - 0.5) * 2);
}


function _d3(require){return(
require("d3@7", "d3-hsv@0.1")
)}

export default function define(runtime, observer) {
  const main = runtime.module();
  const fileAttachments = new Map([
    ["volcano.json", {url: "https://static.observableusercontent.com/files/923ed37945bbd1d7d9a2be8ef0dd59238d6ea7fdff3bf8802007a8b705e38c38a09e6572a4bf546adbad6e69bfae180801cb9a2899b6c334b7f6de1baac533a3", mimeType: "application/json"}]
  ]);
  main.builtin("FileAttachment", runtime.fileAttachments(name => fileAttachments.get(name)));
  main.variable(observer()).define(["md"], _1);
  main.variable(observer("chart")).define("chart", ["d3","wide","width","height","thresholds","path","contours","data","color"], _chart);
  main.variable(observer("path")).define("path", ["d3"], _path);
  main.variable(observer("contours")).define("contours", ["d3","width","height"], _contours);
  main.variable(observer("width")).define("width", ["data"], _width);
  main.variable(observer("height")).define("height", ["data"], _height);
  main.variable(observer("wide")).define("wide", ["Generators","innerWidth","addEventListener","removeEventListener"], _wide);
  main.variable(observer("color")).define("color", ["d3","interpolateTerrain","data"], _color);
  main.variable(observer("thresholds")).define("thresholds", ["color"], _thresholds);
  main.variable(observer("data")).define("data", ["FileAttachment"], _data);
  main.variable(observer("interpolateTerrain")).define("interpolateTerrain", ["d3"], _interpolateTerrain);
  main.variable(observer("d3")).define("d3", ["require"], _d3);
  return main;
}
