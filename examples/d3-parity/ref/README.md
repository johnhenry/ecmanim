# D3 gallery reference corpus

26 reference notebooks fetched from the official D3 Observable gallery
(observablehq.com/@d3/gallery) as compiled notebook-cell JavaScript via
`https://api.observablehq.com/@d3/<slug>.js?v=4` on 2026-07-10. All are
© Observable, Inc. / Mike Bostock and released under the
**ISC license** (per the D3 gallery notebooks' stated license); committed
here as porting references only.

The animation-forward canon (roadmap campaign 2): bar-chart-race,
connected-scatterplot (the draw-on animated line), streamgraph,
stacked-to-grouped-bars, force-directed-graph,
disjoint-force-directed-graph, arc-diagram, hierarchical-edge-bundling,
chord-diagram, sankey, treemap, zoomable-circle-packing, sunburst, tree,
cluster, radial-tree, choropleth, volcano-contours, hexbin, calendar-view,
parallel-coordinates, brushable-scatterplot, pie-chart-update,
bar-chart-transitions, radial-stacked-bar-chart, bar-chart.

`../data/` holds the notebooks' FileAttachment datasets, downloaded from
their pinned `static.observableusercontent.com` URLs (gunzipped): D3's
canonical public fixtures — flare.json (Flare visualization toolkit class
hierarchy), miserables.json (Les Misérables co-occurrence graph),
unemployment*.csv (BLS), counties-albers-10m.json (US Atlas TopoJSON),
category-brands.csv (Interbrand), volcano.json (Maunga Whau DEM),
alphabet/cars/diamonds/energy/driving/DJI et al. Attachment names with
`^`/`@` were sanitized for the filesystem (`^DJI@2.csv` → `DJI-2.csv`).
