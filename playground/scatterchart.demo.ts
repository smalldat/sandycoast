import type { MeshDataSet, MeshPoint, MeshSeries } from '../src/index.js';
import { ScatterChart } from '../src/index.js';
import type { ControlGroup } from './controls.js';
import { renderControls } from './controls.js';
import { clearSettings, deepMerge, loadSettings, saveSettings } from './persist.js';
import type { DemoComponent } from './registry.js';
import { chartPalette } from './theme.js';

const SERIES = ['A', 'B', 'C'];
/** Hard cap so the points control can't wedge the tab. */
const MAX_POINTS = 5000;

type DataMode = 'clusters' | 'trend' | 'spiral';

/** Mulberry32-ish PRNG so a given seed always regenerates the same cloud. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Box-Muller: one standard-normal sample from two uniforms. */
function gaussian(rand: () => number): number {
  const u = Math.max(1e-9, rand());
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

class ScatterChartDemo implements DemoComponent {
  id = 'scatter';
  label = 'Scatter chart';

  private cfg: Cfg = defaultConfig();
  private data: MeshDataSet = { series: [] };
  private chart: ScatterChart | null = null;
  private chartEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private hoverEl!: HTMLElement;
  private panelEl!: HTMLElement;

  private updTimer: ReturnType<typeof setInterval> | null = null;
  private addTimer: ReturnType<typeof setInterval> | null = null;
  private seed = 1;
  /** Snapshot of the data params last generated from, to detect changes. */
  private dataKey = '';

  private get mode(): DataMode {
    if (this.cfg.dataMode === 'trend') return 'trend';
    if (this.cfg.dataMode === 'spiral') return 'spiral';
    return 'clusters';
  }

  private get pointCount(): number {
    const n = Number(this.cfg.pointCount) || 80;
    return Math.max(2, Math.min(MAX_POINTS, Math.round(n)));
  }

  /** One series' points for the current mode. */
  private sampleSeries(si: number, n: number, rand: () => number): MeshPoint[] {
    const points: MeshPoint[] = [];
    if (this.mode === 'trend') {
      // A shared linear trend (y = 1.4x + series offset) plus noise, so
      // `leastSquares` has something real to recover. `straight`/`spline`
      // connect points in the order given (not sorted by x internally), so
      // sort here — the chart leaves ordering to the caller.
      const offset = si * 12 - (SERIES.length - 1) * 6;
      for (let i = 0; i < n; i++) {
        const x = rand() * 100;
        const y = 1.4 * x + offset + gaussian(rand) * 12;
        points.push({ x, y, z: { value: y } });
      }
      points.sort((a, b) => (a.x as number) - (b.x as number));
    } else if (this.mode === 'spiral') {
      // A multi-arm spiral (galaxy-style): each series is one arm, offset by
      // phase, radius growing linearly with angle plus a little noise so the
      // arms read as sand rather than a perfect curve. Points are generated
      // in increasing-angle order and left that way (not sorted by x) — that
      // order is exactly what traces the arm outward when `straight`/`spline`
      // connect them, since a spiral's x is not monotonic in x-sorted order.
      const phase = (si * 2 * Math.PI) / SERIES.length;
      const turns = 2.2;
      const maxR = 42;
      for (let i = 0; i < n; i++) {
        const t = (i / Math.max(1, n - 1)) * turns * 2 * Math.PI;
        const r = maxR * (t / (turns * 2 * Math.PI)) + gaussian(rand) * 1.5;
        const x = 50 + r * Math.cos(t + phase);
        const y = 50 + r * Math.sin(t + phase);
        points.push({ x, y, z: { value: r } });
      }
    } else {
      // A cluster per series, in a ring around the plot center.
      const angle = (si * 2 * Math.PI) / SERIES.length;
      const cx = 50 + 28 * Math.cos(angle);
      const cy = 50 + 28 * Math.sin(angle);
      for (let i = 0; i < n; i++) {
        const x = cx + gaussian(rand) * 9;
        const y = cy + gaussian(rand) * 9;
        points.push({ x, y, z: { value: Math.hypot(x - cx, y - cy) } });
      }
    }
    return points;
  }

  /** (Re)generate the full dataset from the current mode + point count. */
  private regenerate(): void {
    const rand = rng(this.seed++);
    const n = this.pointCount;
    const series: MeshSeries[] = SERIES.map((key, si) => ({
      key,
      points: this.sampleSeries(si, n, rand),
    }));
    this.data = { series };
    this.dataKey = `${this.mode}:${n}`;
  }

  mount(host: HTMLElement, panel: HTMLElement): void {
    this.panelEl = panel;
    this.cfg = loadSettings(this.id, defaultConfig());
    this.regenerate();

    host.replaceChildren();
    this.chartEl = document.createElement('div');
    this.chartEl.id = 'chart';

    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    const rePour = button('Re-pour', () => this.chart?.repour());
    const regen = button('Regenerate', () => {
      this.regenerate();
      this.chart?.update(this.data);
    });
    const reset = button('Reset settings', () => {
      clearSettings(this.id);
      this.cfg = defaultConfig();
      this.regenerate();
      this.renderPanel();
      this.rebuild(false);
    });
    const preset = presetPicker(PRESET_NAMES, (name) => this.applyPreset(name as PresetName));
    toolbar.append(preset, rePour, regen, reset);

    const liveBar = document.createElement('div');
    liveBar.className = 'toolbar';
    const upd = button('Update values', () => this.updateValues());
    const addBtn = button('Add point', () => this.addPoint());
    const rem = button('Remove last', () => this.removeLast());
    const contUpd = toggle('Continuous update', (on) =>
      this.setContinuous('updTimer', on, 900, () => this.updateValues()),
    );
    const contAdd = toggle('Continuous addition', (on) =>
      this.setContinuous('addTimer', on, 250, () => this.addPoint()),
    );
    liveBar.append(upd, addBtn, rem, contUpd, contAdd);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'status';
    this.hoverEl = document.createElement('div');
    this.hoverEl.className = 'hover';
    this.hoverEl.textContent = 'hover a point…';
    host.append(this.chartEl, toolbar, liveBar, this.statusEl, this.hoverEl);

    this.renderPanel();
    this.build();
  }

  private renderPanel(): void {
    renderControls(this.panelEl, this.cfg, GROUPS, () => {
      saveSettings(this.id, this.cfg);
      // Regenerate only when the data shape (mode / point count) changed;
      // other edits keep the current (possibly live-mutated) data so morph
      // transitions and any in-flight continuous add/update stay visible.
      // `rebuild(false)` uses `this.data` as just set by regenerate();
      // `rebuild(true)` re-syncs `this.data` from the still-live chart first
      // so a cosmetic-only change doesn't clobber a running timer's progress.
      const key = `${this.mode}:${this.pointCount}`;
      if (key !== this.dataKey) {
        this.regenerate();
        this.rebuild(false);
      } else {
        this.rebuild(true);
      }
    });
  }

  unmount(): void {
    this.stopTimer('updTimer');
    this.stopTimer('addTimer');
    this.chart?.dispose();
    this.chart = null;
  }

  /** Re-roll every point (morph without changing the point count). */
  private updateValues(): void {
    this.regenerate();
    this.chart?.update(this.data);
  }

  /** Append one random point to a round-robin series; drop the oldest once over budget. */
  private addPoint(): void {
    const rand = rng(Date.now() & 0xffffffff);
    const si = Math.floor(rand() * SERIES.length);
    const [point] = this.sampleSeries(si, 1, rand);
    this.chart?.add(point!, si);
    const current = this.chart?.getData().series[si]?.points.length ?? 0;
    if (current > this.pointCount) this.chart?.remove(0, si);
  }

  /** Remove the newest point from the series that has the most points. */
  private removeLast(): void {
    const data = this.chart?.getData();
    if (!data) return;
    let si = 0;
    let max = -1;
    data.series.forEach((s, i) => {
      if (s.points.length > max) {
        max = s.points.length;
        si = i;
      }
    });
    if (max > 0) this.chart?.remove(-1, si);
  }

  private setContinuous(
    key: 'updTimer' | 'addTimer',
    on: boolean,
    ms: number,
    fn: () => void,
  ): void {
    this.stopTimer(key);
    if (on) this[key] = setInterval(fn, ms);
  }

  private stopTimer(key: 'updTimer' | 'addTimer'): void {
    if (this[key]) {
      clearInterval(this[key]!);
      this[key] = null;
    }
  }

  // Swap the whole config to a named preset (point count is kept from the
  // current cfg; a preset may still set its own `dataMode`, e.g. "Trend +
  // least squares" wants trend data regardless of what was showing before),
  // persist, refresh the panel, regenerate if the data shape changed, then
  // rebuild.
  private applyPreset(name: PresetName): void {
    this.cfg = deepMerge(presets()[name], { pointCount: this.cfg.pointCount });
    saveSettings(this.id, this.cfg);
    this.renderPanel();
    const key = `${this.mode}:${this.pointCount}`;
    const regenerated = key !== this.dataKey;
    if (regenerated) this.regenerate();
    // `false` when regenerated: use the fresh data, don't re-pull the old
    // live chart's snapshot over it (see renderPanel's onChange for why).
    this.rebuild(!regenerated);
  }

  private build(): void {
    this.chart = new ScatterChart(this.chartEl, {
      ...(this.cfg as object),
      data: this.data,
    } as never);
    this.chart.whenReady().then(() => {
      const total = this.data.series.reduce((a, s) => a + s.points.length, 0);
      this.statusEl.textContent = `backend: ${this.chart?.backend ?? '?'} · ${total} pts`;
    });
    this.chart.on('hover', ({ point }) => {
      this.hoverEl.textContent = point
        ? `(${Math.round(Number(point.xValue))}, ${Math.round(Number(point.yValue))}) · ${String(point.seriesKey)}`
        : 'hover a point…';
    });
  }

  // Config is construct-time; any edit disposes and rebuilds. When `keepData` is
  // true, capture the live data first so continuous add/update survives.
  private rebuild(keepData = true): void {
    if (keepData && this.chart) this.data = this.chart.getData();
    this.chart?.dispose();
    this.build();
  }
}

// Full editable config (everything except `data`), plus two demo-only keys
// (`dataMode`, `pointCount`) the ScatterChart ignores.
type Cfg = Record<string, unknown>;

function defaultConfig(): Cfg {
  const palette = chartPalette();
  return {
    dataMode: 'clusters',
    pointCount: 80,
    grainDensity: 1.2,
    maxGrains: 100000,
    pointRadius: 0.018,
    background: palette.background,
    colors: ['#e8598b', '#8bc4e8', '#e8c45a'],
    backend: 'auto',
    grain: { sizePx: 2.2, shape: 'disc', jitter: 0.7, settleJitter: 0.02 },
    animation: {
      duration: 1100,
      stagger: 700,
      ease: 'easeOutCubic',
      morphDuration: 1200,
      reflow: 'translate',
      morphGrains: true,
      enter: 'pour',
      exit: 'fall',
    },
    interaction: {
      hover: {
        effects: ['highlight', 'jitter', 'opacity'],
        highlightGain: 1.7,
        jitterAmp: 0.01,
        opacity: 1,
        fadeMs: 180,
      },
    },
    axes: {
      x: { show: true, ticks: 6, label: '', gridLines: false, color: palette.axis, fontPx: 11 },
      y: { show: true, ticks: 5, label: '', gridLines: true, color: palette.axis, fontPx: 11 },
    },
    legend: { show: true, position: 'bottom', align: 'center', swatch: 'disc' },
    currentValue: {
      show: true,
      mode: 'pointer',
      guide: 'both',
      markers: true,
      color: palette.text,
    },
    marker: {
      shape: 'circle',
      size: 7,
      opacity: 1,
      reveal: { start: 'afterPour', duration: 500, ease: 'easeOutCubic', grainsTo: 0.1 },
    },
    approximation: {
      kind: 'none',
      width: 2,
      opacity: 0.8,
    },
    fps: { position: 'off', color: palette.text },
    // Pan & zoom: drag to pan, wheel/UI to zoom. Off by default.
    panZoom: {
      enabled: false,
      axes: 'both',
      minZoom: 1,
      maxZoom: 10,
      wheel: true,
      drag: true,
      controls: { show: true, position: 'top-right', step: 1.4 },
    },
  };
}

// Named starting points. Each is a full config: `Default` is the untouched
// baseline; the others overlay `defaultConfig()` with a distinct look.
const PRESET_NAMES = [
  'Default',
  'Trend + least squares',
  'Grainy low-opacity markers',
  'Spiral galaxy',
] as const;
type PresetName = (typeof PRESET_NAMES)[number];

function presets(): Record<PresetName, Cfg> {
  return {
    Default: defaultConfig(),
    'Trend + least squares': deepMerge(defaultConfig(), {
      dataMode: 'trend',
      marker: { size: 5, opacity: 0.85 },
      approximation: { kind: 'leastSquares', width: 2.5, opacity: 1 },
    }),
    'Grainy low-opacity markers': deepMerge(defaultConfig(), {
      grainDensity: 2.4,
      pointRadius: 0.03,
      grain: { sizePx: 3, jitter: 0.9 },
      marker: { shape: 'asterisk', size: 9, opacity: 0.5 },
      approximation: { kind: 'spline', width: 1.5, opacity: 0.6 },
    }),
    'Spiral galaxy': deepMerge(defaultConfig(), {
      dataMode: 'spiral',
      grainDensity: 1.6,
      pointRadius: 0.01,
      grain: { sizePx: 1.8, jitter: 0.5 },
      marker: { shape: 'circle', size: 3.5, opacity: 0.9 },
      // `straight`/`spline` connect points in the order given — the spiral
      // data is generated in increasing-angle order, so this traces each
      // arm outward rather than zigzagging (which x-sorting would cause).
      approximation: { kind: 'spline', width: 1.2, opacity: 0.55 },
    }),
  };
}

const GROUPS: ControlGroup[] = [
  {
    title: 'Data',
    controls: [
      {
        kind: 'select',
        label: 'Mode',
        path: 'dataMode',
        options: [
          { value: 'clusters', label: 'clusters' },
          { value: 'trend', label: 'trend + noise' },
          { value: 'spiral', label: 'spiral' },
        ],
      },
      {
        kind: 'number',
        label: 'Points per series (≤5000)',
        path: 'pointCount',
        min: 2,
        max: 5000,
        step: 1,
      },
    ],
  },
  {
    title: 'Grain & render',
    controls: [
      {
        kind: 'slider',
        label: 'Grain density',
        path: 'grainDensity',
        min: 0.1,
        max: 4,
        step: 0.05,
      },
      {
        kind: 'number',
        label: 'Max grains',
        path: 'maxGrains',
        min: 1000,
        max: 300000,
        step: 1000,
      },
      {
        kind: 'slider',
        label: 'Point cloud radius',
        path: 'pointRadius',
        min: 0.002,
        max: 0.06,
        step: 0.002,
      },
      {
        kind: 'slider',
        label: 'Grain size (px)',
        path: 'grain.sizePx',
        min: 0.5,
        max: 6,
        step: 0.1,
      },
      {
        kind: 'select',
        label: 'Shape',
        path: 'grain.shape',
        options: [
          { value: 'disc', label: 'disc' },
          { value: 'quad', label: 'quad' },
        ],
      },
      { kind: 'slider', label: 'Cloud jitter', path: 'grain.jitter', min: 0, max: 1, step: 0.02 },
      {
        kind: 'slider',
        label: 'Settle jitter',
        path: 'grain.settleJitter',
        min: 0,
        max: 0.1,
        step: 0.005,
      },
      { kind: 'color', label: 'Background', path: 'background' },
      { kind: 'colorlist', label: 'Series colors', path: 'colors', count: 3 },
      {
        kind: 'select',
        label: 'Backend',
        path: 'backend',
        options: [
          { value: 'auto', label: 'auto' },
          { value: 'webgpu', label: 'webgpu' },
          { value: 'webgl2', label: 'webgl2' },
          { value: 'canvas2d', label: 'canvas2d' },
        ],
      },
    ],
  },
  {
    title: 'Animation',
    controls: [
      {
        kind: 'slider',
        label: 'Duration (ms)',
        path: 'animation.duration',
        min: 100,
        max: 3000,
        step: 50,
      },
      {
        kind: 'slider',
        label: 'Stagger (ms)',
        path: 'animation.stagger',
        min: 0,
        max: 2000,
        step: 50,
      },
      {
        kind: 'select',
        label: 'Easing',
        path: 'animation.ease',
        options: [
          { value: 'linear', label: 'linear' },
          { value: 'easeOutCubic', label: 'easeOutCubic' },
          { value: 'easeOutQuint', label: 'easeOutQuint' },
        ],
      },
      {
        kind: 'slider',
        label: 'Morph (ms)',
        path: 'animation.morphDuration',
        min: 100,
        max: 3000,
        step: 50,
      },
      {
        kind: 'select',
        label: 'Reflow (unchanged)',
        path: 'animation.reflow',
        options: [
          { value: 'translate', label: 'translate' },
          { value: 'reshuffle', label: 'reshuffle' },
          { value: 'withMarker', label: 'With marker' },
        ],
      },
      { kind: 'checkbox', label: 'Animate grains on morph', path: 'animation.morphGrains' },
      {
        kind: 'select',
        label: 'Enter (added)',
        path: 'animation.enter',
        options: [
          { value: 'pour', label: 'pour' },
          { value: 'rise', label: 'rise' },
          { value: 'continue', label: 'New value' },
        ],
      },
      {
        kind: 'select',
        label: 'Exit (removed)',
        path: 'animation.exit',
        options: [
          { value: 'fall', label: 'fall' },
          { value: 'vanish', label: 'vanish' },
        ],
      },
    ],
  },
  {
    title: 'Hover',
    controls: [
      {
        kind: 'checkgroup',
        label: 'Effects',
        path: 'interaction.hover.effects',
        options: ['highlight', 'jitter', 'opacity'],
      },
      {
        kind: 'slider',
        label: 'Highlight gain',
        path: 'interaction.hover.highlightGain',
        min: 1,
        max: 3,
        step: 0.1,
      },
      {
        kind: 'slider',
        label: 'Jitter amp',
        path: 'interaction.hover.jitterAmp',
        min: 0,
        max: 0.01,
        step: 0.001,
      },
      {
        kind: 'slider',
        label: 'Hover opacity',
        path: 'interaction.hover.opacity',
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        kind: 'slider',
        label: 'Fade (ms)',
        path: 'interaction.hover.fadeMs',
        min: 0,
        max: 600,
        step: 20,
      },
    ],
  },
  {
    title: 'X axis',
    controls: [
      { kind: 'checkbox', label: 'Show', path: 'axes.x.show' },
      { kind: 'number', label: 'Ticks', path: 'axes.x.ticks', min: 0, max: 20, step: 1 },
      { kind: 'checkbox', label: 'Grid lines', path: 'axes.x.gridLines' },
      { kind: 'text', label: 'Label', path: 'axes.x.label' },
      { kind: 'slider', label: 'Font (px)', path: 'axes.x.fontPx', min: 8, max: 20, step: 1 },
      { kind: 'color', label: 'Color', path: 'axes.x.color' },
    ],
  },
  {
    title: 'Y axis',
    controls: [
      { kind: 'checkbox', label: 'Show', path: 'axes.y.show' },
      { kind: 'number', label: 'Ticks', path: 'axes.y.ticks', min: 0, max: 20, step: 1 },
      { kind: 'checkbox', label: 'Grid lines', path: 'axes.y.gridLines' },
      { kind: 'text', label: 'Label', path: 'axes.y.label' },
      { kind: 'slider', label: 'Font (px)', path: 'axes.y.fontPx', min: 8, max: 20, step: 1 },
      { kind: 'color', label: 'Color', path: 'axes.y.color' },
    ],
  },
  {
    title: 'Pan, Zoom, Legend',
    controls: [
      { kind: 'checkbox', label: 'Pan/zoom enabled', path: 'panZoom.enabled' },
      {
        kind: 'select',
        label: 'Pan/zoom axes',
        path: 'panZoom.axes',
        options: (['both', 'x', 'y'] as const).map((v) => ({ value: v, label: v })),
      },
      { kind: 'slider', label: 'Max zoom', path: 'panZoom.maxZoom', min: 1, max: 40, step: 1 },
      { kind: 'checkbox', label: 'Wheel zoom', path: 'panZoom.wheel' },
      { kind: 'checkbox', label: 'Drag pan', path: 'panZoom.drag' },
      { kind: 'checkbox', label: 'Zoom controls', path: 'panZoom.controls.show' },
      {
        kind: 'select',
        label: 'Controls corner',
        path: 'panZoom.controls.position',
        options: (['top-right', 'top-left', 'bottom-right', 'bottom-left'] as const).map((v) => ({
          value: v,
          label: v,
        })),
      },
      { kind: 'checkbox', label: 'Legend show', path: 'legend.show' },
      {
        kind: 'select',
        label: 'Legend position',
        path: 'legend.position',
        options: (['bottom', 'top', 'left', 'right'] as const).map((v) => ({ value: v, label: v })),
      },
      {
        kind: 'select',
        label: 'Legend align',
        path: 'legend.align',
        options: (['start', 'center', 'end'] as const).map((v) => ({ value: v, label: v })),
      },
      {
        kind: 'select',
        label: 'Legend swatch',
        path: 'legend.swatch',
        options: [
          { value: 'disc', label: 'disc' },
          { value: 'square', label: 'square' },
        ],
      },
    ],
  },
  {
    title: 'Marker',
    controls: [
      {
        kind: 'select',
        label: 'Shape',
        path: 'marker.shape',
        options: [
          { value: 'circle', label: 'circle' },
          { value: 'triangle', label: 'triangle' },
          { value: 'square', label: 'square' },
          { value: 'asterisk', label: 'asterisk' },
        ],
      },
      { kind: 'slider', label: 'Size (px)', path: 'marker.size', min: 1, max: 20, step: 0.5 },
      { kind: 'slider', label: 'Opacity', path: 'marker.opacity', min: 0, max: 1, step: 0.05 },
      {
        kind: 'slider',
        label: 'Reveal duration (ms)',
        path: 'marker.reveal.duration',
        min: 0,
        max: 3000,
        step: 50,
      },
      {
        kind: 'slider',
        label: 'Grains end opacity',
        path: 'marker.reveal.grainsTo',
        min: 0,
        max: 1,
        step: 0.05,
      },
    ],
  },
  {
    title: 'Approximation',
    controls: [
      {
        kind: 'select',
        label: 'Kind',
        path: 'approximation.kind',
        options: [
          { value: 'none', label: 'none' },
          { value: 'straight', label: 'straight' },
          { value: 'spline', label: 'spline' },
          { value: 'leastSquares', label: 'least squares' },
        ],
      },
      {
        kind: 'slider',
        label: 'Width (px)',
        path: 'approximation.width',
        min: 0.5,
        max: 6,
        step: 0.5,
      },
      {
        kind: 'slider',
        label: 'Opacity',
        path: 'approximation.opacity',
        min: 0,
        max: 1,
        step: 0.05,
      },
      { kind: 'color', label: 'Color override', path: 'approximation.color' },
    ],
  },
  {
    title: 'Current value',
    controls: [
      { kind: 'checkbox', label: 'Show', path: 'currentValue.show' },
      {
        kind: 'select',
        label: 'Mode',
        path: 'currentValue.mode',
        options: (['pointer', 'axis', 'top', 'right', 'bottom', 'left'] as const).map((v) => ({
          value: v,
          label: v === 'axis' ? 'On axes' : v,
        })),
      },
      {
        kind: 'select',
        label: 'Cursor line',
        path: 'currentValue.guide',
        options: [
          { value: 'none', label: 'none' },
          { value: 'y', label: 'horizontal' },
          { value: 'x', label: 'vertical' },
          { value: 'both', label: 'crosshair' },
        ],
      },
      { kind: 'checkbox', label: 'Axis markers', path: 'currentValue.markers' },
      { kind: 'color', label: 'Color', path: 'currentValue.color' },
    ],
  },
  {
    title: 'FPS meter',
    controls: [
      {
        kind: 'select',
        label: 'Position',
        path: 'fps.position',
        options: (['off', 'left', 'right', 'top', 'bottom'] as const).map((v) => ({
          value: v,
          label: v,
        })),
      },
      { kind: 'color', label: 'Color', path: 'fps.color' },
    ],
  },
];

function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

function toggle(label: string, onChange: (on: boolean) => void): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.style.cssText =
    'display:inline-flex;gap:5px;align-items:center;margin-right:12px;font-size:13px;';
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.addEventListener('change', () => onChange(cb.checked));
  const span = document.createElement('span');
  span.textContent = label;
  wrap.append(cb, span);
  return wrap;
}

/** Labeled <select> of preset names; fires `onPick` on choice. */
function presetPicker(names: readonly string[], onPick: (name: string) => void): HTMLLabelElement {
  const wrap = document.createElement('label');
  wrap.style.cssText =
    'display:inline-flex;gap:5px;align-items:center;margin-right:12px;font-size:13px;';
  const span = document.createElement('span');
  span.textContent = 'Preset';
  const sel = document.createElement('select');
  for (const n of names) {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;
    sel.append(opt);
  }
  sel.addEventListener('change', () => onPick(sel.value));
  wrap.append(span, sel);
  return wrap;
}

export const scatterChartDemo: DemoComponent = new ScatterChartDemo();
