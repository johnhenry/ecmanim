function _1(md){return(
md`# Tree, Cluster

<p style="background: #fffced; box-sizing: border-box; padding: 10px 20px; font-style: italic;">**Update June 2023:** This notebook has been deprecated and is no longer maintained; please see the newer [D3 cluster](/@d3/cluster/2) and [Observable Plot cluster diagram](/@observablehq/plot-cluster-diagram) examples.</p>

D3’s [cluster layout](https://github.com/d3/d3-hierarchy/blob/master/README.md#cluster) produces node-link diagrams with leaf nodes at equal depth. These are less compact than [tidy trees](/@d3/tidy-tree), but are useful for dendrograms, hierarchical clustering, and [phylogenetic trees](/@d3/tree-of-life). See also the [radial variant](/@d3/radial-dendrogram).`
)}

function _chart(Tree,flare,d3){return(
Tree(flare, {
  label: d => d.name,
  title: (d, n) => `${n.ancestors().reverse().map(d => d.data.name).join(".")}`, // hover text
  link: (d, n) => `https://github.com/prefuse/Flare/${n.children ? "tree" : "blob"}/master/flare/src/${n.ancestors().reverse().map(d => d.data.name).join("/")}${n.children ? "" : ".as"}`,
  sort: (a, b) => d3.descending(a.height, b.height), // reduce link crossings
  tree: d3.cluster,
  width: 1152
})
)}

function _flare(FileAttachment){return(
FileAttachment("flare.json").json()
)}

function _4(howto){return(
howto("Tree", "@d3/tree")
)}

export default function define(runtime, observer) {
  const main = runtime.module();
  main.define("module 1", async () => runtime.module((await import("/@d3/tree.js?v=4&resolutions=b686454b1f3dff84@213")).default));
  main.define("module 2", async () => runtime.module((await import("/@d3/example-components.js?v=4&resolutions=b686454b1f3dff84@213")).default));
  const fileAttachments = new Map([
    ["flare-2.json", {url: "https://static.observableusercontent.com/files/e65374209781891f37dea1e7a6e1c5e020a3009b8aedf113b4c80942018887a1176ad4945cf14444603ff91d3da371b3b0d72419fa8d2ee0f6e815732475d5de", mimeType: "application/json"}],
    ["flare.json", {url: "https://static.observableusercontent.com/files/85b8f86120ba5c8012f55b82fb5af4fcc9ff5e3cf250d110e111b3ab98c32a3fa8f5c19f956e096fbf550c47d6895783a4edf72a9c474bef5782f879573750ba", mimeType: "application/json"}]
  ]);
  main.builtin("FileAttachment", runtime.fileAttachments(name => fileAttachments.get(name)));
  main.variable(observer()).define(["md"], _1);
  main.variable(observer("chart")).define("chart", ["Tree","flare","d3"], _chart);
  main.variable(observer("flare")).define("flare", ["FileAttachment"], _flare);
  main.variable(observer()).define(["howto"], _4);
  main.define("Tree", ["module 1", "@variable"], (_, v) => v.import("Tree", _));
  main.define("howto", ["module 2", "@variable"], (_, v) => v.import("howto", _));
  return main;
}
