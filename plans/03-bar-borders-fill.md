# Plan 03 — Bar Borders & Fill (particle → solid reveal)

Status: **AS-BUILT** (M1–M4 landed)
Package: `@smalldat/sandycoast`
Depends on: Plan 01 (v0 sand bar chart), Plan 02 (chrome / overlay / plotRect)

> Adds an optional **solid layer** per bar — a configurable **fill** and
> **border** (per-side) — that **fades in as the sand particles fade out**. The
> effect: grains pour in and settle (as today), then dissolve while a crisp
> solid bar resolves in their place. Fade timing is a **parameter**. All
> config-driven and **off by default** (a v0/Plan-02 call renders identically).

---

## 1. Goals

1. **Fill** — solid rectangle per bar. Always the bar's **series color**; only
   `opacity` is configurable.
2. **Border** — per-side selectable (`left` / `top` / `right` / `bottom`) with a
   shared `width` (px) and `opacity`. Always the bar's **series color**.
3. **Reveal transition** — as the particle animation ends, particles **fade
   out** and fill+border **fade in**, over a window whose **start and duration
   are parameters**. Grains' end opacity is configurable (default fully gone).
4. Everything via `BarChartConfig` (see §7). Zero config → renders exactly as
   Plan 02 does today.

---

## 2. Where fill & border are drawn: the overlay, not the grain backend

The grain backends (WebGPU / Canvas2D) draw **points only** — adding
rectangles/strokes would mean new geometry + WGSL in **two** backends. The
**Canvas2D overlay** (Plan 02, `overlay.ts`) already:

- sits **on top** of the grain canvas (correct z-order for a solid that resolves
  *over* dissolving grains — reads as the shape solidifying),
- shares the **same `plotRect`** + DPR as the grains (pixel-aligned),
- has the layout→device-px transforms (`dx`/`dy`) and draws rects + lines.

**Decision: draw fill + border on the overlay**, once per bar from `metas`
(which already carry `x0`, `x1`, `height`, `color`). One implementation, backend-
independent, crisp at any DPR.

> The one cost: during the reveal window the overlay must redraw **every frame**
> (it is event-driven today). Handled in §5 — driven from the rAF loop only
> while the reveal is in progress, then it goes quiet again.

### 2a. Overlay must mount without chrome

Today the overlay only mounts when `chrome.any`. Bars/fill can be used with **no
axes/legend**. Change the mount condition (and `Overlay.draw`'s early-return) to
`chrome.any || barStyle.enabled`. Draw order inside `Overlay.draw`: **fill →
border → axes/ticks/gridlines → current-value** (chrome sits above the solid).

---

## 3. Particle fade-out: one new uniform

Grains need a global opacity multiplier. There is a **free reserved slot** in the
uniform block — `shader.wgsl.ts` packs `d[7]` as `(unused)` today.

```ts
// core/render/types.ts — added to FrameUniforms
/** Global grain opacity multiplier in [0,1]; 1 = opaque (default), 0 = gone. */
grainFade: number;   // default 1 = byte-identical to today
```

- **WebGPU** (`shader.wgsl.ts` + `webgpu/renderer.ts`): write `grainFade` into the
  reserved `d[7]`; in `vs`, `vo.color = vec4(base.rgb * gain, base.a * grainFade)`.
  (Premultiplied-alpha `src-alpha over` blend already fades grains over the
  background correctly.) *No new uniform vec4, no bind-group change.*
- **Canvas2D** (`canvas2d/renderer.ts`): multiply the per-grain alpha in
  `rgbaCss` by `u.grainFade` (add a `fade` arg, thread it through the two
  `fillStyle` sets).
- Default `grainFade = 1` → identical pixels to Plan 02.

> Chosen over a per-grain fade attribute: the fade is uniform across all grains
> and time-driven, so a single scalar is enough and costs nothing per grain.

---

## 4. Reveal timing model (the parameter)

One scalar `reveal ∈ [0,1]` drives both directions, computed each frame in
`BarChart` from `now`:

```
fadeStart = reveal.start === 'afterPour'
              ? duration + stagger          // pour+settle finished
              : reveal.start (seconds)
p         = clamp((now - fadeStart) / revealDuration, 0, 1)
r         = ease(p, reveal.ease)            // reuse core ease()
grainFade = mix(1, reveal.grainsTo, r)      // 1 → grainsTo (default 0)
solidAmt  = r                                // fill/border alpha *= r
```

- `reveal.start`: `'afterPour'` (default) or an absolute seconds offset from
  animation start. `'afterPour'` = `duration + stagger` (the pour+settle end).
- `reveal.duration`: fade window in **ms** (default e.g. 500).
- `reveal.grainsTo`: grain end-opacity (default `0` = disappear; set `>0` to
  keep a sand texture under the solid).
- `reveal.ease`: reuse the existing `Easing` union (`anim.ts`).

Pure, testable: extract `revealFactor(now, {fadeStart, duration, ease})` → covered
in a unit test (before window = 0, after = 1, monotonic, easing endpoints).

> `update()` (morph) restarts `startTime`, so the reveal re-runs on data change —
> grains re-pour, solid re-resolves. Desired. Hover still works during/after
> reveal (hover jitter uses its own amplitude; fine even as grains fade).

---

## 5. Overlay redraw scheduling

Fill/border need per-frame redraw **only while `solidAmt ∈ (0,1)`** (mid-fade),
plus the existing event-driven redraws (resize / data / pointer). Add to the
`BarChart` rAF `loop()`:

```
const solid = this.solidAmt(now);
if (barStyle.enabled && solid !== this.lastSolid) { this.drawOverlay(); this.lastSolid = solid; }
```

- Before `fadeStart`: `solid = 0`, overlay draws bars at alpha 0 (nothing) — one
  draw, then quiet.
- During fade: `solid` changes each frame → redraw. Bounded window.
- After: `solid = 1`, settles, stops redrawing until the next event.

`drawOverlay()` passes the new state (`metas`, `solidAmt`, resolved `barStyle`)
into `Overlay.draw`.

---

## 6. Overlay drawing (fill + per-side border)

```ts
// overlay.ts — new private drawBars(s), called first in draw()
for (const m of s.metas) {
  const L = dx(m.x0), R = dx(m.x1), B = dy(0), T = dy(m.height);   // device px
  // fill
  if (fill.on && solid > 0) {
    ctx.globalAlpha = fill.opacity * solid;
    ctx.fillStyle = css(m.color);
    ctx.fillRect(L, T, R - L, B - T);
  }
  // border: stroke only the enabled sides, width in px*dpr
  if (border.any && solid > 0) {
    ctx.globalAlpha = border.opacity * solid;
    ctx.strokeStyle = css(m.color);
    ctx.lineWidth = border.width * dpr;
    ctx.beginPath();
    if (border.top)    { ctx.moveTo(L, T); ctx.lineTo(R, T); }
    if (border.bottom) { ctx.moveTo(L, B); ctx.lineTo(R, B); }
    if (border.left)   { ctx.moveTo(L, T); ctx.lineTo(L, B); }
    if (border.right)  { ctx.moveTo(R, T); ctx.lineTo(R, B); }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
```

- Color per bar is always `m.color` (the series color the grains use) → solid
  matches the sand it replaces. Not configurable; only opacity is.
- Border sides default: all `false` unless the user opts in (or a `border` block
  present with no sides → default all four true; decide in resolve, §7).
- Half-pixel crispness: offset stroke coords by `0.5*lineWidth` for odd widths if
  needed (match the axis-spine approach already in overlay).

---

## 7. Config surface (additions to `BarChartConfig`)

```ts
// charts/bar/types.ts — new optional block, default off/no-op
bars?: BarStyleConfig;

interface BarStyleConfig {
  fill?: {
    opacity?: number;   // 0..1, default 1 — always the series color
  };
  border?: {
    left?: boolean; top?: boolean; right?: boolean; bottom?: boolean;
    width?: number;     // px, default 1
    opacity?: number;   // 0..1, default 1 — always the series color
  };
  /** Reveal fill/border while particles fade out. */
  reveal?: {
    start?: 'afterPour' | number;  // seconds; default 'afterPour'
    duration?: number;             // ms, default 500
    ease?: Easing;                 // default 'easeOutCubic'
    grainsTo?: number;             // grain end-opacity, default 0
  };
}
```

Resolved in a `resolveBarStyle(cfg)` (new `barStyle.ts`, mirrors
`resolveChrome`) → a `ResolvedBarStyle` with an `enabled` flag
(`fill.on || border.any`) that gates overlay mount (§2a) and the reveal loop.

**Side defaults:** if `border` present but no side flags set → all four true
(sensible "outline the bar"); if any flag set → only those. `fill` present →
series color at opacity 1.

---

## 8. BarChart wiring

- Constructor: `this.barStyle = resolveBarStyle(config)`; mount overlay when
  `chrome.any || barStyle.enabled` (§2a).
- `uniforms(now)`: add `grainFade: this.grainFade(now)` (§4).
- `loop()`: compute `solidAmt`; redraw overlay while it changes (§5).
- `drawOverlay()`: pass `metas`, `barStyle`, `solidAmt` into `Overlay.draw`
  (extend `OverlayState`).
- `buildGrains`/`update`: `startTime` reset already re-arms the reveal — just
  ensure `lastSolid` is reset so the first post-update frame redraws.
- No change to `dispose` (overlay already torn down).

---

## 9. Milestones

- **M1 — grain fade uniform** ⬜: add `grainFade` to `FrameUniforms`; wire
  reserved `d[7]` in WGSL + `webgpu/renderer.ts`; multiply alpha in Canvas2D;
  default `1` → verify pixels unchanged. Manual: force `grainFade` and watch
  grains fade.
- **M2 — overlay fill + border** ⬜: `barStyle.ts` (types + resolve), extend
  `OverlayState`, `drawBars` (fill + per-side stroke), mount overlay without
  chrome, draw order. Static (no reveal) render correct at DPR 1/2.
- **M3 — reveal transition** ⬜: `revealFactor` pure fn + test; `grainFade`/
  `solidAmt` from `now`; loop redraw scheduling; `'afterPour'` + absolute start,
  `grainsTo`, ease.
- **M4 — demo + polish** ⬜: playground toggles (fill on/off + opacity, each
  border side, width, reveal start/duration/grainsTo), README + as-built.

M1 is independent; M2 can land static; M3 needs M1+M2.

---

## 10. Risks / gotchas

- **Overlay redraw cost:** only redraw while `solidAmt` changes — don't couple
  the whole overlay to every rAF permanently (§5). Guard with `lastSolid`.
- **z-order:** solid is on the overlay, *above* grains. Intended (shape resolves
  over dissolving sand). If a user wants solid *under* grains, that's a future
  option (would need a second under-canvas or grain-backend geometry) — out of
  scope.
- **`grainFade` reserved slot:** `d[7]` is the documented reserved slot; no new
  uniform vec4, no bind-group/layout change → low WebGPU risk (Plan 01 §12
  keyword caveat doesn't apply, no new WGSL identifier).
- **Backward compat:** `bars` block optional; `grainFade` defaults `1`; overlay
  mount unchanged when `bars` absent → identical pixels to Plan 02.
- **Border half-pixel blur:** align odd-width strokes on half-pixels like the
  existing axis spines, or borders look fuzzy at DPR 1.
- **Fill over anti-aliased grains during fade:** both partially transparent
  mid-window; slight double-coverage at bar edges is visually fine (crossfade).
```