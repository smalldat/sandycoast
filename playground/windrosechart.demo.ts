import type { WindDataSet, WindPoint } from '../src/index.js';
import { WindRoseChart } from '../src/index.js';
import type { ControlGroup } from './controls.js';
import { renderControls } from './controls.js';
import { clearSettings, deepMerge, loadSettings, saveSettings } from './persist.js';
import type { DemoComponent } from './registry.js';
import { chartPalette } from './theme.js';

/** Hard cap so the readings control can't wedge the tab. */
const MAX_READINGS = 4000;

type DataMode = 'prevailing' | 'bimodal' | 'variable';

/** Mulberry32-ish PRNG so a given seed always regenerates the same weather. */
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

class WindRoseChartDemo implements DemoComponent {
  id = 'windrose';
  label = 'Wind rose';
  preferredLayout = 'lr' as const;

  private cfg: Cfg = defaultConfig();
  private data: WindDataSet = { points: [], intensityUnit: 'kt' };
  private chart: WindRoseChart | null = null;
  private chartEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private hoverEl!: HTMLElement;
  private selectEl!: HTMLElement;
  private hookLogEl!: HTMLElement;
  private panelEl!: HTMLElement;

  private streamTimer: ReturnType<typeof setInterval> | null = null;
  private seed = 1;
  /** Snapshot of the data params last generated from, to detect changes. */
  private dataKey = '';
  /** Walks forward as readings stream in, so times stay monotonic. */
  private clock = Date.now();
  /** Direction the synthetic weather is currently blowing from, degrees. */
  private heading = 315;

  // Mouse-hook demo switches. They install real hooks on the next rebuild, so
  // the override contract is demonstrable rather than only documented.
  private hooks = { shiftSuppresses: false, logHover: false, dblClears: true };

  private get mode(): DataMode {
    if (this.cfg.dataMode === 'bimodal') return 'bimodal';
    if (this.cfg.dataMode === 'variable') return 'variable';
    return 'prevailing';
  }

  private get readingCount(): number {
    const n = Number(this.cfg.readingCount) || 300;
    return Math.max(4, Math.min(MAX_READINGS, Math.round(n)));
  }

  /** One reading of synthetic weather, walking `heading` forward as it goes. */
  private sample(rand: () => number, stepMs: number): WindPoint {
    if (this.mode === 'bimodal') {
      // Two prevailing regimes — a sea breeze and a land breeze — so the rose
      // grows two opposing lobes rather than one.
      const regime = rand() < 0.6 ? 300 : 120;
      this.heading = regime + gaussian(rand) * 18;
    } else if (this.mode === 'variable') {
      // A near-random walk: no prevailing direction to find.
      this.heading += gaussian(rand) * 40;
    } else {
      // Prevailing NW with slow drift and occasional veering.
      this.heading += gaussian(rand) * 7;
      this.heading += (315 - this.heading) * 0.06;
    }
    const gust = rand() < 0.12 ? 9 + rand() * 14 : 0;
    const intensity = Math.max(0, 5 + gaussian(rand) * 3.5 + gust);
    this.clock += stepMs;
    return { t: new Date(this.clock), direction: this.heading, intensity };
  }

  /** (Re)generate the full dataset from the current mode + reading count. */
  private regenerate(): void {
    const rand = rng(this.seed++);
    const n = this.readingCount;
    // Half-hourly readings ending now, so the time column reads like a log.
    const stepMs = 30 * 60 * 1000;
    this.clock = Date.now() - n * stepMs;
    this.heading = 315;
    const points: WindPoint[] = [];
    for (let i = 0; i < n; i++) points.push(this.sample(rand, stepMs));
    this.data = { points, intensityUnit: 'kt', intensityLabel: 'Speed' };
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
      this.chart?.setData(this.data);
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
    const one = button('New reading', () => this.pushReading());
    const stream = toggle('Stream readings', (on) => {
      this.stopStream();
      if (on) this.streamTimer = setInterval(() => this.pushReading(), 700);
    });
    const jump = button('Select latest', () => {
      const latest = this.chart?.getHighlighted()[0];
      if (latest) this.chart?.selectObservation(latest.id);
    });
    const clearSel = button('Clear selection', () => this.chart?.selectObservation(null));
    liveBar.append(one, stream, jump, clearSel);

    // Mouse-hook switches: each rebuilds so the hook is installed for real.
    const hookBar = document.createElement('div');
    hookBar.className = 'toolbar';
    hookBar.append(
      toggle('Shift-click suppresses select', (on) => {
        this.hooks.shiftSuppresses = on;
        this.rebuild();
      }),
      toggle('Log hover (cancels highlight)', (on) => {
        this.hooks.logHover = on;
        this.rebuild();
      }),
      toggle('Double-click clears', (on) => {
        this.hooks.dblClears = on;
        this.rebuild();
      }),
    );

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'status';
    this.hoverEl = document.createElement('div');
    this.hoverEl.className = 'hover';
    this.hoverEl.textContent = 'hover a petal…';
    this.selectEl = document.createElement('div');
    this.selectEl.className = 'status';
    this.selectEl.textContent = 'nothing selected — click a petal or a table row';
    this.hookLogEl = document.createElement('div');
    this.hookLogEl.className = 'status';
    this.hookLogEl.textContent = 'mouse hooks idle';

    host.append(
      this.chartEl,
      toolbar,
      liveBar,
      hookBar,
      this.statusEl,
      this.hoverEl,
      this.selectEl,
      this.hookLogEl,
    );

    this.renderPanel();
    this.build();
  }

  private renderPanel(): void {
    renderControls(this.panelEl, this.cfg, GROUPS, () => {
      saveSettings(this.id, this.cfg);
      // Regenerate only when the data shape changed; other edits keep the
      // current (possibly streaming) data so morph transitions stay visible.
      const key = `${this.mode}:${this.readingCount}`;
      if (key !== this.dataKey) {
        this.regenerate();
        this.rebuild(false);
      } else {
        this.rebuild(true);
      }
    });
  }

  unmount(): void {
    this.stopStream();
    this.chart?.dispose();
    this.chart = null;
  }

  /** Append one reading — the streaming case the 'grow' entry animates. */
  private pushReading(): void {
    const rand = rng((Date.now() ^ this.seed++) & 0xffffffff);
    this.chart?.add([this.sample(rand, 30 * 60 * 1000)]);
    // Keep the window bounded so a long stream doesn't grow without end.
    const count = this.chart?.getData().points.length ?? 0;
    if (count > this.readingCount) this.chart?.remove([0]);
  }

  private stopStream(): void {
    if (this.streamTimer) {
      clearInterval(this.streamTimer);
      this.streamTimer = null;
    }
  }

  private applyPreset(name: PresetName): void {
    this.cfg = deepMerge(presets()[name], {
      readingCount: this.cfg.readingCount,
      dataMode: this.cfg.dataMode,
    });
    saveSettings(this.id, this.cfg);
    this.renderPanel();
    const key = `${this.mode}:${this.readingCount}`;
    const regenerated = key !== this.dataKey;
    if (regenerated) this.regenerate();
    this.rebuild(!regenerated);
  }

  /** The demo's mouse hooks, built from the toolbar switches. */
  private mouseHooks(): Record<string, unknown> {
    const log = (msg: string) => {
      this.hookLogEl.textContent = msg;
    };
    const hooks: Record<string, unknown> = {};
    if (this.hooks.shiftSuppresses) {
      hooks.onPetalClick = (ctx: {
        meta: { bearing: string } | null;
        native: MouseEvent;
        defaultAction: () => void;
      }) => {
        if (ctx.native.shiftKey) {
          log(`hook: suppressed select on ${ctx.meta?.bearing ?? 'background'} (shift held)`);
          return false;
        }
        log(`hook: default select on ${ctx.meta?.bearing ?? '—'}`);
        ctx.defaultAction();
      };
    }
    if (this.hooks.logHover) {
      hooks.onPetalHover = (ctx: { meta: { bearing: string } | null }) => {
        log(`hook: hover ${ctx.meta?.bearing ?? '—'} (default highlight cancelled)`);
        return false;
      };
    }
    if (!this.hooks.dblClears) {
      hooks.onPetalDblClick = () => {
        log('hook: double-click ignored');
        return false;
      };
    }
    return hooks;
  }

  private build(): void {
    const cfg = this.cfg as Record<string, unknown>;
    const interaction = { ...((cfg.interaction as object) ?? {}), mouse: this.mouseHooks() };
    this.chart = new WindRoseChart(this.chartEl, {
      ...cfg,
      interaction,
      data: this.data,
    } as never);
    this.chart.whenReady().then(() => {
      const dropped = this.chart?.getDroppedCount() ?? 0;
      const segs = this.chart?.getSegments().length ?? 0;
      this.statusEl.textContent =
        `backend: ${this.chart?.backend ?? '?'} · ${this.data.points.length} readings · ` +
        `${segs} segments${dropped > 0 ? ` · ${dropped} dropped` : ''}`;
    });
    this.chart.on('hover', ({ segment }) => {
      this.hoverEl.textContent = segment
        ? `${segment.bearing} · ${segment.count} reading(s) · ${Math.round(segment.intensityMin)}–${Math.round(segment.intensityMax)} kt`
        : 'hover a petal…';
    });
    this.chart.on('select', ({ segmentKey, observationId }) => {
      this.selectEl.textContent =
        segmentKey === null
          ? 'nothing selected — click a petal or a table row'
          : `selected ${segmentKey}${observationId !== null ? ` · reading #${observationId}` : ''}`;
    });
  }

  // Config is construct-time; any edit disposes and rebuilds. When `keepData`
  // is true, capture the live data first so a running stream survives.
  private rebuild(keepData = true): void {
    if (keepData && this.chart) this.data = this.chart.getData();
    this.chart?.dispose();
    this.build();
  }
}

// Full editable config (everything except `data`), plus two demo-only keys
// (`dataMode`, `readingCount`) the WindRoseChart ignores.
type Cfg = Record<string, unknown>;

function defaultConfig(): Cfg {
  const palette = chartPalette();
  return {
    dataMode: 'prevailing',
    readingCount: 300,
    grainDensity: 1.1,
    maxGrains: 100000,
    background: palette.background,
    colors: ['#8bc4e8', '#5ae89a', '#e8c45a', '#e8895a', '#e8598b'],
    backend: 'auto',
    radius: 0.92,
    innerRadius: 0,
    north: 0,
    clockwise: true,
    grain: { sizePx: 2.4, shape: 'disc', jitter: 0.7, settleJitter: 0.006 },
    sectors: { count: 16, align: 'centered' },
    petals: { mode: 'bands', order: 'intensity', width: 0.9, padAngle: 0, rampSteps: 16 },
    radial: { measure: 'count', labelAngle: 11.25 },
    bands: { derive: 'equal', count: 4 },
    calm: { below: 1, show: true, color: '#5b6472' },
    highlight: { show: true, select: 'latest', mode: 'glow', gain: 1.9, outlinePx: 2 },
    animation: {
      duration: 700,
      stagger: 450,
      ease: 'easeOutCubic',
      morphDuration: 900,
      reflow: 'translate',
      morphGrains: true,
      enter: 'grow',
      exit: 'shrink',
    },
    interaction: {
      hover: {
        effects: ['highlight', 'jitter'],
        highlightGain: 1.7,
        jitterAmp: 0.008,
        opacity: 1,
        fadeMs: 180,
      },
      dim: { opacity: 0.15, fadeMs: 200 },
    },
    axes: {
      x: { show: true, ticks: 8, color: palette.axis, fontPx: 11 },
      y: { show: true, ticks: 4, color: palette.axis, fontPx: 10 },
    },
    legend: { show: true, position: 'bottom', align: 'center' },
    table: { show: true, position: 'right', maxRows: 200, followSelection: true },
    title: { text: 'Wind rose', position: 'top', align: 'center' },
    currentValue: { show: true, mode: 'pointer' },
    segments: { fill: { opacity: 0.9 }, border: { show: true, width: 1, opacity: 0.9 } },
    fps: { position: 'off' },
  };
}

const PRESET_NAMES = ['Default', 'Per-observation', 'Grainy donut rose'] as const;
type PresetName = (typeof PRESET_NAMES)[number];

function presets(): Record<PresetName, Cfg> {
  const base = defaultConfig();
  return {
    Default: base,
    // The mode that makes "this exact reading" addressable: one segment per
    // observation, colored by an intensity ramp, latest three glowing.
    'Per-observation': deepMerge(base, {
      petals: { mode: 'observations', order: 'intensity', maxSegmentsPerSector: 120 },
      colors: ['#1d3b53', '#2f7fa8', '#5ac8c8', '#e8c45a', '#e8598b'],
      highlight: { select: 'latestN', count: 3, ramp: true, mode: 'outline', color: '#ffffff' },
      legend: { show: false },
      segments: { fill: { opacity: 0.95 }, border: { show: false } },
    }),
    'Grainy donut rose': deepMerge(base, {
      grainDensity: 2.2,
      grain: { sizePx: 1.8, jitter: 0.9 },
      innerRadius: 0.28,
      radial: { measure: 'percent' },
      petals: { width: 0.75, padAngle: 1 },
      segments: { fill: { opacity: 0.55 }, border: { show: true, width: 1, opacity: 1 } },
    }),
  };
}

const GROUPS: ControlGroup[] = [
  {
    title: 'Data',
    controls: [
      {
        kind: 'select',
        label: 'Weather',
        path: 'dataMode',
        options: [
          { value: 'prevailing', label: 'Prevailing NW' },
          { value: 'bimodal', label: 'Two regimes' },
          { value: 'variable', label: 'Variable' },
        ],
      },
      { kind: 'number', label: 'Readings', path: 'readingCount', min: 4, max: 4000, step: 10 },
    ],
  },
  {
    title: 'Geometry',
    controls: [
      { kind: 'slider', label: 'Radius', path: 'radius', min: 0.3, max: 1, step: 0.01 },
      { kind: 'slider', label: 'Inner radius', path: 'innerRadius', min: 0, max: 0.9, step: 0.01 },
      { kind: 'slider', label: 'North (deg)', path: 'north', min: 0, max: 360, step: 1 },
      { kind: 'checkbox', label: 'Clockwise bearings', path: 'clockwise' },
    ],
  },
  {
    title: 'Sectors',
    controls: [
      { kind: 'number', label: 'Count', path: 'sectors.count', min: 2, max: 64, step: 1 },
      {
        kind: 'select',
        label: 'Align',
        path: 'sectors.align',
        options: [
          { value: 'centered', label: 'centered on point' },
          { value: 'edge', label: 'starts at point' },
        ],
      },
    ],
  },
  {
    title: 'Petals',
    controls: [
      {
        kind: 'select',
        label: 'Mode',
        path: 'petals.mode',
        options: [
          { value: 'bands', label: 'intensity bands' },
          { value: 'observations', label: 'one per reading' },
        ],
      },
      {
        kind: 'select',
        label: 'Order',
        path: 'petals.order',
        options: [
          { value: 'intensity', label: 'by intensity' },
          { value: 'time', label: 'by time' },
        ],
      },
      { kind: 'slider', label: 'Width', path: 'petals.width', min: 0.1, max: 1, step: 0.01 },
      {
        kind: 'slider',
        label: 'Pad angle (deg)',
        path: 'petals.padAngle',
        min: 0,
        max: 10,
        step: 0.1,
      },
      {
        kind: 'number',
        label: 'Max segments/sector',
        path: 'petals.maxSegmentsPerSector',
        min: 1,
        max: 500,
        step: 1,
      },
      { kind: 'number', label: 'Ramp steps', path: 'petals.rampSteps', min: 2, max: 64, step: 1 },
    ],
  },
  {
    title: 'Radial scale',
    controls: [
      {
        kind: 'select',
        label: 'Measure',
        path: 'radial.measure',
        options: [
          { value: 'count', label: 'count' },
          { value: 'percent', label: 'percent' },
          { value: 'intensitySum', label: 'summed speed' },
          { value: 'intensityMax', label: 'strongest' },
        ],
      },
      { kind: 'number', label: 'Max (0 = auto)', path: 'radial.max', min: 0, step: 1 },
      {
        kind: 'slider',
        label: 'Label angle',
        path: 'radial.labelAngle',
        min: 0,
        max: 360,
        step: 1,
      },
    ],
  },
  {
    title: 'Bands',
    controls: [
      {
        kind: 'select',
        label: 'Derive',
        path: 'bands.derive',
        options: [
          { value: 'equal', label: 'equal width' },
          { value: 'quantile', label: 'quantile' },
        ],
      },
      { kind: 'number', label: 'Count', path: 'bands.count', min: 2, max: 8, step: 1 },
    ],
  },
  {
    title: 'Calm circle',
    controls: [
      { kind: 'slider', label: 'Below (kt)', path: 'calm.below', min: 0, max: 10, step: 0.5 },
      { kind: 'checkbox', label: 'Show', path: 'calm.show' },
      { kind: 'color', label: 'Color', path: 'calm.color' },
    ],
  },
  {
    title: 'Latest highlight',
    controls: [
      { kind: 'checkbox', label: 'Show', path: 'highlight.show' },
      {
        kind: 'select',
        label: 'Select',
        path: 'highlight.select',
        options: [
          { value: 'latest', label: 'newest reading' },
          { value: 'latestN', label: 'newest N' },
          { value: 'latestTimestamp', label: 'newest timestamp' },
        ],
      },
      { kind: 'number', label: 'Count', path: 'highlight.count', min: 1, max: 50, step: 1 },
      { kind: 'checkbox', label: 'Recency ramp', path: 'highlight.ramp' },
      {
        kind: 'select',
        label: 'Mode',
        path: 'highlight.mode',
        options: [
          { value: 'glow', label: 'glow' },
          { value: 'outline', label: 'outline' },
          { value: 'color', label: 'recolor' },
        ],
      },
      { kind: 'color', label: 'Color', path: 'highlight.color' },
      { kind: 'slider', label: 'Gain', path: 'highlight.gain', min: 1, max: 3, step: 0.05 },
      {
        kind: 'slider',
        label: 'Outline px',
        path: 'highlight.outlinePx',
        min: 1,
        max: 6,
        step: 0.5,
      },
    ],
  },
  {
    title: 'Grains',
    controls: [
      { kind: 'slider', label: 'Density', path: 'grainDensity', min: 0.1, max: 3, step: 0.05 },
      {
        kind: 'number',
        label: 'Max grains',
        path: 'maxGrains',
        min: 1000,
        max: 300000,
        step: 1000,
      },
      { kind: 'slider', label: 'Size px', path: 'grain.sizePx', min: 0.5, max: 8, step: 0.1 },
      {
        kind: 'select',
        label: 'Shape',
        path: 'grain.shape',
        options: [
          { value: 'disc', label: 'disc' },
          { value: 'quad', label: 'quad' },
        ],
      },
      { kind: 'slider', label: 'Jitter', path: 'grain.jitter', min: 0, max: 1, step: 0.01 },
      {
        kind: 'slider',
        label: 'Settle jitter',
        path: 'grain.settleJitter',
        min: 0,
        max: 0.05,
        step: 0.001,
      },
      { kind: 'colorlist', label: 'Colors', path: 'colors', count: 5 },
      { kind: 'color', label: 'Background', path: 'background' },
      {
        kind: 'select',
        label: 'Backend',
        path: 'backend',
        options: [
          { value: 'auto', label: 'auto' },
          { value: 'webgpu', label: 'webgpu' },
          { value: 'canvas2d', label: 'canvas2d' },
        ],
      },
    ],
  },
  {
    title: 'Animation',
    controls: [
      {
        kind: 'number',
        label: 'Duration ms',
        path: 'animation.duration',
        min: 0,
        max: 4000,
        step: 50,
      },
      {
        kind: 'number',
        label: 'Stagger ms',
        path: 'animation.stagger',
        min: 0,
        max: 4000,
        step: 50,
      },
      {
        kind: 'number',
        label: 'Morph ms',
        path: 'animation.morphDuration',
        min: 0,
        max: 5000,
        step: 50,
      },
      {
        kind: 'select',
        label: 'Ease',
        path: 'animation.ease',
        options: (['linear', 'easeOutCubic', 'easeInOutCubic'] as const).map((v) => ({
          value: v,
          label: v,
        })),
      },
      {
        kind: 'select',
        label: 'Reflow',
        path: 'animation.reflow',
        options: [
          { value: 'translate', label: 'translate' },
          { value: 'reshuffle', label: 'reshuffle' },
          { value: 'withPetal', label: 'with petal' },
        ],
      },
      { kind: 'checkbox', label: 'Animate grains on morph', path: 'animation.morphGrains' },
      {
        kind: 'select',
        label: 'Enter',
        path: 'animation.enter',
        options: [
          { value: 'grow', label: 'grow at rim' },
          { value: 'pour', label: 'pour' },
          { value: 'rise', label: 'rise from center' },
        ],
      },
      {
        kind: 'select',
        label: 'Exit',
        path: 'animation.exit',
        options: [
          { value: 'shrink', label: 'shrink' },
          { value: 'fall', label: 'fall' },
          { value: 'vanish', label: 'vanish' },
        ],
      },
    ],
  },
  {
    title: 'Hover & selection',
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
        step: 0.05,
      },
      {
        kind: 'slider',
        label: 'Jitter amp',
        path: 'interaction.hover.jitterAmp',
        min: 0,
        max: 0.05,
        step: 0.001,
      },
      {
        kind: 'slider',
        label: 'Hover opacity',
        path: 'interaction.hover.opacity',
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        kind: 'number',
        label: 'Fade ms',
        path: 'interaction.hover.fadeMs',
        min: 0,
        max: 1000,
        step: 10,
      },
      {
        kind: 'slider',
        label: 'Dim opacity',
        path: 'interaction.dim.opacity',
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        kind: 'number',
        label: 'Dim fade ms',
        path: 'interaction.dim.fadeMs',
        min: 0,
        max: 1000,
        step: 10,
      },
    ],
  },
  {
    title: 'Segments (solid)',
    controls: [
      {
        kind: 'slider',
        label: 'Fill opacity',
        path: 'segments.fill.opacity',
        min: 0,
        max: 1,
        step: 0.01,
      },
      { kind: 'checkbox', label: 'Border', path: 'segments.border.show' },
      {
        kind: 'slider',
        label: 'Border width',
        path: 'segments.border.width',
        min: 0.5,
        max: 5,
        step: 0.1,
      },
      {
        kind: 'slider',
        label: 'Border opacity',
        path: 'segments.border.opacity',
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
  },
  {
    title: 'Time table',
    controls: [
      { kind: 'checkbox', label: 'Show', path: 'table.show' },
      {
        kind: 'select',
        label: 'Position',
        path: 'table.position',
        options: (['right', 'left', 'top', 'bottom'] as const).map((v) => ({ value: v, label: v })),
      },
      { kind: 'number', label: 'Max rows', path: 'table.maxRows', min: 1, max: 2000, step: 10 },
      { kind: 'checkbox', label: 'Follow selection', path: 'table.followSelection' },
      { kind: 'checkbox', label: 'Interactive', path: 'table.interactive' },
      { kind: 'text', label: 'Max width', path: 'table.maxWidth' },
    ],
  },
  {
    title: 'Compass & rings',
    controls: [
      { kind: 'checkbox', label: 'Compass labels', path: 'axes.x.show' },
      { kind: 'number', label: 'Compass ticks', path: 'axes.x.ticks', min: 2, max: 32, step: 1 },
      { kind: 'color', label: 'Compass color', path: 'axes.x.color' },
      { kind: 'checkbox', label: 'Rings', path: 'axes.y.show' },
      { kind: 'number', label: 'Ring count', path: 'axes.y.ticks', min: 1, max: 10, step: 1 },
      { kind: 'color', label: 'Ring color', path: 'axes.y.color' },
    ],
  },
  {
    title: 'Legend & title',
    controls: [
      { kind: 'checkbox', label: 'Legend (bands only)', path: 'legend.show' },
      {
        kind: 'select',
        label: 'Legend position',
        path: 'legend.position',
        options: (['bottom', 'top', 'left', 'right'] as const).map((v) => ({ value: v, label: v })),
      },
      { kind: 'text', label: 'Title', path: 'title.text' },
      {
        kind: 'select',
        label: 'Title position',
        path: 'title.position',
        options: (['top', 'bottom', 'left', 'right'] as const).map((v) => ({ value: v, label: v })),
      },
    ],
  },
  {
    title: 'Readout',
    controls: [
      { kind: 'checkbox', label: 'Show', path: 'currentValue.show' },
      {
        kind: 'select',
        label: 'Mode',
        path: 'currentValue.mode',
        options: (['pointer', 'top', 'right', 'bottom', 'left'] as const).map((v) => ({
          value: v,
          label: v,
        })),
      },
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

export const windRoseChartDemo: DemoComponent = new WindRoseChartDemo();
