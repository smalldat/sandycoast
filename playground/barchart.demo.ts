import { BarChart, type DataSet, type Point, type Scalar } from '../src/index.js';
import type { ControlGroup } from './controls.js';
import { renderControls } from './controls.js';
import { clearSettings, deepMerge, loadSettings, saveSettings } from './persist.js';
import type { DemoComponent } from './registry.js';

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];
const SERIES = ['EU', 'US', 'APAC'];
/** Cap continuous addition so the chart stays bounded (oldest slot drops off). */
const MAX_SLOTS = 14;

function randomY(): number {
  return 20 + Math.round(Math.random() * 100);
}

function randomData(): DataSet {
  const points: Point[] = [];
  for (const q of QUARTERS) {
    for (const s of SERIES) points.push({ x: q, y: randomY(), z: s });
  }
  return { points };
}

// Full editable config (everything except `data`). Seeded with the same
// defaults the old playground used, plus the previously-hidden props.
type Cfg = Record<string, unknown>;

function defaultConfig(): Cfg {
  return {
    grainDensity: 0.9,
    maxGrains: 100000,
    background: '#10141c',
    colors: ['#e8598b', '#8bc4e8', '#e8c45a'],
    backend: 'auto',
    grain: { sizePx: 2.4, shape: 'disc', jitter: 0.4, settleJitter: 0.02 },
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
    axes: {
      x: { show: true, ticks: 5, label: '', gridLines: false, color: '#8a93a6', fontPx: 11 },
      y: { show: true, ticks: 5, label: 'value', gridLines: true, color: '#8a93a6', fontPx: 11 },
    },
    legend: { show: true, position: 'bottom', align: 'center', swatch: 'disc' },
    currentValue: { show: true, mode: 'pointer', guide: 'y', markers: true, color: '#cdd3de' },
    bars: {
      fill: { opacity: 0.85 },
      border: {
        left: true,
        top: true,
        right: true,
        bottom: true,
        width: 1.5,
        opacity: 1,
      },
      reveal: { start: 'afterPour', duration: 600, ease: 'easeOutCubic', grainsTo: 0.12 },
    },
    // On-screen FPS meter; 'off' hides it. Position pins it to an edge/corner.
    fps: { position: 'off', color: '#cdd3de' },
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
const PRESET_NAMES = ['Default', 'Visible particles + hover', 'Grainy low-fill'] as const;
type PresetName = (typeof PRESET_NAMES)[number];

// Strong hover shared by presets 2 & 3: dim the rest, gain + jitter the target.
const LOUD_HOVER = {
  effects: ['jitter', 'opacity'],
  highlightGain: 2.4,
  jitterAmp: 0.006,
  opacity: 0.8,
  fadeMs: 160,
  bars: {
    fill: {
      opacity: 0.5,
    },
  },
};

function presets(): Record<PresetName, Cfg> {
  return {
    Default: defaultConfig(),
    'Visible particles + hover': deepMerge(defaultConfig(), {
      grainDensity: 1.8,
      grain: { sizePx: 3.6, jitter: 0.6 },
      interaction: { hover: LOUD_HOVER },
      bars: { fill: { opacity: 0.7 }, reveal: { grainsTo: 0.5 } },
    }),
    'Grainy low-fill': deepMerge(defaultConfig(), {
      grainDensity: 2,
      grain: { sizePx: 3.6, jitter: 0.6 },
      interaction: { hover: LOUD_HOVER },
      // Bars barely filled; grains stay near-opaque so the texture dominates.
      bars: { fill: { opacity: 0.12 }, reveal: { grainsTo: 1 } },
    }),
  };
}

const GROUPS: ControlGroup[] = [
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
          { value: 'withBar', label: 'With bar' },
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
    title: 'Bars (fill & border)',
    controls: [
      {
        kind: 'slider',
        label: 'Fill opacity',
        path: 'bars.fill.opacity',
        min: 0,
        max: 1,
        step: 0.05,
      },
      { kind: 'checkbox', label: 'Border left', path: 'bars.border.left' },
      { kind: 'checkbox', label: 'Border top', path: 'bars.border.top' },
      { kind: 'checkbox', label: 'Border right', path: 'bars.border.right' },
      { kind: 'checkbox', label: 'Border bottom', path: 'bars.border.bottom' },
      {
        kind: 'slider',
        label: 'Border width (px)',
        path: 'bars.border.width',
        min: 0.5,
        max: 6,
        step: 0.5,
      },
      {
        kind: 'slider',
        label: 'Border opacity',
        path: 'bars.border.opacity',
        min: 0,
        max: 1,
        step: 0.05,
      },
      {
        kind: 'slider',
        label: 'Reveal duration (ms)',
        path: 'bars.reveal.duration',
        min: 0,
        max: 3000,
        step: 50,
      },
      {
        kind: 'select',
        label: 'Reveal ease',
        path: 'bars.reveal.ease',
        options: [
          { value: 'linear', label: 'linear' },
          { value: 'easeOutCubic', label: 'easeOutCubic' },
          { value: 'easeOutQuint', label: 'easeOutQuint' },
        ],
      },
      {
        kind: 'slider',
        label: 'Grains end opacity',
        path: 'bars.reveal.grainsTo',
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

class BarChartDemo implements DemoComponent {
  id = 'bar';
  label = 'Bar chart';

  private cfg: Cfg = defaultConfig();
  private data: DataSet = randomData();
  private chart: BarChart | null = null;
  private chartEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private hoverEl!: HTMLElement;
  private panelEl!: HTMLElement;
  /** Timers for the continuous update / addition toggles. */
  private updTimer: ReturnType<typeof setInterval> | null = null;
  private addTimer: ReturnType<typeof setInterval> | null = null;
  /** Monotonic label counter for added x-slots. */
  private slotSeq = 0;

  mount(host: HTMLElement, panel: HTMLElement): void {
    this.panelEl = panel;
    // Start from defaults, then overlay whatever was persisted last session.
    this.cfg = loadSettings(this.id, defaultConfig());
    this.data = randomData();

    // Chart column: canvas host + data toolbar + status/hover readouts.
    host.replaceChildren();
    this.chartEl = document.createElement('div');
    this.chartEl.id = 'chart';
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    const rePour = button('Re-pour', () => this.chart?.repour());
    const rand = button('Random data', () => {
      this.data = randomData();
      this.slotSeq = 0;
      this.chart?.update(this.data);
    });
    const reset = button('Reset settings', () => {
      clearSettings(this.id);
      this.cfg = defaultConfig();
      this.renderPanel();
      this.rebuild();
    });
    const preset = presetPicker(PRESET_NAMES, (name) => this.applyPreset(name as PresetName));
    toolbar.append(preset, rePour, rand, reset);

    // Live-data controls: exercise update / add / remove without a full rebuild.
    const liveBar = document.createElement('div');
    liveBar.className = 'toolbar';
    const upd = button('Update values', () => this.updateValues());
    const addBtn = button('Add slot', () => this.addSlot());
    const rem = button('Remove last', () => this.removeLastSlot());
    const contUpd = toggle('Continuous update', (on) =>
      this.setContinuous('updTimer', on, 900, () => this.updateValues()),
    );
    const contAdd = toggle('Continuous addition', (on) =>
      this.setContinuous('addTimer', on, 1400, () => this.addSlot()),
    );
    liveBar.append(upd, addBtn, rem, contUpd, contAdd);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'status';
    this.hoverEl = document.createElement('div');
    this.hoverEl.className = 'hover';
    this.hoverEl.textContent = 'hover a bar…';
    host.append(this.chartEl, toolbar, liveBar, this.statusEl, this.hoverEl);

    this.renderPanel();
    this.build();
  }

  // (Re)wire the control panel against the current `cfg`. Called on mount and
  // after a settings reset so inputs reflect whatever `cfg` now holds.
  private renderPanel(): void {
    renderControls(this.panelEl, this.cfg, GROUPS, () => {
      saveSettings(this.id, this.cfg);
      this.rebuild();
    });
  }

  unmount(): void {
    this.stopTimer('updTimer');
    this.stopTimer('addTimer');
    this.chart?.dispose();
    this.chart = null;
  }

  /** Distinct x values currently on the chart, in slot order. */
  private currentXs(): Scalar[] {
    const seen = new Set<string>();
    const xs: Scalar[] = [];
    for (const p of this.chart?.getData().points ?? []) {
      const k = String(p.x);
      if (!seen.has(k)) {
        seen.add(k);
        xs.push(p.x);
      }
    }
    return xs;
  }

  /** Patch every existing (x, series) bar to a new random value in place. */
  private updateValues(): void {
    const patches = this.currentXs().flatMap((x) => SERIES.map((z) => ({ x, z, y: randomY() })));
    if (patches.length) this.chart?.update(patches);
  }

  /** Append a new x-slot (one bar per series); drop the oldest past the cap. */
  private addSlot(): void {
    const label = `N${++this.slotSeq}`;
    this.chart?.add(SERIES.map((z) => ({ x: label, y: randomY(), z })));
    const xs = this.currentXs();
    if (xs.length > MAX_SLOTS) this.chart?.remove([{ x: xs[0]! }]);
  }

  /** Remove the last x-slot (every series bar at that x). */
  private removeLastSlot(): void {
    const xs = this.currentXs();
    const last = xs.at(-1);
    if (last !== undefined) this.chart?.remove([{ x: last }]);
  }

  /** Start/stop a repeating live-data action stored under `key`. */
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

  // Swap the whole config to a named preset, persist it, refresh the panel so
  // every input reflects the new values, then rebuild.
  private applyPreset(name: PresetName): void {
    this.cfg = presets()[name];
    saveSettings(this.id, this.cfg);
    this.renderPanel();
    this.rebuild();
  }

  private build(): void {
    this.chart = new BarChart(this.chartEl, { ...(this.cfg as object), data: this.data } as never);
    this.chart.whenReady().then(() => {
      this.statusEl.textContent = `backend: ${this.chart?.backend ?? '?'}`;
    });
    this.chart.on('hover', ({ bar }) => {
      this.hoverEl.textContent = bar
        ? `${bar.xValue} · ${String(bar.seriesKey)} = ${bar.yValue}`
        : 'hover a bar…';
    });
  }

  // Config is construct-time; any edit disposes and rebuilds. Capture live data
  // from the chart first so continuous update/add edits survive the rebuild.
  private rebuild(): void {
    if (this.chart) this.data = this.chart.getData();
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

export const barChartDemo: DemoComponent = new BarChartDemo();
