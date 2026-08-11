import { type DataSet, LineChart, type Point } from '../src/index.js';
import type { ControlGroup } from './controls.js';
import { renderControls } from './controls.js';
import { clearSettings, deepMerge, loadSettings, saveSettings } from './persist.js';
import type { DemoComponent } from './registry.js';
import { chartPalette } from './theme.js';

const SERIES = ['A', 'B', 'C'];
/** Fixed wavelength (samples) so adding points refines the wave, not stretches it. */
const WAVELENGTH = 26;
/** Hard cap so the points control can't wedge the tab. */
const MAX_POINTS = 10000;

type DataMode = 'sinusoid' | 'random';

/** Sinusoid sample: series phase-shifted by a third of a turn. */
function sinValue(si: number, x: number): number {
  const phase = (si * 2 * Math.PI) / SERIES.length;
  return 100 + 70 * Math.sin((x / WAVELENGTH) * 2 * Math.PI + phase);
}

function clampY(y: number): number {
  return Math.max(0, Math.min(200, y));
}

class LineChartDemo implements DemoComponent {
  id = 'line';
  label = 'Line chart';

  private cfg: Cfg = defaultConfig();
  private data: DataSet = { points: [] };
  private chart: LineChart | null = null;
  private chartEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private hoverEl!: HTMLElement;
  private focusEl!: HTMLElement;
  private panelEl!: HTMLElement;

  private updTimer: ReturnType<typeof setInterval> | null = null;
  private addTimer: ReturnType<typeof setInterval> | null = null;
  /** Next x index to append; per-series last value for the random walk. */
  private xSeq = 0;
  private walk: number[] = [];
  /** Snapshot of the data params last generated from, to detect changes. */
  private dataKey = '';

  private get mode(): DataMode {
    return this.cfg.dataMode === 'random' ? 'random' : 'sinusoid';
  }

  private get pointCount(): number {
    const n = Number(this.cfg.pointCount) || 60;
    return Math.max(2, Math.min(MAX_POINTS, Math.round(n)));
  }

  /** One sample per series at index `x` for the current mode. */
  private sampleAt(x: number): Point[] {
    return SERIES.map((z, si) => {
      let y: number;
      if (this.mode === 'sinusoid') {
        y = sinValue(si, x);
      } else {
        this.walk[si] = clampY((this.walk[si] ?? 100) + (Math.random() - 0.5) * 30);
        y = this.walk[si]!;
      }
      return { x, y: Math.round(y), z };
    });
  }

  /** (Re)generate the full dataset from the current mode + point count. */
  private regenerate(): void {
    this.walk = SERIES.map(() => 100);
    const points: Point[] = [];
    const n = this.pointCount;
    for (let x = 0; x < n; x++) points.push(...this.sampleAt(x));
    this.xSeq = n;
    this.data = { points };
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
      this.rebuild(true);
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
    const clearFocus = button('Clear legend focus', () => this.chart?.focusSeries(null));
    liveBar.append(upd, addBtn, rem, contUpd, contAdd, clearFocus);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'status';
    this.hoverEl = document.createElement('div');
    this.hoverEl.className = 'hover';
    this.hoverEl.textContent = 'hover a point…';
    this.focusEl = document.createElement('div');
    this.focusEl.className = 'status';
    this.focusEl.textContent = 'no series isolated — click a legend entry (Legend interactive)';
    host.append(this.chartEl, toolbar, liveBar, this.statusEl, this.hoverEl, this.focusEl);

    this.renderPanel();
    this.build();
  }

  private renderPanel(): void {
    renderControls(this.panelEl, this.cfg, GROUPS, () => {
      saveSettings(this.id, this.cfg);
      // Regenerate only when the data shape (mode / point count) changed;
      // other edits keep the current data so morph transitions stay visible.
      const key = `${this.mode}:${this.pointCount}`;
      if (key !== this.dataKey) {
        this.regenerate();
        this.rebuild(true);
      } else {
        this.rebuild(false);
      }
    });
  }

  unmount(): void {
    this.stopTimer('updTimer');
    this.stopTimer('addTimer');
    this.chart?.dispose();
    this.chart = null;
  }

  /** Distinct x values currently on the chart, ascending. */
  private currentXs(): number[] {
    const seen = new Set<number>();
    for (const p of this.chart?.getData().points ?? []) seen.add(Number(p.x));
    return [...seen].sort((a, b) => a - b);
  }

  /** Re-roll every existing point's y in place (morph without reflow). */
  private updateValues(): void {
    const patches = this.currentXs().flatMap((x) =>
      this.sampleAt(x).map((p) => ({ x: p.x, z: p.z!, y: p.y })),
    );
    if (patches.length) this.chart?.update(patches);
  }

  /** Append the next x sample per series; drop the oldest past the window. */
  private addPoint(): void {
    this.chart?.add(this.sampleAt(this.xSeq++));
    const xs = this.currentXs();
    if (xs.length > this.pointCount) this.chart?.remove([{ x: xs[0]! }]);
  }

  /** Remove the newest x-slot (every series point at that x). */
  private removeLast(): void {
    const last = this.currentXs().at(-1);
    if (last !== undefined) this.chart?.remove([{ x: last }]);
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

  // Swap the whole config to a named preset (data mode / point count are kept
  // from the current cfg so the wave shape is unchanged), persist, refresh the
  // panel, then rebuild keeping live data.
  private applyPreset(name: PresetName): void {
    this.cfg = deepMerge(presets()[name], {
      dataMode: this.cfg.dataMode,
      pointCount: this.cfg.pointCount,
    });
    saveSettings(this.id, this.cfg);
    this.renderPanel();
    this.rebuild(true);
  }

  private build(): void {
    this.chart = new LineChart(this.chartEl, { ...(this.cfg as object), data: this.data } as never);
    this.chart.whenReady().then(() => {
      this.statusEl.textContent = `backend: ${this.chart?.backend ?? '?'} · ${this.data.points.length} pts`;
    });
    this.chart.on('hover', ({ point }) => {
      this.hoverEl.textContent = point
        ? `${point.xValue} · ${String(point.seriesKey)} = ${point.yValue}`
        : 'hover a point…';
    });
    this.chart.on('seriesFocus', ({ index }) => {
      this.focusEl.textContent =
        index === null
          ? 'no series isolated — click a legend entry (Legend interactive)'
          : `isolated: series ${index}`;
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
// (`dataMode`, `pointCount`) the LineChart ignores.
type Cfg = Record<string, unknown>;

function defaultConfig(): Cfg {
  const palette = chartPalette();
  return {
    dataMode: 'sinusoid',
    pointCount: 60,
    grainDensity: 1.4,
    maxGrains: 100000,
    lineThickness: 0.03,
    background: palette.background,
    colors: ['#e8598b', '#8bc4e8', '#e8c45a'],
    backend: 'auto',
    grain: { sizePx: 2.2, shape: 'disc', jitter: 0.5, settleJitter: 0.02 },
    animation: {
      duration: 500,
      stagger: 500,
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
      dim: { opacity: 0.15, fadeMs: 200 },
    },
    axes: {
      x: { show: true, ticks: 8, label: '', gridLines: false, color: palette.axis, fontPx: 11 },
      y: { show: true, ticks: 5, label: 'value', gridLines: true, color: palette.axis, fontPx: 11 },
    },
    legend: { show: true, position: 'bottom', align: 'center', swatch: 'disc', interactive: true },
    currentValue: {
      show: true,
      mode: 'pointer',
      guide: 'y',
      markers: true,
      color: palette.text,
    },
    line: {
      stack: false,
      fill: { opacity: 0.12 },
      line: { style: 'spline', width: 2, opacity: 1 },
      reveal: { start: 'afterPour', duration: 600, ease: 'easeOutCubic', grainsTo: 0.1 },
    },
    fps: { position: 'off', color: palette.text },
    // Pan & zoom: drag to pan, wheel/UI to zoom.
    panZoom: {
      enabled: true,
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
const PRESET_NAMES = ['Default', 'Visible particles + hover', 'Grainy low-fill'] as const;
type PresetName = (typeof PRESET_NAMES)[number];

// Strong hover shared by presets 2 & 3: dim the rest, gain + jitter the target.
const LOUD_HOVER = {
  effects: ['highlight', 'jitter', 'opacity'],
  highlightGain: 2.4,
  jitterAmp: 0.006,
  opacity: 0.2,
  fadeMs: 160,
};

function presets(): Record<PresetName, Cfg> {
  return {
    Default: defaultConfig(),
    'Visible particles + hover': deepMerge(defaultConfig(), {
      grainDensity: 2.6,
      lineThickness: 0.05,
      grain: { sizePx: 3.4, jitter: 0.7 },
      interaction: { hover: LOUD_HOVER },
      line: { fill: { opacity: 0.2 }, reveal: { grainsTo: 0.5 } },
    }),
    'Grainy low-fill': deepMerge(defaultConfig(), {
      grainDensity: 3.2,
      lineThickness: 0.06,
      grain: { sizePx: 3.4, jitter: 0.7 },
      interaction: { hover: LOUD_HOVER },
      // Fill nearly gone; grains stay near-opaque so the texture dominates.
      line: { fill: { opacity: 0.05 }, reveal: { grainsTo: 1 } },
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
          { value: 'sinusoid', label: 'sinusoid' },
          { value: 'random', label: 'random' },
        ],
      },
      { kind: 'number', label: 'Points (≤10000)', path: 'pointCount', min: 2, max: 10000, step: 1 },
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
        label: 'Line thickness',
        path: 'lineThickness',
        min: 0.005,
        max: 0.1,
        step: 0.005,
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
          { value: 'withLine', label: 'With line' },
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
      {
        kind: 'checkbox',
        label: 'Legend interactive (click to isolate)',
        path: 'legend.interactive',
      },
    ],
  },
  {
    title: 'Line (style & fill)',
    controls: [
      { kind: 'checkbox', label: 'Stack values (area)', path: 'line.stack' },
      {
        kind: 'select',
        label: 'Line style',
        path: 'line.line.style',
        options: [
          { value: 'none', label: 'none' },
          { value: 'straight', label: 'straight' },
          { value: 'spline', label: 'spline' },
        ],
      },
      {
        kind: 'slider',
        label: 'Line width (px)',
        path: 'line.line.width',
        min: 0.5,
        max: 6,
        step: 0.5,
      },
      {
        kind: 'slider',
        label: 'Line opacity',
        path: 'line.line.opacity',
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        kind: 'slider',
        label: 'Fill opacity',
        path: 'line.fill.opacity',
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        kind: 'slider',
        label: 'Reveal duration (ms)',
        path: 'line.reveal.duration',
        min: 0,
        max: 3000,
        step: 50,
      },
      {
        kind: 'select',
        label: 'Reveal ease',
        path: 'line.reveal.ease',
        options: [
          { value: 'linear', label: 'linear' },
          { value: 'easeOutCubic', label: 'easeOutCubic' },
          { value: 'easeOutQuint', label: 'easeOutQuint' },
        ],
      },
      {
        kind: 'slider',
        label: 'Grains end opacity',
        path: 'line.reveal.grainsTo',
        min: 0,
        max: 1,
        step: 0.05,
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

export const lineChartDemo: DemoComponent = new LineChartDemo();
