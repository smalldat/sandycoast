# Plan 12 — Wind rose chart with per-observation petals, latest-value highlight and a time table

Status: **DRAFT — for review**
Package: `@smalldat/sandycoast`
Depends on: Plan 01 (sand rendering + morph), Plan 02 (axes/legend/current value),
Plan 03 (fill/border reveal), Plan 05 (live data), Plan 09 (`packWedges` polar
packing, square disc rect), Plan 11 (dim/focus machinery)

> A wind rose built on the **same grain machinery as bar/line/pie/scatter**:
> observations bin into direction sectors, sand settles into annular petal
> segments, then a solid wedge layer resolves on top via the shared reveal ramp.
>
> Four structural differences from the existing charts:
>
> 1. **Two indicators, one dimension.** A point is `(time, direction,
>    intensity)` — neither the XYZ `DataSet` nor scatter's `MeshDataSet` has a
>    slot for a second indicator, so the rose gets its **own additive data
>    type** (the precedent Plan 10 set with `core/data/mesh.ts`).
> 2. **The petal is an aggregate.** Every other chart maps one datum to one
>    mark. Here many observations stack into one petal, so **binning becomes a
>    first-class, pure, testable module** and the mark identity is a *segment*,
>    not a point.
> 3. **A time table joins the chrome.** A scrolling table of observations,
>    mounted like the legend and shipped in `core/`, with click-a-row →
>    highlight-a-bar (and the reverse) as one bidirectional selection path. It
>    carries what a legend cannot say about a single series; in band mode the
>    legend stays available beside it to name the band colors.
> 4. **Mouse behavior is overridable.** Built-in click/hover behavior is
>    reachable as `defaultAction()` inside caller hooks that can cancel it —
>    a new shared contract in `core/interaction/`.

---

## 1. Goals

1. **Wind rose from sand.** Petals pour in, then a solid fill + border resolves
   on top, using the exact `reveal` timing contract every chart shares
   (`core/chrome/reveal.ts`).
2. **Two petal models, one code path.** `petals.mode` switches between
   **`'bands'`** (default — the classic meteorological rose: segments are
   intensity bands) and **`'observations'`** (each observation is its own
   addressable segment). Both produce the same `Segment[]`, so layout, packing,
   hit-testing, overlay and animation never branch.
3. **The latest values are highlighted**, with the selection rule configurable:
   the single newest, the newest *N* with a recency ramp, or every observation
   sharing the newest timestamp.
4. **A time table** — a shared `core/chrome/table.ts` layer, positionable on any
   edge, row click ↔ petal highlight in both directions, coexisting with the
   band legend when there is one.
5. **Everything configurable** — geometry, sectors, radial measure, bands,
   grains, animation, hover, highlight, table, title, readout, backend — in
   per-concern blocks matching the other charts' vocabulary.
6. **Mouse events overridable** — cancellable hooks with access to the built-in
   behavior, alongside (not instead of) the existing observer events.
7. **Single series.** No series dimension, no slider, no legend isolation; the
   dim/focus machinery is repurposed for segment selection.
8. **Component isolation** — `charts/windrose/` imports nothing from another
   chart; anything shared lands in `core/`.

---

## 2. Data model — `core/data/wind.ts` (additive)

The generic `Point` carries `x`, `y` and a `z` **series key**; scatter's
`MeshPoint` carries `x`, `y` and a `z` **value payload**. A wind observation is
neither: it has one dimension (time) and **two indicators** (direction,
intensity). Squeezing direction into `MeshValue.value` and time into
`MeshValue.datetime` would work mechanically but would leave the chart's
primary axis unnamed and the config surface lying about what it reads.

So, additively — `Point`/`DataSet` and `MeshPoint`/`MeshDataSet` untouched:

```ts
export interface WindPoint<Custom = unknown> {
  /** The dimension: when the observation was taken. */
  t: Date | number;
  /** Indicator 1 — compass direction the wind comes FROM. */
  direction: number;
  /** Indicator 2 — wind speed / magnitude. Non-finite and negative are dropped. */
  intensity: number;
  /** Caller payload, opaque to the chart, carried through to hover/table/events. */
  custom?: Custom;
}

export interface WindDataSet<Custom = unknown> {
  points: WindPoint<Custom>[];
  /** Unit of `direction`. Default 'deg'. */
  directionUnit?: 'deg' | 'rad';
  /** Label for the intensity indicator, used by the table header and readout. */
  intensityLabel?: string;
  /** Unit suffix for intensity (e.g. 'kt', 'm/s'), used in labels only. */
  intensityUnit?: string;
}
```

Helpers beside the existing `validate` / `resolveTypes` in
`core/data/dataset.ts` (re-exported, same error vocabulary via `DataError`):

```ts
validateWind(ds): void              // shape + finite checks, throws DataError
normalizeWind(ds): NormalizedWind   // direction → radians in [0, 2π), t → ms number,
                                    // sorted by t ascending, invalid rows dropped
```

**Decisions, called out for review:**

- **Direction is "from", not "to"** — the meteorological convention. A
  `directionMeaning?: 'from' | 'to'` knob is *not* proposed; a caller wanting
  "to" adds 180° to their data. Say if you want the knob.
- **Invalid rows are dropped, not clamped.** A NaN direction has no sector.
  The count of dropped rows is exposed as `getDroppedCount()` so the playground
  can surface it rather than silently disagreeing with the caller's row count.
- **Sorting is by `t` ascending** and is the chart's, not the caller's,
  responsibility — "latest" must be well-defined regardless of input order.

---

## 3. Binning — `charts/windrose/binning.ts` (pure, no geometry)

The one genuinely new algorithm in this chart, kept free of angles, rects and
canvas so it can be tested as a function of numbers.

```ts
export interface Segment {
  /** Stable identity for morph + hit-testing + table linkage. */
  key: string;
  /** Contribution to the petal's radial extent, in the radial measure's units. */
  weight: number;
  /** Observations folded into this segment (exactly one in 'observations' mode). */
  members: number[];        // indices into the normalized point list
  /** Band index in 'bands' mode; -1 in 'observations' mode. */
  band: number;
  /** True when this is the merged tail of a capped sector (see below). */
  aggregated: boolean;
}

export interface Bin { sector: number; a0: number; a1: number; segments: Segment[]; total: number }

binDirections(points, opts): Bin[]
bandEdges(points, opts): number[]     // fixed thresholds, or quantile/equal-width derived
```

- **Sector assignment.** `sectors` (default 16; any integer ≥ 2) evenly divides
  the turn. `sectorAlign: 'centered' | 'edge'` (default `'centered'`) decides
  whether a sector is *centered* on due North or *starts* there — the classic
  rose centers, so N spans −11.25°..+11.25° at 16 sectors.
- **Bins are half-open** `[lo, hi)` in a normalized angle, so an observation at
  exactly a boundary lands in exactly one sector and 359.9° wraps into the North
  bin. Covered by a boundary/wrap test.
- **Radial measure** (`radial.measure`, **default `'count'`**) decides `weight`:
  `'count'` → 1 per observation · `'percent'` → 1, normalized at layout time ·
  `'intensitySum'` → the intensity · `'intensityMax'` → the petal length is the
  max rather than a stack (segments then order without accumulating).
- **Calm threshold.** `calm.below` (default 0) diverts observations under the
  threshold into a central **calm circle** rather than a direction petal — the
  standard treatment, since a calm reading has no meaningful direction. Its
  radius is the calm share of the total, drawn as the rose's inner hole.
- **Segment cap.** `maxSegmentsPerSector` (default 120) bounds geometry and
  grains. Unlike the pie's cap, the tail is **merged into one `aggregated`
  segment, never dropped** — dropping observations would misstate a frequency
  petal's length. Hover on an aggregated segment reports "n observations,
  <range>".

**`'bands'` is the default mode**: the same function runs with segments keyed by
band index and `bandEdges` supplying thresholds — explicit
`bands.thresholds: number[]`, or derived (`bands.derive: 'quantile' | 'equal'`,
`bands.count`) when omitted. So the chart opens as the rose people recognise,
and a caller who wants per-reading precision sets `petals.mode: 'observations'`.

> **Consequence of that default, stated plainly:** in `'bands'` mode the
> smallest addressable mark is a band, so a table-row click highlights the
> *band containing* that reading and the "latest" highlight lands on the band
> holding the newest observation. The exact one-row-one-bar linkage arrives with
> `petals.mode: 'observations'`. Both behaviors are real and documented; the
> readout and the table's selected-row styling say which one is in play, so the
> chart never implies more precision than the mode delivers.

---

## 4. Geometry — `charts/windrose/layout.ts` + `core/layout/polar.ts`

### 4a. Shared polar helpers (extracted to core)

The pie already solved "keep the disc round in a non-square rect" and
"clockwise-from-12 angles", but that math lives inside `PieChart.ts`. Two
charts now need it, so it moves to **`core/layout/polar.ts`**:

```ts
squareRect(rect): [number, number, number, number]    // largest centered square
polarToLayout(cx, cy, a, r): { x: number; y: number } // x = cx + sin a · r, y = cy + cos a · r
normalizeAngle(a): number                             // into [0, 2π)
angleInWedge(a, a0, a1): boolean                      // revolution-tolerant, seam-safe
```

**Decided: the pie adopts them in this PR.** The math is identical, so the pie
diff is a move plus imports (~40 lines), guarded by the existing
`pie/layout.test.ts`, `slider.test.ts` and the `pie-basic` e2e journey. The
alternative — duplicating polar math across two charts — is exactly the drift
`core/` exists to prevent.

### 4b. Rose layout

`layoutWindRose(bins, palette, opts): WindRoseLayout` turns bins into the
**existing `Wedge[]`** primitive — so `wedgeArea`, `wedgeGrainCounts` and
`packWedges` are reused verbatim and **no new packing code is written**:

- Angles are radians **clockwise from 12 o'clock**, matching the pie.
- `north` (degrees, default 0) rotates the compass; `clockwise` (default true)
  flips for the rare CCW convention.
- Petal sweep = `sectorSweep · petalWidth` (default 0.9), centered in its
  sector, minus `padAngle`. A `petalWidth` of 1 gives touching petals.
- Radial extent: segments stack outward from `rInner` (the calm circle) to
  `rInner + share · (rOuter − rInner)`, where `share` is the sector's total
  weight over `radial.max` (auto = the largest sector's total, or explicit).
- `radius` (fraction of the square's half-extent, default 0.92) and
  `innerRadius` (minimum hole even with no calm data, default 0), as on the pie.
- Segment order within a petal: `petals.order: 'intensity' | 'time'`
  (default `'intensity'`, ascending inward→outward — the conventional reading).

`hitSegment(layout, x, y)` mirrors `hitSlice`: seam-safe angle test in each
equivalent revolution, radius test between the segment's bounds.

### 4c. Coloring

- `'bands'` mode: `colors` cycles **per band**, so the legend/table swatch is
  stable and means something.
- `'observations'` mode: `colors` acts as **sequential ramp stops** over the
  intensity domain, so a petal reads light→dark outward. Needs one new core
  util: `colorRamp(stops: RGBA[], t: number): RGBA` in `core/util/color.ts`,
  unit-tested for endpoints, midpoints and clamping.

---

## 5. Radial + compass axis — `charts/windrose/axis.ts`

There is no cartesian X/Y here, so the shared `AxisConfig` blocks are re-mapped
rather than dropped — same knobs, polar meaning:

- **`axes.x` → the compass axis**: sector labels around the rim. `ticks` thins
  them (16 sectors with `ticks: 8` labels every other), `tickFormat` receives
  the sector's center bearing so a caller can print `N/NNE/NE…` (the default)
  or raw degrees. `label`, font and color as usual.
- **`axes.y` → the radial axis**: concentric rings at tick radii, labels along a
  configurable spoke (`radial.labelAngle`, default the 45° gap). `gridLines`
  toggles the rings themselves; `tickFormat` receives the measure value (count,
  percent, or intensity sum).

This keeps one mental model across charts and adds no new axis vocabulary.

---

## 6. Latest-value highlight

```ts
highlight?: {
  show?: boolean;                                       // default true
  select?: 'latest' | 'latestN' | 'latestTimestamp';    // default 'latest'
  count?: number;                                       // 'latestN' only, default 3
  ramp?: boolean;                                       // recency fade, default true when count > 1
  mode?: 'glow' | 'outline' | 'color';                  // default 'glow'
  color?: string;                                       // 'outline' / 'color' only
  gain?: number;                                        // grain brightness gain, default 1.8
  outlinePx?: number;                                   // default 2
}
```

Implemented as a per-segment `highlightWeights: Float32Array` — the **same
shape and blend as `hoverWeights` and `dimWeights`** (Plan 11), so highlight,
hover and selection compose additively instead of fighting each other. With
`ramp`, weight falls off by recency rank: the newest reads strongest and the
trail fades.

In `'bands'` mode the newest observation resolves to the *segment containing
it*, and the readout says so — the honest reading, since the band is the
smallest addressable mark in that mode.

Live-append is the marquee behavior: a new observation grows its petal
(`animation.enter: 'grow' | 'pour' | 'rise'`, default `'grow'` — the segment
opens at the rim) and the highlight walks forward on its own.

---

## 7. Time table — `core/chrome/table.ts`

A DOM layer built exactly like `Legend`: absolutely positioned over the chart,
`measure()`d, its extent folded into the plot margins. Chart-agnostic (ISP) —
it takes formatted rows, not wind data.

```ts
export interface TableRow { id: string; cells: string[]; color?: RGBA }

export interface TableConfig {
  show?: boolean;                       // default false
  position?: Side;                      // default 'right'
  align?: 'start' | 'center' | 'end';
  columns?: { label: string; width?: string; align?: 'left' | 'right' }[];
  /** Max rows kept in the DOM; older rows scroll out. Default 500. */
  maxRows?: number;
  /** Click a row to select the matching mark. Default true. */
  interactive?: boolean;
  stickyHeader?: boolean;               // default true
  /** Follow the highlight: scroll the newest/selected row into view. Default true. */
  followSelection?: boolean;
  maxHeight?: string; fontPx?: number; fontFamily?: string; color?: string;
}

export class Table {
  constructor(host, cfg: ResolvedTable, onRowClick?: (index: number) => void)
  setRows(rows: TableRow[]): void
  setSelected(index: number | null): void      // styles + optional scrollIntoView
  setEdgeOffset(px: number): void              // stack under a legend/title on the same edge
  measure(): number
  dispose(): void
}
```

`TableConfig` + `ResolvedTable` join `core/chrome/types.ts` / `chrome.ts`, and
`ChromeInput` gains an optional `table?: TableConfig`, so `resolveChrome`
handles it uniformly for any future chart.

> **Edge-stacking gap found while reading the code:** `recomputePlotRect` adds
> the legend and title extents to the *same* margin side, but both DOM layers
> pin themselves at `edge: 0`, so two layers on one edge overlap each other even
> though the plot is inset correctly for both. The table makes this reachable by
> default, so this PR adds `setEdgeOffset(px)` to `Table` (and, for symmetry, to
> `Legend` and `Title`) and has the chart pass the running per-edge offset. It
> is a small pre-existing bug and worth fixing here rather than working around.

### Columns the wind rose supplies

The chart formats its own rows; `core/chrome/table.ts` never sees wind data.
Default columns, newest first:

| column | content |
| --- | --- |
| Time | `t`, formatted by `table.timeFormat` (default locale time, date when the span exceeds a day) |
| Dir | the **compass bearing** — `N`, `NNE`, `NE`, … — matching the compass axis labels rather than raw degrees |
| Speed | `intensity` + `intensityUnit`, headed by `intensityLabel` |
| *(custom)* | present only when the caller opts in |

Bearing is the default direction rendering because it is what a reader actually
parses, and it agrees with what the rim labels say. Raw degrees stay one line
away via `table.directionFormat: (deg) => …`.

The optional fourth column is driven by the caller's own payload and costs
nothing until used:

```ts
table?: TableConfig & {
  timeFormat?: (t: Date) => string;
  directionFormat?: (deg: number) => string;   // default: compass bearing
  /** Opt-in extra column fed from WindPoint.custom. Omitted entirely when unset. */
  customColumn?: { label: string; format: (custom: unknown, p: ObservationMeta) => string };
};
```

### Legend alongside the table

- **`'bands'` mode** (the default): the legend is **available** — band colors
  name real intervals (`0–5 kt`, `5–10 kt`, …), so a key earns its place. Off by
  default, mountable on any edge, and it stacks cleanly beside the table thanks
  to the `setEdgeOffset` fix above.
- **`'observations'` mode**: colors are a continuous intensity ramp, so there is
  nothing discrete to label. The legend is a no-op; the radial axis and the
  readout carry the intensity story instead. Setting `legend.show` there is
  ignored rather than erroring, and the doc page says so.

---

## 8. Selection — one path, both directions

```ts
selectObservation(id: string | null): void   // table row → petal
selectSegment(key: string | null): void      // petal → table row
getSelected(): { segmentKey: string | null; observationId: string | null }
on('select', ({ segmentKey, observationId, meta }) => …)
```

Both public methods funnel into one private `setSelection()` that updates the
segment weights, the table's selected row and emits — so a scripted call, a
table click and a petal click are indistinguishable downstream (the pie's
`seekTo → setSeriesIndex` rule, which is why the dragged and scripted paths
animate identically). Selection dims the rest via `interaction.dim`, Plan 11's
config reused unchanged.

---

## 9. Overridable mouse events — `core/interaction/mouse.ts`

```ts
export interface MouseHookContext<M, E extends Event = PointerEvent> {
  /** The hit mark, or null for background. */
  meta: M | null;
  /** The raw DOM event — modifiers, coordinates, preventDefault. */
  native: E;
  /** Pointer position in CSS px, relative to the chart element. */
  px: { x: number; y: number };
  /** Run the chart's built-in behavior for this event. Idempotent. */
  defaultAction(): void;
}

export type MouseHook<M, E extends Event = PointerEvent> =
  (ctx: MouseHookContext<M, E>) => boolean | void;

/** Runs `hook`, then the default unless it was cancelled or already run. */
export function runMouseHook<M, E extends Event>(
  hook: MouseHook<M, E> | undefined,
  ctx: MouseHookContext<M, E>,
  fallback: () => void,
): void
```

**Contract:** returning `false` suppresses the default; returning `true` or
`undefined` runs it — *unless* the hook already called `defaultAction()`, which
latches so the behavior can never run twice. No hook at all = today's behavior,
byte for byte.

On the chart:

```ts
interaction?: {
  mouse?: {
    onPetalHover?:      MouseHook<SegmentMeta>;
    onPetalClick?:      MouseHook<SegmentMeta>;
    onPetalDblClick?:   MouseHook<SegmentMeta, MouseEvent>;
    onBackgroundClick?: MouseHook<null>;
    onTableRowClick?:   MouseHook<ObservationMeta, MouseEvent>;
    onWheel?:           MouseHook<SegmentMeta, WheelEvent>;
  };
}
```

The `hover` / `select` emitter events **still fire regardless** — observers are
not overrides, and a caller who suppresses the default selection should still
get to hear about the click. The contract lives in `core/` so bar/line/pie/
scatter can adopt the same block later rather than inventing a second dialect.

---

## 10. Modules (SRP)

| file | responsibility |
| --- | --- |
| `core/data/wind.ts` | `WindPoint` / `WindDataSet` (additive, like `mesh.ts`) |
| `core/data/dataset.ts` | + `validateWind`, `normalizeWind` |
| `core/layout/polar.ts` | square rect, polar↔layout, angle normalize/seam test (pie adopts) |
| `core/chrome/table.ts` | generic DOM data table layer (a `Legend` sibling) |
| `core/chrome/{types,chrome}.ts` | + `TableConfig` / `ResolvedTable`, `ChromeInput.table` |
| `core/interaction/mouse.ts` | cancellable mouse-hook contract + `runMouseHook` |
| `core/util/color.ts` | + `colorRamp` for sequential intensity coloring |
| `charts/windrose/types.ts` | config surface + `SegmentMeta` / `ObservationMeta` |
| `charts/windrose/binning.ts` | sectors, bands, calm, caps, aggregation (pure) |
| `charts/windrose/layout.ts` | bins → `Wedge[]` + metas, `hitSegment` |
| `charts/windrose/roseStyle.ts` | fill/border/reveal + highlight resolution |
| `charts/windrose/axis.ts` | compass labels + radial ring models |
| `charts/windrose/overlay.ts` | cached solid layer, rings, labels, readout |
| `charts/windrose/WindRoseChart.ts` | orchestration: lifecycle, build/morph, pointer, API |

The overlay caches the whole solid petal layer and blits it, repainting only the
segments whose hover/highlight/selection weight is non-zero — the Plan 03
technique the pie already uses.

---

## 11. Animation

Plan 01/05 mechanics, with one rose-specific identity rule:

> **Segment identity is `sector + segment key`** — the observation id in
> `'observations'` mode, the band index in `'bands'` mode.

So appending an observation *grows* the petal it belongs to instead of
re-pouring the rose, and switching `radial.measure` sweeps every petal to its
new length. `reflow: 'translate' | 'reshuffle' | 'withPetal'`,
`enter: 'grow' | 'pour' | 'rise'`, `exit: 'shrink' | 'fall' | 'vanish'`,
`morphGrains`, `morphDuration`, `duration`, `stagger`, `ease` — same names and
meanings as every other chart.

Changing `sectors` or `petals.mode` invalidates every key, so it re-pours —
honest, because the marks genuinely are different marks.

---

## 12. Public API

```ts
new WindRoseChart(el, config)
whenReady() / dispose() / get backend
getData() / update(patch) / add(points) / remove(refs) / repour()
selectObservation(id | null) / selectSegment(key | null) / getSelected()
getHighlighted(): ObservationMeta[]        // what 'latest' currently resolves to
getSegments(): SegmentMeta[]
getDroppedCount(): number
on('hover' | 'select' | 'highlight', fn) → unsubscribe
```

Lifecycle names match every other chart (LSP), so the playground plumbing and
the e2e harness need no special-casing.

---

## 13. Playground

`playground/windrosechart.demo.ts` + a `registry.ts` entry (`preferredLayout:
'lr'`), following the existing demos' structure and settings persistence.

- **Data generator**: a synthetic wind series — prevailing direction with a
  random-walk drift, gust bursts and a calm fraction — seeded so a given seed
  reproduces exactly (the same `rng` / `gaussian` helpers the scatter demo uses).
- **Control groups**: Data (samples, seed, drift, gustiness, calm share) ·
  Geometry (radius, innerRadius, north, clockwise, petalWidth, padAngle) ·
  Petals (mode, order, maxSegmentsPerSector) · Sectors (count, align) ·
  Radial (measure, max, ticks, rings, label angle) · Bands (derive, count,
  thresholds, colors) · Grain · Animation · Highlight (select, count, ramp,
  mode, color, gain) · Hover · Selection/dim · Table (show, position, columns,
  maxRows, followSelection) · Title/Legend · Readout · FPS/backend.
- **Presets**: *Default* (the shipped defaults — 16-sector band rose by count,
  table right, legend bottom, latest band glowing) · *Per-observation* (
  `petals.mode: 'observations'`, intensity ramp, exact row ↔ bar linkage —
  the preset that shows off the selection path) · *Grainy donut rose* (large
  calm hole, high grain density, percent measure).
- **Live toolbar**: stream (append an observation every N ms), pause, reset,
  jump-to-latest — driving the public API, not internals.
- **Mouse-hook pane**: toggles that install real hooks — "shift-click suppresses
  selection", "double-click clears", "hover logged, default cancelled" — with a
  small event log, so the override contract is demonstrable rather than merely
  documented.

---

## 14. Tests

Unit (vitest), all on pure modules:

- `core/data/wind.test.ts` — validate/normalize, unit conversion, sorting,
  invalid-row dropping.
- `charts/windrose/binning.test.ts` — sector assignment at exact boundaries and
  the 360/0 wrap, `centered` vs `edge` alignment, band derivation, calm
  diversion, tail aggregation preserving the total.
- `charts/windrose/layout.test.ts` — wedge geometry per radial measure, stacking
  order, calm hole, `hitSegment` at seams and outside the disc.
- `core/layout/polar.test.ts` — square rect, polar↔layout round-trip, seam test.
- `core/chrome/table.test.ts` — rows, selection styling, `measure()`,
  `setEdgeOffset`, click callback.
- `core/interaction/mouse.test.ts` — cancel via `false`, default runs on
  `undefined`, `defaultAction()` latches (never twice).
- `core/util/color.test.ts` — `colorRamp` endpoints / midpoint / clamping.

E2E (Plan 08 harness): `windrose-basic.scenario.ts` — hover a known petal, hover
the background, then a table-row-click → selection journey, with the geometry
reference comment the `pie-basic` scenario models.

---

## 15. Docs

`docs/windrose-chart.html` matching the existing pages (config table, events,
methods, data model, examples) plus the nav entry in `docs/index.html`. The
mouse-hook contract and the table get their own sections, since both are new
vocabulary for the library.

---

## 16. Milestones

- **M1 — data + binning**: `core/data/wind.ts`, validate/normalize, `binning.ts`
  with both modes, calm, caps + tests. No rendering.
- **M2 — polar core + layout**: `core/layout/polar.ts` (pie adopts it),
  `layout.ts` → `Wedge[]`, `hitSegment`, `colorRamp` + tests.
- **M3 — chart**: square rose rect, pour/reveal/morph, hover, axes (compass +
  rings), overlay caching, lifecycle.
- **M4 — highlight**: `highlight` block, weight buffer, recency ramp,
  composition with hover/dim; live-append grows the petal.
- **M5 — table**: `core/chrome/table.ts`, `ChromeInput.table`, the edge-offset
  fix across `Legend`/`Title`/`Table`, bidirectional selection.
- **M6 — mouse hooks**: `core/interaction/mouse.ts`, wired to hover / click /
  dblclick / background / wheel / table-row.
- **M7 — playground, docs, e2e**: demo + presets + hook pane, doc page,
  scenario, `src/index.ts` exports.

Suggested delivery: one PR, or split at M4/M5 if you would rather review the
chart and the table separately.

---

## 17. Risks / gotchas

- **Ellipse instead of circle** → the square rose rect; aspect is never baked
  into packed targets (the pie's lesson — otherwise every resize repacks).
- **Grain starvation with many small segments** → the budget is distributed by
  sector area *then* subdivided within the petal, with a floor per segment; the
  `maxSegmentsPerSector` merge keeps the tail from atomizing the sand.
- **Boundary/wrap directions** → half-open bins and a revolution-tolerant angle
  test, both directly tested.
- **Aggregation lying about totals** → the cap merges rather than drops, unlike
  the pie's slice cap, and deliberately so.
- **The two petal modes drifting apart** → both emit the same `Segment[]`;
  nothing downstream of `binning.ts` knows which mode produced them.
- **Table + legend/title on one edge overlapping** → `setEdgeOffset`; see §7.
- **Long tables** → `maxRows` cap; if profiling shows real DOM cost at thousands
  of rows, windowing is a follow-up, not a v1 requirement.
- **Hook misuse** (`defaultAction()` twice, or called *and* `false` returned) →
  the latch makes both harmless and the tests pin the semantics.
- **Direction unit ambiguity** → explicit `directionUnit`, defaulted to degrees
  and validated (radians outside `[0, 2π]` is a `DataError`, not a silent
  reinterpretation).
- **Touching the pie in this PR** (§4a, decided yes) → a pure move; the existing
  pie unit tests and the `pie-basic` e2e journey are the guard, and M2 does not
  land until they pass unchanged.
- **The default mode being coarser than the headline feature** (§3) → `'bands'`
  ships as the default, so out of the box a row click selects a band. Mitigated
  by saying so in the readout, the doc page and the *Per-observation* preset
  rather than by silently upgrading the selection.

---

## 18. Decisions (resolved in review)

| # | Question | Decision |
| --- | --- | --- |
| 1 | Pie adopts `core/layout/polar.ts`? | **Yes, in this PR** (§4a, M2). Pure move, three existing suites guard it. |
| 2 | Petal model | **Both, `petals.mode`** — `'bands'` \| `'observations'`, one `Segment[]` contract (§3). |
| 3 | Default `petals.mode` | **`'bands'`** — opens as the recognisable rose; `'observations'` is one line away (§3). |
| 4 | Radial measure | **All four configurable**, `'count'` the default (§3). |
| 5 | Latest highlight | **Configurable** — `select: 'latest' \| 'latestN' \| 'latestTimestamp'`, `count`, `ramp` (§6). |
| 6 | Time table | **`core/chrome/table.ts` now** — a `Legend` sibling, reusable by future charts (§7). |
| 7 | Table columns | **Time / bearing / intensity**, plus an opt-in `customColumn` from `WindPoint.custom` (§7). |
| 8 | Legend in `'bands'` mode | **Kept**, alongside the table; a no-op in `'observations'` mode (§7). |
| 9 | Mouse overriding | **Cancellable hooks** with `defaultAction()`; emitter events still fire (§9). |

Assumptions still carried by the plan, flagged rather than asked — say the word
if any is wrong and it is a small change at this stage:

- Direction means **"wind comes from"** (meteorological convention); no
  `directionMeaning` knob (§2).
- Invalid rows are **dropped, not clamped**, with `getDroppedCount()` exposing
  the count (§2).
- The chart **sorts by `t` itself**, so "latest" is well-defined regardless of
  input order (§2).
- The capped-sector tail is **merged, never dropped** — unlike the pie's slice
  cap — because dropping observations would misstate a frequency petal (§3).
