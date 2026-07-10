function _1(data,md){return(
md`<div style="color: grey; font: 13px/25.5px var(--sans-serif); text-transform: uppercase;"><h1 style="display: none;">Brushable scatterplot</h1><a href="https://d3js.org/">D3</a> › <a href="/@d3/gallery">Gallery</a></div>

# Brushable scatterplot

This chart shows the inverse relationship between engine power (*y*-axis) and fuel efficiency (*x*-axis) in ${data.length} cars from 1970–1982. Brushing this scatterplot will show the selected data points.`
)}

function _selection(d3,data)
{

  // Specify the chart’s dimensions.
  const width = 928;
  const height = 600;
  const marginTop = 20;
  const marginRight = 30;
  const marginBottom = 30;
  const marginLeft = 40;

  // Create the horizontal (x) scale, positioning N/A values on the left margin.
  const x = d3.scaleLinear()
      .domain([0, d3.max(data, d => d["Miles_per_Gallon"])]).nice()
      .range([marginLeft, width - marginRight])
      .unknown(marginLeft);

  // Create the vertical (y) scale, positioning N/A values on the bottom margin.
  const y = d3.scaleLinear()
      .domain([0, d3.max(data, d => d["Horsepower"])]).nice()
      .range([height - marginBottom, marginTop])
      .unknown(height - marginBottom);

  // Create the SVG container.
  const svg = d3.create("svg")
      .attr("viewBox", [0, 0, width, height])
      .property("value", []);

  // Append the axes.
  svg.append("g")
      .attr("transform", `translate(0,${height - marginBottom})`)
      .call(d3.axisBottom(x))
      .call(g => g.select(".domain").remove())
      .call(g => g.append("text")
          .attr("x", width - marginRight)
          .attr("y", -4)
          .attr("fill", "#000")
          .attr("font-weight", "bold")
          .attr("text-anchor", "end")
          .text("Miles per Gallon"));

  svg.append("g")
      .attr("transform", `translate(${marginLeft},0)`)
      .call(d3.axisLeft(y))
      .call(g => g.select(".domain").remove())
      .call(g => g.select(".tick:last-of-type text").clone()
          .attr("x", 4)
          .attr("text-anchor", "start")
          .attr("font-weight", "bold")
          .text("Horsepower"));

  // Append the dots.
  const dot = svg.append("g")
      .attr("fill", "none")
      .attr("stroke", "steelblue")
      .attr("stroke-width", 1.5)
    .selectAll("circle")
    .data(data)
    .join("circle")
      .attr("transform", d => `translate(${x(d["Miles_per_Gallon"])},${y(d["Horsepower"])})`)
      .attr("r", 3);

  // Create the brush behavior.
  svg.call(d3.brush().on("start brush end", ({selection}) => {
    let value = [];
    if (selection) {
      const [[x0, y0], [x1, y1]] = selection;
      value = dot
        .style("stroke", "gray")
        .filter(d => x0 <= x(d["Miles_per_Gallon"]) && x(d["Miles_per_Gallon"]) < x1
                && y0 <= y(d["Horsepower"]) && y(d["Horsepower"]) < y1)
        .style("stroke", "steelblue")
        .data();
    } else {
      dot.style("stroke", "steelblue");
    }

    // Inform downstream cells that the selection has changed.
    svg.property("value", value).dispatch("input");
  }));

  return svg.node();
}


function _3(selection){return(
selection
)}

function _data(FileAttachment){return(
FileAttachment("cars-2.csv").csv({typed: true})
)}

function _5(md){return(
md`Thanks to [John Alexis Guerra Gómez](/@john-guerra) for suggestions.`
)}

export default function define(runtime, observer) {
  const main = runtime.module();
  const fileAttachments = new Map([
    ["cars-2.csv", {url: "https://static.observableusercontent.com/files/53c407ee531bab128477148c9e28c49dd06bf83a93ae317e58dbb9fc819db0d4f6c4fb9646fa2fe20faad76addee20cfc360eab2362eeaec3340a5e4655b9996", mimeType: "text/csv"}]
  ]);
  main.builtin("FileAttachment", runtime.fileAttachments(name => fileAttachments.get(name)));
  main.variable(observer()).define(["data","md"], _1);
  main.variable(observer("viewof selection")).define("viewof selection", ["d3","data"], _selection);
  main.variable(observer("selection")).define("selection", ["Generators", "viewof selection"], (G, _) => G.input(_));
  main.variable(observer()).define(["selection"], _3);
  main.variable(observer("data")).define("data", ["FileAttachment"], _data);
  main.variable(observer()).define(["md"], _5);
  return main;
}
