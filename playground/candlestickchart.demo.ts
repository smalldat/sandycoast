import type { Candle, CandleSeries, OhlcDataSet } from '../src/index.js';
import { CandlestickChart } from '../src/index.js';
import type { ControlGroup } from './controls.js';
import { renderControls } from './controls.js';
import { clearSettings, deepMerge, loadSettings, saveSettings } from './persist.js';
import type { DemoComponent } from './registry.js';
import { chartPalette } from './theme.js';

/** The instruments the slider switches between. */
const INSTRUMENTS = [
  { key: 'ACME', start: 120, drift: 0.15, vol: 1.8 },
  { key: 'GLOBEX', start: 42, drift: -0.06, vol: 0.9 },
  { key: 'INITECH', start: 310, drift: 0.4, vol: 5.2 },
];

/** Hard cap so the candle-count control can't wedge the tab. */
const MAX_CANDLES = 2000;

type DataMode = 'calm' | 'volatile' | 'rally';

/** Mulberry32-ish PRNG so a given seed always regenerates the same series. */
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

const DAY = 24 * 60 * 60 * 1000;

/** Midnight today, so generated series always end on a familiar date. */
function today(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * `n` trading days ending today, weekends skipped — the gaps are what make
 * `spacing: 'band'` (collapse them) versus `'time'` (show them) visible.
 */
function tradingDays(n: number): Date[] {
  const out: Date[] = [];
  let t = today();
  while (out.length < n) {
    const day = new Date(t).getDay();
    if (day !== 0 && day !== 6) out.push(new Date(t));
    t -= DAY;
  }
  return out.reverse();
}

class CandlestickChartDemo implements DemoComponent {
  id = 'candlestick';
  label = 'Candlestick chart';
  preferredLayout = 'lr' as const;

  private cfg: Cfg = defaultConfig();
  private data: OhlcDataSet = { series: [] };
  private chart: CandlestickChart | null = null;
  private chartEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private hoverEl!: HTMLElement;
  private focusEl!: HTMLElement;
  private panelEl!: HTMLElement;

  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private addTimer: ReturnType<typeof setInterval> | null = null;
  private seed = 1;
  /** Snapshot of the data params last generated from, to detect changes. */
  private dataKey = '';

  private get mode(): DataMode {
    if (this.cfg.dataMode === 'volatile') return 'volatile';
    if (this.cfg.dataMode === 'rally') return 'rally';
    return 'calm';
  }

  private get candleCount(): number {
    const n = Number(this.cfg.candleCount) || 60;
    return Math.max(2, Math.min(MAX_CANDLES, Math.round(n)));
  }

  /** One instrument's candles: a random walk where each open is the last close. */
  private sampleSeries(si: number, n: number, rand: () => number): Candle[] {
    const inst = INSTRUMENTS[si]!;
    const volScale = this.mode === 'volatile' ? 2.6 : this.mode === 'rally' ? 1.1 : 1;
    const driftScale = this.mode === 'rally' ? 4 : 1;
    const dates = tradingDays(n);
    const candles: Candle[] = [];
    let price = inst.start;
    for (let i = 0; i < n; i++) {
      const open = price;
      const move = inst.drift * driftScale + gaussian(rand) * inst.vol * volScale;
      const close = Math.max(0.5, open + move);
      // Wicks reach beyond the body by a fraction of the period's own move.
      const reach = Math.abs(move) * 0.6 + inst.vol * volScale * 0.4 * rand();
      candles.push({
        x: dates[i]!,
        open: round(open),
        high: round(Math.max(open, close) + reach * rand()),
        low: round(Math.max(0.1, Math.min(open, close) - reach * rand())),
        close: round(close),
      });
      price = close;
    }
    // Only the newest candle carries a live price — that is the bar still
    // being filled, and it is what the live-price line reads.
    const last = candles[candles.length - 1];
    if (last) last.actual = round(last.close + gaussian(rand) * inst.vol * 0.5);
    return candles;
  }

  /** (Re)generate every instrument from the current mode + candle count. */
  private regenerate(): void {
    const rand = rng(this.seed++);
    const n = this.candleCount;
    const series: CandleSeries[] = INSTRUMENTS.map((inst, si) => ({
      key: inst.key,
      candles: this.sampleSeries(si, n, rand),
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
    const tick = button('Tick price', () => this.tickPrice());
    const addBtn = button('Add candle', () => this.addCandle());
    const rem = button('Remove oldest', () => this.chart?.remove(0));
    const nextInst = button('Next instrument', () => this.nextInstrument());
    const contTick = toggle('Continuous ticking', (on) =>
      this.setContinuous('tickTimer', on, 400, () => this.tickPrice()),
    );
    const contAdd = toggle('Continuous candles', (on) =>
      this.setContinuous('addTimer', on, 1200, () => this.addCandle()),
    );
    const clearFocus = button('Clear legend focus', () => this.chart?.focusSeries(null));
    liveBar.append(tick, addBtn, rem, nextInst, contTick, contAdd, clearFocus);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'status';
    this.hoverEl = document.createElement('div');
    this.hoverEl.className = 'hover';
    this.hoverEl.textContent = 'hover a candle…';
    this.focusEl = document.createElement('div');
    this.focusEl.className = 'status';
    this.focusEl.textContent = 'nothing isolated — click Rising/Falling in the legend';
    host.append(this.chartEl, toolbar, liveBar, this.statusEl, this.hoverEl, this.focusEl);

    this.renderPanel();
    this.build();
  }

  private renderPanel(): void {
    renderControls(this.panelEl, this.cfg, GROUPS, () => {
      saveSettings(this.id, this.cfg);
      // Regenerate only when the data shape (mode / candle count) changed;
      // other edits keep the current (possibly live-mutated) data so morph
      // transitions and any in-flight ticking stay visible.
      const key = `${this.mode}:${this.candleCount}`;
      if (key !== this.dataKey) {
        this.regenerate();
        this.rebuild(false);
      } else {
        this.rebuild(true);
      }
    });
  }

  unmount(): void {
    this.stopTimer('tickTimer');
    this.stopTimer('addTimer');
    this.chart?.dispose();
    this.chart = null;
  }

  /**
   * Move the live price on the newest candle, exactly as a market feed would:
   * patch `close`/`actual` (and stretch high/low if the tick broke the range)
   * without touching any older bar.
   */
  private tickPrice(): void {
    const chart = this.chart;
    if (!chart) return;
    const series = chart.getData().series[chart.getSeriesIndex()];
    const last = series?.candles[series.candles.length - 1];
    if (!last) return;
    const rand = rng(Date.now() & 0xffffffff);
    const move = gaussian(rand) * Math.max(0.4, Math.abs(last.close) * 0.01);
    const close = round(Math.max(0.5, last.close + move));
    chart.update([
      {
        x: last.x,
        close,
        actual: close,
        high: round(Math.max(last.high, close)),
        low: round(Math.min(last.low, close)),
      },
    ]);
  }

  /** Append the next trading day; drop the oldest once over the budget. */
  private addCandle(): void {
    const chart = this.chart;
    if (!chart) return;
    const si = chart.getSeriesIndex();
    const series = chart.getData().series[si];
    const last = series?.candles[series.candles.length - 1];
    if (!last) return;
    const rand = rng(Date.now() & 0xffffffff);
    const open = last.close;
    const move = gaussian(rand) * Math.max(0.5, Math.abs(open) * 0.015);
    const close = round(Math.max(0.5, open + move));
    const reach = Math.abs(move) * 0.8;
    let next = new Date((last.x as Date).getTime() + DAY);
    while (next.getDay() === 0 || next.getDay() === 6) next = new Date(next.getTime() + DAY);
    chart.add({
      x: next,
      open: round(open),
      high: round(Math.max(open, close) + reach * rand()),
      low: round(Math.max(0.1, Math.min(open, close) - reach * rand())),
      close,
      actual: close,
    });
    if ((chart.getData().series[si]?.candles.length ?? 0) > this.candleCount) chart.remove(0);
  }

  private nextInstrument(): void {
    const chart = this.chart;
    if (!chart) return;
    chart.setSeriesIndex((chart.getSeriesIndex() + 1) % Math.max(1, chart.seriesCount));
  }

  private setContinuous(
    key: 'tickTimer' | 'addTimer',
    on: boolean,
    ms: number,
    fn: () => void,
  ): void {
    this.stopTimer(key);
    if (on) this[key] = setInterval(fn, ms);
  }

  private stopTimer(key: 'tickTimer' | 'addTimer'): void {
    if (this[key]) {
      clearInterval(this[key]!);
      this[key] = null;
    }
  }

  // Swap the whole config to a named preset (candle count is kept from the
  // current cfg; a preset may still set its own `dataMode`), persist, refresh
  // the panel, regenerate if the data shape changed, then rebuild.
  private applyPreset(name: PresetName): void {
    this.cfg = deepMerge(presets()[name], { candleCount: this.cfg.candleCount });
    saveSettings(this.id, this.cfg);
    this.renderPanel();
    const key = `${this.mode}:${this.candleCount}`;
    const regenerated = key !== this.dataKey;
    if (regenerated) this.regenerate();
    this.rebuild(!regenerated);
  }

  private build(): void {
    this.chart = new CandlestickChart(this.chartEl, {
      ...(this.cfg as object),
      data: this.data,
    } as never);
    this.chart.whenReady().then(() => this.refreshStatus());
    this.chart.on('hover', ({ candle }) => {
      this.hoverEl.textContent = candle
        ? `${fmtDate(candle.xValue)} · O ${candle.open} H ${candle.high} L ${candle.low} C ${candle.close} · ${candle.rising ? 'rising' : 'falling'}`
        : 'hover a candle…';
    });
    this.chart.on('click', ({ candle }) => {
      if (candle)
        this.hoverEl.textContent = `clicked ${fmtDate(candle.xValue)} · C ${candle.close}`;
    });
    this.chart.on('seriesChange', () => this.refreshStatus());
    this.chart.on('seriesFocus', ({ index }) => {
      this.focusEl.textContent =
        index === null
          ? 'nothing isolated — click Rising/Falling in the legend'
          : `isolated: ${index === 0 ? 'rising' : 'falling'} candles`;
    });
  }

  private refreshStatus(): void {
    const chart = this.chart;
    if (!chart) return;
    const key = String(chart.getSeriesKeys()[chart.getSeriesIndex()] ?? '?');
    const n = chart.getData().series[chart.getSeriesIndex()]?.candles.length ?? 0;
    this.statusEl.textContent = `backend: ${chart.backend ?? '?'} · ${key} · ${n} candles`;
  }

  // Config is construct-time; any edit disposes and rebuilds. When `keepData` is
  // true, capture the live data first so continuous ticking survives.
  private rebuild(keepData = true): void {
    if (keepData && this.chart) this.data = this.chart.getData();
    const index = this.chart?.getSeriesIndex() ?? 0;
    this.chart?.dispose();
    this.cfg.seriesIndex = index;
    this.build();
  }
}

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

function fmtDate(v: unknown): string {
  return v instanceof Date ? v.toLocaleDateString('en-US') : String(v);
}

// Full editable config (everything except `data`), plus two demo-only keys
// (`dataMode`, `candleCount`) the CandlestickChart ignores.
type Cfg = Record<string, unknown>;

function defaultConfig(): Cfg {
  const palette = chartPalette();
  return {
    dataMode: 'calm',
    candleCount: 60,
    grainDensity: 1.1,
    maxGrains: 100000,
    background: palette.background,
    backend: 'auto',
    spacing: 'band',
    seriesIndex: 0,
    grain: { sizePx: 2, shape: 'disc', jitter: 0.7, settleJitter: 0.004 },
    candles: {
      rising: '#2eb872',
      falling: '#e0555c',
      direction: 'openClose',
      body: 'openClose',
      width: 0.62,
      fill: { opacity: 0.9 },
      border: { show: true, width: 1, opacity: 1 },
      wick: { show: true, width: 1, opacity: 0.9 },
      reveal: { start: 'afterPour', duration: 500, ease: 'easeOutCubic', grainsTo: 0.12 },
    },
    actual: {
      show: true,
      color: palette.text,
      width: 1,
      opacity: 0.9,
      marker: true,
    },
    animation: {
      duration: 700,
      stagger: 500,
      ease: 'easeOutCubic',
      morphDuration: 900,
      reflow: 'translate',
      morphGrains: true,
      enter: 'pour',
      exit: 'fall',
    },
    interaction: {
      hover: {
        effects: ['highlight', 'jitter'],
        highlightGain: 1.6,
        jitterAmp: 0.008,
        opacity: 1,
        fadeMs: 180,
      },
      dim: { opacity: 0.15, fadeMs: 200 },
    },
    axes: {
      x: { show: true, ticks: 6, label: '', gridLines: false, color: palette.axis, fontPx: 11 },
      y: { show: true, ticks: 5, label: '', gridLines: true, color: palette.axis, fontPx: 11 },
    },
    slider: { show: true, position: 'bottom', interactive: true, handlePx: 7, trackPx: 3 },
    legend: { show: true, position: 'top', align: 'end', swatch: 'square', interactive: true },
    currentValue: {
      show: true,
      mode: 'pointer',
      guide: 'both',
      markers: true,
      color: palette.text,
    },
    fps: { position: 'off', color: palette.text },
    panZoom: {
      enabled: true,
      axes: 'x',
      minZoom: 1,
      maxZoom: 12,
      wheel: true,
      drag: true,
      controls: { show: true, position: 'top-left', step: 1.4 },
    },
  };
}

// Named starting points. Each is a full config: `Default` is the untouched
// baseline; the others overlay `defaultConfig()` with a distinct look.
const PRESET_NAMES = [
  'Default',
  'Sand only (no solid bodies)',
  'Range bars (low-high)',
  'Close-to-close coloring',
  'Real time gaps',
] as const;
type PresetName = (typeof PRESET_NAMES)[number];

function presets(): Record<PresetName, Cfg> {
  const base = defaultConfig();
  return {
    Default: base,
    // No `fill`/`border` block at all: the bodies stay sand forever and only
    // the wicks are solid — the chart's most particle-forward look.
    'Sand only (no solid bodies)': deepMerge(defaultConfig(), {
      grainDensity: 2.2,
      grain: { sizePx: 2.6, jitter: 0.85 },
      candles: {
        fill: undefined,
        border: undefined,
        width: 0.8,
        reveal: { grainsTo: 1 },
      },
    }),
    'Range bars (low-high)': deepMerge(defaultConfig(), {
      dataMode: 'volatile',
      candles: { body: 'lowHigh', width: 0.5, fill: { opacity: 0.7 } },
    }),
    'Close-to-close coloring': deepMerge(defaultConfig(), {
      dataMode: 'rally',
      candles: { direction: 'closeClose' },
    }),
    'Real time gaps': deepMerge(defaultConfig(), {
      spacing: 'time',
      candleCount: 30,
      candles: { width: 0.7 },
      axes: { x: { ticks: 5 } },
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
          { value: 'calm', label: 'calm' },
          { value: 'volatile', label: 'volatile' },
          { value: 'rally', label: 'rally' },
        ],
      },
      {
        kind: 'number',
        label: 'Candles per instrument (≤2000)',
        path: 'candleCount',
        min: 2,
        max: 2000,
        step: 1,
      },
      {
        kind: 'select',
        label: 'X spacing',
        path: 'spacing',
        options: [
          { value: 'band', label: 'band (collapse gaps)' },
          { value: 'time', label: 'time (show gaps)' },
        ],
      },
    ],
  },
  {
    title: 'Candles',
    controls: [
      { kind: 'color', label: 'Rising color', path: 'candles.rising' },
      { kind: 'color', label: 'Falling color', path: 'candles.falling' },
      {
        kind: 'select',
        label: 'Color rule (which difference)',
        path: 'candles.direction',
        options: [
          { value: 'openClose', label: 'open → close' },
          { value: 'closeClose', label: 'close → previous close' },
          { value: 'lowHigh', label: 'low-high range midpoint' },
          { value: 'closeInRange', label: 'close within its range' },
        ],
      },
      {
        kind: 'select',
        label: 'Body spans',
        path: 'candles.body',
        options: [
          { value: 'openClose', label: 'open → close (+ wicks)' },
          { value: 'lowHigh', label: 'low → high (range bar)' },
        ],
      },
      { kind: 'slider', label: 'Body width', path: 'candles.width', min: 0.05, max: 1, step: 0.02 },
      {
        kind: 'slider',
        label: 'Fill opacity',
        path: 'candles.fill.opacity',
        min: 0,
        max: 1,
        step: 0.05,
      },
      { kind: 'checkbox', label: 'Border', path: 'candles.border.show' },
      {
        kind: 'slider',
        label: 'Border width (px)',
        path: 'candles.border.width',
        min: 0.5,
        max: 5,
        step: 0.5,
      },
      { kind: 'checkbox', label: 'Wicks', path: 'candles.wick.show' },
      {
        kind: 'slider',
        label: 'Wick width (px)',
        path: 'candles.wick.width',
        min: 0.5,
        max: 5,
        step: 0.5,
      },
      {
        kind: 'slider',
        label: 'Wick opacity',
        path: 'candles.wick.opacity',
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        kind: 'slider',
        label: 'Reveal duration (ms)',
        path: 'candles.reveal.duration',
        min: 0,
        max: 3000,
        step: 50,
      },
      {
        kind: 'slider',
        label: 'Grains end opacity',
        path: 'candles.reveal.grainsTo',
        min: 0,
        max: 1,
        step: 0.05,
      },
    ],
  },
  {
    title: 'Live price line',
    controls: [
      { kind: 'checkbox', label: 'Show', path: 'actual.show' },
      { kind: 'color', label: 'Color', path: 'actual.color' },
      { kind: 'slider', label: 'Width (px)', path: 'actual.width', min: 0.5, max: 5, step: 0.5 },
      { kind: 'slider', label: 'Opacity', path: 'actual.opacity', min: 0, max: 1, step: 0.05 },
      { kind: 'checkbox', label: 'Price-axis marker', path: 'actual.marker' },
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
      { kind: 'slider', label: 'Grid jitter', path: 'grain.jitter', min: 0, max: 1, step: 0.02 },
      {
        kind: 'slider',
        label: 'Settle jitter',
        path: 'grain.settleJitter',
        min: 0,
        max: 0.05,
        step: 0.002,
      },
      { kind: 'color', label: 'Background', path: 'background' },
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
          { value: 'withCandle', label: 'With candle' },
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
    title: 'Legend dim (click to isolate)',
    controls: [
      {
        kind: 'slider',
        label: 'Dimmed opacity',
        path: 'interaction.dim.opacity',
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        kind: 'slider',
        label: 'Fade (ms)',
        path: 'interaction.dim.fadeMs',
        min: 0,
        max: 600,
        step: 20,
      },
    ],
  },
  {
    title: 'Instrument slider',
    controls: [
      { kind: 'checkbox', label: 'Show', path: 'slider.show' },
      {
        kind: 'select',
        label: 'Position',
        path: 'slider.position',
        options: [
          { value: 'bottom', label: 'bottom' },
          { value: 'top', label: 'top' },
        ],
      },
      { kind: 'checkbox', label: 'Interactive', path: 'slider.interactive' },
      { kind: 'slider', label: 'Handle (px)', path: 'slider.handlePx', min: 3, max: 14, step: 1 },
      { kind: 'slider', label: 'Track (px)', path: 'slider.trackPx', min: 1, max: 10, step: 1 },
    ],
  },
  {
    title: 'X axis (period)',
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
    title: 'Y axis (price)',
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
        options: (['x', 'both', 'y'] as const).map((v) => ({ value: v, label: v })),
      },
      { kind: 'slider', label: 'Max zoom', path: 'panZoom.maxZoom', min: 1, max: 40, step: 1 },
      { kind: 'checkbox', label: 'Wheel zoom', path: 'panZoom.wheel' },
      { kind: 'checkbox', label: 'Drag pan', path: 'panZoom.drag' },
      { kind: 'checkbox', label: 'Zoom controls', path: 'panZoom.controls.show' },
      {
        kind: 'select',
        label: 'Controls corner',
        path: 'panZoom.controls.position',
        options: (['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const).map((v) => ({
          value: v,
          label: v,
        })),
      },
      { kind: 'checkbox', label: 'Legend show', path: 'legend.show' },
      {
        kind: 'select',
        label: 'Legend position',
        path: 'legend.position',
        options: (['top', 'bottom', 'left', 'right'] as const).map((v) => ({ value: v, label: v })),
      },
      {
        kind: 'select',
        label: 'Legend align',
        path: 'legend.align',
        options: (['end', 'center', 'start'] as const).map((v) => ({ value: v, label: v })),
      },
      {
        kind: 'select',
        label: 'Legend swatch',
        path: 'legend.swatch',
        options: [
          { value: 'square', label: 'square' },
          { value: 'disc', label: 'disc' },
        ],
      },
      {
        kind: 'checkbox',
        label: 'Legend interactive (click to isolate)',
        path: 'legend.interactive',
      },
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

export const candlestickChartDemo: DemoComponent = new CandlestickChartDemo();
