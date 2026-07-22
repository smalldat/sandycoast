# Plan 02 — Axes, Current Value & Legend

Status: **PROPOSED**
Package: `@smalldat/visual`
Depends on: Plan 01 (v0 sand bar chart, as-built)

> Adds chart *chrome* — axes (with ticks), a positionable legend, and a
> current-value readout — around the existing sand grains. All three are
> **config-driven** and off by default (backward compatible with v0). Text and
> lines are **not** drawn by the grain backend (WebGPU/Canvas2D draw points
> only); they live on a thin **Canvas2D overlay** + a DOM legend layer.

---

## 1. Goals

1. **Axes** — x and y, each independently `on/off`, with `ticks` (frequency /
   count) and tick labels; optional axis label + grid lines.
2. **Current value** — a readout of the value under focus, either **following
   the mouse pointer** or **pinned** to an edge (left/right/top/bottom). Reuses
   the existing `hover` event hook — the hook stays public and unchanged.
3. **Legend** — series swatch+label list, **positionable** left / right / top /
   bottom.
4. Everything configured via `BarChartConfig` (see §7). Zero config → renders
   exactly as v0 does today.

---

## 2. The load-bearing change: a plot rect (margins)

Today grains map layout space `[0,1]` **directly to the full canvas**
(`BarChart`/renderers). Axes, tick labels, and an edge legend need **gutters**;
so the plot area must shrink to an inset rectangle and the grains must map into
*that* rectangle, not the whole viewport.

**Decision: introduce a `plotRect` — one source of truth shared by grains and
overlay.** Margins are computed in **device px** (label/legend sizes are px, not
fractions of canvas), then expressed to the renderer as a normalized rect.

```ts
// core/render/types.ts — added to FrameUniforms
/** Inset the layout [0,1] box maps into, normalized [x0,y0,x1,y1], y-up. */
plotRect: [number, number, number, number];   // default [0,0,1,1] = v0 behavior
```

Mapping becomes `device = mix(plotRect.xy, plotRect.zw, layout)`:

- **WebGPU** (`shader.wgsl.ts`): apply `plotRect` in the vertex stage before the
  `p*2−1` clip transform. New `vec4` in the uniform block. *(Watch reserved
  keywords — see Plan 01 §12; name it `plot` not `rect`/`in`/`out`.)*
- **Canvas2D** (`renderer.ts`): `px = (x0 + tmp.x*(x1−x0))*w`,
  `py = (1 − (y0 + tmp.y*(y1−y0)))*h`.
- Default `[0,0,1,1]` keeps every existing call byte-identical.

`BarChart` owns margin computation: given which axes/legend are enabled and
their measured sizes, produce `plotRect`. Recompute on resize and on
config/data change. The **overlay canvas uses the same `plotRect`**, so axis
lines/ticks and grains stay pixel-aligned.

> Alternative considered: bake insets into `layoutBars` output (normalized).
> Rejected — margins are px-sized (tick label widths), which normalize
> incorrectly across canvas sizes and couple layout to chrome.

---

## 3. Overlay architecture

```
el
├─ <canvas> grains   (WebGPU or Canvas2D)   — z0
├─ <canvas> overlay  (Canvas2D, always)     — z1  axes, ticks, gridlines, current-value
└─ <div>    legend   (DOM)                   — z2  positionable, flexbox
```

- Overlay `<canvas>` sits on top, `pointer-events: none`, same DPR/resize path
  as the grain canvas. Owned by a new `Overlay` class.
- **Axes/current-value on canvas** (crisp lines, px-precise, follows pointer per
  frame). **Legend as DOM** — trivial edge positioning + wrapping + future
  interactivity/a11y; it also *consumes* margin so it reduces `plotRect`.
- Overlay redraw is cheap and only when needed: on resize, data/config change,
  and — for a pointer-following current value — on pointer move. Static axes
  don't redraw every rAF.

New files:

```
src/charts/bar/axis.ts       AxisModel builder (tick values → positions + labels)
src/charts/bar/overlay.ts    Overlay class: draws axes/ticks/gridlines/current-value
src/charts/bar/legend.ts     DOM legend: build/position/update/dispose
src/charts/bar/chrome.ts     ChromeConfig types + resolve() (axes/legend/currentValue)
src/charts/bar/axis.test.ts  tick placement, formatting, count/off cases
```

---

## 4. Axis model (feed the overlay from the scales)

`layoutBars` already builds a `LinearScale` (y) and the x band internally, then
throws them away. Expose that so the axis renderer knows tick **values and their
layout positions**.

```ts
// charts/bar/axis.ts
export interface AxisTick { value: Scalar; pos: number; label: string; } // pos in [0,1]
export interface AxisModel { x: AxisTick[]; y: AxisTick[]; }

export function buildAxes(ds, layout, cfg): AxisModel;
```

- **y ticks:** `LinearScale.ticks(count)` (already exists, nice 1/2/5 steps).
  `count` from `axes.y.ticks`. `pos = yScale.scale(v) * PLOT_HEIGHT`.
- **x ticks:** for `category` → one tick per band, `pos = band center`
  (`BandScale.center` already exists; today x layout is hand-rolled in
  `layout.ts` — refactor to return centers, or reuse `BandScale`). For
  `number`/`time` → `scale.ticks(count)`.
- `ticks: false` → axis drawn (line only) with no ticks; `ticks: n` → ~n ticks;
  omitted → sensible default (5 for y, all categories / auto for x).
- `tickFormat?(value) => string` hook; default = `String(v)` (numbers via a
  compact formatter).

**Refactor:** `layoutBars` returns the scales (or a small `{ xScale, yScale,
xValues }`) alongside `{ bars, metas }` so `buildAxes` and the overlay reuse the
*exact* scale the grains used — no drift between bars and ticks. `PLOT_HEIGHT`
becomes shared between layout and axis.

---

## 5. Current value (keep the hook)

The `hover` hit-test and `chart.on('hover', …)` event are **unchanged and stay
public**. Current-value display is an *additional* overlay consumer of the same
`hoveredBarId`/`BarMeta`.

```ts
currentValue?: {
  show?: boolean;                          // default false
  mode?: 'pointer' | 'left'|'right'|'top'|'bottom';  // default 'pointer'
  format?: (bar: BarMeta) => string;       // default `${x} · ${z} = ${y}`
  showGuide?: boolean;                      // dashed line to axis, default true
}
```

- `mode: 'pointer'` → small label follows the cursor near the hovered bar
  (clamped inside `plotRect`); hides on `pointerleave`. Overlay redraws on
  pointer move.
- `mode: <side>` → label pinned to that edge, updates text on hover; static
  position. On no hover, shows nothing (or a placeholder).
- Optional guide line from the bar top to the value axis.
- Values come straight from the existing `BarMeta` (`xValue`, `yValue`,
  `seriesKey`) — no new hit-testing.

---

## 6. Legend (DOM, positionable)

```ts
legend?: {
  show?: boolean;                          // default false
  position?: 'left'|'right'|'top'|'bottom';// default 'bottom'
  align?: 'start'|'center'|'end';          // default 'center'
  swatch?: 'disc'|'square';                // default matches grain shape
}
```

- Built from `seriesKeys(ds)` + resolved `palette` (already available). One
  swatch (colored) + label per series.
- Positioned by absolutely placing the legend `<div>` on the chosen edge inside
  `el` (which is `position: relative`); flex row (top/bottom) or column
  (left/right); `align` maps to `justify-content`.
- **Reserves margin:** the legend's measured extent (its box size on its edge)
  is subtracted from the plot area → feeds `plotRect` computation in §2. Measure
  after mount (`getBoundingClientRect`), then recompute `plotRect`.
- Rebuilt on data change (series may change); repositioned on resize.
- Future (out of scope): click-to-toggle series visibility — DOM makes this
  easy later.

---

## 7. Config surface (additions to `BarChartConfig`)

```ts
// charts/bar/types.ts (new optional blocks; all default off/no-op)
axes?: {
  x?: AxisConfig;
  y?: AxisConfig;
};
legend?: LegendConfig;         // §6
currentValue?: CurrentValueConfig;  // §5

interface AxisConfig {
  show?: boolean;              // default false
  ticks?: number | false;     // count (~) or false = line only
  tickFormat?: (v: Scalar) => string;
  label?: string;             // axis title
  gridLines?: boolean;        // default false
  color?: string;             // default subdued from theme
  fontPx?: number;            // default 11
}
```

Resolved in a `resolveChrome(cfg)` (mirrors existing `resolve()` in
`BarChart.ts`) → a `Resolved` chrome struct the `Overlay`/`Legend` read.

Playground (`playground/main.ts`) gets toggles to exercise every axis on/off,
tick count, legend side, and current-value mode.

---

## 8. BarChart wiring

- Constructor: create overlay canvas + legend div next to the grain canvas.
- `boot`: after first layout, `buildAxes`, mount legend, measure, compute
  `plotRect`, draw overlay once.
- `resizeCanvas`: also resize overlay to same px/DPR; recompute `plotRect`
  (label + legend sizes are px, so margins are resize-stable); redraw overlay;
  reposition legend.
- `buildGrains`/`update`: rebuild axis model + legend (series/domain may
  change), recompute `plotRect`, redraw overlay.
- `onPointerMove`/`onPointerLeave`: if current-value is pointer-mode (or any
  edge mode), redraw overlay with the new hovered bar. (Hover event still emits
  as today.)
- `uniforms()`: include `plotRect`.
- `dispose`: remove overlay canvas + legend div.

---

## 9. Milestones

- **M1 — plotRect refactor** ⬜: add `plotRect` to `FrameUniforms`; apply in
  WebGPU shader + Canvas2D; default `[0,0,1,1]`; verify v0 output unchanged.
- **M2 — Overlay + axes** ⬜: `Overlay` class, `buildAxes`, expose scales from
  `layoutBars`; draw x/y lines, ticks, tick labels, gridlines; axis on/off +
  tick count config. Tests for tick placement/format.
- **M3 — Current value** ⬜: pointer-follow + fixed-edge readout off the hover
  hook; optional guide line.
- **M4 — Legend** ⬜: DOM legend, four positions + align, margin reservation
  feeding `plotRect`.
- **M5 — Wire + demo + polish** ⬜: config plumbing, playground toggles, DPR/
  resize correctness, dispose/leak check, README + this plan's as-built.

M1 is the prerequisite; M2–M4 are independent once the plot rect exists.

---

## 10. Risks / gotchas anticipated

- **WGSL reserved keywords** (Plan 01 §12): name the new uniform `plot`, not
  `rect`/`in`/`out`/`target`. Mis-name → silent blank canvas.
- **DPR / overlay alignment:** overlay canvas must use the *same* DPR and size
  as the grain canvas or ticks drift from bars. Share the resize path.
- **Margin ↔ legend feedback:** legend size determines margin, margin determines
  plot rect — measure legend after mount, then compute rect (one pass; avoid a
  layout loop).
- **`PLOT_HEIGHT` duplication:** currently only in `layout.ts`; axis y-positions
  must use the same constant → hoist to a shared spot.
- **Backward compat:** every new config block optional and default-off; a v0
  call must produce identical pixels (guard with the existing screenshot check).
- **Text on canvas vs a11y:** overlay text isn't selectable/AT-visible. Fine for
  v1; if a11y matters later, mirror labels into off-screen DOM. Legend already
  DOM.
```