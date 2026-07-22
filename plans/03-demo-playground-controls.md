# Plan 03 — Demo Playground: Component Nav & Live Controls

Status: **AS-BUILT**
Package: `@smalldat/visual`
Depends on: Plan 01 (v0 sand bar chart), Plan 02 (axes/legend/current-value)

> Rebuilds the dev playground from a fixed single-chart page with toggle buttons
> into a **component gallery**: a left nav to pick which visual to demo, and a
> right-hand **control panel** that exposes *every* `BarChartConfig` property as a
> natural input (slider / dropdown / textbox / color / checkbox) instead of
> cycle-buttons. Dev-only — nothing here ships in `dist/`.

---

## 1. Goals

1. **Left nav** — list of demoable components. Only **Bar chart** is live today;
   Line / Area / Scatter appear grayed as placeholders so adding a component is a
   one-line registry entry.
2. **Natural controls** — replace the old toggle buttons (shape, legend side,
   value mode cycled on click) with real inputs, one per customizable property:
   sliders for ranges, dropdowns for enums, textboxes for free text, color
   pickers for colors. Checkboxes remain **only** where the property is a true
   boolean.
3. **Extensible** — a declarative control spec drives DOM generation, so a new
   component just supplies its own spec + build/rebuild.

Non-goal: no library source changes. `BarChartConfig` is the contract; the
panel only reads/writes it.

---

## 2. Layout

CSS grid (`index.html`) — nav + chart on top row, **full-width controls panel**
spanning the bottom row:

```
┌────────────┬────────────────────────────────────────────┐
│  #nav      │  #host (chart column)                      │
│ COMPONENTS │  ┌──────────────────────────────────────┐  │
│ ▸ Bar chart│  │             chart canvas             │  │
│  Line…     │  └──────────────────────────────────────┘  │
│  Area…     │  [Re-pour] [Random data]                   │
│  Scatter…  │  backend: … · hover: …                     │
├────────────┴────────────────────────────────────────────┤
│  #panel  (CONTROLS — multi-column, no scroll)            │
│  Grain&render │ Animation │ Hover │ X axis │ Y axis │ …  │
│               ┆           ┆       ┆        ┆        ┆    │
└──────────────────────────────────────────────────────────┘
      ┆ = column-rule light separator between columns
```

- `#nav` — component registry buttons; active highlighted, disabled grayed.
- `#host` — canvas mount + **data toolbar** (Re-pour / Random) + status + hover
  readout.
- `#panel` — generated control groups laid out **across the full width** in a CSS
  multi-column flow.

### Multi-column controls (widescreen, scroll-free)

Grid is now 2 columns × 3 rows: `head` / (`nav` `main`) / `panel panel`. The
panel is a **bottom bar spanning both columns** instead of a narrow 320px right
rail — targeting wide screens where a single tall column forced vertical
scrolling.

Panel CSS uses CSS multi-column layout so groups flow into as many columns as the
width allows:

```css
#panel {
  columns: 230px;                        /* col-width → count auto by width */
  column-gap: 28px;
  column-rule: 1px solid #1e2430;        /* light separator BETWEEN columns only */
  max-height: 42vh; overflow-y: auto;    /* safety scroll if window is short */
}
.ctl-group { break-inside: avoid; }      /* never split a group across columns */
```

- `column-rule` draws the light vertical separator between columns only (not at
  the outer edges) — no manual per-group borders / `:nth-child` edge-casing.
- `columns: 230px` = column-*width*; the browser packs as many 230px columns as
  fit and balances the groups, so on a wide screen all 7 groups sit side-by-side
  without vertical scrolling. `break-inside: avoid` keeps each group intact.
- `max-height: 42vh` + `overflow-y: auto` is a fallback only — on a short/narrow
  window the panel scrolls rather than eating the chart.

---

## 3. Files (all under `playground/`)

| File | Role |
| --- | --- |
| `index.html` | grid scaffold (nav+chart row, full-width multi-column controls bar) + all CSS (dark theme, matches lib) |
| `main.ts` | Builds nav from registry; mount/unmount active component |
| `registry.ts` | `DemoComponent` interface + `COMPONENTS[]` list |
| `controls.ts` | `Control`/`ControlGroup` types + `renderControls()` spec→DOM generator |
| `barchart.demo.ts` | Bar chart: default config, control spec `GROUPS`, build/rebuild, data actions |

### `DemoComponent` (registry contract)

```ts
interface DemoComponent {
  id: string;
  label: string;
  mount(host: HTMLElement, panel: HTMLElement): void;
  unmount(): void;      // dispose chart, clear listeners
  disabled?: boolean;   // placeholder → grayed in nav
}
```

Adding a component = implement this + push into `COMPONENTS`.

---

## 4. Control generator (`controls.ts`)

Declarative spec, no per-control wiring in the demo:

```ts
type Control =
  | { kind: 'slider';    label; path; min; max; step }
  | { kind: 'number';    label; path; min?; max?; step? }
  | { kind: 'select';    label; path; options: {value;label}[] }
  | { kind: 'checkbox';  label; path }
  | { kind: 'color';     label; path }
  | { kind: 'text';      label; path }
  | { kind: 'checkgroup';label; path; options: string[] } // multi-set → string[]
  | { kind: 'colorlist'; label; path; count };            // fixed-len string[]
```

- `path` is a **dotted path** into the config object (`"axes.y.ticks"`,
  `"interaction.hover.jitterAmp"`). `getPath`/`setPath` walk/create it.
- `renderControls(mount, cfg, groups, onChange)` mutates `cfg` **in place** and
  fires `onChange` on every edit.
- Sliders show a live tabular value readout.

---

## 5. Property → control map (bar chart)

Every `BarChartConfig` field, grouped:

| Group | Property | Control |
| --- | --- | --- |
| **Grain & render** | `grainDensity` | slider 0.1–2 |
| | `maxGrains` | number 1k–300k |
| | `grain.sizePx` | slider 0.5–6 |
| | `grain.shape` | select disc/quad |
| | `grain.jitter` | slider 0–1 |
| | `grain.settleJitter` | slider 0–0.1 |
| | `background` | color |
| | `colors[]` | colorlist ×3 (series) |
| | `backend` | select auto/webgpu/webgl2/canvas2d |
| **Animation** | `animation.duration` | slider 100–3000 (**ms**, see §7) |
| | `animation.stagger` | slider 0–2000 |
| | `animation.ease` | select linear/easeOutCubic/easeOutQuint |
| **Hover** | `interaction.hover.effects` | checkgroup highlight/jitter |
| | `interaction.hover.highlightGain` | slider 1–3 |
| | `interaction.hover.jitterAmp` | slider 0–0.05 |
| | `interaction.hover.fadeMs` | slider 0–600 |
| **X / Y axis** | `axes.{x,y}.show` | checkbox |
| | `axes.{x,y}.ticks` | number 0–20 |
| | `axes.{x,y}.gridLines` | checkbox |
| | `axes.{x,y}.label` | text |
| | `axes.{x,y}.fontPx` | slider 8–20 |
| | `axes.{x,y}.color` | color |
| **Legend** | `legend.show` | checkbox |
| | `legend.position` | select bottom/top/left/right |
| | `legend.align` | select start/center/end |
| | `legend.swatch` | select disc/square |
| **Current value** | `currentValue.show` | checkbox |
| | `currentValue.mode` | select pointer/top/right/bottom/left |
| | `currentValue.showGuide` | checkbox |
| | `currentValue.color` | color |

Checkboxes used **only** for genuine booleans (`show`, `gridLines`, `showGuide`)
and the multi-set `effects` group. Everything else is slider / dropdown / text /
color per the brief.

**Bar fill/border have no color control** — both always paint the bar's **series
color**; only `opacity` (and border sides/width) is configurable. There is no
color or inherit toggle to expose.

---

## 6. Rebuild model

`BarChartConfig` is **construct-time** — the chart reads config once in its
constructor. So a config edit disposes the chart and news a fresh one:

```
control onChange → mutate cfg in place → rebuild(): chart.dispose(); build()
```

**Data** is separate from config: Re-pour / Random data call `chart.update(data)`
live (grains morph, no rebuild). Switching components in the nav calls
`unmount()` (dispose) on the old, `mount()` on the new.

---

## 7. Notes / gotchas

- **`animation.duration` units** — the config JSDoc says *seconds* but v0 code and
  the old playground pass `1100` and treat it as **ms**. Panel labels it **ms** to
  match observed behavior. If the doc is the source of truth, fix the lib and
  relabel here.
- `colors` default seeded from `DEFAULT_PALETTE` first three (`#e8598b`,
  `#8bc4e8`, `#e8c45a`); color inputs require hex, so seed hex not names.
- `exactOptionalPropertyTypes` + construct-time config: the demo holds `cfg` as a
  loose `Record<string, unknown>` and spreads `{ ...cfg, data }` into the
  constructor to avoid fighting the strict optional types for a dev-only tool.

---

## 8. Verification (as-built)

- `npm run typecheck` — clean (playground is in `tsconfig` `include`).
- `npm run lint` — clean (Biome; format applied).
- `npm run dev` — Vite serves + transforms all playground modules (200, no
  transform errors).
- Browser runtime (WebGPU/Canvas2D render) not driven headless — eyeball via
  `npm run dev` at `http://localhost:5199`.
