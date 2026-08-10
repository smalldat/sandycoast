# Plan 10 — Scatter chart with markers, mesh-ready Z, and swappable trend fitting

Status: **DRAFT**
Package: `@smalldat/sandycoast`
Depends on: Plan 01 (sand rendering + morph), Plan 02 (axes/legend/current value),
Plan 05 (live data), `core/scales` (continuous positioning), `core/chrome/reveal.ts`
(shared reveal ramp)

> A scatter chart built on the **same grain machinery as bar/line/pie**: sand
> settles into a cloud, then a per-point **solid marker** (circle, triangle,
> square, asterisk, …) resolves on top — the scatter analogue of the line
> chart's solid line / bar chart's solid border.
>
> Two structural differences from line/bar/pie:
>
> 1. **Continuous X and Y.** Line charts slot `x` into discrete, evenly spaced
>    categories; a scatter needs real numeric (or time) positioning on both
>    axes. This is a straight reuse of `core/scales` (`LinearScale`/`TimeScale`),
>    just not wired up for `x` on any chart yet.
> 2. **`z` stops being a series key and becomes a per-point value object.**
>    Scatter (and a future mesh chart) needs a `z` that carries a numeric
>    value, an independent timestamp and an opaque custom payload — for
>    coloring and, later, mesh height/topology. That is a different shape than
>    every other chart's `z: Scalar` series discriminator, so scatter gets its
>    **own point/data types**, additive in `core/data/`, with the existing
>    `Point`/`DataSet` left untouched.

---

## 1. Goals

1. **Marker chart from sand.** Grains settle into a cloud around each point,
   then a solid marker (shape/size/color) resolves on top, using the exact
   `reveal` timing contract every other chart already shares
   (`core/chrome/reveal.ts`).
2. **Configurable markers.** Shape (`circle` | `triangle` | `square` |
   `asterisk`), size and color, at chart- or per-series granularity — same
   cycling convention as `colors: string[]` on bar/line.
3. **Mesh-ready `z`.** A new `MeshValue` object (`value`, `datetime`, `custom`)
   travels with every point, additive to — not replacing — the existing
   `Point`/`DataSet` used by bar/line/pie. `z.value` is *typed and threaded
   through* in this plan; it does **not** drive rendering yet (no color-scale
   infra is built here — see §9 Follow-ups). It exists so a future mesh chart,
   and a later "color by value" pass on scatter, both consume one shape
   instead of inventing their own.
4. **Swappable point-cloud approximation.** A pluggable `Approximation`
   strategy interface (`fit(points) → path`) with three built-ins — `'none'`,
   `'straight'`, `'spline'`, `'leastSquares'` — so a caller can pass a custom
   fitter later without the chart changing.
5. **Same properties as the line chart** wherever the concept transfers:
   `grain`, `animation` (duration/ease/stagger/morph/reflow/enter/exit),
   `interaction.hover`, `axes`, `legend`, `title`, `currentValue`, `fps`,
   `panZoom`, `backend` — one mental model across bar/line/pie/scatter.
6. **Component isolation.** The scatter chart must not import from
   `charts/bar/`, `charts/line/` or `charts/pie/`. Anything scatter needs that
   line already half-built (Catmull-Rom path tracing) gets **extracted to
   `core`** first, with a thin re-export left in `line/` — see §6.
7. **Demo + docs parity.** A playground demo following the line chart's
   pattern, and a docs page following `docs/line-chart.html`'s pattern. Both
   already have placeholders waiting (`playground/registry.ts`'s disabled
   `scatter` stub, `docs/index.html`'s "Scatter — soon" roadmap entry).

---

## 2. Data model

### 2a. Why not reuse `Point<X,Y,Z>`

`Point.z` (`core/data/types.ts`) is a `Scalar` and is consumed **everywhere**
as the series-grouping key — bar, line and pie all group points by
`String(p.z)`. Redefining it as an object would silently break that contract
for three shipped charts. Scatter's `z` means something else entirely (a
value, not an identity), so it gets an **additive** sibling type instead of a
breaking change to the shared one.

### 2b. New types — `core/data/mesh.ts` (new file)

Placed in `core/data/`, not `charts/scatter/`, for the same reason legend/title
live in `core/chrome/`: a future mesh chart will need the identical shape, and
two consumers means it belongs in `core` (`component-isolation` memory) rather
than the mesh chart importing from `charts/scatter/`.

```ts
import type { Scalar, FieldType } from './types.js';

/** Per-point value payload: accompanying data beyond position, used today for
 *  optional coloring and reserved for future mesh height/topology. */
export interface MeshValue<Custom = unknown> {
  /** Numeric value — coloring today, mesh height/weight later. */
  value?: number;
  /** Independent per-point timestamp (not the x axis — e.g. "when this
   *  sample was captured", orthogonal to its plotted position). */
  datetime?: Date;
  /** Caller-defined payload, opaque to the chart; carried through to hover
   *  events and, later, mesh construction untouched. */
  custom?: Custom;
}

export interface MeshPoint<X extends Scalar = Scalar, Y extends Scalar = Scalar, Custom = unknown> {
  x: X;
  y: Y;
  z?: MeshValue<Custom>;
}

/** One scatter series: an optional key (legend label) plus its points. */
export interface MeshSeries<Custom = unknown> {
  key?: Scalar;
  points: MeshPoint<Scalar, Scalar, Custom>[];
}

/** A scatter/mesh dataset is a list of series — `z` no longer discriminates
 *  series membership, so series become an explicit array. */
export interface MeshDataSet<Custom = unknown> {
  series: MeshSeries<Custom>[];
  xType?: FieldType;
  yType?: FieldType;
}
```

`core/data/types.ts` itself is **not modified**. `resolveTypes`/`toNumeric`/
`validate` in `core/data/dataset.ts` gain scatter-specific counterparts (or
overloads) operating on `MeshDataSet`, since the existing ones assume a flat
`DataSet.points` with a scalar `z`.

### 2c. Consequence: series come from array structure, not `z`

Every other chart infers series by grouping on `z`. Scatter can't, since `z`
is now a value object. `ScatterChartConfig.data: MeshDataSet` makes series
explicit (`series: [{ key: 'Batch A', points: [...] }, ...]`), which is also
strictly clearer for a chart whose points aren't naturally ordered.

---

## 3. Continuous axes (the other structural change)

Line's `layoutLine` (`charts/line/layout.ts`) buckets `x` into `xSlots`, one
per **distinct value** — categorical, not continuous. Scatter needs real
numeric/time positioning for both axes (points at `x=1.2` and `x=1.3` must
land at different pixels, not share a slot).

`layoutScatter` (new, `charts/scatter/layout.ts`) builds `xScale`/`yScale` via
`core/scales`' existing `LinearScale`/`TimeScale`/`makeScale` — **already
generic over field type**, just never wired to `x` before now since line
didn't need it. No changes required in `core/scales`.

---

## 4. Markers

### 4a. Rendering model

Mirrors the line chart's `line` block: sand settles into a cloud around each
point (small-radius packing, see §5), then a **solid marker glyph** resolves
on top using the identical `reveal` contract already factored out in
`core/chrome/reveal.ts` (`RevealConfig`/`resolveReveal`/`revealFactor` — reused
verbatim, not reimplemented).

Grain shape stays `core/render/types.ts`'s existing `GrainShape` (`'quad' |
'disc'`) for the sand itself; marker glyph shape is a **new, separate**
concept — drawn by the overlay, analogous to how `lineStyle.ts` resolves the
solid stroke independent of grain shape.

### 4b. Config

```ts
export type MarkerShape = 'circle' | 'triangle' | 'square' | 'asterisk';

export interface MarkerStyleConfig {
  /** Default shape for every series. Default 'circle'. */
  shape?: MarkerShape;
  /** Per-series shape cycling, like `colors`. Overrides `shape` per series. */
  shapes?: MarkerShape[];
  /** Marker size, CSS px. Default 6. */
  size?: number;
  /** Per-series size cycling. */
  sizes?: number[];
  /** Marker fill opacity 0..1. Default 1. */
  opacity?: number;
  /** Timing of the particle→marker crossfade (shared RevealConfig). */
  reveal?: RevealConfig;
}
```

`marker` is **off by default** the same way `line.line` is — a config without
it renders sand-only, matching every other chart's "additive block, backward
compatible" convention.

### 4c. Drawing the four shapes

`circle`/`square` are trivial canvas paths. `triangle` is an equilateral
triangle inscribed in the marker's bounding circle. `asterisk` is N radial
strokes (default 3, 6 spokes) — cheapest to draw as a small `Path2D` built
once per shape/size pair and cached, not rebuilt per point per frame (same
caching discipline as the pie chart's cached solid wedge layer, Plan 09 §6).

---

## 5. Packing — `core/particles/pack.ts` additions

New primitive alongside `BarRect`/`Wedge`/`LineSeg`:

```ts
export interface PointBlob {
  cx: number;
  cy: number;
  /** Cloud radius grains scatter within, layout units. */
  radius: number;
  colorIdx: number;
  barId: number; // reused slot name for hover hit-testing, per existing convention
}

export function blobArea(b: PointBlob): number;         // π r²
export function blobGrainCounts(blobs: PointBlob[], opts: PackOptions): number[];
export function packBlobs(blobs, counts, out, opts, offset?): number;
```

Same contract as `wedgeGrainCounts`/`packWedges`: density-driven
`grainBudget`, shared by area so adding points subdivides the same sand
budget. Grains land in a jittered disc (rejection sampling or the pie chart's
area-uniform radial trick: `r = sqrt(u) * radius`), not a square grid, so the
cloud reads round regardless of point density.

---

## 6. Approximation — swappable strategy

### 6a. Extracting shared curve math (prerequisite)

Today, `'straight'`/`'spline'` path tracing (Catmull-Rom → bézier) lives
**inside** `charts/line/overlay.ts` (`traceTop`, lines ~609–635), coupled to
line's own drawing loop. Scatter needs the same two connectors for its
`'straight'`/`'spline'` approximations. Per `component-isolation` (chart code
must not import from a sibling chart), this gets **extracted to `core`
first**:

```
core/geometry/curve.ts
  tracePolylinePath(ctx, points, style: 'straight' | 'spline'): void
  catmullRomToBezier(points): BezierSegment[]   // pure math, testable
```

`charts/line/overlay.ts` re-imports from `core/geometry/curve.ts`; a thin
call-site swap, not a behavior change (exactly the "move to core, leave a
re-export shim" pattern Plan 09 used for chrome).

### 6b. The interface

```ts
// core/approx/types.ts
export interface FitPoint { x: number; y: number; }

export interface Approximation {
  readonly kind: string;
  /** Points → an ordered path to draw (resampled curve, regression line, …). */
  fit(points: FitPoint[]): FitPoint[];
}
```

### 6c. Built-ins — `core/approx/`

| kind | behavior |
| --- | --- |
| `none` | no-op; approximation layer draws nothing |
| `straight` | sort by `x`, connect consecutively (reuses §6a) |
| `spline` | sort by `x`, Catmull-Rom smooth (reuses §6a) |
| `leastSquares` | ordinary linear least-squares (`y = mx + b`) over the whole cloud, returned as the two endpoints spanning the x-domain — new, scatter-only math (closed-form, no iteration) |

`core/approx/` (not `charts/scatter/`) for the same DIP reason as `MeshValue`:
a future mesh chart's height-fitting is a natural second consumer of
`leastSquares`.

### 6d. Config

```ts
export interface ScatterApproximationConfig {
  kind?: 'none' | 'straight' | 'spline' | 'leastSquares' | Approximation;
  width?: number;   // stroke width, CSS px. Default 1.
  opacity?: number; // Default 1.
  color?: string;   // Default: series color.
}
```

Passing an object implementing `Approximation` in place of the string enables
a fully custom fitter without touching `ScatterChart.ts` — the literal
"swappable interface" ask.

---

## 7. Config surface — `ScatterChartConfig`

Mirrors `LineChartConfig` field-for-field except for the swapped `data`,
`line` → `marker`, and the new `approximation` block:

```ts
export interface ScatterChartConfig {
  data: MeshDataSet;
  grainDensity?: number;
  maxGrains?: number;
  /** Cloud radius grains scatter within per point, layout units. Default 0.02. */
  pointRadius?: number;
  colors?: string[];
  background?: string;
  grain?: { sizePx?: number; shape?: GrainShape; jitter?: number; settleJitter?: number };
  animation?: { /* identical shape to LineChartConfig.animation */ };
  interaction?: { hover?: { /* identical shape to line's */ } };
  axes?: { x?: AxisConfig; y?: AxisConfig };
  legend?: LegendConfig;
  title?: TitleConfig;
  currentValue?: CurrentValueConfig;
  /** Solid marker per point, revealed as particles fade; off by default. */
  marker?: MarkerStyleConfig;
  /** Trend/connector fit over the point cloud; off by default. */
  approximation?: ScatterApproximationConfig;
  fps?: FpsConfig;
  panZoom?: PanZoomConfig;
  backend?: BackendPreference;
}
```

`reflow`'s `'withLine'` option and `enter: 'continue'` (line-specific
semantics) get scatter-appropriate renames (`'withMarker'`, marker equivalents)
but the same three-way shape, so the mental model still transfers 1:1 from the
line chart docs.

---

## 8. Modules (SRP)

| file | responsibility |
| --- | --- |
| `core/data/mesh.ts` | `MeshValue`, `MeshPoint`, `MeshSeries`, `MeshDataSet` (new, additive) |
| `core/geometry/curve.ts` | Catmull-Rom/straight path tracing, extracted from `line/overlay.ts` |
| `core/approx/types.ts` | `Approximation`, `FitPoint` |
| `core/approx/{straight,spline,leastSquares}.ts` | built-in strategies |
| `core/particles/pack.ts` | `PointBlob`, `blobArea`, `blobGrainCounts`, `packBlobs` (additions) |
| `charts/scatter/types.ts` | `ScatterChartConfig`, `MarkerStyleConfig`, `ScatterApproximationConfig`, `ScatterMeta` |
| `charts/scatter/layout.ts` | `layoutScatter`: continuous x/y scales, `PointBlob[]`, per-point meta |
| `charts/scatter/markerStyle.ts` | `resolveMarkerStyle` (config → resolved, mirrors `lineStyle.ts`) |
| `charts/scatter/approximation.ts` | resolves `approximation` config to a concrete `Approximation`, runs `fit()` |
| `charts/scatter/overlay.ts` | cached marker glyph layer, approximation stroke, axes, current-value |
| `charts/scatter/ScatterChart.ts` | orchestration: lifecycle, build/morph, pointer, public API |

Lifecycle (`whenReady`/`update`/`add`/`remove`/`repour`/`getData`/`dispose`)
matches every other chart (LSP, `solid-principles` memory) — `update` takes
per-point patches keyed by `(seriesIndex, x, y)` since there's no `z` identity
to key on anymore; point identity for morphing falls back to array position
within its series, same fallback line already uses for points sharing an
x-slot.

---

## 9. Follow-ups (explicitly out of scope for this plan)

- **Color-by-`z.value`.** No sequential/diverging color-scale utility exists
  anywhere in the codebase (`core/util/color.ts` only has a fixed categorical
  palette). `MeshValue.value` is typed and threaded through hover metadata in
  this plan, but does **not** drive marker color yet. Building
  `core/scales`-style value→color mapping is its own plan, likely paired with
  the mesh chart that motivates it.
- **Mesh chart itself.** Doesn't exist yet anywhere in the codebase (confirmed
  zero references). This plan only makes `core/data/mesh.ts` and
  `core/approx/` reusable for it later.
- **Size-by-value.** Same story as color — no size-scale utility exists;
  `marker.size`/`sizes` are static, not data-driven, in this plan.
- `docs/scatter-chart.html`'s "Examples" section may want a "custom
  `Approximation`" snippet once the interface ships — nice-to-have, not
  blocking.

---

## 10. Playground demo

`playground/scatterchart.demo.ts`, cloning `linechart.demo.ts`'s pattern:
`ScatterChartDemo implements DemoComponent`, synthetic data generators
(clustered-random point clouds, optionally with a linear trend + noise to
exercise `leastSquares`), toolbar (re-pour/regenerate/reset/presets),
live-update buttons, a `GROUPS: ControlGroup[]` panel covering `marker`
(shape/size/color pickers), `approximation` (kind selector), plus everything
already shared with line (`grain`, `animation`, `axes`, `legend`, `title`,
`currentValue`, `interaction.hover`, `panZoom`).

Wiring: swap the disabled stub in `playground/registry.ts`
(`{ id: 'scatter', label: 'Scatter', disabled: true, ... }`, line 24) for the
real `scatterChartDemo` import, same as `lineChartDemo`/`pieChartDemo` above
it.

`examples/stackblitz-demo/` is secondary (it currently only demos the bar
chart, not even line yet) — not required for this plan, noted for parity only.

---

## 11. Docs

New `docs/scatter-chart.html`, cloning `docs/line-chart.html`'s structure
(constructor → config top-level → sub-block tables → "Shared blocks" pointer
back to bar-chart.html → methods → events → examples). Specifically documents
`marker`, `approximation`, `MeshValue`/`MeshDataSet` (linking to
`data-model.html` for the shared parts), and the continuous-axes behavior as
the explicit contrast with the line chart's slotted x.

Since there's no shared nav partial (each page hand-duplicates its sidebar),
updates needed in every existing page's `<nav class="nav-group"><h4>Visuals</h4>`
block: `index.html`, `bar-chart.html`, `line-chart.html`, `data-model.html`,
plus the new `scatter-chart.html` itself — add `<a href="scatter-chart.html">Scatter chart</a>`.

`index.html` roadmap/card updates: un-gray the "Scatter <span class='pill'>soon</span>"
nav link (line 28) and the "Area & Scatter" roadmap card (lines 61-66) — split
that card since Area isn't part of this plan, or reword it to "Scatter
(shipped) / Area (planned)".

`data-model.html`'s exported-symbols index gains `MeshValue`, `MeshPoint`,
`MeshSeries`, `MeshDataSet`, `Approximation` under a new "Mesh & approximation"
grouping.

---

## 12. Milestones

- **M1 — data model**: `core/data/mesh.ts`, dataset helpers for `MeshDataSet`
  (validate/resolveTypes/toNumeric equivalents), unit tests.
- **M2 — continuous layout**: `layoutScatter` using `core/scales` for both
  axes, `PointBlob[]` construction, per-point meta.
- **M3 — packing**: `PointBlob`, `blobArea`, `blobGrainCounts`, `packBlobs` in
  `core/particles/pack.ts` + tests (mirroring `packLine.test.ts`'s coverage
  style).
- **M4 — markers**: `core/geometry/curve.ts` extraction (+ line chart
  re-export swap, regression-tested against existing line snapshots),
  `markerStyle.ts`, cached glyph drawing for all 4 shapes.
- **M5 — approximation**: `core/approx/` (`straight`/`spline`/`leastSquares`),
  `Approximation` interface, custom-strategy pass-through.
- **M6 — chart**: `ScatterChart.ts` orchestration, lifecycle, hover/pointer,
  morph/reflow with position-based (not `z`-based) point identity.
- **M7 — playground + docs**: `scatterchart.demo.ts`, registry un-stub,
  `docs/scatter-chart.html`, nav/roadmap updates across existing doc pages.

---

## 13. Risks / gotchas

- **Breaking `Point.z` for other charts** → avoided entirely by keeping
  `MeshDataSet`/`MeshPoint` additive in `core/data/mesh.ts`; `core/data/types.ts`
  is untouched. Verify with a diff review before merge — zero lines changed
  there is the acceptance bar.
- **Extracting `traceTop` out of `line/overlay.ts` regresses the line chart** →
  extract behind the existing line-chart test/visual coverage first, land the
  extraction as its own isolated commit before adding any scatter-specific
  code on top, so a regression is bisectable to exactly that change.
- **`leastSquares` on a near-vertical cloud** (all points at ~same `x`) →
  degenerate slope; guard the closed-form solve the same way `LinearScale`
  guards a zero-span domain (pad/clamp rather than divide by ~0).
  Add a unit test for this deliberately, not just for the reference/happy path — a plan that only tests the golden path won't catch it.
- **Asterisk/triangle glyph cost at high point counts** → cache `Path2D` per
  (shape, size) pair, not per point (§4c); verify against `plans/09-render-performance.md`'s
  budget methodology before landing.
- **Series identity without `z`** → morph/reflow keys on `(seriesIndex, index
  within series)`; a point insert/remove *inside* a series shifts every
  later index's identity (same limitation line already has for points sharing
  an x-slot) — document this rather than silently mis-animating.
- **Cross-chart coupling** → `core/data/mesh.ts`, `core/approx/`,
  `core/geometry/curve.ts` are the only new shared surfaces; scatter itself
  imports nothing from `charts/bar|line|pie/`.
