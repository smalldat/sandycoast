# Plan 11 — Series dimming on legend click

Status: **AS-BUILT** (M1–M6, M7 playground) + **PROPOSED** (docs pages)
Package: `@smalldat/sandycoast`
Depends on: Plan 02 (axes/legend/current value), the existing per-point hover-weight
machinery in `BarChart`/`LineChart`/`PieChart`/`ScatterChart` (`hoverWeights` +
`FrameUniforms.hoverOpacity`/`highlightGain`), Plan 10 (scatter chart, for parity)

> Click a legend entry: that series (or, on the pie chart, that slice) stays at
> full opacity: everything else in the chart dims. Click the same entry again
> (or call the new API method) to clear it and restore every series. Off by
> default, opt-in via one config field, so no existing chart's behavior or
> screenshot changes.

---

## 1. Goals

1. **Click-to-isolate on the legend.** Clicking a legend entry dims every
   other series/slice; clicking the isolated entry again clears it. Exactly
   one entry can be isolated at a time (no multi-select in this plan — see
   §9).
2. **One opt-in parameter.** `legend.interactive?: boolean` (default `false`).
   A legend that doesn't set it renders and behaves exactly as it does today
   — inert, `pointer-events: none`, no click affordance. This is the
   "introduce a parameter" ask.
3. **One public API method per chart**, so isolation can be driven
   programmatically (a filter checkbox, a URL param, a test) without
   synthesizing a click: `focusSeries(index: number | null)` /
   `getFocusedSeries(): number | null`, on `BarChart`, `LineChart`,
   `PieChart`, `ScatterChart`. Clicking the legend and calling `focusSeries`
   are the same code path — one emits from a DOM event, the other is called
   directly — so they always agree and both fire the new `seriesFocus` event.
4. **Same visual language on all four charts**, reusing the *existing*
   per-point weight/opacity pipeline (`hoverWeights` → `FrameUniforms` →
   shader/canvas2d) rather than inventing a second one, plus the equivalent
   dim in each chart's solid overlay layer (bar border/fill, line
   stroke/fill, pie wedge, scatter marker) — sand and solid dim together.
5. **Zero behavior change when unused.** `legend.interactive` defaults to
   `false`; `interaction.dim` has no effect unless it's on. Every existing
   e2e scenario and visual-regression screenshot stays byte-identical.

---

## 2. UX / semantics

| Chart | Legend entry represents | What gets dimmed |
| --- | --- | --- |
| Bar | one series (`legendEntries()` = `seriesKeys(data)`) | every bar whose `BarMeta.seriesIndex` ≠ focused |
| Line | one series (same `seriesKeys` mapping) | every vertex/segment whose `LineMeta.seriesIndex` ≠ focused |
| Scatter | one series (`MeshDataSet.series[i]`) | every point blob whose `ScatterMeta.seriesIndex` ≠ focused |
| Pie | one **slice** of the currently displayed series (`legendEntries()` = `metas.map(m => m.xValue)`) | every other slice of that series |

Pie is the one chart where "series" (the slider dimension) and "legend entry"
(a slice/category) are different axes. `focusSeries` on `PieChart` is
therefore documented as addressing **the slice index within the currently
displayed series**, matching what its legend already shows — not the
slider's series. This keeps the method name and signature identical across
all four charts (uniform public API beats a pie-specific method name), at
the cost of one doc note explaining the index's meaning there.

Click semantics:
- Click entry `i` while nothing is focused → focus `i` (dim the rest).
- Click entry `i` while `i` is already focused → clear (focus `null`).
- Click entry `j ≠ i` while `i` is focused → switch focus straight to `j`
  (no intermediate "all clear" frame).
- `focusSeries(null)` / clicking with `legend.interactive` off always shows
  everything at full opacity — the pre-existing behavior.

---

## 3. Config surface

New field on the shared `LegendConfig` (`core/chrome/types.ts`), picked up by
every chart's config the same way `show`/`position`/`align`/`swatch` already
are:

```ts
export interface LegendConfig {
  show?: boolean;
  position?: Side;
  align?: 'start' | 'center' | 'end';
  swatch?: 'disc' | 'square';
  /**
   * Click an entry to isolate it — every other series/slice dims to
   * `interaction.dim.opacity`. Click the isolated entry again to clear it.
   * Default false (the legend stays presentational, exactly as today).
   */
  interactive?: boolean;
}
```

Tuning lives next to `interaction.hover`, the existing precedent for
behavioral (as opposed to presentational) config:

```ts
interaction?: {
  hover?: { /* unchanged */ };
  /** Isolation effect driven by `legend.interactive` / `focusSeries()`. */
  dim?: {
    /** Opacity of dimmed series/slices, 0..1. Default 0.15. */
    opacity?: number;
    /** Ease in/out time, ms — mirrors `hover.fadeMs`. Default 200. */
    fadeMs?: number;
  };
};
```

`ResolvedLegend` (`core/chrome/chrome.ts`) gains `interactive: boolean`;
`resolveChrome()` resolves it the same way as the other legend fields
(`cfg.legend?.interactive ?? false`). `interaction.dim` is resolved per chart
inside each chart's existing `resolve(cfg)` (same place `hoverOpacity`/
`highlightGain` are resolved today), not in `resolveChrome`, since it's
chart-instance state (dim *target*) rather than static chrome layout.

---

## 4. Legend component (`core/chrome/legend.ts`)

- Constructor takes an optional `onEntryClick?: (index: number) => void`.
  Only wired up by the chart when `cfg.interactive` is true — an inert legend
  gets no listeners, same DOM as today.
- When interactive: root keeps `pointer-events: none` (unchanged — it must
  not steal pointer events from the canvas at large) but each entry `<span>`
  gets `pointerEvents: 'auto'`, `cursor: 'pointer'`, `role="button"`,
  `tabIndex=0`, and a `click`/`keydown` (Enter/Space) listener calling
  `onEntryClick(i)`. This is additive to the existing per-entry DOM built in
  `setEntries()` — no restructuring.
- New `setFocus(index: number | null): void` — toggles an `aria-pressed`
  attribute and an opacity/font-weight style on each entry (dim the label of
  every non-focused entry, matching the chart's own dim) without rebuilding
  the entry list. Called by the chart after every focus change (click or
  API), and again at the top of `setEntries()` if focus should survive a
  data rebuild (see §7 — it does, by index, until the index is out of range).

---

## 5. Grain (sand) rendering — reuse `hoverWeights`' shape, add a parallel channel

The existing hover pipeline is a single per-point weight buffer
(`hoverWeights: Float32Array`) plus scalar knobs (`highlightGain`,
`hoverJitterAmp`, `hoverOpacity`) that are eased on the CPU every frame
(`easeHoverWeights`) and consumed identically by the WebGPU shader and the
Canvas2D fallback. Dimming needs to compose *with* hover, not replace it (a
user can still hover inside the focused series), so it is a **second,
independent weight buffer**, not a repurposing of `hoverWeights`:

- `FrameUniforms` (`core/render/types.ts`) gains:
  - `dimWeights: Float32Array` — per-point, eased 0..1, 1 = dimmed.
  - `dimOpacity: number` — target alpha multiplier for a fully-dimmed point
    at `dimWeights=1` (the resolved `interaction.dim.opacity`).
- **WebGPU is a near-zero-cost change.** `Uniforms.d` (`shader.wgsl.ts`)
  already reserves three unused floats (`d.y`/`d.z`/`d.w`, currently written
  as `0` in `renderer.ts`) — `dimOpacity` slots into `d.y` with no struct
  layout change. The only new binding is a second `storage, read` buffer
  (`dimW : array<f32>`) at `@binding(3)`, uploaded exactly like `hoverBuf`
  (`renderer.ts`'s `ensureBuffers`/`hoverBuf` block gets a `dimBuf` sibling).
  Fragment color becomes
  `alpha = hoverAlpha * mix(1.0, dimOpacity, dimW[u32(ids.y)])`.
- **Canvas2D** (`canvas2d/renderer.ts`): same `alpha` composition,
  `const dw = u.dimWeights[g.barId[i]!] ?? 0; const alpha = (opOn ? fade + (u.hoverOpacity - fade) * w : fade) * (1 + (u.dimOpacity - 1) * dw);`.
- Each chart's per-frame ease loop (`easeHoverWeights` in
  `BarChart`/`LineChart`/`PieChart`/`ScatterChart`) gets a sibling
  `easeDimWeights`, identical shape: target is `1` for every point whose
  `seriesIndex` (bar/line/scatter) or slice position (pie) is not the
  focused one, `0` otherwise (or unconditionally `0` when nothing is
  focused). `dimWeights` is resized alongside `hoverWeights` in
  `buildGrains`/`buildBlobs`/`buildWedges` (same `Float32Array` resize +
  copy-forward pattern already there for `hoverWeights`).

This is deliberately **not** a rename/repurpose of `hoverOpacity` — that
knob lerps the *hovered* point up (or down) from `grainFade`; dimming needs
an independent, persistent (not proximity-eased-to-zero-on-leave) multiplier
that composes underneath whatever hover is doing.

---

## 6. Solid overlay layer (border/line/wedge/marker)

Each chart's `overlay.ts` already threads a per-meta `alpha` into its solid
paint routine, driven by the same hover state:

- Bar (`charts/bar/overlay.ts`, `paintBar(ctx, s, m, dx, dy, dpr, gain, alpha, ...)`)
- Pie (`charts/pie/overlay.ts`, same `gainedRGBA(m.color, gain, fill.opacity * alpha)` shape)
- Line (`charts/line/overlay.ts`) and Scatter (`charts/scatter/overlay.ts`)
  analogously scale their stroke/marker alpha per series.

The dim multiplier folds into that existing `alpha` computation at the call
site in each `OverlayState`/paint loop: `alpha *= focused === null ||
seriesIndexOf(m) === focused ? 1 : dimOpacity`. No new drawing code paths —
one extra factor where alpha is already computed per meta, in all four
overlays.

---

## 7. Per-chart wiring

Each of `BarChart`/`LineChart`/`PieChart`/`ScatterChart` gets:

- `private focusedSeries: number | null = null;`
- `private handleLegendClick = (i: number): void => { this.setFocus(i === this.focusedSeries ? null : i); };`
  passed as `onEntryClick` when constructing `Legend`, only if
  `this.chrome.legend.interactive`.
- `private setFocus(index: number | null): void` — sets `focusedSeries`,
  calls `this.legend?.setFocus(index)`, and emits `seriesFocus`. No redraw
  call needed for the grain layer (the render loop already calls
  `renderer.frame(this.uniforms(now))` unconditionally every rAF tick, same
  as today's hover weights); the overlay's `overlayDirty` flag is set so the
  solid layer repaints on the next frame.
- Public API:
  ```ts
  /** Isolate one series (dim every other series/slice); `null` clears it.
   *  Mirrors clicking that entry's legend, and fires the same `seriesFocus` event. */
  focusSeries(index: number | null): void
  /** Currently isolated series index, or `null`. */
  getFocusedSeries(): number | null
  ```
- New event: `seriesFocus: { index: number | null }` added to each chart's
  `Events` map (alongside `hover`, and `seriesChange` on `PieChart`).
- Focus survives a data rebuild by index (`refreshChrome`/`buildGrains` etc.
  don't reset it), but is clamped to `null` if the rebuilt series count
  shrinks past it — same defensive clamp `PieChart.seriesIndex` already
  applies on data changes.
- `dispose()` needs no new cleanup beyond what `Legend.dispose()` already
  does (its click/keydown listeners go with the removed DOM).

---

## 8. Modules touched (SRP)

| file | change |
| --- | --- |
| `core/chrome/types.ts` | `LegendConfig.interactive` |
| `core/chrome/chrome.ts` | `ResolvedLegend.interactive`, resolved in `resolveChrome` |
| `core/chrome/legend.ts` | `onEntryClick` ctor param, per-entry click/keydown wiring, `setFocus()` |
| `core/render/types.ts` | `FrameUniforms.dimWeights`, `FrameUniforms.dimOpacity` |
| `core/render/webgpu/shader.wgsl.ts` | `dimW` storage binding, `d.y` = `dimOpacity`, alpha composition |
| `core/render/webgpu/renderer.ts` | `dimBuf` upload (mirrors `hoverBuf`), write `d[21] = u.dimOpacity` |
| `core/render/canvas2d/renderer.ts` | alpha composition with `dimWeights`/`dimOpacity` |
| `charts/bar/types.ts`, `.../line/types.ts`, `.../pie/types.ts`, `.../scatter/types.ts` | `interaction.dim` config, re-export `LegendConfig` (already re-exported — no signature break) |
| `charts/bar/BarChart.ts`, `.../line/LineChart.ts`, `.../pie/PieChart.ts`, `.../scatter/ScatterChart.ts` | `focusedSeries` state, `easeDimWeights`, `focusSeries`/`getFocusedSeries`, `seriesFocus` event, legend wiring |
| `charts/bar/overlay.ts`, `.../line/overlay.ts`, `.../pie/overlay.ts`, `.../scatter/overlay.ts` | fold dim multiplier into existing per-meta `alpha` |
| `src/index.ts` | no new exports needed — `focusSeries`/`getFocusedSeries` are chart instance methods, `LegendConfig`/`interaction` types are already exported per chart |

---

## 9. Explicitly out of scope

- **Multi-series isolation** (select several, dim the rest). `focusedSeries`
  is a single `number | null`. A `Set<number>` upgrade is a natural
  follow-up but changes the API shape (`focusSeries` → `focusSeries(indices:
  number[] )`), so it's left for a later plan rather than guessed at now.
- **"Toggle visibility" instead of "dim".** This plan dims (reduced alpha,
  point stays hit-testable and present); it does not remove the series from
  the dataset/layout or skip its grain budget. A true show/hide toggle would
  touch grain packing (`lineGrainCounts`/`blobGrainCounts`/etc.) and is a
  different feature with different perf tradeoffs.
- **Persisting focus across chart re-instantiation** (e.g. playground
  settings persistence, Plan 04's mechanism) — the playground demo wiring in
  §11 exposes a control, not persistence.

---

## 10. Tests

**Unit (vitest, pure logic — no canvas/renderer):**
- `core/chrome/chrome.test.ts` (new or extend existing chrome tests if any):
  `resolveChrome` defaults `legend.interactive` to `false`; resolves `true`
  when set.
- A small pure helper extracted for the dim-target computation (e.g.
  `dimTarget(seriesIndex: number, focused: number | null): 0 | 1`) is
  trivial enough to unit test directly rather than only through a chart
  instance — add it to `core/chrome/` (or co-locate per chart if the
  series/slice indexing differs enough not to share one function; pie's
  slice-position vs bar/line/scatter's `seriesIndex` may end up as two thin
  variants, not one shared function — decide during implementation once the
  four call sites are side by side).
- Extend each chart's existing `legendEntries()`-adjacent tests (if any) —
  otherwise this is the first legend-behavior test in the repo, so check
  during implementation whether `legendEntries()` has any existing coverage
  to extend rather than duplicate.

**E2E (Playwright, `e2e/`):**
- Add an `Act` variant to `e2e/scenarios/types.ts`:
  `{ kind: 'clickLegend'; index: number }` (click the nth legend entry by DOM
  order — the harness page needs the legend actually in the DOM, which it
  already is since `Legend` is a real DOM layer, not canvas-drawn).
- New scenario(s) (or extend `bar-basic`/`line-basic`/`pie-basic` with
  `legend: { show: true, interactive: true }` and extra steps), asserting:
  - clicking an entry fires `seriesFocus` with the right index;
  - clicking it again fires `seriesFocus` with `null`;
  - `minInk` drops after focusing (dimmed series paint less opaque — a
    coarse but real pixel-level check that dimming actually rendered,
    following this suite's existing "ink" convention for pixel assertions);
  - deterministic-across-mounts check (already run generically by
    `component.spec.ts` for every registered scenario) still holds with
    focus applied mid-script.
- A `focusSeries()`-driven scenario step (`{ kind: 'call'; method:
  'focusSeries'; args: [1] }` or similar, if the harness doesn't already
  support calling arbitrary chart methods — check `e2e/harness/main.ts`
  first) verifying the programmatic path produces identical output to the
  click path, since §1 goal 3 claims they're the same code path.
- Pie's scenario specifically: assert the isolated index dims *slices*, not
  the slider's series, per §2.

---

## 11. Playground + docs

- `playground/*.demo.ts` (bar/line/pie/scatter): add `legend: { show: true,
  interactive: true }` to a control group, plus a small readout showing
  `getFocusedSeries()` and a "clear focus" button calling `focusSeries(null)`
  — mirrors how the pie demo likely already surfaces `seriesChange`.
- `docs/*.html` (bar/line/pie/scatter-chart.html): `legend.interactive` row
  in the legend config table, `interaction.dim` row in the interaction
  table, `focusSeries`/`getFocusedSeries` in the methods table,
  `seriesFocus` in the events table. Four pages, same shape of edit each —
  no shared nav partial in this repo (per Plan 10 §11), so each is a
  separate hand-edit.

---

## 12. Milestones

- **M1 — config + chrome**: `LegendConfig.interactive`, `ResolvedLegend`,
  `interaction.dim` config + resolution in all four chart `types.ts`/
  `resolve()`. Unit tests for the resolution defaults.
- **M2 — legend interactivity**: `Legend` click/keydown wiring, `setFocus()`
  visual state on the legend DOM itself.
- **M3 — render layer**: `FrameUniforms.dimWeights`/`dimOpacity`, WebGPU
  shader + buffer, Canvas2D alpha composition. Verify with a manual
  before/after screenshot on one chart (bar) before wiring the rest — this
  is the one change that touches both backends and is worth isolating.
- **M4 — grain wiring x4**: `focusedSeries` state, `easeDimWeights`,
  `focusSeries`/`getFocusedSeries`, `seriesFocus` event, on
  Bar/Line/Pie/Scatter.
- **M5 — solid overlay dim x4**: fold the dim multiplier into each chart's
  existing per-meta `alpha` in its `overlay.ts`.
- **M6 — e2e + unit tests**: `clickLegend` harness action, scenario
  coverage per §10.
- **M7 — playground + docs**: demo controls, docs tables, per §11.

---

## 13. Risks / gotchas

- **Hover and dim fighting visually.** A dimmed-but-hovered point: hover's
  `highlightGain`/`hoverOpacity` still apply on top of the dim multiplier
  (§5's composition is deliberately multiplicative, not either/or) — a
  hovered point inside a dimmed series will still look dimmed-but-brightened
  rather than fully dimmed. Worth a deliberate visual check in M3 rather
  than assuming the multiply "just works" — a hovered *and* dimmed grain at
  `dimOpacity=0.15`, `hoverOpacity=1` could still read as too bright; may
  need `interaction.hover` to skip non-focused series entirely while a focus
  is active (i.e., hit-test/hover ignores dimmed points) — decide once M3's
  visual check is in.
- **Pie's index meaning is not what the method name implies elsewhere.**
  `focusSeries` means "series" on three charts and "slice-of-the-active-
  series" on the pie. Documented in §2/§9, but this is the one spot a
  consumer reading only the TSDoc across all four charts could reasonably
  get confused — the per-chart doc comment must say so explicitly, not just
  the plan.
- **Legend entry index vs. chart-internal index drift.** `legendEntries()`
  order must stay the single source of truth for what index `n` means
  (already true today — nothing new breaks here, but the click handler's
  `i` comes from DOM child order in `setEntries()`, so a future change to
  `setEntries()`'s iteration order would silently desync clicks from
  series — worth a one-line comment at the click wiring site pointing back
  at `legendEntries()`).
- **WebGPU buffer growth.** `dimBuf` follows `hoverBuf`'s exact
  grow-only-on-demand pattern (`hoverCap`) — reuse that, don't reallocate
  every frame.
- **Zero behavior change bar.** Because `legend.interactive` defaults false
  and `dimWeights` defaults to an all-zero array, `dimOpacity` defaults such
  that `mix(1, dimOpacity, 0) === 1` regardless of its value — but confirm
  `FrameUniforms.dimOpacity`'s *default when unset* still resolves to a
  harmless value (e.g. `1`, not `0`) so a chart that never touches the new
  config can't accidentally zero out every grain if some call site forgets
  to pass it. Same class of bug §5 avoids for `hoverOpacity` via its `< 0 =
  disabled` sentinel — consider the same sentinel convention here instead of
  relying on `dimWeights` staying all-zero.
