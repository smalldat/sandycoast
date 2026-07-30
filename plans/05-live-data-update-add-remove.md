# Plan 05 — Live data: `update` / `add` / `remove`

Status: **AS-BUILT**
Package: `@smalldat/sandycoast`
Depends on: Plan 01 (sand bar chart + morph), Plan 03 (bar fill/border reveal)

> Generic control methods to mutate a live chart **without a full re-pour**.
> `update` patches current values, `add` appends points, `remove` drops them.
> On every mutation the **border tweens smoothly** to the new geometry while the
> **sand particles morph** to indicate the change (added bars pour in from above,
> updated bars reshuffle their grains in place). Demo gains **Continuous update**
> and **Continuous addition** toggles.

---

## 1. Goals

1. **Update** — change y of existing points in place. No re-pour: the solid
   border/fill stay resolved and **tween** to the new bar heights; grains morph
   and briefly re-appear (grain-fade ramps back) so the change reads as motion.
2. **Add** — append points (new x-slots or new series bars). New bars **grow**
   from height 0 and their grains **pour from above**; existing bars slide to
   their new slot positions.
3. **Remove** — drop points by index or by `{x, z?}` match. Remaining bars
   reflow to fill the gap (border tweens, grains morph).
4. Backend-independent (border on the Canvas2D overlay, grains on the active
   backend), and it must not regress the initial pour or `bars`-off configs.

---

## 2. Public API (`BarChart`)

```ts
update(data: DataSet): void;        // replace the whole dataset (morph)
update(patches: PointPatch[]): void; // patch y of existing points in place
add(points: Point | Point[]): void;  // append
remove(refs: PointRef | PointRef[]): void; // drop by index or {x,z?}
repour(): void;                      // re-run the pour-in animation, same data
getData(): DataSet;                  // snapshot (deep-cloned points)
```

```ts
// core/data/types.ts
export type PointRef = number | { x: Scalar; z?: Scalar };   // negative index = from end
export interface PointPatch { x: Scalar; z?: Scalar; y: Scalar }
```

`update(data)` keeps its Plan-01 signature (full replace) and now routes through
the same morph transition. Overload dispatch: an **array** arg = patches, a
`DataSet` (`.points`) = replace.

### 2a. Pure data helpers (`core/data/dataset.ts`, unit-tested)

```ts
patchPoints(points, patches): Point[]   // clone; set y where x (+z if given) match
appendPoints(points, add): Point[]      // clone + concat
removePoints(points, refs): Point[]     // clone minus matched (index or {x,z?})
```

Matching mirrors the layout's keying: compare `String(p.x)` and `String(p.z)`;
`z` omitted matches every series at that x. Index refs accept negatives
(`-1` = last). All return **new arrays** so before/after snapshots are cheap.

---

## 3. Transition model — one shared progress drives grains + border

`buildGrains(data, mode)` where `mode ∈ 'pour' | 'morph'`.

- **pour** (constructor, `repour`): `scatterStarts` + reveal ramp from 0
  (unchanged Plan 01/03 behavior).
- **morph** (`update`/`add`/`remove`): grains keep their new packed **targets**
  but take **data-identity–matched starts**, and a **border tween** is armed.

Both reset the grain clock (`startTime`) so grains animate start→target via the
existing shader path. When exiting bars are present the buffer is sized
`presentGrains + ghostGrains`; present grains are packed as usual, ghosts are
appended from the old buffer with falling targets. Two decoupled reveal modes so
the border does *not* re-fade on morph:

```
revealState(now):
  morph & tween active → { solid: 1, grainFade: mix(1, grainsTo, e) }  // grains re-appear then settle
  morph & settled      → { solid: 1, grainFade: grainsTo }             // steady, border solid
  pour                 → Plan-03 ramp
  e = ease((now - morphStart) / morphDur, reveal.ease); morphDur = duration + stagger
```

### 3a. Grain starts by data identity — enter / move / exit (parametric)

Key `${x}\0${z}` per bar. Grains are assigned starts per bar so only added and
removed bars get a distinct animation; **unchanged bars just move**:

- **Unchanged / shifted bar** (K existed): grains map **1:1 by within-bar
  index** — grain *k* of the new bar starts from grain *k* of the old bar — so
  they **translate** to the new position instead of reshuffling. Configurable
  `animation.reflow`: `'translate'` (default, 1:1 slide with settle stagger) |
  `'reshuffle'` (old random flow) | `'withBar'` (rigid 1:1 with **zero delay**
  and **no grain-fade flash** — grains ride the border quietly so only added/
  removed particles indicate the change; `revealState` holds `grainFade` steady
  for this mode).
- **Added bar** (K new): `animation.enter = 'pour'` (default; fall from above) |
  `'rise'` (grow up from the base).
- **Removed bar** (K gone from the new layout): `animation.exit = 'fall'`
  (default) keeps that bar's old grains in the buffer as **ghosts** that fall
  off the bottom (`targetY < 0`) and fade with the global grain-fade, then are
  dropped on the next rebuild; `'vanish'` = instant (no ghosts).

Ghost grains carry `barId = 0` (a safe hover index — both backends tolerate any
id) and have no `meta`, so they are never hit-tested. All timings share
`animation.morphDuration` (ms; default `duration + stagger`).

### 3b. Border tween (overlay)

Snapshot each bar's box `{x0,x1,height}` keyed by identity **before** rebuild.
For each new bar: `to` = new box; `from` = old box by key, or `{…new x, height:0}`
when added (grow up). Each frame while morphing, lerp `from→to` with `ease` and
**write into `metas`** (so overlay draw, hit-test, and current-value all use the
tweened geometry), redraw the overlay, and snap to `to` at `p≥1`. Only armed
when `barStyle.enabled` (no border/fill ⇒ nothing to tween; grains still morph).

---

## 4. BarChart wiring

- Store `this.data` (source of truth); `getData()` deep-clones it.
- `buildGrains`: capture old metas/grains, build new layout, choose starts by
  `mode`, arm `this.morph` (when enabled), set `revealMode`, reset clock.
- `loop()`: if `this.morph` → `applyMorph(now)` + redraw every frame until it
  clears; else the Plan-03 `solid !== lastSolid` guard.
- `uniforms()`: `grainFade` from `revealState` (morph ramp).
- `hoverWeights` already resize to bar count; stale hovered id self-heals on
  next pointer move.

---

## 5. Demo (playground)

Second toolbar row "Live data":

- Buttons: **Update values** (patch all points to new random y), **Add slot**
  (append a new x with a bar per series; cap at 14, dropping the oldest),
  **Remove last** (remove the last x-slot).
- Toggles: **Continuous update** (patch every 900 ms), **Continuous addition**
  (add a slot every 1400 ms, capped). Intervals cleared on toggle-off and
  `unmount`. `rebuild()` reads `chart.getData()` first so live edits survive a
  settings change.

---

## 6. Milestones

- **M1 — data helpers + types** ✅: `PointRef`/`PointPatch`, `patchPoints`/
  `appendPoints`/`removePoints`, exports, unit tests.
- **M2 — morph transition** ✅: `mode` param, identity-matched grain starts,
  border tween, `revealState` morph branch, loop redraw.
- **M3 — public API** ✅: `update` overload, `add`, `remove`, `repour`,
  `getData`.
- **M4 — demo + docs** ✅: live toolbar + continuous toggles, README + as-built.

---

## 7. Risks / gotchas

- **Border must not re-fade on update** → separate `revealMode`; morph holds
  `solid = 1`. Guarded so `bars`-off configs are byte-identical.
- **Overlay redraw cost** → only every frame while a morph tween is active, then
  quiet again (same discipline as Plan 03's reveal window).
- **Demo/chart data divergence** → chart owns the data; `rebuild()` pulls
  `getData()` before disposing so a config edit mid-stream keeps live points.
- **Removed-bar grains vanish instantly** (no exit fade) — acceptable v1; a
  ghost-buffer exit is a future option.
