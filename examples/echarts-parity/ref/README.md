# ECharts gallery reference corpus

15 examples fetched verbatim from the official Apache ECharts gallery
(echarts.apache.org/examples, backed by github.com/apache/echarts-examples),
**Apache-2.0** license, fetched 2026-07-10 from the live site's own raw-source
endpoint — `https://echarts.apache.org/examples/examples/ts/<slug>.ts`, the
same path the editor's "Edit in ..." view pulls from (diffed byte-identical
against `raw.githubusercontent.com/apache/echarts-examples/master/public/examples/ts/<slug>.ts`,
so either is a valid citation). These are the gallery's **option-builder
source files**, not rendered HTML/canvas output — each is either a plain
`option = {...}` object plus any inline data generators, or (candlestick,
graph) a small wrapper that fetches a companion JSON fixture and builds
`option` from it. Note: the upstream repo currently authors these examples in
TypeScript (light type annotations — `interface`, `: number[]`, generics on
`Record<>`); they're preserved close to verbatim under this campaign's
`.js` naming convention rather than stripped to plain JS, since porting work
in a later phase reads the real option shape, not a hand-edited one.

`../ref/data/` holds the one companion fixture a wrapper example needs
(les-miserables.json for the force-graph) — fetched from the same repo's
`public/data/asset/data/` folder, not invented. All calendar/random-walk/
candlestick data used by the other examples is generated inline by their own
source and needs no external fixture.

| # | Example | Proves | License | Source |
|---|---------|--------|---------|--------|
| 01 | [bar race](./01-bar-race.js) — "Bar Race" | ranked bars that re-sort/flip position every tick off a randomized-then-updated dataset | Apache-2.0 | https://echarts.apache.org/examples/examples/ts/bar-race.ts |
| 02 | [smoothed line + areaStyle](./02-line-area-smooth.js) — "Area Chart with Time Axis" | `smooth: true` curve interpolation combined with `areaStyle: {}` fill on a single time-axis series (substitution: the gallery's literal "Smoothed Line Chart" has no areaStyle, and "Basic area chart" has no smoothing — this is the one example that combines both on a non-stacked series) | Apache-2.0 | https://echarts.apache.org/examples/examples/ts/area-time-axis.ts |
| 03 | [stacked bar chart](./03-bar-stack.js) — "Stacked Column Chart" | multi-series bars stacked per category via matching `stack` keys | Apache-2.0 | https://echarts.apache.org/examples/examples/ts/bar-stack.ts |
| 04 | [scatter + visualMap](./04-scatter-visualmap.js) — "Scatter Aqi Color" | continuous (`calculable: true`) visualMap dimensions driving bubble size and color lightness off real AQI/pollutant data | Apache-2.0 | https://echarts.apache.org/examples/examples/ts/scatter-aqi-color.ts |
| 05 | [radar chart](./05-radar.js) — "Basic Radar Chart" | polygon-axis radar with two overlaid budget/spending series | Apache-2.0 | https://echarts.apache.org/examples/examples/ts/radar.ts |
| 06 | [gauge chart](./06-gauge.js) — "Gauge Basic chart" | dial/needle gauge with color-banded progress arc | Apache-2.0 | https://echarts.apache.org/examples/examples/ts/gauge.ts |
| 07 | [funnel chart](./07-funnel.js) — "Funnel Chart" | tapering stage-conversion funnel with per-stage labels | Apache-2.0 | https://echarts.apache.org/examples/examples/ts/funnel.ts |
| 08 | [candlestick / OHLC](./08-candlestick.js) — "ShangHai Index" | OHLC candlesticks + derived moving-average lines + dataZoom over ~9 years of real index data (substitution: no single "candlestick" example is uniquely canonical in the gallery — picked the most iconic/complete one, per the task's stated latitude) | Apache-2.0 | https://echarts.apache.org/examples/examples/ts/candlestick-sh.ts |
| 09 | [calendar heatmap](./09-calendar-heatmap.js) — "Calendar Heatmap" | GitHub-style day-cell heatmap laid out on the `calendar` coordinate system, data generated inline | Apache-2.0 | https://echarts.apache.org/examples/examples/ts/calendar-heatmap.ts |
| 10 | [pie roseType](./10-pie-rosetype.js) — "Nightingale Chart" | nightingale/rose pie where slice radius (not just angle) encodes value | Apache-2.0 | https://echarts.apache.org/examples/examples/ts/pie-roseType.ts |
| 11 | [graph / force-directed](./11-graph-force.js) — "Force Layout" | force-simulated node-link graph with categories/legend, fed by `data/les-miserables.json` | Apache-2.0 | https://echarts.apache.org/examples/examples/ts/graph-force.ts |
| 12 | [sunburst chart](./12-sunburst.js) — "Basic Sunburst" | nested-ring hierarchical sunburst from a small hand-authored tree | Apache-2.0 | https://echarts.apache.org/examples/examples/ts/sunburst-simple.ts |
| 13 | [sankey diagram](./13-sankey.js) — "Basic Sankey" | weighted flow diagram between named nodes | Apache-2.0 | https://echarts.apache.org/examples/examples/ts/sankey-simple.ts |
| 14 | [themeRiver](./14-themeriver.js) — "ThemeRiver" | streamgraph-style flowing-river series over a category/time axis | Apache-2.0 | https://echarts.apache.org/examples/examples/ts/themeRiver-basic.ts |
| 15 | [waterfall chart](./15-waterfall.js) — "Waterfall Chart" | bar chart simulating a waterfall via a transparent "placeholder" stacked series (ECharts has no native waterfall series type) | Apache-2.0 | https://echarts.apache.org/examples/examples/ts/bar-waterfall.ts |

`data/les-miserables.json` — Les Misérables character co-occurrence graph
(nodes/links/categories, pre-laid-out with x/y/symbolSize), fetched from
https://echarts.apache.org/examples/data/asset/data/les-miserables.json,
Apache-2.0 (same repo as the examples above).
