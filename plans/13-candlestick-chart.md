# Plan 13 — Candlestick chart (OHLC + live price)

Status: **IMPLEMENTED**
Package: `@smalldat/sandycoast`
Depends on: Plan 01 (sand rendering + morph), Plan 02 (axes/legend/current value),
Plan 05 (live data), Plan 09 (pie: the series slider), Plan 11 (series dimming),
`core/chrome/reveal.ts` (shared reveal ramp)

> A candlestick chart on the **same grain machinery as bar/line/pie/scatter**:
> sand pours into each candle's open-close **body** and resolves into a solid
> block, while the high-low **wicks** are stroked solid throughout. Colour comes
> from a configurable *difference rule* (rising vs falling), not from a series
> palette, and a dashed **live-price line** tracks the newest `actual`.
>
> Four structural decisions, each confirmed with the requester before building:
>
> 1. **`actual` is a live-price line.** A chart-wide horizontal rule at the
>    latest `Candle.actual` plus a price-axis marker — not a per-candle glyph.
> 2. **Series are a selector.** Two instruments cannot share an x-slot legibly,
>    so one series is drawn at a time and the pie chart's slider picks which.
> 3. **X spacing is configurable, band by default.** `'band'` collapses
>    non-trading days (standard trading-chart behaviour); `'time'` shows the
>    real gaps.
> 4. **Body sand, solid wicks.** Grains pack the body rect only; thin wicks read
>    badly as sparse sand and are the sole carrier of the high/low.

---

## 1. Goals

1. **Candles from sand.** Grains settle into each body, then a solid fill/border
   resolves on top using the exact `reveal` contract every other chart shares
   (`core/chrome/reveal.ts`).
2. **Configurable colour.** `candles.rising` / `candles.falling`, plus
   `candles.direction` choosing *which difference* decides the direction — with
   a caller-supplied function accepted in place of a built-in name (OCP).
3. **`actual` (live price).** Carried per candle, drawn as one line at the
   latest value, folded into the price domain so it never falls off screen.
4. **Same properties as every other chart** wherever the concept transfers:
   `grain`, `animation`, `interaction.hover`, `interaction.dim`, `axes`,
   `legend`, `title`, `currentValue`, `fps`, `panZoom`, `backend`, plus the
   pie chart's `slider` / `seriesIndex` / `maxSeries`.
5. **Overridable mouse events.** `interaction.pointer` replaces any built-in
   pointer reaction (hover, click, legend click, slider seek).
6. **Component isolation.** No import from `charts/bar|line|pie|scatter/`.
   Anything shared moves to `core/` first — see §6.
7. **Demo + docs parity.** A playground demo following the scatter demo's
   pattern, and a docs page following `docs/scatter-chart.html`'s.

---

## 2. Data model — `core/data/ohlc.ts` (new, additive)

`Point.y` is a single scalar and is consumed that way by four shipped charts, so
a candle gets an **additive sibling** rather than a breaking change — the same
reasoning that produced `core/data/mesh.ts` for scatter. `core/data/types.ts`
and `core/data/mesh.ts` are untouched.

```ts
interface Candle<X extends Scalar = Scalar> {
  x: X; open: number; high: number; low: number; close: number;
  /** Live / last traded price — orthogonal to `close`, drives the price line. */
  actual?: number;
}
interface CandleSeries<X extends Scalar = Scalar> { key?: Scalar; candles: Candle<X>[] }
interface OhlcDataSet<X extends Scalar = Scalar> { series: CandleSeries<X>[]; xType?: FieldType }
```

Plus `CandleRef` / `CandlePatch` for the array helpers. `core/data/dataset.ts`
gains the OHLC counterparts of the existing helpers: `allCandles`,
`resolveOhlcTypes`, `validateOhlc`, `patchCandles`, `appendCandles`,
`removeCandles` — all pure and exported, like `patchPoints` before them.
`patchCandles` applies only the fields a patch carries, which is the streaming
path (`{ x, close, actual }` and nothing else).

`validateOhlc` deliberately **tolerates a transposed high/low**: the layout
takes the wick extent from the min/max of all four prices, so bad input draws a
sensible candle rather than an inverted one.

---

## 3. Colour: the direction rule — `charts/candlestick/direction.ts`

`candles.direction` picks *which difference* decides rising vs falling. Every
backward-looking rule falls back to `openClose` for the first candle.

| kind | rising when |
| --- | --- |
| `openClose` (default) | `close >= open` |
| `closeClose` | `close >=` the **previous** candle's close |
| `lowHigh` | this candle's range **midpoint** >= the previous candle's midpoint |
| `closeInRange` | the close sits in the upper half of its own low-high range |
| `(candle, previous, index) => boolean` | anything the caller wants |

Its own module (SRP) so the rules are unit-testable without a chart, resolved
through one function (OCP) so a custom rule drops in where a name goes — the
same swappable-strategy shape as scatter's `Approximation`.

Consequence for the rest of the chart: the grain palette is **two entries**
(`[rising, falling]`, `colorIdx` 0/1) and the legend's two entries describe
those groups, so `legend.interactive` / `focusSeries(0|1)` isolates every rising
or every falling candle. That reuses Plan 11's dim machinery verbatim, and
matches the pie chart's precedent of `focusSeries` targeting the drawn marks
rather than the slider's series.

---

## 4. Geometry — `charts/candlestick/layout.ts`

`layoutCandles(ds, opts) -> CandleLayout` draws one series (`seriesIndex`,
clamped; `maxCandles`/`maxSeries` caps) into body `BoxRect[]` + `CandleMeta[]`.

- **Price scale.** `LinearScale` over the min/max of all four prices *and* the
  live price, padded 6% each side. A price axis has no meaningful baseline, so
  the domain pads itself instead of reserving headroom via `PLOT_HEIGHT`
  (same choice scatter made for its continuous axes).
- **X spacing.** `'band'`: slot `i` centres at `(i + 0.5)/n`. `'time'`: a
  continuous `LinearScale`/`TimeScale` padded by half a candle so the end
  bodies aren't sliced; the layout-space `step` is the median gap between the
  laid-out centres. A **categorical** x has no continuous position, so `'time'`
  degrades to `'band'` and the layout reports what it actually used.
- **Body.** `openClose` (classic, with wicks) or `lowHigh` (a range bar, no
  wick left to draw). A doji gets a `MIN_BODY` height so it still carries
  grains and draws a visible line.
- **Hit-testing.** `hitCandle` selects by **column** — anywhere in a candle's
  slot — the way a trading crosshair behaves, not by hitting the thin body.

---

## 5. Packing — `core/particles/pack.ts` additions

A candle body is a **free-floating** rect, unlike `BarRect` which always grows
from the baseline:

```ts
interface BoxRect { x: number; y: number; width: number; height: number; colorIdx: number; barId: number }
boxArea(b) / boxGrainCounts(boxes, opts) / packBoxes(boxes, counts, out, opts, offset?)
```

`packBars` and `packBoxes` now share one internal `packRects` grid loop
parameterised by the rect's bottom edge — the only thing that differed. Same
density-driven `grainBudget`, shared by area, so adding candles subdivides the
same sand.

---

## 6. Shared-code moves (component isolation)

The series slider was pie-local (`charts/pie/slider.ts`) and is now needed by a
second chart, so per the `component-isolation` memory it moved to
**`core/chrome/slider.ts`** — resolve/ticks/track/hit-test *and* the drawing
(`drawSlider`), which the pie overlay had inline. `charts/pie/slider.ts` stays
as a thin re-export so the pie chart's public surface is unchanged, and
`SliderConfig` moved to `core/chrome/types.ts` beside the other chrome config.

One behavioural addition: `sliderTrack` takes an `offsetPx` gutter. The pie
chart has no X axis, but a candlestick chart's period axis sits between the plot
and a bottom slider — without the offset the handle lands on the axis labels.

Axis *drawing* stays per-overlay, matching the existing precedent (bar, line,
scatter and pie each draw their own); axis *resolution* and tick formatting were
already shared in `core/chrome/`.

---

## 7. Modules (SRP)

| file | responsibility |
| --- | --- |
| `core/data/ohlc.ts` | `Candle`, `CandleSeries`, `OhlcDataSet`, `CandlePatch`, `CandleRef` |
| `core/data/dataset.ts` | OHLC validate/resolve/patch/append/remove helpers (additions) |
| `core/particles/pack.ts` | `BoxRect`, `boxArea`, `boxGrainCounts`, `packBoxes` (additions) |
| `core/chrome/slider.ts` | the series slider, moved out of `charts/pie/` |
| `charts/candlestick/types.ts` | config surface, `CandleMeta`, payloads |
| `charts/candlestick/direction.ts` | the colour rules |
| `charts/candlestick/layout.ts` | `layoutCandles`, `hitCandle` |
| `charts/candlestick/candleStyle.ts` | `resolveCandleStyle`, `resolveActual` |
| `charts/candlestick/axis.ts` | `buildAxes` (band or continuous X, price Y) |
| `charts/candlestick/overlay.ts` | wicks, solid bodies, live-price line, axes, slider, readout |
| `charts/candlestick/CandlestickChart.ts` | orchestration: lifecycle, build/morph, pointer, public API |

Lifecycle (`whenReady`/`update`/`add`/`remove`/`repour`/`getData`/`dispose`)
matches every other chart (LSP), plus the pie chart's series API
(`setSeriesIndex`/`getSeriesIndex`/`getSeriesKeys`/`seriesCount`) and the shared
`PanZoomable`.

**Morph identity is the period (`x`)**, not the array index. That is what makes
a rolling window animate correctly: dropping the oldest bar and appending a new
one shifts every index, but each surviving period keeps its identity, so
unchanged candles slide instead of being treated as removed-and-re-added.

---

## 8. Reveal, and why wicks are exempt

The body's `fill`/`border` resolve on the shared reveal ramp as the grains fade.
The **wicks do not**: they are the only carrier of the high/low prices, so they
are stroked solid from the first frame while the bodies are still falling sand.
That also means a config with no `fill` and no `border` is a *permanent* sand
chart with solid wicks — the most particle-forward look, and a preset in the
demo.

Consequence in the frame loop: an in-flight morph always repaints the overlay
(the wicks move with the candles), not only when the solid body layer is on.

---

## 9. Overridable mouse events

`interaction.pointer` takes `hover` / `click` / `legendClick` / `sliderSeek`.
Returning exactly `false` suppresses the chart's own default for that gesture
*and* the event it would have emitted; anything else (including nothing) lets it
run. Slider grabs also `stopImmediatePropagation()` so a drag on the handle
doesn't also drag-to-pan — which is why the chart's pointer listeners attach
**before** `PanZoomController.attach`.

---

## 10. Playground demo

`playground/candlestickchart.demo.ts`, cloning `scatterchart.demo.ts`'s pattern:
three synthetic instruments (random walk, weekends skipped so the band-vs-time
difference is visible), toolbar (re-pour/regenerate/reset/presets), a live bar
(**Tick price** patches the newest bar's `close`/`actual`; **Add candle** rolls
the window; **Next instrument**; continuous toggles), and a `GROUPS` panel
covering every config block. Presets: *Default*, *Sand only (no solid bodies)*,
*Range bars (low-high)*, *Close-to-close coloring*, *Real time gaps*.

Registered in `playground/registry.ts`, which also makes `#candlestick` a
working deep link.

---

## 11. Docs

`docs/candlestick-chart.html` cloning the scatter page's structure, plus:
`data-model.html` gains an **OHLC data** section and export-list entries;
`index.html` gains a card and roadmap text; every page's `Visuals` nav gains the
link (there is no shared nav partial).

---

## 12. Tests

- `charts/candlestick/direction.test.ts` — all four rules, the first-candle
  fallback, the flat-range degenerate case, custom-rule pass-through.
- `charts/candlestick/layout.test.ts` — slotting, body/wick extents, the doji
  minimum, transposed high/low, series selection + caps, the live price
  widening the domain, time spacing preserving gaps, categorical fallback,
  and column hit-testing.
- `core/data/ohlc.test.ts` — validation (including what it deliberately
  tolerates) and the pure array helpers.
- `core/particles/packBox.test.ts` — area weighting, the budget ceiling, grains
  staying inside a floating box, offset writes, determinism.

---

## 13. Risks / gotchas

- **Breaking `Point`/`MeshPoint`** → avoided; `core/data/ohlc.ts` is purely
  additive and neither existing model file was touched.
- **Regressing the pie chart via the slider move** → the extraction is
  behaviour-preserving (pie re-exports from core and calls the shared
  `drawSlider`); verified against the pie demo before candlestick code landed.
- **Slider colliding with the period axis** → `sliderTrack`'s `offsetPx`, fed
  from the chart's own axis-band accounting.
- **Slider drag also panning** → chart pointer handlers attach before pan/zoom's
  and stop immediate propagation on a grab.
- **A `TimeScale` cannot scale a raw number** → the time-spacing step is
  measured on the laid-out centres, never by re-scaling a synthetic x. (Caught
  by the layout test, not by types.)
- **Doji / zero-height bodies** → `MIN_BODY`, so they still get grains.
- **`barId` is `Uint16`** → `maxCandles` defaults to 5000, well inside it.

---

## 14. Follow-ups (out of scope)

- **Volume sub-panel.** A second, shorter plot below the price panel is its own
  layout problem (shared x, independent y) and its own plan.
- **Indicator overlays** (moving averages, Bollinger bands) — the direction rule
  already accepts a custom function, but drawing an indicator line on top of the
  candles is a separate layer.
- **E2E scenario.** The candlestick chart ships with unit tests only, matching
  the scatter chart; `e2e/scenarios/` would need a `candlestick` `ChartKind`.
