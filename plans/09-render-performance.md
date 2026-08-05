# Plan 09 — Render Performance at High Point Counts

Status: **AS-BUILT** (§1–§4) + **PROPOSED** (§5)
Package: `@smalldat/sandycoast`
Depends on: Plan 01 (sand rendering), Plan 03 (bar borders/fill)

> A 5,000-point, 3-series line chart ran at 16–28 FPS and drew visibly sparse
> sand. Two unrelated causes: the grain budget collapsed as point count grew,
> and the Canvas2D overlay re-rasterized its whole solid layer every frame.
> Both are fixed. This plan records what changed and what is still open.

---

## 1. Grain budget was coupled to point count

### The defect

`lineGrainCounts` asked for grains per segment (`density × arcLength ×
thickness`), summed, then clamped with `Math.floor(n * scale)`. Two failures
compounded:

- **Demand scaled with sampling.** On noisy data, polyline arc length grows
  roughly linearly with sample count, so more points asked for more grains
  through the same shape.
- **The clamp starved every segment.** Once each share fell below 1, flooring
  zeroed nearly all of them.

At the reported settings (density 1.4, thickness 0.03, 15,000 segments):

```
raw/seg = round(1.4 * 0.3 * 0.03 * 1e4) = 126
total   = 126 * 15000                   = ~1.89M
scale   = 10000 / 1.89M                 = 0.0053
floor(126 * 0.0053) = 0                 <- every average segment
```

Only unusually steep segments survived to 1, so the chart drew a small fraction
of its budget, bunched on the spiky parts. The same settings at 10 points never
hit the clamp and looked dense — `grainDensity` meant different things at
different data sizes.

### The fix

Budget is a function of density alone; geometry only decides how it is shared.

| Symbol | Location | Meaning |
|---|---|---|
| `GRAINS_AT_UNIT_DENSITY` | [pack.ts:47](../src/core/particles/pack.ts#L47) | Total grains at `grainDensity === 1` (20,000) |
| `grainBudget(opts)` | [pack.ts:50](../src/core/particles/pack.ts#L50) | `min(maxGrains, round(density × GRAINS_AT_UNIT_DENSITY))` |
| `distribute(total, weights)` | [pack.ts](../src/core/particles/pack.ts) | Largest-remainder apportionment |

`distribute` floors every share, then hands leftovers to the largest fractional
remainders, ties broken by index so packing stays deterministic. It guarantees
`sum(result) === total` exactly, and spreads the shortfall evenly instead of
concentrating it.

Both call sites route through it:

| Function | Weight |
|---|---|
| `grainCounts` (bars) | bar area (`width × height`) |
| `lineGrainCounts` (lines) | segment arc length |

Consequences worth knowing:

- `grainDensity` now means the same thing on bar and line charts.
- `lineThickness` no longer affects grain *count* — a thicker ribbon spreads the
  same grains wider. Thickness is a look knob; density is the cost knob.
- Resampling the same curve at 10× the point count leaves the sand unchanged.

## 2. Overlay re-rasterized the solid layer every frame

### The defect

With the `highlight` hover effect on, the pointer being inside the plot repaints
the overlay every frame — but only the *style* differs between those frames.

For lines, a noisy 5k-point area fill is a self-intersecting ~10k-vertex
polygon. Nonzero-winding scanline fill sorts thousands of edge crossings per
scanline, every scanline, three series deep, to change a colour.

An intermediate attempt cached the traced `Path2D` and did **not** fix it: a
`Path2D` caches path *construction*, not *rasterization*, and rasterization is
where the time goes. Recording this because it is the non-obvious part.

### The fix — pre-rasterized layers

Each series (lines) or the whole bar set (bars) is rasterized once into an
offscreen canvas at gain 1 and its configured per-layer opacity. A steady-state
frame becomes one `drawImage`.

```ts
ctx.globalAlpha = s.solid;                            // reveal factor
if (gain !== 1) ctx.filter = `brightness(${gain})`;   // hover highlight (lines)
ctx.drawImage(layer.canvas, layer.left, layer.top);
```

`brightness()` multiplies rgb and leaves alpha alone — the same semantics as the
old per-draw rgb gain, so highlighting is visually unchanged.

**Cache key** (a mismatch forces a re-render): `geomVersion`, canvas size, plot
rect, view transform, dpr, and the fill/border/line style fields. `geomVersion`
is a counter on the chart, bumped in `buildGrains` and on every `applyMorph`
tick, so the overlay learns about geometry changes without diffing metas.

**Sizing.** Layers cover the plot rect plus stroke/border bleed, not the whole
canvas — roughly 2.9 MB per series instead of 12 MB at 2699×1185. Canvases are
reused across rebuilds and released in `dispose()`.

**Bars needed a different hover path.** The highlight tints a *single bar*, not a
whole series, so a filter over the composite won't do. `drawBars` patches only
the bars whose hover weight exceeds `HOVER_EPSILON` — one on the way in, at most
one more easing out:

```ts
ctx.beginPath();
ctx.rect(L - bw, T - bw, R - L + bw * 2, B - T + bw * 2);
ctx.clip();                          // don't chew into a neighbour
ctx.clearRect(L, T, R - L, B - T);   // drop the baked-in copy
this.paintBar(ctx, s, m, dx, dy, dpr, gain, s.solid, 0, 0);
```

The clip matters at high slot counts, where bars go sub-pixel and touch. A shared
`paintBar` serves both the layer render and the live patch so the two cannot
drift apart. Hover is O(hovered bars), not O(all bars).

`PieChart` was built against this pattern and already carries it.

## 3. Smaller wins on the same path

| Change | Where | Why |
|---|---|---|
| Spline → `lineTo`, round joins → bevel/butt below 3px point spacing | `line/overlay.ts` `SPLINE_MIN_SPACING_PX` | Control points land inside one pixel; curve flattening and round joins on 5k segments are not free. Visually identical at that density. |
| Pointer events set `overlayDirty`; the RAF loop draws | `BarChart` / `LineChart` | Events fire faster than the display refreshes; each used to trigger a full repaint. |
| `hitTest` binary-searches a per-series x index | `LineChart` | Was scanning all 15,000 points per pointer event. Index invalidates on rebuild. |

## 4. Zoom model: sand scales with the content

Hover jitter and the baked scatter offset were each divided by the view scale in
the shader and multiplied back by the view transform, holding a **constant pixel**
amplitude at any zoom. Zooming in therefore shrank the sand relative to the
content: a bar ten times wider kept the same few-pixel shimmer and the same
absolute grain spread, so the effect read as fading out.

Both compensations were removed. Jitter and scatter live in layout space like the
rest of the geometry, so zoom magnifies the sand along with the bars and lines.
Grain **size** stays in device pixels — grains do not balloon, only their spread
and shimmer scale.

That left the per-grain scatter offset with no consumer, so `offX`/`offY` came
out of `GrainBuffer` entirely:

| | Before | After |
|---|---|---|
| Instance floats/grain | 10 | 8 |
| `arrayStride` | 40 | 32 |
| Shader instance locations | 1–5 | 1–4 |

A fifth off the buffer uploaded on every data change, and `evalGrain` lost its
`viewX`/`viewY` parameters.

## 5. Open work

Ordered by expected value.

### 5.1 Pan/zoom drag and morph re-rasterize per frame

The layer cache keys on the view transform, so dragging or zooming invalidates it
every frame and pays the full old cost. `onViewChange` → `drawOverlay` directly.

Two candidate approaches:
- **Transform the cached bitmap during the gesture**, re-rasterize on release.
  Cheap, slightly soft while dragging.
- **Decimate during the drag only**, full detail on release.

Morph has the same shape but is bounded by `morphDuration`, so it matters less.

### 5.2 `GRAINS_AT_UNIT_DENSITY` calibration

20,000 was a starting guess and it re-bases what every existing `grainDensity`
value means. It has not had a deliberate visual pass against the defaults across
bar/line/pie.

### 5.3 Bar `hitTest` is a linear scan

[BarChart.ts](../src/charts/bar/BarChart.ts) still scans every meta per pointer
event. It has an early return and now runs once per frame rather than once per
event, so it has not shown up — but the line chart's sorted x index is the
obvious fix if it does.

### 5.4 Min/max decimation

Only pays past roughly 2 points per device pixel. At the sizes tested (5k points
over ~2600 device px ≈ 1.9 pt/px) it buys nothing, which is why it was skipped.
Revisit if point counts climb or plots get narrow.

### 5.5 Canvas2D grain fallback

[canvas2d/renderer.ts](../src/core/render/canvas2d/renderer.ts) still evaluates
every grain on the CPU per frame, with a palette-outer-loop that rescans
`g.count` once per colour. Mitigated by grouped `fillStyle` and an early bail
when fully faded, but it remains the slow path — thousands of grains are fine,
tens of thousands are not. Untouched by this plan.

---

## 6. Test coverage

Added to `pack.test.ts` / `packLine.test.ts`:

- `distribute`: sum preservation, proportionality, the 10k-slots/1000-units
  starvation case, zero-weight fallback, determinism under ties, empty input.
- Invariance regressions: totals do not move with bar count or with the point
  count sampling the same curve.
- The dense noisy-line case that used to under-spend its budget now spends it
  exactly.

`anim.test.ts` was rewritten for §4 — lerp, wobble decay, and layout-space
positioning replace the two cases that asserted the old constant-on-screen
scatter.

**Not covered by any automated test:** WGSL does not compile during
`typecheck`/`build`, so shader edits are only structurally verified. A shader
error surfaces at runtime as `[webgpu] uncaptured error` with an empty chart.
Plan 08 (E2E) is where this gap closes.

---

## 7. Shipped in

| PR | Contents |
|---|---|
| #7 | §1 grain budget + `distribute`, §2 line layers, §3 |
| #8 | §2 bar layers, playground slot-count control, §4 zoom model |
