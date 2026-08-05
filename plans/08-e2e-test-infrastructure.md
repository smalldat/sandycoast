# Plan 08 — E2E test infrastructure (Playwright)

Status: **PROPOSED — not implemented**
Scope: component-level E2E for the charts, scripted scenarios, CI gating on PR + release.

> Unit tests (vitest, `src/**/*.test.ts`) already cover the pure math: layout,
> scales, packing, formatting. This plan covers everything that only exists once
> a canvas is on screen — actual pixels, pointer interaction, resize, live data,
> and the playground journeys.

---

## 1. What makes this repo awkward to E2E

- **Charts render to a canvas.** There is no DOM to assert on. Every assertion
  is either a pixel comparison or a probe into the chart instance.
- **Two backends.** `pickRenderer` prefers WebGPU and falls back to Canvas2D.
  GPU output differs by driver, so it cannot be the screenshot baseline.
- **Animation is time-driven.** `performance.now()` + `requestAnimationFrame`
  in `BarChart` / `LineChart` / `PieChart` drive the reveal and the shader-side
  grain jitter. Unfrozen, no two frames are alike.
- **Randomness is already fine.** Particle packing and scatter use seeded
  `mulberry32` (`pack.ts`, `anim.ts`), so a fixed `seed` in the config is
  reproducible. Nothing to fix here — just always pass one.

## 2. Test layers

| Layer | Tool | Covers |
|---|---|---|
| unit (exists) | vitest | layout, scales, packing, format |
| **component E2E** | Playwright + harness page | mounts, renders pixels, hover/zoom/slider events, resize, live data |
| **visual regression** | Playwright `toHaveScreenshot` | grain look, theme, axes, chrome |
| **journey E2E** | Playwright on the playground | nav switch, settings persistence, theme + layout switch |
| **smoke** | Playwright vs deployed URL | post-deploy production check |

Rule of thumb: if it can be a vitest test, it stays a vitest test. E2E is only
for things that need a browser and a canvas.

## 3. Harness page (the reusable core)

The playground is a demo app, not a test rig — it has persistence, nav state and
a control panel, all of which fight determinism. Add a separate minimal page.

```
e2e/
  harness/index.html          # empty <div id="host">
  harness/main.ts             # ?scenario=<id>&backend=<kind> -> mount, expose window.__sc
  scenarios/*.scenario.ts     # data only: config + steps + expectations
  scenarios/index.ts          # SCENARIOS registry
  specs/component.spec.ts     # generic runner over every scenario
  specs/visual.spec.ts        # screenshot runner
  specs/playground.spec.ts    # journeys against the real playground
  specs/smoke.spec.ts         # runs against BASE_URL (deployed site)
  fixtures/clock.ts           # fake performance.now + rAF queue
  fixtures/mount.ts           # goto harness, wait for first frame
  playwright.config.ts
```

`e2e/harness/main.ts`:

```ts
import { SCENARIOS } from '../scenarios/index.js';
import type { BackendPreference } from '../../src/index.js';

const q = new URLSearchParams(location.search);
const sc = SCENARIOS[q.get('scenario')!];
const backend = (q.get('backend') ?? 'canvas2d') as BackendPreference;

const chart = await sc.create(document.getElementById('host')!, { ...sc.config, backend });

// Test-only probe. The harness is not part of the library bundle, so this
// never ships to consumers.
(window as any).__sc = {
  chart,
  events: [] as unknown[],   // hover / seriesChange payloads are pushed here
  backend,
};
```

A scenario is plain data, so the same file feeds the interaction spec *and* the
screenshot spec — one source of truth per case:

```ts
export const barBasic: Scenario = {
  id: 'bar-basic',
  create: (host, cfg) => new BarChart(host, cfg),
  config: { data: FIXED_ROWS, seed: 42, reveal: { mode: 'none' }, fps: false },
  steps: [
    { act: { hover: [120, 200] }, expect: { event: 'hover', match: { index: 2 } } },
    { act: { wheel: { dy: -240 } }, expect: { view: { k: '>1' } } },
  ],
  screenshot: { at: ['after-mount', 'after-hover'] },
};
```

The spec is a single loop:

```ts
for (const sc of Object.values(SCENARIOS))
  test(sc.id, async ({ page }) => runScenario(page, sc));
```

Adding a chart means adding one scenario file. No spec code changes.

## 4. Determinism

No library changes required — the charts call the globals, so patch them in a
Playwright `addInitScript` that runs before app code:

- Fake `performance.now()` and queue `requestAnimationFrame` manually; expose
  `__advance(ms)` to step an exact number of frames. Reveal animation and grain
  jitter become reproducible.
- `deviceScaleFactor: 1`, fixed viewport, `--force-color-profile=srgb`,
  `--font-render-hinting=none`.
- Always pass an explicit `seed` in the scenario config.
- Disable the FPS meter (`fps: false`) — its text changes every frame. Where a
  scenario must keep it, `mask:` that region in the screenshot.

## 5. Backend matrix

Playwright projects:

- **`chromium-canvas2d`** — `backend=canvas2d`. Baseline for *all* screenshots.
  Deterministic in CI.
- **`chromium-webgpu`** — flags `--enable-unsafe-webgpu --use-angle=swiftshader`.
  Runs the same scenarios, but assertions stay structural: correct events, canvas
  is not blank, loose pixel threshold. **Does not gate release** — driver
  differences are not a product bug.
- **`packaged`** — identical scenarios, but the harness imports
  `../../dist/index.js` instead of `../../src/index.js`. Catches broken
  `exports` maps and tsup output before publish.
- **`smoke`** — journey specs pointed at `BASE_URL` (the deployed site).

## 6. CI

New `.github/workflows/e2e.yml`, callable from the release workflow:

```yaml
name: E2E
on:
  pull_request:
  push: { branches: [main] }
  workflow_call: {}

jobs:
  e2e:
    runs-on: ubuntu-latest
    container: mcr.microsoft.com/playwright:v1.5x-jammy   # pin: baselines are image-specific
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run build          # needed by the `packaged` project
      - run: npx playwright test
      - uses: actions/upload-artifact@v4
        if: failure()
        with: { name: playwright-report, path: playwright-report/ }
```

Screenshot baselines are generated **only** from that container image
(`npm run e2e:update` runs it via docker locally). Generating them on Windows
guarantees permanent font/anti-aliasing churn.

In `publish.yml`, gate the release on it:

```yaml
jobs:
  e2e:
    uses: ./.github/workflows/e2e.yml
  release:
    needs: e2e
    # ... existing steps
```

And after the Firebase deploy step, a production smoke run:

```yaml
      - name: Smoke test deployed site
        env: { BASE_URL: https://sandycoast.smalldat.com }
        run: npx playwright test --project=smoke
```

Failure alerts; it does not auto-roll-back (deliberate — rollback is a manual
call until the smoke suite has a track record).

## 7. Scripts

```json
"e2e": "playwright test",
"e2e:ui": "playwright test --ui",
"e2e:update": "docker run --rm -v ${PWD}:/w -w /w mcr.microsoft.com/playwright:v1.5x-jammy npx playwright test -u",
"e2e:smoke": "playwright test --project=smoke"
```

## 8. Rollout order

1. Playwright config + harness page + fake-clock fixture + one bar scenario
   (mount + hover). Proves the rig end to end.
2. Screenshot baselines, `chromium-canvas2d` only.
3. Port line + pie scenarios — should be pure data additions.
4. Add the `packaged` project.
5. Wire `e2e.yml` into PR checks and into `publish.yml`.
6. Playground journey specs + production smoke.

## 9. Tradeoffs

- Screenshot tests carry the maintenance cost. Keep them **few and coarse** —
  one per chart per theme — and lean on the `window.__sc` probe for fine-grained
  behavior. A failing pixel diff should mean "the render changed", not "a label
  moved one pixel".
- The probe API is extra surface that only the harness uses. It lives in
  `e2e/`, never in `src/`, so it cannot leak into the published package.
- WebGPU coverage is intentionally shallow. Deep GPU verification needs real
  hardware in CI; not worth it at this stage.
