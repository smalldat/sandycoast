// Reuse the bar chart's chrome infrastructure verbatim (legend/title/margins/fps).
import {
  type Margins,
  type ResolvedChrome,
  marginsToPlotRect,
  resolveChrome,
} from '../../core/chrome/chrome.js';
import type { AxisTick } from '../../core/chrome/format.js';
import { FpsMeter, type ResolvedFps, resolveFps } from '../../core/chrome/fps.js';
import { Legend, type LegendEntry } from '../../core/chrome/legend.js';
import { Title } from '../../core/chrome/title.js';
import { appendPoints, patchPoints, removePoints } from '../../core/data/dataset.js';
import { squareRect } from '../../core/layout/polar.js';
import type { DataSet, Point, PointPatch, PointRef, Scalar } from '../../core/data/types.js';
import { ease, scatterStarts } from '../../core/particles/anim.js';
import { type GrainBuffer, allocGrains } from '../../core/particles/grains.js';
import { packWedges, wedgeGrainCounts } from '../../core/particles/pack.js';
import { mulberry32 } from '../../core/particles/rng.js';
import { pickRenderer } from '../../core/render/pick.js';
import type { FrameUniforms, RGBA, Renderer } from '../../core/render/types.js';
import { DEFAULT_PALETTE, parseColor } from '../../core/util/color.js';
import { Emitter } from '../../core/util/emitter.js';
import { type PieLayout, type PieLayoutOptions, hitSlice, layoutPie } from './layout.js';
import { PieOverlay } from './overlay.js';
import { type ResolvedPieStyle, resolvePieStyle, revealFactor } from './pieStyle.js';
import {
  type ResolvedSlider,
  fractionAtPx,
  indexAt,
  resolveSlider,
  sliderBandPx,
  sliderTicks,
  sliderTrack,
  trackPos,
} from './slider.js';
import {
  DEFAULT_MAX_SERIES,
  DEFAULT_MAX_SLICES,
  type HoverPayload,
  type PieChartConfig,
  type SeriesChangePayload,
  type SeriesFocusPayload,
  type SliceMeta,
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
  /** Transition window (wedge tween + grain fade) for series/data changes, seconds. */
  morphDuration: number;
  reflow: 'translate' | 'reshuffle' | 'withSlice';
  enter: 'pour' | 'rise';
  exit: 'fall' | 'vanish';
  hoverEffects: Set<'highlight' | 'jitter' | 'opacity'>;
  highlightGain: number;
  hoverJitterAmp: number;
  hoverOpacity: number;
  hoverFade: number;
  /** Alpha multiplier for a fully-dimmed (isolated-out) slice. */
  dimOpacity: number;
  /** Dim ease in/out time, seconds. */
  dimFade: number;
  /** Geometry knobs, minus the series index (which is live state). */
  geometry: Omit<PieLayoutOptions, 'seriesIndex'>;
}

function resolve(cfg: PieChartConfig): Resolved {
  const hover = cfg.interaction?.hover;
  const anim = cfg.animation;
  const duration = anim?.duration != null ? anim.duration / 1000 : 0.9;
  const stagger = anim?.stagger != null ? anim.stagger / 1000 : 0.5;
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
    enter: anim?.enter ?? 'pour',
    exit: anim?.exit ?? 'fall',
    hoverEffects: new Set(hover?.effects ?? ['highlight', 'jitter']),
    highlightGain: hover?.highlightGain ?? 1.6,
    hoverJitterAmp: hover?.jitterAmp ?? 0.008,
    hoverOpacity: hover?.opacity ?? 1,
    hoverFade: (hover?.fadeMs ?? 180) / 1000,
    dimOpacity: cfg.interaction?.dim?.opacity ?? 0.15,
    dimFade: (cfg.interaction?.dim?.fadeMs ?? 200) / 1000,
    geometry: {
      maxSlices: cfg.maxSlices ?? DEFAULT_MAX_SLICES,
      maxSeries: cfg.maxSeries ?? DEFAULT_MAX_SERIES,
      innerRadius: cfg.innerRadius ?? 0,
      radius: cfg.radius ?? 0.92,
      startAngle: (cfg.startAngle ?? 0) * DEG,
      padAngle: (cfg.padAngle ?? 0) * DEG,
    },
  };
}

type Events = {
  hover: HoverPayload;
  seriesChange: SeriesChangePayload;
  seriesFocus: SeriesFocusPayload;
};

/** How grains enter on a build: fresh pour vs. morph from the prior state. */
type BuildMode = 'pour' | 'morph';

/** A slice's animated geometry (layout space). */
interface WedgeBox {
  a0: number;
  a1: number;
  rInner: number;
  rOuter: number;
}

/** An in-flight wedge tween: interpolate `from → to` per slice over `dur`. */
interface MorphTween {
  start: number;
  dur: number;
  from: WedgeBox[];
  to: WedgeBox[];
}

/** Data identity of a slice. Series is deliberately *not* part of the key: a
 * slider move should morph `Chrome` into `Chrome`, not fade one out and another
 * in. */
function sliceKey(xValue: unknown): string {
  return String(xValue);
}

/** Group grain indices by their `barId` (= slice id), preserving buffer order. */
function groupGrainsBySlice(grains: GrainBuffer): Map<number, number[]> {
  const bySlice = new Map<number, number[]>();
  for (let i = 0; i < grains.count; i++) {
    const b = grains.barId[i]!;
    let arr = bySlice.get(b);
    if (!arr) {
      arr = [];
      bySlice.set(b, arr);
    }
    arr.push(i);
  }
  return bySlice;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Sand pie / donut chart. Mounts into an element and renders one series of the
 * dataset as annular sectors of animated grains via the best available backend
 * (WebGPU → Canvas2D).
 *
 * Mirrors {@link BarChart}'s config surface and lifecycle. The differences:
 *
 * - the series axis is a **selector**, not a visual dimension — a slider (styled
 *   from `axes.x`, the block the bar chart's category axis uses) picks which
 *   series is drawn, and changing it morphs the slices to the new values;
 * - the layout box maps onto a **square** sub-rect of the plot, so the disc is a
 *   true circle at any host aspect ratio;
 * - `innerRadius` cuts the middle out, turning the pie into a donut.
 */
export class PieChart {
  private el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private cfg: Resolved;
  private renderer: Renderer | null = null;
  private grains: GrainBuffer = allocGrains(0);
  private metas: SliceMeta[] = [];
  /** Current dataset (source of truth for {@link update}/{@link add}/{@link remove}). */
  private data: DataSet = { points: [] };
  private emitter = new Emitter<Events>();

  /** Reveal timing regime: fresh pour vs. in-place morph (wedges stay solid). */
  private revealMode: BuildMode = 'pour';
  /** Active wedge tween, or null when settled. */
  private morph: MorphTween | null = null;

  private chrome: ResolvedChrome;
  private style: ResolvedPieStyle;
  private sliderCfg: ResolvedSlider;
  /** Last drawn reveal factor; -1 forces the next overlay redraw. */
  private lastSolid = -1;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlay: PieOverlay | null = null;
  private legend: Legend | null = null;
  private title: Title | null = null;
  private fpsCfg: ResolvedFps;
  private fps: FpsMeter | null = null;
  private layout: PieLayout | null = null;
  private ticks: AxisTick[] = [];
  /** Full plot rect (chrome gutters removed), normalized y-up. */
  private plotRect: [number, number, number, number] = [0, 0, 1, 1];
  /** Square sub-rect of the plot the disc lives in; the grains' plot rect. */
  private discRect: [number, number, number, number] = [0, 0, 1, 1];
  private hovered: SliceMeta | null = null;
  private pointerPx: { x: number; y: number } | null = null;
  private geomVersion = 0;
  /** Set by pointer events; the RAF loop coalesces them into one redraw. */
  private overlayDirty = false;
  private raf = 0;
  private startTime = 0;
  private lastFrameMs = 0;
  private hoveredSliceId = -1;
  /** Per-slice hover weight in [0,1], eased toward 1 for the hovered slice. */
  private hoverWeights = new Float32Array(0);
  /**
   * Slice index isolated via the legend / `focusSeries()`, or null. Named
   * `focusedSlice` internally — "series" here means the legend's entries,
   * which for the pie chart are slices of the currently displayed series,
   * not the slider's series (see `focusSeries`'s doc comment).
   */
  private focusedSlice: number | null = null;
  /** Per-slice dim weight in [0,1], eased toward 1 for non-focused slices. */
  private dimWeights = new Float32Array(0);

  // --- Series slider state -------------------------------------------------
  /** Selected series index (the value the slider represents). */
  private seriesIndex = 0;
  /** Drawn handle position, 0..1; eases toward the selected index. */
  private handlePos = 0;
  /** True while the user drags the handle (it then tracks the pointer exactly). */
  private dragging = false;
  private dragPointerId = -1;

  private dpr = 1;
  private ro: ResizeObserver | null = null;
  private disposed = false;
  private ready: Promise<void>;

  constructor(el: HTMLElement, config: PieChartConfig) {
    this.el = el;
    // Seat data synchronously so getData() is valid before the async boot runs
    // buildGrains(); otherwise a rebuild firing mid-boot captures empty data.
    this.data = config.data;
    this.cfg = resolve(config);
    this.chrome = resolveChrome(config);
    this.style = resolvePieStyle(config);
    this.sliderCfg = resolveSlider(config.slider);
    this.fpsCfg = resolveFps(config);
    this.seriesIndex = Math.max(0, Math.round(config.seriesIndex ?? 0));
    this.handlePos = 0.5;

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

  /**
   * Create the overlay canvas + DOM legend/title layers. Unlike the bar chart
   * the overlay is always mounted: the slider lives on it.
   */
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
    this.overlay = new PieOverlay(oc);

    if (this.chrome.legend.show) {
      this.legend = new Legend(this.el, this.chrome.legend, (i) => this.handleLegendClick(i));
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

  private async boot(data: DataSet, backend: PieChartConfig['backend']): Promise<void> {
    this.renderer = await pickRenderer(backend ?? 'auto');
    this.resizeCanvas();
    await this.renderer.init(this.canvas);
    this.buildGrains(data, 'pour');
    this.handlePos = trackPos(this.seriesIndex, this.seriesCount);

    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('pointercancel', this.onPointerUp);
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
      // The disc rect is derived from pixel dimensions, so it must be recomputed
      // on every resize — the grains then follow via the plot-rect uniform, with
      // no repacking.
      this.recomputeRects();
      this.drawOverlay();
    }
  }

  /** Rebuild the slider ticks + legend and redraw the overlay (data change). */
  private refreshChrome(): void {
    const layout = this.layout;
    if (!layout) return;
    this.ticks = this.sliderCfg.show ? sliderTicks(layout.series, this.chrome.x) : [];
    if (this.legend) {
      this.legend.setEntries(this.legendEntries());
      this.legend.setFocus(this.focusedSlice);
    }
    this.recomputeRects();
    this.drawOverlay();
  }

  /** Legend entry `i` was clicked: toggle isolation of slice `i`. */
  private handleLegendClick(i: number): void {
    this.setFocus(this.focusedSlice === i ? null : i);
  }

  private setFocus(index: number | null): void {
    if (index === this.focusedSlice) return;
    this.focusedSlice = index;
    this.legend?.setFocus(index);
    this.emitter.emit('seriesFocus', { index });
  }

  /**
   * Isolate one legend entry by index — it stays at full opacity, every other
   * entry dims to `interaction.dim.opacity`. `null` clears the isolation.
   * Equivalent to clicking that entry's legend; fires `seriesFocus`.
   *
   * On the pie chart, the legend's entries are **slices of the currently
   * displayed series** (see {@link legendEntries}), not the slider's series —
   * so `index` addresses a slice, not what {@link setSeriesIndex} addresses.
   * The method is named the same as the other charts' for a consistent public
   * API; this doc note is the one place that consistency costs a wrinkle.
   */
  focusSeries(index: number | null): void {
    this.setFocus(index);
  }

  /** Currently isolated slice index (see {@link focusSeries}), or `null`. */
  getFocusedSeries(): number | null {
    return this.focusedSlice;
  }

  /** Legend entries describe the **slices** (the pie's categories). */
  private legendEntries(): LegendEntry[] {
    return this.metas.map((m) => ({ label: String(m.xValue), color: m.color }));
  }

  /** Plot margins from the legend, title and slider band (there are no axes). */
  private margins(): Margins {
    const m: Margins = { top: 4, right: 8, bottom: 4, left: 8 };
    if (this.sliderCfg.show && this.seriesCount > 1) {
      m[this.sliderCfg.position] += sliderBandPx(this.sliderCfg, this.chrome.x);
    }
    if (this.legend && this.chrome.legend.show) {
      m[this.chrome.legend.position] += this.legend.measure() + 6;
    }
    if (this.title && this.chrome.title.show) {
      m[this.chrome.title.position] += this.title.measure() + 4;
    }
    return m;
  }

  /**
   * Recompute the plot rect (chrome gutters removed) and the square disc rect
   * centered inside it. Squaring the *rect* rather than the geometry is what
   * keeps the disc circular without repacking grains on resize.
   */
  private recomputeRects(): void {
    const W = Math.max(1, this.canvas.width);
    const H = Math.max(1, this.canvas.height);
    this.plotRect = marginsToPlotRect(this.margins(), W, H, this.dpr);
    this.discRect = squareRect(this.plotRect, W, H);
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
      discRect: this.discRect,
      chrome: this.chrome,
      metas: this.metas,
      style: this.style,
      solid,
      hoverWeights: this.hoverWeights,
      highlightGain: this.cfg.hoverEffects.has('highlight') ? this.cfg.highlightGain : 1,
      dimWeights: this.dimWeights,
      dimOpacity: this.cfg.dimOpacity,
      hoveredSlice: this.hovered,
      pointer: this.pointerPx,
      slider: this.sliderCfg,
      sliderTicks: this.ticks,
      sliderPos: this.handlePos,
      sliderActive: this.seriesCount > 1,
      geomVersion: this.geomVersion,
    });
    this.overlayDirty = false;
  }

  /**
   * Whether the solid layer should keep redrawing for hover: the highlight
   * effect is on, slices are solid, and some slice's weight is still non-zero.
   */
  private solidHoverActive(): boolean {
    if (!this.style.enabled || !this.cfg.hoverEffects.has('highlight')) return false;
    if (this.hoveredSliceId !== -1) return true;
    for (let i = 0; i < this.hoverWeights.length; i++)
      if (this.hoverWeights[i]! > 0.001) return true;
    return false;
  }

  /** Whether the dim transition is still easing (needs the solid layer to keep repainting). */
  private solidDimActive(): boolean {
    if (!this.style.enabled) return false;
    if (this.focusedSlice !== null) return true;
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
      if (!this.morph || this.cfg.reflow === 'withSlice') {
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
   * Advance the active wedge tween: write the eased `from → to` geometry into
   * each `meta` (so overlay draw, hit-test and the readout all use the tweened
   * shape). Snaps to `to` and clears the tween once complete.
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
   * Build the grain buffer from `data` at the selected series. `'pour'` scatters
   * grains from above; `'morph'` flows them from the prior state by slice
   * identity and arms a wedge tween so the solid layer changes smoothly.
   */
  private buildGrains(data: DataSet, mode: BuildMode): void {
    const prevGrains = this.grains;
    const prevMetas = this.metas;

    const layout = layoutPie(data, this.cfg.palette, {
      ...this.cfg.geometry,
      seriesIndex: this.seriesIndex,
    });
    const { wedges, metas } = layout;
    this.layout = layout;
    this.metas = metas;
    this.data = data;
    // Caps may have clamped the request; keep the public value in step.
    this.seriesIndex = layout.seriesIndex;
    this.geomVersion++;

    // Clamp focus regardless of whether a legend is mounted — focusSeries()
    // works without one, and a stale out-of-range index would otherwise dim
    // every slice (none would match it).
    if (this.focusedSlice !== null && this.focusedSlice >= metas.length) {
      this.focusedSlice = null;
    }

    // Resize hover weights to slice count, preserving overlapping indices.
    const weights = new Float32Array(metas.length);
    weights.set(this.hoverWeights.subarray(0, Math.min(metas.length, this.hoverWeights.length)));
    this.hoverWeights = weights;

    const dimWeights = new Float32Array(metas.length);
    dimWeights.set(this.dimWeights.subarray(0, Math.min(metas.length, this.dimWeights.length)));
    this.dimWeights = dimWeights;

    const counts = wedgeGrainCounts(wedges, {
      density: this.cfg.grainDensity,
      maxGrains: this.cfg.maxGrains,
    });
    const total = counts.reduce((a, b) => a + b, 0);

    const canMorph = mode === 'morph' && prevGrains.count > 0 && prevMetas.length > 0;

    // Morph identity maps + removed-slice ghosts (grains that fall off on exit).
    let oldGrainsBySlice: Map<number, number[]> | null = null;
    let oldSliceByKey: Map<string, number> | null = null;
    const ghostSlices: number[] = [];
    let ghostTotal = 0;
    if (canMorph) {
      oldGrainsBySlice = groupGrainsBySlice(prevGrains);
      oldSliceByKey = new Map();
      for (const m of prevMetas) oldSliceByKey.set(sliceKey(m.xValue), m.sliceId);
      if (this.cfg.exit === 'fall') {
        const newKeys = new Set(metas.map((m) => sliceKey(m.xValue)));
        for (const m of prevMetas) {
          if (newKeys.has(sliceKey(m.xValue))) continue;
          const list = oldGrainsBySlice.get(m.sliceId);
          if (list && list.length > 0) {
            ghostSlices.push(m.sliceId);
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
      this.morphGrainStarts(g, metas, counts, prevGrains, oldGrainsBySlice!, oldSliceByKey!);
      if (ghostSlices.length > 0) {
        this.appendGhosts(g, total, ghostSlices, prevGrains, oldGrainsBySlice!);
      }
      this.armWedgeTween(metas, prevMetas);
    }
    this.revealMode = canMorph ? 'morph' : 'pour';

    this.grains = g;
    this.renderer?.upload(g);
    this.startTime = performance.now();
    this.lastSolid = -1; // re-arm reveal redraw for the new grains
    // Seat the tween at its start so the first overlay frame draws `from`.
    if (this.morph) this.applyMorph(0);

    this.refreshChrome();
  }

  /**
   * Assign morph starts per slice (grains are packed in slice order, so `counts`
   * gives each slice's contiguous grain range):
   *
   * - **existing slice** — map grain *k* to old grain *k* (`reflow: 'translate'`,
   *   a smooth sweep) or a random old grain (`'reshuffle'`);
   * - **added slice** — enter from above (`enter: 'pour'`) or out from the disc
   *   center (`'rise'`).
   */
  private morphGrainStarts(
    g: GrainBuffer,
    metas: SliceMeta[],
    counts: number[],
    prevGrains: GrainBuffer,
    oldGrainsBySlice: Map<number, number[]>,
    oldSliceByKey: Map<string, number>,
  ): void {
    const rng = mulberry32(9);
    let off = 0;
    for (let si = 0; si < metas.length; si++) {
      const cnt = counts[si]!;
      if (cnt <= 0) continue;
      const m = metas[si]!;
      const oldSlice = oldSliceByKey.get(sliceKey(m.xValue));
      const pool = oldSlice !== undefined ? oldGrainsBySlice.get(oldSlice) : undefined;
      const pourDelay = (gi: number): number =>
        this.cfg.stagger * (g.targetY[gi]! * 0.5 + rng() * 0.5);
      for (let k = 0; k < cnt; k++) {
        const i = off + k;
        if (pool && pool.length > 0) {
          const src =
            this.cfg.reflow === 'reshuffle'
              ? pool[(rng() * pool.length) | 0]!
              : pool[Math.min(pool.length - 1, ((k * pool.length) / cnt) | 0)]!;
          g.startX[i] = prevGrains.targetX[src]!;
          g.startY[i] = prevGrains.targetY[src]!;
          // 'withSlice' rides the wedge with no stagger; others settle in.
          g.delay[i] = this.cfg.reflow === 'withSlice' ? 0 : pourDelay(i);
        } else if (this.cfg.enter === 'rise') {
          // Grow out of the middle — the pie's analogue of rising from the base.
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
   * Append the removed slices' old grains as ghosts at `[offset, …)`: they start
   * where they were and fall off the bottom (`targetY < 0`), fading with the
   * global grain-fade. `barId = 0` is a safe hover index; ghosts have no meta so
   * they are never hit-tested, and are dropped on the next rebuild.
   */
  private appendGhosts(
    g: GrainBuffer,
    offset: number,
    ghostSlices: number[],
    prevGrains: GrainBuffer,
    oldGrainsBySlice: Map<number, number[]>,
  ): void {
    const rng = mulberry32(21);
    let gi = offset;
    for (const slice of ghostSlices) {
      for (const src of oldGrainsBySlice.get(slice)!) {
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
   * Arm a wedge tween from the old per-slice geometry (matched by category) to
   * the new one. Slices with no predecessor open from a zero-width sliver at
   * their final leading edge.
   */
  private armWedgeTween(metas: SliceMeta[], prevMetas: SliceMeta[]): void {
    if (!this.style.enabled) {
      this.morph = null;
      return;
    }
    const oldByKey = new Map<string, WedgeBox>();
    for (const m of prevMetas) {
      oldByKey.set(sliceKey(m.xValue), {
        a0: m.a0,
        a1: m.a1,
        rInner: m.rInner,
        rOuter: m.rOuter,
      });
    }
    const from: WedgeBox[] = [];
    const to: WedgeBox[] = [];
    for (const m of metas) {
      to.push({ a0: m.a0, a1: m.a1, rInner: m.rInner, rOuter: m.rOuter });
      const old = oldByKey.get(sliceKey(m.xValue));
      from.push(old ?? { a0: m.a0, a1: m.a0, rInner: m.rInner, rOuter: m.rOuter });
    }
    this.morph = { start: 0, dur: this.cfg.morphDuration, from, to };
  }

  // --- Series selection (programmatic twin of the slider) -------------------

  /** Number of series the slider can address (after the `maxSeries` cap). */
  get seriesCount(): number {
    return this.layout?.series.length ?? 0;
  }

  /** Series keys in slider order (after the `maxSeries` cap). */
  getSeriesKeys(): (Scalar | undefined)[] {
    return [...(this.layout?.series ?? [])];
  }

  /** Index of the series currently drawn. */
  getSeriesIndex(): number {
    return this.seriesIndex;
  }

  /**
   * Show another series. The slices morph to the new values (and the handle
   * eases across) exactly as when the user drags the slider — this is the same
   * code path, so a programmatic move and a dragged one are indistinguishable.
   */
  setSeriesIndex(index: number): void {
    if (this.disposed) return;
    const count = this.seriesCount;
    const next = count === 0 ? 0 : Math.max(0, Math.min(count - 1, Math.round(index)));
    if (next === this.seriesIndex) return;
    this.seriesIndex = next;
    this.buildGrains(this.data, 'morph');
    this.emitter.emit('seriesChange', {
      index: this.seriesIndex,
      key: this.layout?.series[this.seriesIndex],
    });
  }

  /** Replace the title text (empty hides it); the plot re-insets around it. */
  setTitle(text: string): void {
    if (!this.title) {
      if (!text) return;
      this.ensureRelative();
      this.title = new Title(this.el, { ...this.chrome.title, show: true, text });
    }
    this.chrome.title = { ...this.chrome.title, text, show: text.length > 0 };
    this.title.setText(text);
    this.recomputeRects();
    this.drawOverlay();
  }

  // --- Data ----------------------------------------------------------------

  /**
   * Replace the whole dataset (grains morph to the new targets), or — given an
   * array of {@link PointPatch} — set `y` on existing points in place.
   */
  update(data: DataSet): void;
  update(patches: PointPatch[]): void;
  update(arg: DataSet | PointPatch[]): void {
    if (this.disposed) return;
    const next: DataSet = Array.isArray(arg)
      ? { ...this.data, points: patchPoints(this.data.points, arg) }
      : arg;
    this.buildGrains(next, 'morph');
  }

  /** Append one or more points; new slices open and their grains pour in. */
  add(points: Point | Point[]): void {
    if (this.disposed) return;
    const add = Array.isArray(points) ? points : [points];
    this.buildGrains({ ...this.data, points: appendPoints(this.data.points, add) }, 'morph');
  }

  /** Remove points by index (negative = from end) or `{x, z?}` match. */
  remove(refs: PointRef | PointRef[]): void {
    if (this.disposed) return;
    const list = Array.isArray(refs) ? refs : [refs];
    this.buildGrains({ ...this.data, points: removePoints(this.data.points, list) }, 'morph');
  }

  /** Re-run the pour-in animation with the current data (no morph). */
  repour(): void {
    if (this.disposed) return;
    this.buildGrains(this.data, 'pour');
  }

  /** Snapshot of the current dataset (points deep-cloned). */
  getData(): DataSet {
    return { ...this.data, points: this.data.points.map((p) => ({ ...p })) };
  }

  // --- Frame loop ----------------------------------------------------------

  private loop = (): void => {
    if (this.disposed || !this.renderer) return;
    const nowMs = performance.now();
    const dt = this.lastFrameMs ? (nowMs - this.lastFrameMs) / 1000 : 0;
    this.lastFrameMs = nowMs;
    this.fps?.sample(dt, nowMs);
    this.easeHoverWeights(dt);
    this.easeDimWeights(dt);
    const handleMoved = this.easeHandle(dt);
    const now = (nowMs - this.startTime) / 1000;
    this.renderer.frame(this.uniforms(now));
    if (handleMoved) this.overlayDirty = true;
    if (this.style.enabled) {
      if (this.morph) {
        this.applyMorph(now);
        this.drawOverlay(now);
      } else {
        const solid = this.revealState(now).solid;
        if (
          solid !== this.lastSolid ||
          this.solidHoverActive() ||
          this.solidDimActive() ||
          this.overlayDirty
        ) {
          this.drawOverlay(now);
        }
      }
    } else if (this.overlayDirty) {
      this.drawOverlay(now);
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  /**
   * Ease each slice's hover weight toward its target (1 for the hovered slice, 0
   * otherwise). Frame-rate independent exponential smoothing.
   */
  private easeHoverWeights(dt: number): void {
    const w = this.hoverWeights;
    const k = this.cfg.hoverFade > 0 && dt > 0 ? 1 - Math.exp(-dt / this.cfg.hoverFade) : 1;
    for (let i = 0; i < w.length; i++) {
      const target = i === this.hoveredSliceId ? 1 : 0;
      const next = w[i]! + (target - w[i]!) * k;
      w[i] = Math.abs(next - target) < 0.001 ? target : next;
    }
  }

  // Ease each slice's dim weight toward its target: 1 for every slice other
  // than the focused one, 0 when nothing is focused.
  private easeDimWeights(dt: number): void {
    const w = this.dimWeights;
    const k = this.cfg.dimFade > 0 && dt > 0 ? 1 - Math.exp(-dt / this.cfg.dimFade) : 1;
    for (let i = 0; i < w.length; i++) {
      const target = this.focusedSlice !== null && i !== this.focusedSlice ? 1 : 0;
      const next = w[i]! + (target - w[i]!) * k;
      w[i] = Math.abs(next - target) < 0.001 ? target : next;
    }
  }

  /**
   * Glide the handle toward the selected series so a programmatic
   * {@link setSeriesIndex} animates like a drag. While dragging the handle is
   * pinned to the pointer, so this is a no-op. Returns true when it moved.
   */
  private easeHandle(dt: number): boolean {
    if (this.dragging) return false;
    const target = trackPos(this.seriesIndex, this.seriesCount);
    if (Math.abs(this.handlePos - target) < 0.0005) {
      if (this.handlePos === target) return false;
      this.handlePos = target;
      return true;
    }
    // Time constant follows the slice morph, so handle and pie settle together.
    const tau = Math.max(0.05, this.cfg.morphDuration * 0.35);
    const k = dt > 0 ? 1 - Math.exp(-dt / tau) : 1;
    this.handlePos += (target - this.handlePos) * k;
    return true;
  }

  private uniforms(now: number): FrameUniforms {
    const useHighlight = this.cfg.hoverEffects.has('highlight');
    const useJitter = this.cfg.hoverEffects.has('jitter');
    const useOpacity = this.cfg.hoverEffects.has('opacity');
    return {
      now,
      duration: this.cfg.duration,
      easing: this.cfg.ease,
      grainSizePx: this.cfg.grainSizePx * this.dpr,
      grainShape: this.cfg.grainShape,
      palette: this.cfg.palette,
      viewport: [this.canvas.width, this.canvas.height],
      hoverWeights: this.hoverWeights,
      highlightGain: useHighlight ? this.cfg.highlightGain : 1,
      hoverJitterAmp: useJitter ? this.cfg.hoverJitterAmp : 0,
      hoverOpacity: useOpacity ? this.cfg.hoverOpacity : -1,
      dimWeights: this.dimWeights,
      dimOpacity: this.cfg.dimOpacity,
      settleJitterAmp: this.cfg.settleJitter,
      background: this.cfg.background,
      // Grains live in the square disc box, which is what makes the pie round.
      plotRect: this.discRect,
      grainFade: this.revealState(now).grainFade,
    };
  }

  // --- Pointer -------------------------------------------------------------

  /** Pointer position in device px (y-down), relative to the canvas. */
  private devicePoint(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * this.dpr,
      y: (e.clientY - rect.top) * this.dpr,
    };
  }

  /** True when `p` (device px) is close enough to the track to grab it. */
  private overSlider(p: { x: number; y: number }): boolean {
    if (!this.sliderCfg.show || !this.sliderCfg.interactive || this.seriesCount < 2) return false;
    const t = sliderTrack(
      this.sliderCfg,
      this.plotRect,
      this.canvas.width,
      this.canvas.height,
      this.dpr,
    );
    const slack = t.handle * 2;
    return p.x >= t.x0 - slack && p.x <= t.x1 + slack && Math.abs(p.y - t.y) <= slack;
  }

  /** Move the selection to wherever `p` (device px) points along the track. */
  private seekTo(p: { x: number; y: number }): void {
    const t = sliderTrack(
      this.sliderCfg,
      this.plotRect,
      this.canvas.width,
      this.canvas.height,
      this.dpr,
    );
    const f = fractionAtPx(t, p.x);
    this.handlePos = f;
    this.overlayDirty = true;
    this.setSeriesIndex(indexAt(f, this.seriesCount));
  }

  private onPointerDown = (e: PointerEvent): void => {
    const p = this.devicePoint(e);
    if (!this.overSlider(p)) return;
    this.dragging = true;
    this.dragPointerId = e.pointerId;
    this.canvas.setPointerCapture?.(e.pointerId);
    e.preventDefault();
    this.seekTo(p);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (!this.dragging || e.pointerId !== this.dragPointerId) return;
    this.dragging = false;
    this.dragPointerId = -1;
    this.canvas.releasePointerCapture?.(e.pointerId);
    // Snap the handle onto the selected tick.
    this.handlePos = trackPos(this.seriesIndex, this.seriesCount);
    this.overlayDirty = true;
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.devicePoint(e);
    this.pointerPx = p;

    if (this.dragging) {
      this.seekTo(p);
      return;
    }
    // Show a grab cursor over the track so the control announces itself.
    this.canvas.style.cursor = this.overSlider(p) ? 'ew-resize' : '';

    const hit = this.hitTest(p);
    const id = hit?.sliceId ?? -1;
    if (id !== this.hoveredSliceId) {
      this.hoveredSliceId = id;
      this.hovered = hit;
      this.emitter.emit('hover', { slice: hit });
    }
    // Mark dirty rather than drawing here: pointer events fire faster than the
    // display refreshes, and each redraw repaints the whole overlay.
    if (this.overlay && this.chrome.currentValue.show) this.overlayDirty = true;
  };

  private onPointerLeave = (): void => {
    this.pointerPx = null;
    this.canvas.style.cursor = '';
    if (this.hoveredSliceId !== -1) {
      this.hoveredSliceId = -1;
      this.hovered = null;
      this.emitter.emit('hover', { slice: null });
    }
    if (this.overlay && this.chrome.currentValue.show) this.overlayDirty = true;
  };

  /** Slice under a device-px point, or null. */
  private hitTest(p: { x: number; y: number }): SliceMeta | null {
    const [x0, y0, x1, y1] = this.discRect;
    const W = this.canvas.width;
    const H = this.canvas.height;
    // Canvas fraction (y-up), then into disc-local layout space.
    const cx = p.x / Math.max(1, W);
    const cy = 1 - p.y / Math.max(1, H);
    const lx = (cx - x0) / Math.max(1e-6, x1 - x0);
    const ly = (cy - y0) / Math.max(1e-6, y1 - y0);
    return hitSlice(this.metas, lx, ly);
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.ro?.disconnect();
    this.renderer?.dispose();
    this.emitter.clear();
    this.legend?.dispose();
    this.title?.dispose();
    this.fps?.dispose();
    this.overlay?.dispose();
    this.overlayCanvas?.remove();
    this.canvas.remove();
  }
}
