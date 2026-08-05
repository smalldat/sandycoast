---
name: component-isolation
description: "Chart components must be independent — shared chrome lives in src/core, never imported chart-to-chart"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 6bd4fd48-97c7-4236-a5fe-2ad737f2dc5f
  modified: 2026-08-05T07:19:50.327Z
---

In sandycoast, chart components (`src/charts/<kind>/`) must stay isolated from each other. A chart may never import from another chart's folder (e.g. the line chart importing `../bar/legend.js`). Anything two charts need — legend, title, FPS meter, chrome/axis resolution, tick formatting, reveal ramp — belongs in `src/core/` and is imported from there by both.

**Why:** the user wants each chart to be independently understandable, replaceable and shippable; cross-component imports make `bar/` a de-facto framework and any change to it a change to every other chart.

**How to apply:** when adding a chart or a feature two charts share, put the shared piece under `src/core/` (e.g. `src/core/chrome/`) and import it from there. If existing code already couples charts, move the shared module to core and leave a thin re-export shim in the old location only to preserve the public API.
