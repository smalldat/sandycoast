# @smalldat/visual

High-performance visual components rendered as **points/sand** — no SVG.
First component: a sand bar chart where thousands of grains pour in and settle
into bars. WebGPU-first, Canvas2D fallback.

### ▶ Live demo: **[sandycoast.smalldat.com](https://sandycoast.smalldat.com/)**

Interactive playground — tweak grain density, animation, bars, and live data in
the browser. No install needed.

**Docs:** full property reference and examples live at the
[documentation site](https://smalldat.github.io/sandycoast/) (a static
GitHub Pages site). **License:** dual-licensed — free for non-commercial use, paid
commercial license for revenue-generating organizations. See
[LICENSE](https://github.com/smalldat/sandycoast/blob/main/LICENSE) and the
[License page](https://smalldat.github.io/sandycoast/license.html).

## Install / dev

```bash
npm install
npm run dev        # playground at http://localhost:5199
npm test           # unit tests (data, scales, packing, layout)
npm run typecheck
npm run build      # tsup -> dist/ (ESM + d.ts)
npm run lint       # biome
```

## Quick start

```ts
import { BarChart } from '@smalldat/visual';

const chart = new BarChart(document.querySelector('#el')!, {
  data: {
    points: [
      { x: 'Q1', y: 120, z: 'EU' },
      { x: 'Q1', y: 90, z: 'US' },
      { x: 'Q2', y: 140, z: 'EU' },
    ],
  },
  grainDensity: 0.9,
  grain: { sizePx: 2.4, shape: 'disc' },   // 'disc' | 'quad'
  animation: { duration: 1100, stagger: 700, ease: 'easeOutCubic' },
  interaction: { hover: { effects: ['highlight', 'jitter'] } },
  // Solid bars that resolve as the sand fades out (all optional, off by default):
  bars: {
    fill: { opacity: 0.85 },                 // always the series color; only opacity
    border: { top: true, width: 1.5 },       // pick sides; width/opacity shared, series color
    reveal: { start: 'afterPour', duration: 600, grainsTo: 0.12 },
  },
});

chart.on('hover', ({ bar }) => console.log(bar?.xValue, bar?.yValue));
chart.update(newData);   // replace the dataset; grains morph to new targets
chart.dispose();
```

## Live data (`update` / `add` / `remove`)

Mutate a mounted chart **without a full re-pour**: the solid border/fill tween
smoothly to the new geometry while the sand morphs to indicate the change.

```ts
// Update — set y on existing points in place (matched by x, and z if given):
chart.update([{ x: 'Q2', z: 'EU', y: 175 }]);

// Add — append points; new bars grow in and their grains pour from above:
chart.add([{ x: 'Q3', y: 60, z: 'EU' }, { x: 'Q3', y: 45, z: 'US' }]);

// Remove — by index (negative = from end) or by {x, z?} match; bars reflow:
chart.remove([{ x: 'Q1' }]);   // drop every series bar at Q1
chart.remove([-1]);            // drop the last point

chart.repour();                // re-run the pour-in animation, same data
const snapshot = chart.getData();
```

Only added and removed bars get a distinct animation — **unchanged bars just
move** to their new position. The behavior is parametric under `animation`:

```ts
animation: {
  morphDuration: 900,     // ms, transition window (border tween + grain fade)
  reflow: 'translate',    // unchanged bars: 'translate' (slide 1:1) | 'reshuffle'
                          //   | 'withBar' (rigid, no delay/flash — quiet particles)
  enter: 'pour',          // added bars:     'pour' (from above) | 'rise' (from base)
  exit: 'fall',           // removed bars:   'fall' (drop off + fade) | 'vanish'
}
```

The pure array helpers behind the methods — `patchPoints`, `appendPoints`,
`removePoints` — are exported for use off-chart. The playground's **Live data**
toolbar (with **Continuous update** / **Continuous addition** toggles) drives
them; see [plans/05-live-data-update-add-remove.md](https://github.com/smalldat/sandycoast/blob/main/plans/05-live-data-update-add-remove.md).

## Data model (generic to all visuals)

`Point<X, Y, Z>` — `x`/`y` are `number | Date | string`, `z` is the optional
series key. Field types (`number` | `time` | `category`) are inferred or
declared. Build from arbitrary rows with `fromRows(rows, { x, y, z })`.

## How it renders

Grains live in a Structure-of-Arrays buffer uploaded to the GPU once. Each frame
the CPU only bumps a `now` uniform; the vertex shader derives every grain's
position via `mix(start, target, ease(t)) + fading jitter`. Hover uses a cheap
CPU bar-region hit-test; the hovered `barId` drives a shader highlight and extra
jitter. See [plans/01-bar-chart-sand-rendering.md](https://github.com/smalldat/sandycoast/blob/main/plans/01-bar-chart-sand-rendering.md).

## Status

v0: data model, scales (linear/time/band), grain packing, WebGPU + Canvas2D
backends, `BarChart` with pour-in, morph `update()`, and hover interaction.
Plan 02: axes/ticks/labels, positionable legend, current-value readout.
Plan 03: per-bar solid **fill + border** that fade in while the sand particles
fade out (`bars` config; see [plans/03-bar-borders-fill.md](https://github.com/smalldat/sandycoast/blob/main/plans/03-bar-borders-fill.md)).
Plan 05: live **`update` / `add` / `remove`** with smooth border tween + grain
morph, no full re-pour (see [plans/05-live-data-update-add-remove.md](https://github.com/smalldat/sandycoast/blob/main/plans/05-live-data-update-add-remove.md)).
`LineChart`: solid line / spline / **stacked area** (`line.stack`), grain count
bounded by ribbon area not point count (`maxGrains` is a hard ceiling), a
line-only morph (`animation.morphGrains: false`), and a `currentValue` cursor
crosshair (`guide`) with axis value **markers** and an **On axes** readout
(`mode: 'axis'`) — shared with the bar chart.
Planned next: WebGL2 fallback, more chart types, framework wrappers.

## Documentation

Static docs (no build step) are served from [GitHub Pages](https://smalldat.github.io/sandycoast/), structured by visual:

- [Overview + install/publish](https://smalldat.github.io/sandycoast/index.html)
- [Data model & shared config](https://smalldat.github.io/sandycoast/data-model.html)
- [Bar chart](https://smalldat.github.io/sandycoast/bar-chart.html) — every config property, methods, events, examples
- [Line chart](https://smalldat.github.io/sandycoast/line-chart.html)
- [License](https://smalldat.github.io/sandycoast/license.html)

**Publish to GitHub Pages:** Settings → Pages → *Deploy from a branch* → branch
`main`, folder `/docs` → Save. A `.nojekyll` file is included so the HTML is
served as-is. (This is independent of the Vite/Firebase playground deploy.)

## License

Dual-licensed:

- **Non-commercial — free.** Individuals, personal projects, research, teaching,
  evaluation, and non-profits, under MIT-style terms.
- **Commercial — paid.** Any company or for-profit entity using the library in a
  revenue-generating product, service, or internal tool needs a paid commercial
  license. Contact <office-dat@smalldat.com>.

Full terms in [LICENSE](https://github.com/smalldat/sandycoast/blob/main/LICENSE). The `LICENSE` text is a starting template —
have a lawyer review it before relying on it commercially.
