# Plan 01 — Sand Bar Chart (point-based visual engine)

Status: **v0 IMPLEMENTED** (WebGPU + Canvas2D; WebGL2 fallback still pending)
Package: `@smalldat/visual`

> Sections 1–11 are the original approved plan, annotated where the build
> diverged. **§12 "As-built"** is the authoritative record of what shipped this
> session. Read §12 first if you only want current state.

---

## 1. Goal

TypeScript library of visual components. High-performance, **not SVG**. First
component: a **bar chart rendered as sand** — thousands–millions of points
("grains") that animate from a scattered state and settle into bar shapes, like
pouring/merging sand piles.

Locked decisions (from review questions):

| Decision | Choice |
|---|---|
| Rendering backend | **WebGPU-first**, WebGL2 fallback, Canvas2D last-resort — *built: WebGPU + Canvas2D; WebGL2 deferred* |
| First deliverable | **Vanilla core only** (framework wrappers later) |
| Animation model | **GPU lerp + jitter** (no physics sim) |

---

## 2. Architecture (layered)

```
@smalldat/visual
├─ core/
│  ├─ data/        generic X,Y,Z model + accessors + validation
│  ├─ scales/      linear, time, band(ordinal) scales  → normalized device coords
│  ├─ render/      backend abstraction
│  │   ├─ Renderer (interface)
│  │   ├─ webgpu/  primary
│  │   ├─ webgl2/  fallback
│  │   └─ canvas2d/ last-resort
│  ├─ particles/   grain buffer mgmt, target-position packing, animation clock
│  └─ chart/       Chart base class (lifecycle, resize, axes host, ticker)
├─ charts/
│  └─ bar/         BarChart — maps XYZ → bars → grain targets
└─ index.ts        public API
```

Design rule: **rendering is GPU-driven**. Per frame the CPU only advances a
`now` uniform. The vertex/compute stage derives each grain's current position
from `(start, target, startDelay, duration)`. No per-grain CPU work in steady
state → this is what buys the performance.

---

## 3. Generic data model (shared by ALL future visuals)

```ts
// core/data/types.ts
export type Scalar = number | Date | string;

export interface Point<X extends Scalar = Scalar,
                        Y extends Scalar = Scalar,
                        Z extends Scalar = Scalar> {
  x: X;   // numeric | datetime | string (categorical)
  y: Y;   // numeric | datetime | string
  z?: Z;  // series key; omit = single series
}

export interface DataSet<X extends Scalar, Y extends Scalar, Z extends Scalar> {
  points: Point<X, Y, Z>[];
  // optional explicit typing; inferred if absent
  xType?: FieldType; yType?: FieldType; zType?: FieldType;
}

export type FieldType = 'number' | 'time' | 'category';
```

- Accessor layer lets callers feed arbitrary objects:
  `data({ x: d => d.date, y: d => d.sales, z: d => d.region })`.
- Type inference: sniff first non-null value per field; overridable.
- This `Point<X,Y,Z>` + `FieldType` + scales is the **generic contract** reused
  by every later visual (line, scatter, area…). Bar chart is first consumer.

---

## 4. Scales

`core/scales` — map domain value → normalized `[0,1]` layout space (chart later
maps to clip/device coords).

- `linear` (number)
- `time` (Date; ticks via nice-time steps)
- `band` (category → position + bandwidth, for bar slots)

Interface:
```ts
interface Scale<T extends Scalar> {
  (v: T): number;              // → [0,1]
  domain(d: T[]): this;
  ticks(count?: number): T[];
  bandwidth?(): number;        // band only
}
```

*As-built:* the callable `(v)` became a `scale(v)` method (`Scale.scale()`,
`ticks()`, optional `bandwidth()`); `BandScale` also has `center()`. `makeScale()`
picks the impl by `FieldType`.

Axis rendering: **deferred**. v0 draws bars only. Axes/labels are a follow-up
plan (text on WebGPU = separate concern; likely a thin Canvas2D overlay).

---

## 5. Bar → grain mapping (the sand)

For each bar (one X slot × one Z series):

1. Compute bar rect in layout space from scales (`x` = band slot, height = `y`).
2. **Pack** grains into that rect: `grainsPerBar ≈ area * density`, arranged on a
   jittered grid so settled pile looks granular, not a solid block.
   → `target[i] = (px, py)` per grain.
3. **Start** position: scattered above the chart (random x, y above top) OR
   previous frame's position on data update (enables morph transitions).
4. Per-grain `startDelay` staggered by column/height → pour effect.

Grain buffer (Structure-of-Arrays, one big typed buffer, uploaded once):
```
startX, startY, targetX, targetY, delay, seed, colorIdx, barId   (per grain)
```
*(As-built: `barId` added for hover hit-test/weighting — see §11/§12.)*
Uniforms per frame: `now`, `viewport`, `grainSize`, palette.

Vertex/compute stage:
```
t   = clamp((now - startDelay) / duration, 0, 1)
te  = ease(t)                       // easeOutCubic
pos = mix(start, target, te)
pos += jitter(seed) * (1 - te)      // noise fades as it settles
emit grain at pos, size=grainSize
```

WebGPU point note: point-list topology is 1px only → render each grain as an
**instanced quad** (2 tris) sized by `grainSize`, or a small triangle. Instance
count = grain count. Same math ports to WebGL2 (instanced arrays) and Canvas2D
(CPU loop, capped grain count).

---

## 6. Rendering backend abstraction

```ts
// As-built (core/render/types.ts): now lives inside FrameUniforms, not a param.
interface Renderer {
  readonly kind: 'webgpu' | 'webgl2' | 'canvas2d';
  init(canvas: HTMLCanvasElement): Promise<void>;
  upload(grains: GrainBuffer): void;   // one-time / on data change
  frame(u: FrameUniforms): void;       // u.now advances the clock
  resize(widthPx: number, heightPx: number): void;
  dispose(): void;
}
```

- `pickRenderer(pref='auto')`: try `navigator.gpu` → WebGPU; else Canvas2D.
  **WebGL2 branch not yet built** — `auto` skips straight to Canvas2D when
  WebGPU is unavailable. Preference forceable (`backend: 'webgpu'|'canvas2d'`).
- WebGPU primary: render pipeline, instanced quads (6 verts × N instances),
  three buffers — uniform (4×vec4), palette `array<vec4<f32>>` (binding 1), and
  per-bar hover weights `array<f32>` (binding 2). No compute shader (keeps
  Canvas2D parity); reserve compute for a future physics mode.
- Canvas2D fallback mirrors the exact grain math in JS (`particles/anim.ts`
  `evalGrain`) so both backends animate identically.
- WGSL is inlined as a TS string (bundler-friendly, no asset loader).

---

## 7. Public API (v0)

```ts
// As-built API.
import { BarChart } from '@smalldat/visual';

const chart = new BarChart(document.querySelector('#el')!, {
  data: {
    points: [{ x: 'Q1', y: 120, z: 'EU' }, { x: 'Q1', y: 90, z: 'US' }, ...],
  },
  grainDensity: 0.9,                 // grains per layout unit² (×1e4)
  maxGrains: 100_000,
  colors: ['#e8598b', '#8bc4e8'],
  background: 'rgba(0,0,0,0)',
  grain: { sizePx: 2.4, shape: 'disc', jitter: 0.6, settleJitter: 0.004 },
  animation: { duration: 1100, ease: 'easeOutCubic', stagger: 700 }, // ms
  interaction: {
    hover: { effects: ['highlight', 'jitter'],
             highlightGain: 1.6, jitterAmp: 0.008, fadeMs: 180 },
  },
  backend: 'auto',                   // 'auto' | 'webgpu' | 'canvas2d'
});

await chart.whenReady();             // backend initialised; chart.backend set
chart.on('hover', ({ bar }) => { /* bar: BarMeta | null */ });
chart.update(newData);               // morph grains to new targets
chart.dispose();
```

Notes vs original sketch: `animation.duration`/`stagger` are **milliseconds**;
`stagger` is a number, not a boolean. Grain look moved under `grain{}`. Hover
config + `backend` added. Framework-agnostic, `el`-mounted; React/Vue wrappers =
separate later package.

---

## 8. Tooling / repo setup

- Build: **tsup** (ESM + d.ts). Bundler-friendly, tiny config.
- Types: strict TS.
- Dev harness: **Vite** playground app (`/playground`) to eyeball the sand.
- Test: **Vitest** for data/scale/packing logic (deterministic, headless).
  Renderer smoke-tested in playground manually for v0 (GPU hard to unit test).
- Lint/format: as you prefer (propose Biome — fast, single tool).
- No runtime deps in core (hand-rolled scales) to keep it lean; revisit if scale
  edge cases pile up.

---

## 9. Milestones

- **M0 — Scaffold** ✅: package, tsup, biome, vitest, vite playground.
- **M1 — Data + scales** ✅: `Point<X,Y,Z>`, inference, linear/time/band + tests.
- **M2 — Grain packing** ✅: bar rect → jittered targets, deterministic + tests.
- **M3 — WebGPU renderer** ✅: instanced quads, uniform-driven lerp+jitter.
- **M4 — Animation** ✅: pour-in from scatter, staggered delays, `now` clock.
- **M5 — BarChart glue** ✅: XYZ → bars → grains → renderer; `update()` morph.
- **M5.5 — Hover** ✅ *(added this session)*: bar-region hit-test, smooth eased
  per-bar hover weights driving highlight + jitter, crossfade/fade-out.
- **Canvas2D fallback** ✅ *(promoted from stretch — real fallback at 100k)*.
- **M6 — WebGL2 fallback** ⬜ *pending*: parity path for no-WebGPU browsers.
- **M7 — Polish** 🟡: resize/HiDPI ✅, dispose ✅, README ✅; leak audit TODO.

Axes, labels, tooltips, other chart types, framework wrappers = **future plans**.

---

## 10. Resolved decisions

1. **Grain ceiling = 100k.** ⇒ all three backends viable (Canvas2D fallback
   real, no downsample needed). GPU buffer ~3MB, 600k verts/frame — trivial.
   Bar-region CPU hit-test easily fast enough; GPU picking unneeded. Keeps v0
   simple; ceiling can be raised later without API change.
2. **Uniform dots**, but `grainSize` + `grainShape` ('quad'|'disc') parametrized.
3. **Fixed per-series palette.**
4. **Biome** (newer/simpler, single tool).
5. **Hover interaction in v0.** Selectable effect, two modes implemented:
   - `highlight` — hovered bar's grains brighten (per-grain highlight factor).
   - `jitter` — hovered grains get small extra noisy movement (never settles
     fully while hovered).

## 11. Interaction / picking design  *(updated to as-built)*

- **Bar-region hit-test** (CPU): pointer → layout coords → which bar rect. Cheap,
  works at 100k grains, no GPU readback.
- **Smooth transitions (as-built).** Instead of a binary `hoveredBarId`, each bar
  has a **hover weight** in `[0,1]`. Every frame the CPU eases each weight toward
  its target (1 for the hovered bar, else 0) with frame-rate-independent
  exponential smoothing `w += (target − w)·(1 − e^(−dt/τ))`, τ = `fadeMs` (180ms
  default). This gives:
  - **enter** → weight eases up (fade-in),
  - **leave** → weight eases to 0 (fade-out),
  - **bar → bar** → old eases down while new eases up (**crossfade**).
- Weights upload to a `array<f32>` storage buffer (binding 2); the shader reads
  `hw = hoverW[barId]` and scales effects continuously:
  - `highlight`: `color.rgb *= mix(1.0, highlightGain, hw)`
  - `jitter`: `pos += noise(seed, now) * hoverJitterAmp * hw`
  - Canvas2D applies the same weight per grain.
- Config: `interaction.hover.{ effects, highlightGain, jitterAmp, fadeMs }`.
- Emits `chart.on('hover', { bar: BarMeta | null })` for host apps.
- GPU per-grain picking (id-buffer readback) = future, only if per-grain hit
  needed. Bar-region covers the stated use.

---

## 12. As-built (this session — authoritative current state)

### File map
```
src/
  index.ts                       public API barrel
  core/
    data/types.ts                Point<X,Y,Z>, DataSet, FieldType, Accessor
    data/dataset.ts              inference, fromRows, seriesKeys, toNumeric, validate
    scales/{linear,time,band}.ts  scale impls; index.ts = makeScale()
    scales/types.ts              Scale<T> (scale()/ticks()/bandwidth?)
    particles/grains.ts          GrainBuffer (SoA) incl. barId
    particles/pack.ts            grainCounts(), packBars() jittered grid
    particles/anim.ts            ease(), scatterStarts(), evalGrain() (CPU/canvas2d)
    particles/rng.ts             mulberry32 deterministic PRNG
    render/types.ts              Renderer, FrameUniforms, RGBA, GrainShape
    render/pick.ts               pickRenderer(): WebGPU → Canvas2D
    render/webgpu/renderer.ts    instanced quads; uniform+palette+hover buffers
    render/webgpu/shader.wgsl.ts WGSL (inlined string)
    render/canvas2d/renderer.ts  JS-mirror fallback
    util/{color,emitter}.ts      parseColor/DEFAULT_PALETTE, typed Emitter
  charts/bar/BarChart.ts         lifecycle, loop, hover easing, morph update()
  charts/bar/layout.ts           XYZ → grouped BarRect[] + BarMeta[]
  charts/bar/types.ts            BarChartConfig, BarMeta, HoverPayload
playground/                      vite demo (index.html, main.ts)
```
Tests: `*.test.ts` for dataset, scales, pack, layout — **28 passing**. Renderers
verified visually (GPU not unit-testable headless here).

### Coordinate model
Layout space `[0,1]`, origin **bottom-left, +y up**. Bars grow up from y=0 to
`yScale(value)·0.92` (headroom). X = grouped band per distinct x-value (numeric/
time sorted, category first-seen); series split each slot side-by-side. WebGPU
maps layout→clip (`p·2−1`); Canvas2D maps layout→device px (`y` flipped).

### Gotchas hit & fixed
- **WGSL reserved keywords.** `target`, `meta` (and defensively `in`/`out`) are
  reserved — using them as identifiers throws *"'X' is a reserved keyword"* at
  `createShaderModule`, silently blanking the canvas. Renamed to `dst`, `md`,
  `frag`/`vo`. Any new WGSL identifier must be checked against the reserved list.
- **WebGPU errors are async/uncaptured.** A bad shader doesn't throw at the call
  site; it surfaces via `device.addEventListener('uncapturederror', …)`. That
  handler is **kept** in the renderer as a permanent diagnostic.
- **Headless Chrome has no WebGPU adapter here** → falls back to Canvas2D; the
  software-Vulkan flags crash it. WebGPU can only be pixel-verified in a real
  Chrome window. Chrome profile-lock also silently 0-bytes headless screenshots
  → use `--user-data-dir=<temp>`.
- **TS 5.7 `Float32Array<ArrayBufferLike>`** isn't assignable to WebGPU's
  `GPUAllowSharedBufferSource`; hover-weight `writeBuffer` casts through `unknown`.

### Verified this session
typecheck clean · 28 unit tests pass · biome clean (3 benign warnings) · tsup
build (ESM + d.ts) · WebGPU renders in real Chrome (`backend: webgpu`) · Canvas2D
renders (headless screenshot) · hover crossfade/fade-out confirmed.

### Known gaps / next
WebGL2 backend (M6) · axes/labels/tooltip overlay · leak audit · more chart
types reusing the generic model · framework wrappers.