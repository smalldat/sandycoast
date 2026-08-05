import { type DataSet, PieChart, type Point } from '../src/index.js';
import type { ControlGroup } from './controls.js';
import { renderControls } from './controls.js';
import { clearSettings, deepMerge, loadSettings, saveSettings } from './persist.js';
import type { DemoComponent } from './registry.js';

/** Slice categories. The pie draws these; the slider walks the series. */
const SLICES = ['Search', 'Direct', 'Social', 'Referral', 'Email', 'Ads'];
/** Series the slider steps through, generated as consecutive months. */
const DEFAULT_SERIES = 12;
/** Library cap: a dataset may address at most this many series. */
const MAX_SERIES = 1000;
/** Library cap: at most this many points of a series become slices. */
const MAX_SLICES = 10;

function randomY(): number {
  return 10 + Math.round(Math.random() * 90);
}

/** Series label: month names, extended with an index past the first year. */
function seriesLabel(i: number): string {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const year = Math.floor(i / 12);
  return year === 0 ? months[i]! : `${months[i % 12]!} +${year}`;
}

function randomData(seriesCount: number, sliceCount: number): DataSet {
  const points: Point[] = [];
  for (let s = 0; s < seriesCount; s++) {
    const z = seriesLabel(s);
    for (let i = 0; i < sliceCount; i++)
      points.push({ x: SLICES[i % SLICES.length]!, y: randomY(), z });
  }
  return { points };
}

type Cfg = Record<string, unknown>;

function defaultConfig(): Cfg {
  return {
    // Playground-only knobs the PieChart itself ignores.
    seriesCount: DEFAULT_SERIES,
    sliceCount: 5,
    grainDensity: 0.9,
    maxGrains: 100000,
    background: '#10141c',
    colors: ['#e8598b', '#8bc4e8', '#e8c45a', '#5ae89a', '#b98be8', '#e8895a'],
    backend: 'auto',
    grain: { sizePx: 2.4, shape: 'disc', jitter: 0.4, settleJitter: 0.02 },
    // Pie geometry. `innerRadius: 0` is a pie; raise it to cut a donut.
    innerRadius: 0,
    radius: 0.92,
    startAngle: 0,
    padAngle: 0,
    seriesIndex: 0,
    maxSlices: MAX_SLICES,
    maxSeries: MAX_SERIES,
    slider: { show: true, position: 'bottom', interactive: true, handlePx: 7, trackPx: 3 },
    animation: {
      duration: 1100,
      stagger: 700,
      ease: 'easeOutCubic',
      morphDuration: 1400,
      reflow: 'translate',
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
    // `axes.x` styles the slider's ticks, exactly as it styles the bar chart's
    // category axis.
    axes: {
      x: { show: true, ticks: 6, label: 'month', color: '#8a93a6', fontPx: 11 },
    },
    legend: { show: true, position: 'right', align: 'center', swatch: 'disc' },
    title: { text: 'Traffic by channel', position: 'top', align: 'center', fontPx: 14 },
    currentValue: { show: true, mode: 'pointer', color: '#cdd3de' },
    slices: {
      fill: { opacity: 0.85 },
      border: { show: true, width: 1.5, opacity: 1 },
      reveal: { start: 'afterPour', duration: 600, ease: 'easeOutCubic', grainsTo: 0.12 },
    },
    fps: { position: 'off', color: '#cdd3de' },
  };
}

const PRESET_NAMES = ['Default', 'Donut', 'Grainy exploded donut'] as const;
type PresetName = (typeof PRESET_NAMES)[number];

function presets(): Record<PresetName, Cfg> {
  return {
    Default: defaultConfig(),
    Donut: deepMerge(defaultConfig(), {
      innerRadius: 0.55,
      padAngle: 1,
      slices: { fill: { opacity: 0.9 }, reveal: { grainsTo: 0.08 } },
    }),
    'Grainy exploded donut': deepMerge(defaultConfig(), {
      grainDensity: 1.8,
      grain: { sizePx: 3.4, jitter: 0.6 },
      innerRadius: 0.45,
      padAngle: 3,
      interaction: {
        hover: { effects: ['jitter', 'opacity'], highlightGain: 2.4, opacity: 0.8, fadeMs: 160 },
      },
      slices: { fill: { opacity: 0.3 }, reveal: { grainsTo: 0.8 } },
    }),
  };
}

const GROUPS: ControlGroup[] = [
  {
    title: 'Data',
    controls: [
      {
        kind: 'number',
        label: `Series (≤${MAX_SERIES})`,
        path: 'seriesCount',
        min: 1,
        max: MAX_SERIES,
        step: 1,
      },
      {
        kind: 'number',
        label: `Slices (≤${MAX_SLICES})`,
        path: 'sliceCount',
        min: 1,
        max: MAX_SLICES,
        step: 1,
      },
      {
        kind: 'number',
        label: 'Slice cap',
        path: 'maxSlices',
        min: 1,
        max: MAX_SLICES,
        step: 1,
      },
      {
        kind: 'number',
        label: 'Series cap',
        path: 'maxSeries',
        min: 1,
        max: MAX_SERIES,
        step: 1,
      },
    ],
  },
  {
    title: 'Pie / donut',
    controls: [
      {
        kind: 'slider',
        label: 'Inner radius (donut)',
        path: 'innerRadius',
        min: 0,
        max: 0.95,
        step: 0.05,
      },
      { kind: 'slider', label: 'Radius', path: 'radius', min: 0.3, max: 1, step: 0.02 },
      { kind: 'slider', label: 'Start angle (°)', path: 'startAngle', min: 0, max: 360, step: 5 },
      { kind: 'slider', label: 'Pad angle (°)', path: 'padAngle', min: 0, max: 10, step: 0.5 },
    ],
  },
  {
    title: 'Series slider',
    controls: [
      { kind: 'checkbox', label: 'Show', path: 'slider.show' },
      {
        kind: 'select',
        label: 'Position',
        path: 'slider.position',
        options: (['bottom', 'top'] as const).map((v) => ({ value: v, label: v })),
      },
      { kind: 'checkbox', label: 'Interactive', path: 'slider.interactive' },
      { kind: 'slider', label: 'Handle (px)', path: 'slider.handlePx', min: 3, max: 14, step: 1 },
      { kind: 'slider', label: 'Track (px)', path: 'slider.trackPx', min: 1, max: 10, step: 1 },
      { kind: 'checkbox', label: 'Ticks show', path: 'axes.x.show' },
      { kind: 'number', label: 'Ticks', path: 'axes.x.ticks', min: 0, max: 20, step: 1 },
      { kind: 'text', label: 'Tick label', path: 'axes.x.label' },
      { kind: 'slider', label: 'Font (px)', path: 'axes.x.fontPx', min: 8, max: 20, step: 1 },
      { kind: 'color', label: 'Color', path: 'axes.x.color' },
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
        max: 2,
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
        max: 0.1,
        step: 0.005,
      },
      { kind: 'color', label: 'Background', path: 'background' },
      { kind: 'colorlist', label: 'Slice colors', path: 'colors', count: 6 },
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
        label: 'Reflow (existing)',
        path: 'animation.reflow',
        options: [
          { value: 'translate', label: 'translate' },
          { value: 'reshuffle', label: 'reshuffle' },
          { value: 'withSlice', label: 'With slice' },
        ],
      },
      {
        kind: 'select',
        label: 'Enter (added)',
        path: 'animation.enter',
        options: [
          { value: 'pour', label: 'pour' },
          { value: 'rise', label: 'rise' },
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
    title: 'Title & legend',
    controls: [
      { kind: 'text', label: 'Title', path: 'title.text' },
      {
        kind: 'select',
        label: 'Title position',
        path: 'title.position',
        options: (['top', 'bottom', 'left', 'right'] as const).map((v) => ({ value: v, label: v })),
      },
      {
        kind: 'select',
        label: 'Title align',
        path: 'title.align',
        options: (['start', 'center', 'end'] as const).map((v) => ({ value: v, label: v })),
      },
      { kind: 'slider', label: 'Title font (px)', path: 'title.fontPx', min: 10, max: 28, step: 1 },
      { kind: 'color', label: 'Title color', path: 'title.color' },
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
    title: 'Slices (fill & border)',
    controls: [
      {
        kind: 'slider',
        label: 'Fill opacity',
        path: 'slices.fill.opacity',
        min: 0,
        max: 1,
        step: 0.05,
      },
      { kind: 'checkbox', label: 'Border', path: 'slices.border.show' },
      {
        kind: 'slider',
        label: 'Border width (px)',
        path: 'slices.border.width',
        min: 0.5,
        max: 6,
        step: 0.5,
      },
      {
        kind: 'slider',
        label: 'Border opacity',
        path: 'slices.border.opacity',
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        kind: 'slider',
        label: 'Reveal duration (ms)',
        path: 'slices.reveal.duration',
        min: 0,
        max: 3000,
        step: 50,
      },
      {
        kind: 'select',
        label: 'Reveal ease',
        path: 'slices.reveal.ease',
        options: [
          { value: 'linear', label: 'linear' },
          { value: 'easeOutCubic', label: 'easeOutCubic' },
          { value: 'easeOutQuint', label: 'easeOutQuint' },
        ],
      },
      {
        kind: 'slider',
        label: 'Grains end opacity',
        path: 'slices.reveal.grainsTo',
        min: 0,
        max: 1,
        step: 0.05,
      },
    ],
  },
  {
    title: 'Current value & FPS',
    controls: [
      { kind: 'checkbox', label: 'Readout show', path: 'currentValue.show' },
      {
        kind: 'select',
        label: 'Readout mode',
        path: 'currentValue.mode',
        options: (['pointer', 'top', 'right', 'bottom', 'left'] as const).map((v) => ({
          value: v,
          label: v,
        })),
      },
      { kind: 'color', label: 'Readout color', path: 'currentValue.color' },
      {
        kind: 'select',
        label: 'FPS position',
        path: 'fps.position',
        options: (['off', 'left', 'right', 'top', 'bottom'] as const).map((v) => ({
          value: v,
          label: v,
        })),
      },
      { kind: 'color', label: 'FPS color', path: 'fps.color' },
    ],
  },
];

class PieChartDemo implements DemoComponent {
  id = 'pie';
  label = 'Pie / donut';

  private cfg: Cfg = defaultConfig();
  private data: DataSet = randomData(DEFAULT_SERIES, 5);
  private chart: PieChart | null = null;
  private chartEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private hoverEl!: HTMLElement;
  private seriesEl!: HTMLElement;
  private panelEl!: HTMLElement;
  private updTimer: ReturnType<typeof setInterval> | null = null;
  private playTimer: ReturnType<typeof setInterval> | null = null;
  /** Shape the current data was generated at, to detect config changes. */
  private dataShape = '';

  private get seriesCount(): number {
    const n = Number(this.cfg.seriesCount) || DEFAULT_SERIES;
    return Math.max(1, Math.min(MAX_SERIES, Math.round(n)));
  }

  private get sliceCount(): number {
    const n = Number(this.cfg.sliceCount) || 1;
    return Math.max(1, Math.min(MAX_SLICES, Math.round(n)));
  }

  /** (Re)generate the dataset at the configured series/slice counts. */
  private regenerate(): void {
    this.data = randomData(this.seriesCount, this.sliceCount);
    this.dataShape = `${this.seriesCount}x${this.sliceCount}`;
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
    const rand = button('Random data', () => {
      this.regenerate();
      this.chart?.update(this.data);
    });
    const reset = button('Reset settings', () => {
      clearSettings(this.id);
      this.cfg = defaultConfig();
      this.regenerate();
      this.renderPanel();
      this.rebuild(true);
    });
    const preset = presetPicker(PRESET_NAMES, (name) => this.applyPreset(name as PresetName));
    toolbar.append(preset, rePour, rand, reset);

    // Series controls: the slider is just one way in — these drive the exact
    // same `setSeriesIndex` API programmatically.
    const seriesBar = document.createElement('div');
    seriesBar.className = 'toolbar';
    const prev = button('◀ Prev series', () => this.step(-1));
    const next = button('Next series ▶', () => this.step(1));
    const play = toggle('Play series', (on) =>
      this.setTimer('playTimer', on, 1600, () => this.step(1)),
    );
    const contUpd = toggle('Continuous update', (on) =>
      this.setTimer('updTimer', on, 1200, () => this.updateValues()),
    );
    seriesBar.append(prev, next, play, contUpd);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'status';
    this.seriesEl = document.createElement('div');
    this.seriesEl.className = 'status';
    this.hoverEl = document.createElement('div');
    this.hoverEl.className = 'hover';
    this.hoverEl.textContent = 'hover a slice…';
    host.append(this.chartEl, toolbar, seriesBar, this.statusEl, this.seriesEl, this.hoverEl);

    this.renderPanel();
    this.build();
  }

  private renderPanel(): void {
    renderControls(this.panelEl, this.cfg, GROUPS, () => {
      saveSettings(this.id, this.cfg);
      // Regenerate only when the data shape changed; other edits keep the
      // current data so morph transitions stay visible.
      const regenerated = `${this.seriesCount}x${this.sliceCount}` !== this.dataShape;
      if (regenerated) this.regenerate();
      this.rebuild(regenerated);
    });
  }

  unmount(): void {
    this.stopTimer('updTimer');
    this.stopTimer('playTimer');
    this.chart?.dispose();
    this.chart = null;
  }

  /** Move the selection by `delta`, wrapping around the ends. */
  private step(delta: number): void {
    const chart = this.chart;
    if (!chart || chart.seriesCount === 0) return;
    const n = chart.seriesCount;
    chart.setSeriesIndex((chart.getSeriesIndex() + delta + n) % n);
  }

  /** Patch every slice of the shown series to a new random value in place. */
  private updateValues(): void {
    const chart = this.chart;
    if (!chart) return;
    const z = chart.getSeriesKeys()[chart.getSeriesIndex()];
    // A single-series dataset has no `z`; omit the key rather than sending
    // `undefined`, which would match nothing.
    const patches = SLICES.slice(0, this.sliceCount).map((x) =>
      z === undefined ? { x, y: randomY() } : { x, z, y: randomY() },
    );
    if (patches.length) chart.update(patches);
  }

  private setTimer(key: 'updTimer' | 'playTimer', on: boolean, ms: number, fn: () => void): void {
    this.stopTimer(key);
    if (on) this[key] = setInterval(fn, ms);
  }

  private stopTimer(key: 'updTimer' | 'playTimer'): void {
    if (this[key]) {
      clearInterval(this[key]!);
      this[key] = null;
    }
  }

  private applyPreset(name: PresetName): void {
    // Presets are a look, not a dataset — carry the data shape across.
    this.cfg = deepMerge(presets()[name], {
      seriesCount: this.cfg.seriesCount,
      sliceCount: this.cfg.sliceCount,
    });
    saveSettings(this.id, this.cfg);
    this.renderPanel();
    this.rebuild();
  }

  private build(): void {
    this.chart = new PieChart(this.chartEl, { ...(this.cfg as object), data: this.data } as never);
    this.chart.whenReady().then(() => {
      const chart = this.chart;
      if (!chart) return;
      this.statusEl.textContent = `backend: ${chart.backend ?? '?'} · ${chart.seriesCount} series · ${this.sliceCount} slices`;
      this.showSeries();
    });
    this.chart.on('hover', ({ slice }) => {
      this.hoverEl.textContent = slice
        ? `${String(slice.xValue)} = ${slice.value} (${(slice.fraction * 100).toFixed(1)}%)`
        : 'hover a slice…';
    });
    this.chart.on('seriesChange', () => this.showSeries());
  }

  private showSeries(): void {
    const chart = this.chart;
    if (!chart) return;
    const i = chart.getSeriesIndex();
    this.seriesEl.textContent = `series ${i + 1}/${chart.seriesCount} · ${String(chart.getSeriesKeys()[i])}`;
  }

  // Config is construct-time; any edit disposes and rebuilds. Capture live data
  // and the selected series first so both survive the rebuild.
  private rebuild(regenerated = false): void {
    if (this.chart && !regenerated) {
      this.data = this.chart.getData();
      this.cfg.seriesIndex = this.chart.getSeriesIndex();
    } else if (regenerated) {
      this.cfg.seriesIndex = 0;
    }
    this.chart?.dispose();
    this.build();
  }
}

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

export const pieChartDemo: DemoComponent = new PieChartDemo();
