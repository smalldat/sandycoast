import {
  type Margins,
  type ResolvedChrome,
  marginsToPlotRect,
  resolveChrome,
} from '../../core/chrome/chrome.js';
import { FpsMeter, type ResolvedFps, resolveFps } from '../../core/chrome/fps.js';
import { Legend, type LegendEntry } from '../../core/chrome/legend.js';
import { Table, type TableRow, resolveTable } from '../../core/chrome/table.js';
import type { ResolvedTable } from '../../core/chrome/table.js';
import { Title } from '../../core/chrome/title.js';
import { normalizeWind, validateWind } from '../../core/data/dataset.js';
import type { NormalizedWind, WindDataSet, WindPoint } from '../../core/data/wind.js';
import { type MouseHook, runMouseHook } from '../../core/interaction/mouse.js';
import { squareRect } from '../../core/layout/polar.js';
import { ease, scatterStarts } from '../../core/particles/anim.js';
import { type GrainBuffer, allocGrains } from '../../core/particles/grains.js';
import { packWedges, wedgeGrainCounts } from '../../core/particles/pack.js';
import { mulberry32 } from '../../core/particles/rng.js';
import { pickRenderer } from '../../core/render/pick.js';
import type { FrameUniforms, RGBA, Renderer } from '../../core/render/types.js';
import { DEFAULT_PALETTE, parseColor } from '../../core/util/color.js';
import { Emitter } from '../../core/util/emitter.js';
import { type RoseAxes, buildRoseAxes } from './axis.js';
import { bandRanges } from './binning.js';
import { bearingLabel, degreesFromRadians } from './compass.js';
import {
  type WindRoseLayout,
  type WindRoseLayoutOptions,
  hitSegment,
  layoutWindRose,
} from './layout.js';
import { WindRoseOverlay } from './overlay.js';
import {
  type ResolvedHighlight,
  type ResolvedRoseStyle,
  highlightTargets,
  resolveHighlight,
  resolveRoseStyle,
  revealFactor,
} from './roseStyle.js';
import {
  DEFAULT_MAX_SEGMENTS,
  DEFAULT_RAMP_STEPS,
  DEFAULT_SECTORS,
  type HighlightPayload,
  type HoverPayload,
  type MouseConfig,
  type ObservationMeta,
  type SegmentMeta,
  type SelectPayload,
  type WindRoseChartConfig,
  type WindRoseTableConfig,
} from './types.js';

const DEG = Math.PI / 180;

interface Resolved {
  grainDensity: number;
  maxGrains: number;
  palette: RGBA[];
  background: RGBA;
  grainSizePx: number;
  grainShape: 'quad' | 'disc';
  jitter: number;
  settleJitter: number;
  duration: number;
  ease: FrameUniforms['easing'];
  stagger: number;
  morphDuration: number;
  reflow: 'translate' | 'reshuffle' | 'withPetal';
  morphGrains: boolean;
  enter: 'grow' | 'pour' | 'rise';
  exit: 'shrink' | 'fall' | 'vanish';
  hoverEffects: Set<'highlight' | 'jitter' | 'opacity'>;
  highlightGain: number;
  hoverJitterAmp: number;
  hoverOpacity: number;
  hoverFade: number;
  dimOpacity: number;
  dimFade: number;
  mouse: MouseConfig;
  ringLabelAngle: number;
  geometry: WindRoseLayoutOptions;
}

function resolve(cfg: WindRoseChartConfig): Resolved {
  const hover = cfg.interaction?.hover;
  const anim = cfg.animation;
  const duration = anim?.duration != null ? anim.duration / 1000 : 0.9;
  const stagger = anim?.stagger != null ? anim.stagger / 1000 : 0.5;
  const petals = cfg.petals;
  return {
    grainDensity: cfg.grainDensity ?? 0.6,
    maxGrains: cfg.maxGrains ?? 100_000,
    palette: (cfg.colors ?? DEFAULT_PALETTE).map(parseColor),
    background: parseColor(cfg.background ?? 'rgba(0,0,0,0)'),
    grainSizePx: cfg.grain?.sizePx ?? 3,
    grainShape: cfg.grain?.shape ?? 'disc',
    jitter: cfg.grain?.jitter ?? 0.6,
    settleJitter: cfg.grain?.settleJitter ?? 0.004,
    duration,
    ease: anim?.ease ?? 'easeOutCubic',
    stagger,
    morphDuration: anim?.morphDuration != null ? anim.morphDuration / 1000 : duration + stagger,
    reflow: anim?.reflow ?? 'translate',
    morphGrains: anim?.morphGrains ?? true,
    enter: anim?.enter ?? 'grow',
    exit: anim?.exit ?? 'shrink',
    hoverEffects: new Set(hover?.effects ?? ['highlight', 'jitter']),
    highlightGain: hover?.highlightGain ?? 1.6,
    hoverJitterAmp: hover?.jitterAmp ?? 0.008,
    hoverOpacity: hover?.opacity ?? 1,
    hoverFade: (hover?.fadeMs ?? 180) / 1000,
    dimOpacity: cfg.interaction?.dim?.opacity ?? 0.15,
    dimFade: (cfg.interaction?.dim?.fadeMs ?? 200) / 1000,
    mouse: cfg.interaction?.mouse ?? {},
    // Ring labels default to the gap *between* two sectors, half a sector off
    // north. On a compass point they would sit on top of both that sector's
    // petal and its rim label — which is exactly what 45° does on a 16-sector
    // rose, where 45° is NE.
    ringLabelAngle:
      cfg.radial?.labelAngle != null
        ? cfg.radial.labelAngle * DEG
        : Math.PI / Math.max(2, Math.floor(cfg.sectors?.count ?? DEFAULT_SECTORS)),
    geometry: {
      sectors: Math.max(2, Math.floor(cfg.sectors?.count ?? DEFAULT_SECTORS)),
      sectorAlign: cfg.sectors?.align ?? 'centered',
      mode: petals?.mode ?? 'bands',
      measure: cfg.radial?.measure ?? 'count',
      order: petals?.order ?? 'intensity',
      maxSegmentsPerSector: petals?.maxSegmentsPerSector ?? DEFAULT_MAX_SEGMENTS,
      calmBelow: cfg.calm?.below ?? 0,
      calmShow: cfg.calm?.show ?? true,
      bands: {
        thresholds: cfg.bands?.thresholds,
        derive: cfg.bands?.derive ?? 'equal',
        count: cfg.bands?.count ?? 4,
      },
      radius: cfg.radius ?? 0.92,
      innerRadius: cfg.innerRadius ?? 0,
      north: (cfg.north ?? 0) * DEG,
      clockwise: cfg.clockwise ?? true,
      petalWidth: petals?.width ?? 0.9,
      padAngle: (petals?.padAngle ?? 0) * DEG,
      radialMax: cfg.radial?.max,
      rampSteps: petals?.rampSteps ?? DEFAULT_RAMP_STEPS,
      calmColor: cfg.calm?.color ? parseColor(cfg.calm.color) : undefined,
    },
  };
}

type Events = {
  hover: HoverPayload;
  select: SelectPayload;
  highlight: HighlightPayload;
};

/** Column formatters for the time table — the chart's half of `table`. */
interface ResolvedTableFormat {
  timeFormat: (t: Date) => string;
  directionFormat: (deg: number) => string;
  customColumn: { label: string; format: (custom: unknown, o: ObservationMeta) => string } | null;
}

/**
 * Time formatting defaults to a clock, and widens to a date only when the
 * readings actually span more than a day — a column of identical dates is
 * noise, and a bare clock across a week is a lie.
 */
function resolveTableFormat(
  cfg: WindRoseTableConfig | undefined,
  spansDays: () => boolean,
): ResolvedTableFormat {
  return {
    timeFormat:
      cfg?.timeFormat ??
      ((t: Date) =>
        spansDays()
          ? t.toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })
          : t.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })),
    directionFormat: cfg?.directionFormat ?? ((deg: number) => bearingLabel(deg)),
    customColumn: cfg?.customColumn ?? null,
  };
}

/** How grains enter on a build: fresh pour vs. morph from the prior state. */
type BuildMode = 'pour' | 'morph';

/** A segment's animated geometry (layout space). */
interface WedgeBox {
  a0: number;
  a1: number;
  rInner: number;
  rOuter: number;
}

interface MorphTween {
  start: number;
  dur: number;
  from: WedgeBox[];
  to: WedgeBox[];
}

/** Group grain indices by their `barId` (= segment id), preserving order. */
function groupGrainsBySegment(grains: GrainBuffer): Map<number, number[]> {
  const out = new Map<number, number[]>();
  for (let i = 0; i < grains.count; i++) {
    const b = grains.barId[i]!;
    let arr = out.get(b);
    if (!arr) {
      arr = [];
      out.set(b, arr);
    }
    arr.push(i);
  }
  return out;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Sand wind rose. Mounts into an element and renders one series of wind
 * observations as annular petal segments of animated grains via the best
 * available backend (WebGPU → Canvas2D).
 *
 * Shares the bar/line/pie/scatter machinery — grain packing, reveal ramp,
 * hover, dim, chrome — with four differences of its own:
 *
 * - observations carry **two indicators** (direction, intensity) over one
 *   dimension (time), so the data model is `WindDataSet`, not `DataSet`;
 * - a petal is an **aggregate**: many readings stack into one mark, and
 *   `petals.mode` decides whether a segment is an intensity band (default) or a
 *   single reading;
 * - the **latest** reading(s) are emphasised, composing with hover and dim
 *   rather than competing with them;
 * - a **time table** can stand beside (or instead of) the legend, with row
 *   click ↔ segment selection as one code path.
 */
export class WindRoseChart<Custom = unknown> {
  private el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private cfg: Resolved;
  private renderer: Renderer | null = null;
  private grains: GrainBuffer = allocGrains(0);
  private metas: SegmentMeta[] = [];
  /** Current dataset (source of truth for update/add/remove). */
  private data: WindDataSet<Custom> = { points: [] };
  private norm: NormalizedWind<Custom> = {
    points: [],
    dropped: 0,
    intensityLabel: 'Speed',
    intensityUnit: '',
  };
  private emitter = new Emitter<Events>();

  private revealMode: BuildMode = 'pour';
  private morph: MorphTween | null = null;

  private chrome: ResolvedChrome;
  private style: ResolvedRoseStyle;
  private highlightCfg: ResolvedHighlight;
  private tableCfg: ResolvedTable;
  /** The wind-specific half of the table config: how its columns are formatted. */
  private tableFmt: ResolvedTableFormat;
  private lastSolid = -1;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlay: WindRoseOverlay | null = null;
  private legend: Legend | null = null;
  private table: Table | null = null;
  private title: Title | null = null;
  private fpsCfg: ResolvedFps;
  private fps: FpsMeter | null = null;
  private layout: WindRoseLayout | null = null;
  private axes: RoseAxes = { compass: [], rings: [] };
  private plotRect: [number, number, number, number] = [0, 0, 1, 1];
  /** Square sub-rect of the plot the rose lives in; the grains' plot rect. */
  private roseRect: [number, number, number, number] = [0, 0, 1, 1];
  private hovered: SegmentMeta | null = null;
  private pointerPx: { x: number; y: number } | null = null;
  private geomVersion = 0;
  private overlayDirty = false;
  private raf = 0;
  private startTime = 0;
  private lastFrameMs = 0;
  private hoveredSegmentId = -1;
  private hoverWeights = new Float32Array(0);
  /** Selected segment key, or null. Drives the dim of everything else. */
  private selectedKey: string | null = null;
  private selectedObservation: number | null = null;
  private dimWeights = new Float32Array(0);
  /** Per-segment latest-value emphasis, rebuilt whenever the data changes. */
  private highlightWeights = new Float32Array(0);
  private highlighted: ObservationMeta<Custom>[] = [];

  private dpr = 1;
  private ro: ResizeObserver | null = null;
  private disposed = false;
  private ready: Promise<void>;

  constructor(el: HTMLElement, config: WindRoseChartConfig<Custom>) {
    this.el = el;
    // Seat data synchronously so getData() is valid before the async boot runs
    // buildGrains(); otherwise a rebuild firing mid-boot captures empty data.
    this.data = config.data;
    this.cfg = resolve(config);
    this.chrome = resolveChrome(config);
    this.style = resolveRoseStyle(config);
    this.highlightCfg = resolveHighlight(config);
    this.tableCfg = resolveTable(config.table);
    this.tableFmt = resolveTableFormat(config.table, () => this.spansMoreThanADay());
    this.fpsCfg = resolveFps(config);

    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    el.appendChild(this.canvas);

    this.mountChrome();
    if (this.fpsCfg.show) {
      this.ensureRelative();
      this.fps = new FpsMeter(this.el, this.fpsCfg.position, this.fpsCfg.color);
    }

    this.ready = this.boot(config.data, config.backend);
  }

  /** Make the host a positioning context so overlays anchor to it. */
  private ensureRelative(): void {
    if (getComputedStyle(this.el).position === 'static') this.el.style.position = 'relative';
  }

  private mountChrome(): void {
    this.ensureRelative();

    const oc = document.createElement('canvas');
    oc.style.position = 'absolute';
    oc.style.top = '0';
    oc.style.left = '0';
    oc.style.width = '100%';
    oc.style.height = '100%';
    oc.style.display = 'block';
    oc.style.pointerEvents = 'none';
    this.el.appendChild(oc);
    this.overlayCanvas = oc;
    this.overlay = new WindRoseOverlay(oc);

    // The legend names band colors, so it only means anything in 'bands' mode;
    // in 'observations' mode the colors are a continuous ramp with nothing
    // discrete to label, and mounting one would invent categories.
    if (this.chrome.legend.show && this.cfg.geometry.mode === 'bands') {
      this.legend = new Legend(this.el, this.chrome.legend, (i) => this.handleLegendClick(i));
    }
    if (this.tableCfg.show) {
      this.table = new Table(this.el, this.tableCfg, (i, e) => this.handleTableRowClick(i, e));
    }
    if (this.chrome.title.show) this.title = new Title(this.el, this.chrome.title);
  }

  /** Resolves once the backend is initialized and the first frame is scheduled. */
  whenReady(): Promise<void> {
    return this.ready;
  }

  /** Active rendering backend, or null before {@link whenReady} resolves. */
  get backend(): Renderer['kind'] | null {
    return this.renderer?.kind ?? null;
  }

  on<K extends keyof Events>(event: K, fn: (p: Events[K]) => void): () => void {
    return this.emitter.on(event, fn);
  }

  private async boot(
    data: WindDataSet<Custom>,
    backend: WindRoseChartConfig['backend'],
  ): Promise<void> {
    this.renderer = await pickRenderer(backend ?? 'auto');
    this.resizeCanvas();
    await this.renderer.init(this.canvas);
    this.buildGrains(data, 'pour');

    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('dblclick', this.onDoubleClick);
    this.ro = new ResizeObserver(() => this.resizeCanvas());
    this.ro.observe(this.el);

    this.startTime = performance.now();
    this.loop();
  }

  private resizeCanvas(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.el.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * this.dpr));
    const h = Math.max(1, Math.round(rect.height * this.dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.renderer?.resize(w, h);
      if (this.overlayCanvas) {
        this.overlayCanvas.width = w;
        this.overlayCanvas.height = h;
      }
      // The rose rect is derived from pixel dimensions, so it is recomputed on
      // every resize — the grains follow via the plot-rect uniform, no repack.
      this.recomputeRects();
      this.drawOverlay();
    }
  }

  /** Rebuild axes, legend and table, then redraw (data or geometry change). */
  private refreshChrome(): void {
    const layout = this.layout;
    if (!layout) return;
    this.axes = buildRoseAxes(layout, this.chrome.x, this.chrome.y, {
      north: this.cfg.geometry.north,
      clockwise: this.cfg.geometry.clockwise,
      percent: this.cfg.geometry.measure === 'percent',
    });
    if (this.legend) {
      this.legend.setEntries(this.legendEntries());
      this.legend.setFocus(this.focusedIndex());
    }
    if (this.table) {
      this.table.setColumns(this.tableColumns());
      this.table.setRows(this.tableRows());
      this.table.setSelected(this.selectedRowIndex());
    }
    this.recomputeRects();
    this.drawOverlay();
  }

  /** Legend entries name the **bands** (the only discrete colors the rose has). */
  private legendEntries(): LegendEntry[] {
    const layout = this.layout;
    if (!layout || this.cfg.geometry.mode !== 'bands') return [];
    const unit = layout.intensityUnit ? ` ${layout.intensityUnit}` : '';
    return bandRanges(layout.edges).map((r, i) => ({
      label:
        r.hi === Number.POSITIVE_INFINITY
          ? `${round(r.lo)}+${unit}`
          : `${round(r.lo)}–${round(r.hi)}${unit}`,
      color: this.cfg.palette[i % Math.max(1, this.cfg.palette.length)] ?? [1, 1, 1, 1],
    }));
  }

  /** Newest reading first — the order a log is read in. */
  private tableRows(): TableRow[] {
    const layout = this.layout;
    if (!layout) return [];
    const rows: TableRow[] = [];
    const obs = layout.observations;
    const limit = Math.min(obs.length, this.tableCfg.maxRows);
    for (let k = 0; k < limit; k++) {
      const o = obs[obs.length - 1 - k]!;
      const meta = this.observationMeta(o.id);
      if (!meta) continue;
      const cells = [
        this.tableFmt.timeFormat(new Date(o.t)),
        this.tableFmt.directionFormat(meta.directionDeg),
        `${round(o.intensity)}${layout.intensityUnit ? ` ${layout.intensityUnit}` : ''}`,
      ];
      const custom = this.tableFmt.customColumn;
      if (custom) cells.push(custom.format(o.custom, meta as ObservationMeta));
      const seg = this.metaForKey(meta.segmentKey);
      const color = seg?.color;
      rows.push(color ? { id: String(o.id), cells, color } : { id: String(o.id), cells });
    }
    return rows;
  }

  /** Whether the readings span more than a day, which widens the time column. */
  private spansMoreThanADay(): boolean {
    const pts = this.norm.points;
    if (pts.length < 2) return false;
    return pts[pts.length - 1]!.t - pts[0]!.t > 24 * 60 * 60 * 1000;
  }

  /** Column headers, including the intensity label the dataset supplied. */
  private tableColumns(): string[] {
    const cols = ['Time', 'Dir', this.norm.intensityLabel];
    if (this.tableFmt.customColumn) cols.push(this.tableFmt.customColumn.label);
    return cols;
  }

  private legendClickToggle(i: number): void {
    const key = this.keyForBand(i);
    this.setSelection(key === this.selectedKey ? null : key, null);
  }

  private handleLegendClick(i: number): void {
    this.legendClickToggle(i);
  }

  /** First segment of band `i`, so a legend click has something to isolate. */
  private keyForBand(i: number): string | null {
    for (const m of this.metas) if (m.band === i) return m.key;
    return null;
  }

  private focusedIndex(): number | null {
    const seg = this.metaForKey(this.selectedKey);
    return seg && seg.band >= 0 ? seg.band : null;
  }

  private selectedRowIndex(): number | null {
    if (this.selectedObservation === null) return null;
    const obs = this.layout?.observations ?? [];
    for (let k = 0; k < obs.length; k++) {
      if (obs[obs.length - 1 - k]!.id === this.selectedObservation) return k;
    }
    return null;
  }

  private metaForKey(key: string | null): SegmentMeta | null {
    if (key === null) return null;
    for (const m of this.metas) if (m.key === key) return m;
    return null;
  }

  // --- Selection (one path for table clicks, petal clicks and API calls) ----

  /**
   * Select the mark holding observation `id` — the same code path a table row
   * click and a petal click take, so a scripted selection and a clicked one are
   * indistinguishable downstream.
   */
  selectObservation(id: number | null): void {
    if (id === null) {
      this.setSelection(null, null);
      return;
    }
    const key = this.layout?.segmentKeyByObservation.get(id) ?? null;
    this.setSelection(key, id);
  }

  /** Select a segment by its key; `null` clears the selection. */
  selectSegment(key: string | null): void {
    this.setSelection(key, null);
  }

  getSelected(): { segmentKey: string | null; observationId: number | null } {
    return { segmentKey: this.selectedKey, observationId: this.selectedObservation };
  }

  private setSelection(key: string | null, observationId: number | null): void {
    if (key === this.selectedKey && observationId === this.selectedObservation) return;
    this.selectedKey = key;
    // Keep the row in step even when the caller selected by segment: the table
    // is a view of the same selection, not a second one.
    this.selectedObservation =
      observationId ?? (key ? (this.metaForKey(key)?.observationIds[0] ?? null) : null);
    this.legend?.setFocus(this.focusedIndex());
    this.table?.setSelected(this.selectedRowIndex());
    this.overlayDirty = true;
    this.emitter.emit('select', {
      segmentKey: this.selectedKey,
      observationId: this.selectedObservation,
      segment: this.metaForKey(this.selectedKey),
    });
  }

  private handleTableRowClick(index: number, e: MouseEvent): void {
    const obs = this.layout?.observations ?? [];
    const o = obs[obs.length - 1 - index];
    const meta = o ? this.observationMeta(o.id) : null;
    runMouseHook(
      this.cfg.mouse.onTableRowClick as MouseHook<ObservationMeta, MouseEvent> | undefined,
      meta as ObservationMeta | null,
      e,
      { x: 0, y: 0 },
      () => {
        if (o) this.selectObservation(o.id);
      },
    );
  }

  /** Public view of one reading, or null when it was dropped as unusable. */
  private observationMeta(id: number): ObservationMeta<Custom> | null {
    for (const o of this.norm.points) {
      if (o.id !== id) continue;
      const deg = degreesFromRadians(o.direction);
      return {
        id: o.id,
        t: o.t,
        directionDeg: deg,
        bearing: bearingLabel(deg),
        intensity: o.intensity,
        custom: o.custom,
        segmentKey: this.layout?.segmentKeyByObservation.get(o.id) ?? null,
      };
    }
    return null;
  }

  /** Plot margins from the legend, table and title (the axes are polar). */
  private margins(): Margins {
    const m: Margins = { top: 4, right: 8, bottom: 4, left: 8 };
    // Two layers on one edge must stack, not overlap: each is told how far in
    // the previous one already pushed, and the plot is inset by the total.
    const offsets: Record<string, number> = { top: 0, right: 0, bottom: 0, left: 0 };
    if (this.title && this.chrome.title.show) {
      const side = this.chrome.title.position;
      this.title.setEdgeOffset(offsets[side]!);
      const ext = this.title.measure() + 4;
      offsets[side]! += ext;
      m[side] += ext;
    }
    if (this.legend && this.chrome.legend.show) {
      const side = this.chrome.legend.position;
      this.legend.setEdgeOffset(offsets[side]!);
      const ext = this.legend.measure() + 6;
      offsets[side]! += ext;
      m[side] += ext;
    }
    if (this.table && this.tableCfg.show) {
      const side = this.tableCfg.position;
      this.table.setEdgeOffset(offsets[side]!);
      const ext = this.table.measure() + 6;
      offsets[side]! += ext;
      m[side] += ext;
    }
    return m;
  }

  /**
   * Recompute the plot rect (chrome gutters removed) and the square rose rect
   * centered inside it. Squaring the *rect* rather than the geometry is what
   * keeps the rose circular without repacking grains on resize.
   */
  private recomputeRects(): void {
    const W = Math.max(1, this.canvas.width);
    const H = Math.max(1, this.canvas.height);
    this.plotRect = marginsToPlotRect(this.margins(), W, H, this.dpr);
    this.roseRect = squareRect(this.plotRect, W, H);
  }

  private drawOverlay(now = this.nowSeconds()): void {
    if (!this.overlay || !this.overlayCanvas) return;
    const solid = this.revealState(now).solid;
    this.lastSolid = solid;
    this.overlay.draw({
      deviceW: this.overlayCanvas.width,
      deviceH: this.overlayCanvas.height,
      dpr: this.dpr,
      plotRect: this.plotRect,
      roseRect: this.roseRect,
      chrome: this.chrome,
      metas: this.metas,
      style: this.style,
      solid,
      hoverWeights: this.hoverWeights,
      highlightGain: this.cfg.hoverEffects.has('highlight') ? this.cfg.highlightGain : 1,
      dimWeights: this.dimWeights,
      dimOpacity: this.cfg.dimOpacity,
      highlightWeights: this.highlightWeights,
      highlight: this.highlightCfg,
      hoveredSegment: this.hovered,
      pointer: this.pointerPx,
      axes: this.axes,
      ringLabelAngle: this.cfg.ringLabelAngle,
      intensityLabel: this.norm.intensityLabel,
      intensityUnit: this.norm.intensityUnit,
      percent: this.cfg.geometry.measure === 'percent',
      geomVersion: this.geomVersion,
    });
    this.overlayDirty = false;
  }

  private solidHoverActive(): boolean {
    if (!this.style.enabled || !this.cfg.hoverEffects.has('highlight')) return false;
    if (this.hoveredSegmentId !== -1) return true;
    for (let i = 0; i < this.hoverWeights.length; i++) {
      if (this.hoverWeights[i]! > 0.001) return true;
    }
    return false;
  }

  private solidDimActive(): boolean {
    if (!this.style.enabled) return false;
    if (this.selectedKey !== null) return true;
    for (let i = 0; i < this.dimWeights.length; i++) if (this.dimWeights[i]! > 0.001) return true;
    return false;
  }

  private nowSeconds(): number {
    return (performance.now() - this.startTime) / 1000;
  }

  /** Reveal state at `now` (seconds): grain fade-out + fill/border fade-in. */
  private revealState(now: number): { grainFade: number; solid: number } {
    const r = this.style;
    if (!r.enabled) return { grainFade: 1, solid: 0 };
    if (this.revealMode === 'morph') {
      if (!this.morph || this.cfg.reflow === 'withPetal' || !this.cfg.morphGrains) {
        return { grainFade: r.reveal.grainsTo, solid: 1 };
      }
      const e = ease(clamp01((now - this.morph.start) / this.morph.dur), r.reveal.ease);
      return { grainFade: 1 + (r.reveal.grainsTo - 1) * e, solid: 1 };
    }
    const start =
      r.reveal.start === 'afterPour' ? this.cfg.duration + this.cfg.stagger : r.reveal.start;
    const solid = revealFactor(now, start, r.reveal.duration, r.reveal.ease);
    const grainFade = 1 + (r.reveal.grainsTo - 1) * solid;
    return { grainFade, solid };
  }

  /**
   * Advance the active segment tween: write the eased `from → to` geometry into
   * each meta, so overlay draw, hit-test and the readout all use the tweened
   * shape. Snaps to `to` and clears the tween once complete.
   */
  private applyMorph(now: number): boolean {
    const mo = this.morph;
    if (!mo) return false;
    const p = mo.dur > 0 ? (now - mo.start) / mo.dur : 1;
    const done = p >= 1;
    const e = done ? 1 : ease(clamp01(p), this.style.reveal.ease);
    const n = Math.min(this.metas.length, mo.from.length, mo.to.length);
    for (let i = 0; i < n; i++) {
      const f = mo.from[i]!;
      const t = mo.to[i]!;
      const m = this.metas[i]!;
      m.a0 = f.a0 + (t.a0 - f.a0) * e;
      m.a1 = f.a1 + (t.a1 - f.a1) * e;
      m.rInner = f.rInner + (t.rInner - f.rInner) * e;
      m.rOuter = f.rOuter + (t.rOuter - f.rOuter) * e;
    }
    this.geomVersion++;
    if (done) this.morph = null;
    return !done;
  }

  /**
   * Build the grain buffer from `data`. `'pour'` scatters grains from above;
   * `'morph'` flows them from the prior state by segment identity and arms a
   * tween so the solid layer changes smoothly.
   */
  private buildGrains(data: WindDataSet<Custom>, mode: BuildMode): void {
    const prevGrains = this.grains;
    const prevMetas = this.metas;

    validateWind(data);
    this.norm = normalizeWind(data);
    const layout = layoutWindRose(this.norm, this.cfg.palette, this.cfg.geometry);
    const { wedges, metas } = layout;
    this.layout = layout;
    this.metas = metas;
    this.data = data;
    this.geomVersion++;

    // A selection that no longer exists (its reading aged out, or the mode
    // changed under it) would dim every segment against a mark that is gone.
    if (this.selectedKey !== null && !metas.some((m) => m.key === this.selectedKey)) {
      this.selectedKey = null;
      this.selectedObservation = null;
    }

    this.hoverWeights = resize(this.hoverWeights, metas.length);
    this.dimWeights = resize(this.dimWeights, metas.length);
    this.recomputeHighlight();

    const counts = wedgeGrainCounts(wedges, {
      density: this.cfg.grainDensity,
      maxGrains: this.cfg.maxGrains,
    });
    const total = counts.reduce((a, b) => a + b, 0);

    const canMorph = mode === 'morph' && prevGrains.count > 0 && prevMetas.length > 0;

    let oldGrainsBySegment: Map<number, number[]> | null = null;
    let oldSegmentByKey: Map<string, number> | null = null;
    const ghosts: number[] = [];
    let ghostTotal = 0;
    if (canMorph) {
      oldGrainsBySegment = groupGrainsBySegment(prevGrains);
      oldSegmentByKey = new Map();
      for (const m of prevMetas) oldSegmentByKey.set(m.key, m.segmentId);
      if (this.cfg.exit === 'fall') {
        const newKeys = new Set(metas.map((m) => m.key));
        for (const m of prevMetas) {
          if (newKeys.has(m.key)) continue;
          const list = oldGrainsBySegment.get(m.segmentId);
          if (list && list.length > 0) {
            ghosts.push(m.segmentId);
            ghostTotal += list.length;
          }
        }
      }
    }

    const g = allocGrains(total + ghostTotal);
    packWedges(wedges, counts, g, {
      density: this.cfg.grainDensity,
      jitter: this.cfg.jitter,
      seed: 1,
    });

    if (!canMorph) {
      scatterStarts(g, { duration: this.cfg.duration, stagger: this.cfg.stagger, seed: 7 });
      this.morph = null;
    } else {
      this.morphGrainStarts(g, metas, counts, prevGrains, oldGrainsBySegment!, oldSegmentByKey!);
      if (ghosts.length > 0) {
        this.appendGhosts(g, total, ghosts, prevGrains, oldGrainsBySegment!);
      }
      this.armSegmentTween(metas, prevMetas);
    }
    this.revealMode = canMorph ? 'morph' : 'pour';

    this.grains = g;
    this.renderer?.upload(g);
    this.startTime = performance.now();
    this.lastSolid = -1;
    if (this.morph) this.applyMorph(0);

    this.refreshChrome();
  }

  /**
   * Assign morph starts per segment (grains are packed in segment order, so
   * `counts` gives each segment's contiguous range):
   *
   * - **existing segment** — grain *k* from old grain *k* (`'translate'`) or a
   *   random old grain (`'reshuffle'`);
   * - **new segment** — grow at the petal's rim (`enter: 'grow'`, the streaming
   *   case), fall from above (`'pour'`), or grow out of the center (`'rise'`).
   */
  private morphGrainStarts(
    g: GrainBuffer,
    metas: SegmentMeta[],
    counts: number[],
    prevGrains: GrainBuffer,
    oldGrainsBySegment: Map<number, number[]>,
    oldSegmentByKey: Map<string, number>,
  ): void {
    const rng = mulberry32(9);
    let off = 0;
    for (let si = 0; si < metas.length; si++) {
      const cnt = counts[si]!;
      if (cnt <= 0) continue;
      const m = metas[si]!;
      const oldSeg = oldSegmentByKey.get(m.key);
      const pool = oldSeg !== undefined ? oldGrainsBySegment.get(oldSeg) : undefined;
      const pourDelay = (gi: number): number =>
        this.cfg.stagger * (g.targetY[gi]! * 0.5 + rng() * 0.5);
      for (let k = 0; k < cnt; k++) {
        const i = off + k;
        if (!this.cfg.morphGrains) {
          // Snap: only the solid layer tweens on a data change.
          g.startX[i] = g.targetX[i]!;
          g.startY[i] = g.targetY[i]!;
          g.delay[i] = 0;
        } else if (pool && pool.length > 0) {
          const src =
            this.cfg.reflow === 'reshuffle'
              ? pool[(rng() * pool.length) | 0]!
              : pool[Math.min(pool.length - 1, ((k * pool.length) / cnt) | 0)]!;
          g.startX[i] = prevGrains.targetX[src]!;
          g.startY[i] = prevGrains.targetY[src]!;
          g.delay[i] = this.cfg.reflow === 'withPetal' ? 0 : pourDelay(i);
        } else if (this.cfg.enter === 'grow') {
          // Open at the segment's inner edge: a new reading extends the petal
          // it joins rather than arriving from somewhere else entirely.
          const mid = (m.a0 + m.a1) / 2;
          g.startX[i] = clamp01(0.5 + Math.sin(mid) * m.rInner);
          g.startY[i] = clamp01(0.5 + Math.cos(mid) * m.rInner);
          g.delay[i] = this.cfg.reflow === 'withPetal' ? 0 : pourDelay(i) * 0.4;
        } else if (this.cfg.enter === 'rise') {
          g.startX[i] = 0.5;
          g.startY[i] = 0.5;
          g.delay[i] = pourDelay(i);
        } else {
          g.startX[i] = g.targetX[i]!;
          g.startY[i] = 1 + rng() * 0.4;
          g.delay[i] = pourDelay(i);
        }
      }
      off += cnt;
    }
  }

  /**
   * Append removed segments' old grains as ghosts: they start where they were
   * and fall off the bottom, fading with the global grain-fade. `barId = 0` is
   * a safe hover index; ghosts have no meta so they are never hit-tested.
   */
  private appendGhosts(
    g: GrainBuffer,
    offset: number,
    ghosts: number[],
    prevGrains: GrainBuffer,
    oldGrainsBySegment: Map<number, number[]>,
  ): void {
    const rng = mulberry32(21);
    let gi = offset;
    for (const seg of ghosts) {
      for (const src of oldGrainsBySegment.get(seg)!) {
        g.startX[gi] = prevGrains.targetX[src]!;
        g.startY[gi] = prevGrains.targetY[src]!;
        g.targetX[gi] = prevGrains.targetX[src]!;
        g.targetY[gi] = -0.4 - rng() * 0.3;
        g.colorIdx[gi] = prevGrains.colorIdx[src]!;
        g.barId[gi] = 0;
        g.seed[gi] = prevGrains.seed[src]!;
        g.delay[gi] = this.cfg.stagger * 0.2 * rng();
        gi++;
      }
    }
  }

  /**
   * Arm a tween from the old per-segment geometry (matched by key) to the new
   * one. A segment with no predecessor opens from a zero-thickness sliver at
   * its inner edge, so a petal visibly grows outward as readings arrive.
   */
  private armSegmentTween(metas: SegmentMeta[], prevMetas: SegmentMeta[]): void {
    if (!this.style.enabled) {
      this.morph = null;
      return;
    }
    const oldByKey = new Map<string, WedgeBox>();
    for (const m of prevMetas) {
      oldByKey.set(m.key, { a0: m.a0, a1: m.a1, rInner: m.rInner, rOuter: m.rOuter });
    }
    const from: WedgeBox[] = [];
    const to: WedgeBox[] = [];
    for (const m of metas) {
      to.push({ a0: m.a0, a1: m.a1, rInner: m.rInner, rOuter: m.rOuter });
      const old = oldByKey.get(m.key);
      from.push(old ?? { a0: m.a0, a1: m.a1, rInner: m.rInner, rOuter: m.rInner });
    }
    this.morph = { start: 0, dur: this.cfg.morphDuration, from, to };
  }

  // --- Latest-value highlight ----------------------------------------------

  /**
   * Recompute which segments carry the latest-value emphasis. Rebuilt on every
   * data change, because "latest" moves with the data rather than with the
   * pointer.
   */
  private recomputeHighlight(): void {
    const weights = new Float32Array(this.metas.length);
    const targets = highlightTargets(this.norm.points, this.highlightCfg);
    const metas: ObservationMeta<Custom>[] = [];
    for (const t of targets) {
      const key = this.layout?.segmentKeyByObservation.get(t.id);
      const seg = this.metaForKey(key ?? null);
      // Several highlighted readings can share one segment in 'bands' mode;
      // the strongest weight wins rather than accumulating past 1.
      if (seg && t.weight > (weights[seg.segmentId] ?? 0)) weights[seg.segmentId] = t.weight;
      const meta = this.observationMeta(t.id);
      if (meta) metas.push(meta);
    }
    this.highlightWeights = weights;
    this.highlighted = metas;
    this.emitter.emit('highlight', { observations: metas as ObservationMeta[] });
  }

  /** The readings the latest-value highlight currently resolves to. */
  getHighlighted(): ObservationMeta<Custom>[] {
    return [...this.highlighted];
  }

  /** Every drawn segment, in draw order. */
  getSegments(): SegmentMeta[] {
    return [...this.metas];
  }

  /** Rows dropped by {@link normalizeWind} as unusable. */
  getDroppedCount(): number {
    return this.norm.dropped;
  }

  // --- Data lifecycle ------------------------------------------------------

  getData(): WindDataSet<Custom> {
    return this.data;
  }

  /** Replace the dataset and morph to it. */
  setData(data: WindDataSet<Custom>): void {
    if (this.disposed) return;
    this.buildGrains(data, 'morph');
  }

  /** Append readings — the streaming case; petals grow to take them. */
  add(points: WindPoint<Custom>[]): void {
    if (this.disposed || points.length === 0) return;
    this.buildGrains({ ...this.data, points: [...this.data.points, ...points] }, 'morph');
  }

  /** Drop readings by source index (negative counts from the end). */
  remove(indices: number[]): void {
    if (this.disposed || indices.length === 0) return;
    const drop = new Set(indices.map((i) => (i < 0 ? this.data.points.length + i : i)));
    const points = this.data.points.filter((_, i) => !drop.has(i));
    this.buildGrains({ ...this.data, points }, 'morph');
  }

  /** Re-pour from scratch (a fresh scatter rather than a morph). */
  repour(): void {
    if (this.disposed) return;
    this.buildGrains(this.data, 'pour');
  }

  // --- Frame loop ----------------------------------------------------------

  private loop = (): void => {
    if (this.disposed) return;
    const now = this.nowSeconds();
    const ms = performance.now();
    const dt = this.lastFrameMs > 0 ? (ms - this.lastFrameMs) / 1000 : 0;
    this.lastFrameMs = ms;

    this.easeHoverWeights(dt);
    this.easeDimWeights(dt);
    const morphing = this.applyMorph(now);

    if (this.renderer) {
      this.renderer.frame(this.uniforms(now));
      this.fps?.sample(dt, ms);
    }

    if (this.overlay) {
      const solid = this.revealState(now).solid;
      if (
        morphing ||
        solid !== this.lastSolid ||
        this.solidHoverActive() ||
        this.solidDimActive() ||
        this.overlayDirty
      ) {
        this.drawOverlay(now);
      }
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private easeHoverWeights(dt: number): void {
    const w = this.hoverWeights;
    const k = this.cfg.hoverFade > 0 && dt > 0 ? 1 - Math.exp(-dt / this.cfg.hoverFade) : 1;
    for (let i = 0; i < w.length; i++) {
      const target = i === this.hoveredSegmentId ? 1 : 0;
      const next = w[i]! + (target - w[i]!) * k;
      w[i] = Math.abs(next - target) < 0.001 ? target : next;
    }
  }

  /** Dim every segment other than the selected one; nothing dims with no selection. */
  private easeDimWeights(dt: number): void {
    const w = this.dimWeights;
    const selected = this.metaForKey(this.selectedKey)?.segmentId ?? -1;
    const k = this.cfg.dimFade > 0 && dt > 0 ? 1 - Math.exp(-dt / this.cfg.dimFade) : 1;
    for (let i = 0; i < w.length; i++) {
      const target = selected !== -1 && i !== selected ? 1 : 0;
      const next = w[i]! + (target - w[i]!) * k;
      w[i] = Math.abs(next - target) < 0.001 ? target : next;
    }
  }

  private uniforms(now: number): FrameUniforms {
    const useHighlight = this.cfg.hoverEffects.has('highlight');
    const useJitter = this.cfg.hoverEffects.has('jitter');
    const useOpacity = this.cfg.hoverEffects.has('opacity');
    const glow = this.highlightCfg.show && this.highlightCfg.mode === 'glow';
    return {
      now,
      duration: this.cfg.duration,
      easing: this.cfg.ease,
      grainSizePx: this.cfg.grainSizePx * this.dpr,
      grainShape: this.cfg.grainShape,
      // Grains index the layout's palette: band colors, or the quantized
      // intensity ramp plus the calm color.
      palette: this.layout?.grainPalette ?? this.cfg.palette,
      viewport: [this.canvas.width, this.canvas.height],
      hoverWeights: this.hoverWeights,
      highlightGain: useHighlight ? this.cfg.highlightGain : 1,
      hoverJitterAmp: useJitter ? this.cfg.hoverJitterAmp : 0,
      hoverOpacity: useOpacity ? this.cfg.hoverOpacity : -1,
      dimWeights: this.dimWeights,
      dimOpacity: this.cfg.dimOpacity,
      // The latest-value glow rides its own channel, not `hoverWeights`: that
      // one also drives the hover jitter, and this emphasis is permanent, so
      // sharing it would leave the newest petal shimmering forever.
      emphasisWeights: this.highlightWeights,
      emphasisGain: glow ? this.highlightCfg.gain : 1,
      settleJitterAmp: this.cfg.settleJitter,
      background: this.cfg.background,
      // Grains live in the square rose box, which is what makes it round.
      plotRect: this.roseRect,
      grainFade: this.revealState(now).grainFade,
    };
  }

  // --- Pointer -------------------------------------------------------------

  private devicePoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * this.dpr,
      y: (e.clientY - rect.top) * this.dpr,
    };
  }

  private cssPoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.devicePoint(e);
    this.pointerPx = p;
    const hit = this.hitTest(p);
    runMouseHook(this.cfg.mouse.onPetalHover, hit, e, this.cssPoint(e), () => {
      this.applyHover(hit);
    });
    // The event fires whether or not the hook cancelled the built-in effect:
    // an observer is not an override.
    const id = hit?.segmentId ?? -1;
    if (id !== this.lastEmittedHover) {
      this.lastEmittedHover = id;
      this.emitter.emit('hover', { segment: hit });
    }
    if (this.overlay && this.chrome.currentValue.show) this.overlayDirty = true;
  };

  /** Last hover id *emitted*, tracked apart from the visual hover state so a
   * cancelling hook still gets exactly one event per change. */
  private lastEmittedHover = -1;

  private applyHover(hit: SegmentMeta | null): void {
    const id = hit?.segmentId ?? -1;
    if (id === this.hoveredSegmentId) return;
    this.hoveredSegmentId = id;
    this.hovered = hit;
    this.canvas.style.cursor = hit ? 'pointer' : '';
  }

  private onPointerLeave = (): void => {
    this.pointerPx = null;
    this.canvas.style.cursor = '';
    if (this.hoveredSegmentId !== -1) {
      this.hoveredSegmentId = -1;
      this.hovered = null;
    }
    if (this.lastEmittedHover !== -1) {
      this.lastEmittedHover = -1;
      this.emitter.emit('hover', { segment: null });
    }
    if (this.overlay && this.chrome.currentValue.show) this.overlayDirty = true;
  };

  private onPointerDown = (e: PointerEvent): void => {
    const hit = this.hitTest(this.devicePoint(e));
    const px = this.cssPoint(e);
    if (hit) {
      runMouseHook(this.cfg.mouse.onPetalClick, hit, e, px, () => {
        // Clicking the selected segment again clears it, so the rose is never
        // stuck in a selection the user cannot undo with the same gesture.
        this.setSelection(hit.key === this.selectedKey ? null : hit.key, null);
      });
    } else {
      runMouseHook(this.cfg.mouse.onBackgroundClick, null, e, px, () => {
        this.setSelection(null, null);
      });
    }
  };

  private onDoubleClick = (e: MouseEvent): void => {
    const hit = this.hitTest(this.devicePoint(e));
    runMouseHook(this.cfg.mouse.onPetalDblClick, hit, e, this.cssPoint(e), () => {
      this.setSelection(null, null);
    });
  };

  /** Segment under a device-px point, or null. */
  private hitTest(p: { x: number; y: number }): SegmentMeta | null {
    const [x0, y0, x1, y1] = this.roseRect;
    const W = this.canvas.width;
    const H = this.canvas.height;
    // Canvas fraction (y-up), then into rose-local layout space.
    const cx = p.x / Math.max(1, W);
    const cy = 1 - p.y / Math.max(1, H);
    const lx = (cx - x0) / Math.max(1e-6, x1 - x0);
    const ly = (cy - y0) / Math.max(1e-6, y1 - y0);
    return hitSegment(this.metas, lx, ly);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('dblclick', this.onDoubleClick);
    this.ro?.disconnect();
    this.renderer?.dispose();
    this.emitter.clear();
    this.legend?.dispose();
    this.table?.dispose();
    this.title?.dispose();
    this.fps?.dispose();
    this.overlay?.dispose();
    this.overlayCanvas?.remove();
    this.canvas.remove();
  }
}

/** Grow/shrink a weight buffer, preserving overlapping indices. */
function resize(src: Float32Array, length: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(length);
  out.set(src.subarray(0, Math.min(length, src.length)));
  return out;
}

function round(v: number): string {
  return String(Math.round(v * 100) / 100);
}
