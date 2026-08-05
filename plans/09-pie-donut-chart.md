# Plan 09 — Pie / donut chart with a series slider

Status: **AS-BUILT** (PR #9)
Package: `@smalldat/sandycoast`
Depends on: Plan 01 (sand rendering + morph), Plan 02 (axes/legend/current value),
Plan 03 (fill/border reveal), Plan 05 (live data)

> A pie/donut component built on the **same grain machinery as the bar chart**:
> area-weighted packing, pour-in, identity-matched morph, cached solid layer,
> shared legend/hover/current-value chrome.
>
> The one structural difference: **the series axis becomes a selector.** A pie
> can only show one series at a time, so the bar chart's X axis is replaced by a
> **slider** that picks which series is drawn — and moving it *animates* the
> slices to the new values instead of swapping them.

---

## 1. Goals

1. **Pie and donut from one component.** `innerRadius > 0` cuts the middle out;
   there is no separate DonutChart.
2. **Same sand.** Grains, hover effects, reveal crossfade, legend, readout and
   FPS meter behave exactly as on the bar chart, because they are the same code.
3. **Multiple series, one on screen.** A slider walks the series; the slices
   morph between them.
4. **Bounded input.** At most 10 points of a series become slices; at most 1000
   series are addressable. Both configurable.
5. **Slider is a property, not just a widget** — fully drivable from code.
6. **Title** with edge placement, aligned to the legend's vocabulary.
7. **Component isolation** — the pie must not import from `charts/bar/`.

---

## 2. Data model

The generic XYZ model is reused unchanged, with pie-specific meaning:

| field | meaning |
| --- | --- |
| `x` | slice category (legend entry) |
| `y` | slice value (share of the series total) |
| `z` | **series** — what the slider selects |

Only the selected series is drawn. Colors cycle per **slice**, not per series,
so the legend describes categories and stays stable as the slider moves.

**Caps.** `maxSlices` (default 10) and `maxSeries` (default 1000) truncate.
Truncating rather than aggregating is deliberate: dozens of hair-thin wedges
read as noise, and folding the tail into an "other" bucket would invent a
category the caller never supplied.

Non-positive and non-finite `y` weigh **nothing** in the share (a negative has
no meaning as a fraction of a whole) but the raw value is still reported on
hover. An all-zero series splits the circle evenly rather than collapsing to
nothing.

---

## 3. Geometry

### 3a. Angles

Radians **clockwise from 12 o'clock**, so a point at `(a, r)` sits at
`(cx + sin a · r, cy + cos a · r)` in layout space (y-up). Canvas' arc angles
run clockwise from 3 o'clock, so drawing subtracts a quarter turn.

Knobs: `radius` (fraction of the box half-extent), `innerRadius` (fraction of
the outer radius, 0..0.95), `startAngle` and `padAngle` (degrees). Total padding
is clamped to half a turn so it can never eat the circle.

### 3b. Keeping the disc round — the square rect

A chart's layout box `[0,1]²` maps onto the plot rect, which is rarely square,
so a constant radius would render as an ellipse.

**Solution: square the *rect*, not the geometry.** The chart keeps two rects:

- `plotRect` — the usual one (legend/title/slider gutters removed), used for the
  slider and the readout;
- `discRect` — the largest **square** centered inside it, handed to the grains as
  their `plotRect` uniform and to the overlay for wedge drawing.

The alternative — baking the pixel aspect into the packed grain targets — would
force a **repack on every resize**. This way a resize is a uniform update.

### 3c. Packing (`core/particles/pack.ts`)

```ts
export interface Wedge { cx; cy; a0; a1; rInner; rOuter; colorIdx; barId }
export function wedgeArea(w: Wedge): number
export function wedgeGrainCounts(wedges: Wedge[], opts: PackOptions): number[]
export function packWedges(wedges, counts, out, opts, offset?): number
```

- Counts come from the shared density-driven `grainBudget` + `distribute`,
  weighted by **sector area** `½·Δa·(rOut² − rIn²)` — same contract as
  `grainCounts` / `lineGrainCounts`: adding slices subdivides the budget rather
  than asking for more sand.
- Grains land on a jittered **polar** grid whose cols/rows follow the sector's
  proportions (arc length at the mid radius across, ring thickness down).
- The radius is sampled **by area**: `r = sqrt(rIn² + v·(rOut² − rIn²))`. A
  linear ramp in `v` bunches grains against the hole and leaves the rim sparse.

---

## 4. The series slider (replaces the X axis)

Ticks and labels come from **`axes.x`** — the very block the bar chart uses for
its category axis (`ticks` thinning, `tickFormat`, `label`, font, color), so one
mental model covers both charts.

`charts/pie/slider.ts` holds the **pure model**, no drawing:

```ts
resolveSlider(cfg): ResolvedSlider          // show/position/interactive/handlePx/trackPx
trackPos(index, count): number              // 0..1 (a single series centers at 0.5)
indexAt(fraction, count): number            // inverse, clamped
sliderTicks(series, axisCfg): AxisTick[]    // thinned like the bar chart's X axis
sliderTrack(slider, plotRect, w, h, dpr)    // device-px geometry
fractionAtPx(track, px): number
sliderBandPx(slider, axisCfg): number       // margin reserved on its edge
```

`sliderTrack` is shared by the overlay (drawing) and the chart (hit-testing) so
the two can never drift apart.

Interaction lives on the **main canvas** (the overlay canvas is
`pointer-events: none`): `pointerdown` near the track captures the pointer,
drag/click seek. The handle shows an `ew-resize` cursor.

### Programmatic parity

```ts
setSeriesIndex(i): void      // animates, clamped
getSeriesIndex(): number
get seriesCount(): number
getSeriesKeys(): (Scalar | undefined)[]
on('seriesChange', ({ index, key }) => …)
// plus `seriesIndex` in the config
```

`seekTo()` (drag) calls `setSeriesIndex()` — **the dragged and the scripted path
are one code path**, so both animate identically. The handle eases toward the
selected index with a time constant tied to `morphDuration`, so handle and pie
settle together; while dragging it is pinned to the pointer instead.

---

## 5. Animation

Reuses Plan 01/05 mechanics with one decision that makes the slider feel right:

> **Slice identity is the category alone — the series is deliberately *not* part
> of the key.**

So moving the slider matches `Search → Search` and **sweeps** the wedge to its
new angle, rather than fading one series out and another in. `update` / `add` /
`remove` / `repour` behave as on the bar chart.

- Wedge tween interpolates `a0 / a1 / rInner / rOuter`; new slices open from a
  zero-width sliver at their final leading edge.
- Grain morph maps grain *k* to old grain *k* (`translate`), a random old grain
  (`reshuffle`), or rides the wedge with no stagger (`withSlice`).
- `enter: 'rise'` grows a new slice **out of the disc center** (the pie's
  analogue of rising from the baseline); `exit: 'fall'` appends ghost grains
  that drop off the bottom.

---

## 6. Modules (SRP)

| file | responsibility |
| --- | --- |
| `charts/pie/types.ts` | config surface + `SliceMeta` |
| `charts/pie/layout.ts` | series selection, caps, wedge geometry, `hitSlice` |
| `charts/pie/slider.ts` | slider model + geometry math (no drawing) |
| `charts/pie/pieStyle.ts` | `slices.fill/border/reveal` resolution |
| `charts/pie/overlay.ts` | cached solid layer, slider drawing, readout |
| `charts/pie/PieChart.ts` | orchestration: lifecycle, build/morph, pointer, API |
| `core/particles/pack.ts` | `Wedge` packing (shared primitive) |

The overlay caches the whole solid wedge layer and blits it, repainting only
the slices whose hover weight is non-zero — the bar chart's Plan-03 technique.

---

## 7. Shared chrome extraction (component isolation)

The pie needed the legend, FPS meter, chrome resolution, tick formatting and the
reveal ramp — all of which lived in `charts/bar/`. Importing them there would
have made `bar/` a de-facto framework and every future chart a dependent.

Moved to `core`, with thin re-exports left in `charts/bar/` so the public API is
unchanged:

```
core/chrome/{chrome,legend,title,fps,format,reveal,types}.ts
core/layout/plot.ts        // PLOT_HEIGHT
```

`CurrentValueConfig<M>` is now generic over the chart's own meta; the resolved
form stores `format` contravariantly (`(item: never) => string`) and each
overlay re-types it to its own meta. **No chart imports another chart.**

### Title (all three charts)

`core/chrome/title.ts` — a DOM layer built like `Legend`: same `position` /
`align` vocabulary and the same measure-then-inset contract, so a title and a
legend on one edge line up and neither overlaps the plot. Side titles read
vertically. Mounted by bar, line and pie; `PieChart.setTitle()` re-insets live.

---

## 8. Playground

New **Pie / donut** demo: 12 monthly series × 5 slices, full control panel
(data, geometry, slider, grain, animation, hover, title/legend, slices,
readout), three presets (Default / Donut / Grainy exploded donut), and a series
toolbar — prev, next, **play series**, continuous update — driving the public
API rather than the widget.

---

## 9. Milestones

- **M1 — packing** ✅: `Wedge`, `wedgeArea`, `wedgeGrainCounts`, `packWedges`.
- **M2 — layout** ✅: series selection, caps, angles, donut hole, `hitSlice`.
- **M3 — chart** ✅: square disc rect, build/morph, reveal, hover, lifecycle.
- **M4 — slider** ✅: model, drawing, drag/click, programmatic API + event.
- **M5 — title + isolation** ✅: `core/chrome` extraction, `Title`, re-exports.
- **M6 — playground + tests** ✅: demo, 3 new suites, browser verification.

---

## 10. Risks / gotchas

- **Ellipse instead of circle** → the square `discRect`; never bake aspect into
  packed targets, or every resize repacks.
- **Grains bunching at the donut hole** → area-uniform radial sampling
  (`sqrt`), covered by a distribution test.
- **Slider move reading as a full swap** → identity keyed on category only.
- **Hover repaint of the wedge** → clip to the wedge *grown by the border
  width*, else stroking the clip path clips its outer half.
- **Cross-chart coupling** → shared chrome in `core`; see
  `.claude/memory/component-isolation.md`.
- **Boundary angles in hit-testing** → the test at exactly the seam between two
  slices returns the first match; wedges may wrap past a full turn, so the angle
  is tested in each equivalent revolution.

---

## 11. Follow-ups (not in PR #9)

- `docs/pie-chart.html` to match the bar and line doc pages.
- E2E coverage for the slider drag journey (Plan 08).
- Optional exploded slices (per-slice radial offset) and label callouts.
