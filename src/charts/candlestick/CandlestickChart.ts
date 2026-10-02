import type { ChartEvents, ChartFrameInfo } from '../../core/chart/kernel.js';
import { ChartKernel } from '../../core/chart/kernel.js';
// Chrome infrastructure (axes/legend/title/margins/fps/slider) is shared by
// every visual and comes from `core` — never from a sibling chart.
import { axisMargins, marginsToPlotRect, resolveChrome } from '../../core/chrome/chrome.js';
import type { ResolvedChrome } from '../../core/chrome/chrome.js';
import type { AxisTick } from '../../core/chrome/format.js';
import { FpsMeter, type ResolvedFps, resolveFps } from '../../core/chrome/fps.js';
import { Legend, type LegendEntry } from '../../core/chrome/legend.js';
import {
  type ResolvedSlider,
  type SliderTrack,
  fractionAtPx,
  indexAt,
  resolveSlider,
  sliderBandPx,
  sliderTicks,
  sliderTrack,
  trackPos,
} from '../../core/chrome/slider.js';
import { Title } from '../../core/chrome/title.js';
import { appendCandles, patchCandles, removeCandles } from '../../core/data/dataset.js';
import type { Candle, CandlePatch, CandleRef, OhlcDataSet } from '../../core/data/ohlc.js';
import type { Scalar } from '../../core/data/types.js';
import { runMouseHook } from '../../core/interaction/mouse.js';
import { ease, scatterStarts } from '../../core/particles/anim.js';
import { type GrainBuffer, allocGrains } from '../../core/particles/grains.js';
import { boxGrainCounts, packBoxes } from '../../core/particles/pack.js';
import { mulberry32 } from '../../core/particles/rng.js';
import { pickRenderer } from '../../core/render/pick.js';
import type { FrameUniforms, RGBA, Renderer } from '../../core/render/types.js';
import { parseColor } from '../../core/util/color.js';
import { PanZoomController } from '../../core/view/controller.js';
import { ZoomControls } from '../../core/view/controls.js';
import {
  type PanZoomable,
  type ResolvedPanZoom,
  type ViewTransform,
  resolvePanZoom,
} from '../../core/view/types.js';
import { type AxisModel, buildAxes } from './axis.js';
import {
  type ResolvedActual,
  type ResolvedCandleStyle,
  resolveActual,
  resolveCandleStyle,
  revealFactor,
} from './candleStyle.js';
import { type CandleLayout, hitCandle, layoutCandles } from './layout.js';
import { Overlay } from './overlay.js';
import type {
  CandleMeta,
  CandleSpacing,
  CandlestickChartConfig,
  ClickPayload,
  HoverPayload,
  MouseConfig,
  SeriesChangePayload,
  SeriesFocusPayload,
  Side,
} from './types.js';

/** Legend entry labels: the legend describes the two color groups. */
const DIRECTION_LABELS = ['Rising', 'Falling'] as const;

interface Resolved {
  grainDensity: number;
  maxGrains: number;
  background: RGBA;
  grainSizePx: number;
  grainShape: 'quad' | 'disc';
  jitter: number;
  settleJitter: number;
  spacing: CandleSpacing;
  maxCandles: number;
  maxSeries: number;
  duration: number;
  ease: FrameUniforms['easing'];
  stagger: number;
  /** Transition window (body tween + grain fade) for a data/series change, seconds. */
  morphDuration: number;
  reflow: 'translate' | 'reshuffle' | 'withCandle';
  /** Animate grains on morph, or snap them to targets (body-only transition). */
  morphGrains: boolean;
  enter: 'pour' | 'rise' | 'continue';
  exit: 'fall' | 'vanish';
  hoverEffects: Set<'highlight' | 'jitter' | 'opacity'>;
  highlightGain: number;
  hoverJitterAmp: number;
  hoverOpacity: number;
  hoverFade: number;
  /** Alpha multiplier for a fully-dimmed (isolated-out) direction group. */
  dimOpacity: number;
  /** Dim ease in/out time, seconds. */
  dimFade: number;
  mouse: MouseConfig;
}

function resolve(cfg: CandlestickChartConfig): Resolved {
  const hover = cfg.interaction?.hover;
  const anim = cfg.animation;
  const duration = anim?.duration != null ? anim.duration / 1000 : 0.9;
  const stagger = anim?.stagger != null ? anim.stagger / 1000 : 0.5;
  return {
    grainDensity: cfg.grainDensity ?? 0.8,
    maxGrains: cfg.maxGrains ?? 100_000,
    background: parseBackground(cfg.background),
    grainSizePx: cfg.grain?.sizePx ?? 2.4,
    grainShape: cfg.grain?.shape ?? 'disc',
    jitter: cfg.grain?.jitter ?? 0.6,
    settleJitter: cfg.grain?.settleJitter ?? 0.004,
    spacing: cfg.spacing ?? 'band',
    maxCandles: cfg.maxCandles ?? 0,
    maxSeries: cfg.maxSeries ?? 0,
    duration,
    ease: anim?.ease ?? 'easeOutCubic',
    stagger,
    morphDuration: anim?.morphDuration != null ? anim.morphDuration / 1000 : duration + stagger,
    reflow: anim?.reflow ?? 'translate',
    morphGrains: anim?.morphGrains ?? true,
    enter: anim?.enter ?? 'pour',
    exit: anim?.exit ?? 'fall',
    hoverEffects: new Set(hover?.effects ?? ['highlight', 'jitter']),
    highlightGain: hover?.highlightGain ?? 1.6,
    hoverJitterAmp: hover?.jitterAmp ?? 0.008,
    hoverOpacity: hover?.opacity ?? 1,
    hoverFade: (hover?.fadeMs ?? 180) / 1000,
    dimOpacity: cfg.interaction?.dim?.opacity ?? 0.15,
    dimFade: (cfg.interaction?.dim?.fadeMs ?? 200) / 1000,
    mouse: cfg.interaction?.mouse ?? {},
  };
}

function parseBackground(css: string | undefined): RGBA {
  return parseColor(css ?? 'rgba(0,0,0,0)');
}

// A type alias, not an interface: only the former carries the implicit index
// signature that `ChartKernel`'s `Record<string, object>` constraint needs.
/**
 * Events this chart adds on top of the standard set every chart inherits.
 *
 * `click` narrows the standard one rather than replacing it: listeners get the
 * shared `meta`/`px`/`button` fields *and* this chart's original
 * `candle`/`event`, so code written before the standard events kept working.
 */
type CandleExtraEvents = {
  hover: HoverPayload;
  click: ClickPayload;
  seriesChange: SeriesChangePayload;
  seriesFocus: SeriesFocusPayload;
};

/** Items the candlestick chart's data methods accept, per the `data*` events. */
type CandleItem = Candle | CandlePatch | CandleRef;

/** Everything {@link CandlestickChart.on} accepts: the standard events plus the above. */
export type CandlestickChartEvents = ChartEvents<CandleMeta, CandleItem, CandleExtraEvents>;

/** How grains enter on a build: fresh pour vs. morph from the prior state. */
type BuildMode = 'pour' | 'morph';

/** A candle's animated geometry (layout space). */
interface CandleBox {
  x0: number;
  x1: number;
  cx: number;
  bodyLow: number;
  bodyHigh: number;
  wickLow: number;
  wickHigh: number;
}

/** An in-flight body tween: interpolate `from → to` per candle over `dur`. */
interface MorphTween {
  start: number;
  dur: number;
  from: CandleBox[];
  to: CandleBox[];
}

/**
 * Data identity of a candle: its period. Keying on `x` rather than array
 * position is what makes a streaming feed animate correctly — dropping the
 * oldest bar and appending a new one shifts every index, but leaves every
 * surviving period's identity intact, so unchanged candles slide rather than
 * being treated as removed-and-re-added.
 */
function candleKey(xValue: Scalar): string {
  return String(xValue);
}

/** Group grain indices by their `barId` (= candle id), preserving order. */
function groupGrainsByCandle(grains: GrainBuffer): Map<number, number[]> {
  const byCandle = new Map<number, number[]>();
  for (let i = 0; i < grains.count; i++) {
    const b = grains.barId[i]!;
    let arr = byCandle.get(b);
    if (!arr) {
      arr = [];
      byCandle.set(b, arr);
    }
    arr.push(i);
  }
  return byCandle;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function boxOf(m: CandleMeta): CandleBox {
  return {
    x0: m.x0,
    x1: m.x1,
    cx: m.cx,
    bodyLow: m.bodyLow,
    bodyHigh: m.bodyHigh,
    wickLow: m.wickLow,
    wickHigh: m.wickHigh,
  };
}

/**
 * Sand candlestick chart. Mounts into an element, packs each candle's body with
 * settling grains that resolve into a solid body, strokes the high-low wicks
 * solid throughout, and draws a live-price line at the latest `Candle.actual`.
 *
 * Two structural traits, both shared with charts already in the library:
 *
 * - **Color comes from a direction rule, not a series palette.** Every candle is
 *   rising or falling (`candles.direction`), so the grain palette is
 *   `[rising, falling]` and the legend describes those two groups — clicking
 *   one isolates it, exactly like isolating a series elsewhere.
 * - **Series are a selector.** Two instruments can't share an x-slot legibly,
 *   so — like the pie chart — one series is drawn at a time and the slider
 *   picks which, morphing the candles across.
 */
export class CandlestickChart
  extends ChartKernel<CandleMeta, CandleItem, CandleExtraEvents>
  implements PanZoomable
{
  private el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private cfg: Resolved;
  private renderer: Renderer | null = null;
  private grains: GrainBuffer = allocGrains(0);
  private metas: CandleMeta[] = [];
  /** Current dataset (source of truth for {@link update}/{@link add}/{@link remove}). */
  private data: OhlcDataSet = { series: [] };

  /** Reveal timing regime: fresh pour vs. in-place morph (body stays solid). */
  private revealMode: BuildMode = 'pour';
  /** Active body tween, or null when settled. */
  private morph: MorphTween | null = null;

  private chrome: ResolvedChrome;
  private style: ResolvedCandleStyle;
  private actualCfg: ResolvedActual;
  /** Last drawn reveal factor; -1 forces the next overlay redraw. */
  private lastSolid = -1;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlay: Overlay | null = null;
  private legend: Legend | null = null;
  private title: Title | null = null;
  private fpsCfg: ResolvedFps;
  private fps: FpsMeter | null = null;
  private pzCfg: ResolvedPanZoom;
  private pz: PanZoomController;
  private zoomControls: ZoomControls | null = null;
  private layout: CandleLayout | null = null;
  private axes: AxisModel = { x: [], y: [] };
  private plotRect: [number, number, number, number] = [0, 0, 1, 1];
  private hovered: CandleMeta | null = null;
  private pointerPx: { x: number; y: number } | null = null;
  /** Set by pointer events; the RAF loop coalesces them into one redraw. */
  private overlayDirty = false;
  private raf = 0;
  private startTime = 0;
  private lastFrameMs = 0;
  private hoveredCandleId = -1;
  /** Last candle id the `hover` event reported, so it fires once per change. */
  private lastEmittedHover = -1;
  /** Per-candle hover weight in [0,1], eased toward 1 for the hovered candle. */
  private hoverWeights = new Float32Array(0);
  /** Direction group isolated via the legend / `focusSeries()` (0 rising, 1 falling). */
  private focusedDirection: number | null = null;
  /** Per-candle dim weight in [0,1], eased toward 1 for non-focused candles. */
  private dimWeights = new Float32Array(0);

  // --- Series slider state ---------------------------------------------------
  /** Selected series index (the value the slider represents). */
  private seriesIndex = 0;
  private sliderCfg: ResolvedSlider;
  private ticks: AxisTick[] = [];
  /** Animated handle position, 0..1 — eases toward the selected series. */
  private handlePos = 0;
  /** True while the user drags the handle (it then tracks the pointer exactly). */
  private dragging = false;
  private dragPointerId = -1;
  /** Where the live drag last was, in CSS px, for the `drag` event's delta. */
  private lastDragPx = { x: 0, y: 0 };
  /**
   * Gutter the period axis already occupies on the slider's edge, CSS px — the
   * slider is pushed past it so the handle never lands on the axis labels.
   * Unlike the pie chart, this chart has an X axis competing for that band.
   */
  private sliderOffsetPx = 0;

  private dpr = 1;
  private ro: ResizeObserver | null = null;
  private disposed = false;
  private ready: Promise<void>;

  constructor(el: HTMLElement, config: CandlestickChartConfig) {
    super();
    this.el = el;
    this.data = config.data;
    this.cfg = resolve(config);
    this.chrome = resolveChrome(config);
    this.style = resolveCandleStyle(config);
    this.actualCfg = resolveActual(config.actual);
    this.sliderCfg = resolveSlider(config.slider);
    this.fpsCfg = resolveFps(config);
    this.pzCfg = resolvePanZoom(config.panZoom);
    this.seriesIndex = Math.max(0, Math.round(config.seriesIndex ?? 0));
    this.pz = new PanZoomController(
      this.pzCfg,
      () => this.plotRect,
      () => this.onViewChange(),
      this.panZoomHooks(),
    );
    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    el.appendChild(this.canvas);

    // The overlay is always mounted: the wicks, the live-price line and the
    // series slider all live on it, none of which are optional chrome.
    this.mountChrome();
    if (this.fpsCfg.show) {
      this.ensureRelative(this.el);
      this.fps = new FpsMeter(this.el, this.fpsCfg.position, this.fpsCfg.color);
    }
    // Chart pointer handlers are attached *before* pan/zoom's so a grab on the
    // slider handle can stop the drag-to-pan listener from also firing.
    this.attachPointer();
    if (this.pzCfg.enabled) {
      this.ensureRelative(this.el);
      this.pz.attach(this.canvas);
      if (this.pzCfg.controls.show) {
        this.zoomControls = new ZoomControls(this.el, this, this.pzCfg.controls);
      }
    }

    this.ready = this.boot(config.data, config.backend);
  }

  /** View moved (drag/wheel/programmatic): redraw chrome; grains follow via uniforms. */
  private onViewChange(): void {
    this.drawOverlay();
  }

  private mountChrome(): void {
    this.ensureRelative(this.el);

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
    this.overlay = new Overlay(oc);

    if (this.chrome.legend.show) {
      this.legend = new Legend(this.el, this.chrome.legend, (i, e) => this.handleLegendClick(i, e));
    }
    if (this.chrome.title.show) this.title = new Title(this.el, this.chrome.title);
  }

  private attachPointer(): void {
    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('pointerdown', this.onPointerDown);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
    this.canvas.addEventListener('dblclick', this.onDoubleClick);
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  get backend(): Renderer['kind'] | null {
    return this.renderer?.kind ?? null;
  }

  /** Geometry the shared drawing layers project through (see {@link ChartKernel}). */
  protected chartFrame(): ChartFrameInfo {
    return {
      host: this.el,
      canvas: this.canvas,
      rect: this.plotRect,
      dpr: this.dpr,
      view: this.view,
      now: this.nowSeconds(),
    };
  }

  private async boot(data: OhlcDataSet, backend: CandlestickChartConfig['backend']): Promise<void> {
    this.renderer = await pickRenderer(backend ?? 'auto');
    this.resizeCanvas();
    await this.renderer.init(this.canvas);
    this.buildGrains(data, 'pour');
    this.handlePos = trackPos(this.seriesIndex, this.seriesCount);

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
        this.recomputePlotRect();
        this.drawOverlay();
      }
    }
  }

  private refreshChrome(): void {
    if (!this.layout) return;
    this.axes = buildAxes(this.layout, this.chrome.x, this.chrome.y);
    this.ticks = this.sliderCfg.show ? sliderTicks(this.layout.series, this.chrome.x) : [];
    if (this.legend) {
      this.legend.setEntries(this.legendEntries());
      this.legend.setFocus(this.focusedDirection);
    }
    this.recomputePlotRect();
    this.drawOverlay();
  }

  /** Legend entry `i` was clicked: toggle isolation of that direction group. */
  private handleLegendClick(i: number, e: MouseEvent | KeyboardEvent): void {
    runMouseHook(this.cfg.mouse.onLegendClick, i, e, this.cssPointOf(e), () => {
      this.setFocus(this.focusedDirection === i ? null : i);
    });
  }

  private setFocus(index: number | null): void {
    if (index === this.focusedDirection) return;
    this.focusedDirection = index;
    this.legend?.setFocus(index);
    this.emit('seriesFocus', { index }, { cancelable: false });
  }

  /**
   * Isolate one **direction group** — `0` rising, `1` falling — at full
   * opacity while the other dims to `interaction.dim.opacity`; `null` clears
   * it. Those groups are what the legend describes, so this is exactly what
   * clicking a legend entry does (the pie chart's `focusSeries` targets its
   * slices the same way, not the slider's series). Fires `seriesFocus`.
   */
  focusSeries(index: number | null): void {
    this.setFocus(index);
  }

  /** Currently isolated direction group (0 rising, 1 falling), or `null`. */
  getFocusedSeries(): number | null {
    return this.focusedDirection;
  }

  private legendEntries(): LegendEntry[] {
    return [
      { label: DIRECTION_LABELS[0], color: this.style.rising },
      { label: DIRECTION_LABELS[1], color: this.style.falling },
    ];
  }

  /** X-axis room below the plot, mirroring {@link axisMargins}'s accounting. */
  private axisBandPx(): number {
    if (!this.chrome.x.show) return 0;
    const c = this.chrome.x;
    return c.fontPx + 12 + (c.label ? c.fontPx + 6 : 0);
  }

  private recomputePlotRect(): void {
    const m = axisMargins(this.chrome);
    // Layers on one edge must stack, not overlap: each DOM layer is told how
    // far in the previous one already pushed, and the plot is inset by the
    // total. The canvas-drawn slider gets the same treatment via `offsetPx`.
    const offsets: Record<Side, number> = { top: 0, right: 0, bottom: 0, left: 0 };
    // Only a bottom slider shares an edge with the period axis.
    this.sliderOffsetPx = this.sliderCfg.position === 'bottom' ? this.axisBandPx() : 0;
    if (this.sliderCfg.show && this.seriesCount > 1) {
      const side = this.sliderCfg.position;
      const ext = sliderBandPx(this.sliderCfg, this.chrome.x);
      offsets[side] += ext;
      m[side] += ext;
    }
    if (this.title && this.chrome.title.show) {
      const side = this.chrome.title.position;
      this.title.setEdgeOffset(offsets[side]);
      const ext = this.title.measure() + 4;
      offsets[side] += ext;
      m[side] += ext;
    }
    if (this.legend && this.chrome.legend.show) {
      const side = this.chrome.legend.position;
      this.legend.setEdgeOffset(offsets[side]);
      const ext = this.legend.measure() + 6;
      offsets[side] += ext;
      m[side] += ext;
    }
    this.plotRect = marginsToPlotRect(m, this.canvas.width, this.canvas.height, this.dpr);
    this.positionZoomControls();
  }

  /**
   * Anchor the zoom controls to their plot corner (inside axes/legend), nudged
   * clear of the FPS meter, so legend / FPS / zoom controls never overlap.
   */
  private positionZoomControls(): void {
    if (!this.zoomControls) return;
    const rect = this.el.getBoundingClientRect();
    const cssW = rect.width || 1;
    const cssH = rect.height || 1;
    const [x0, y0, x1, y1] = this.plotRect;
    const pad = 6;
    const pos = this.pzCfg.controls.position;
    let vInset = (pos.startsWith('top') ? (1 - y1) * cssH : y0 * cssH) + pad;
    const hInset = (pos.endsWith('left') ? x0 * cssW : (1 - x1) * cssW) + pad;
    if (this.fpsCfg.show && pos.startsWith('top')) {
      const fpsCorner =
        this.fpsCfg.position === 'left'
          ? 'top-left'
          : this.fpsCfg.position === 'right'
            ? 'top-right'
            : null;
      if (fpsCorner === pos) vInset += 30;
    }
    this.zoomControls.setInset(vInset, hInset);
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
      axes: this.axes,
      chrome: this.chrome,
      metas: this.metas,
      style: this.style,
      actual: this.actualCfg,
      actualValue: this.layout?.actual,
      actualPos:
        this.layout && this.layout.actual !== undefined
          ? clamp01(this.layout.yScale.scale(this.layout.actual))
          : undefined,
      solid,
      hoverWeights: this.hoverWeights,
      highlightGain: this.cfg.hoverEffects.has('highlight') ? this.cfg.highlightGain : 1,
      dimWeights: this.dimWeights,
      dimOpacity: this.cfg.dimOpacity,
      hoveredCandle: this.hovered,
      pointer: this.pointerPx,
      slider: this.sliderCfg,
      sliderTicks: this.ticks,
      sliderPos: this.handlePos,
      sliderActive: this.seriesCount > 1,
      sliderOffsetPx: this.sliderOffsetPx * this.dpr,
      viewScale: this.view.scale,
      viewOffset: this.view.offset,
      clipToPlot: this.pzCfg.enabled,
    });
    this.overlayDirty = false;
  }

  /** Current pan/zoom transform. */
  private get view(): ViewTransform {
    return this.pz.getView();
  }

  /** Whether anything is drawn on the overlay per candle (bodies and/or wicks). */
  private visualsEnabled(): boolean {
    return this.style.enabled || this.style.wick.show;
  }

  /**
   * Whether the candle layer should keep redrawing for hover: the highlight
   * effect is on and some candle's weight is still non-zero (hovered or
   * easing out).
   */
  private solidHoverActive(): boolean {
    if (!this.visualsEnabled() || !this.cfg.hoverEffects.has('highlight')) return false;
    if (this.hoveredCandleId !== -1) return true;
    for (let i = 0; i < this.hoverWeights.length; i++)
      if (this.hoverWeights[i]! > 0.001) return true;
    return false;
  }

  /** Whether the dim transition is still easing (needs the overlay to repaint). */
  private solidDimActive(): boolean {
    if (!this.visualsEnabled()) return false;
    if (this.focusedDirection !== null) return true;
    for (let i = 0; i < this.dimWeights.length; i++) if (this.dimWeights[i]! > 0.001) return true;
    return false;
  }

  private nowSeconds(): number {
    return (performance.now() - this.startTime) / 1000;
  }

  /** Reveal state at `now` (seconds): grain fade-out + solid body fade-in. */
  private revealState(now: number): { grainFade: number; solid: number } {
    if (!this.style.enabled) return { grainFade: 1, solid: 0 };
    const r = this.style;
    if (this.revealMode === 'morph') {
      if (!this.morph || this.cfg.reflow === 'withCandle') {
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
   * Advance the active body tween: write the eased `from → to` geometry into
   * each `meta` so overlay draw, hit-test and the readout all use the tweened
   * shape. Snaps to `to` and clears the tween once complete.
   */
  private applyMorph(now: number): boolean {
    const mo = this.morph;
    if (!mo) return false;
    const p = mo.dur > 0 ? (now - mo.start) / mo.dur : 1;
    const done = p >= 1;
    const e = done ? 1 : ease(clamp01(p), this.style.reveal.ease);
    const n = Math.min(this.metas.length, mo.from.length, mo.to.length);
    const lerp = (a: number, b: number): number => a + (b - a) * e;
    for (let i = 0; i < n; i++) {
      const f = mo.from[i]!;
      const t = mo.to[i]!;
      const m = this.metas[i]!;
      m.x0 = lerp(f.x0, t.x0);
      m.x1 = lerp(f.x1, t.x1);
      m.cx = lerp(f.cx, t.cx);
      m.bodyLow = lerp(f.bodyLow, t.bodyLow);
      m.bodyHigh = lerp(f.bodyHigh, t.bodyHigh);
      m.wickLow = lerp(f.wickLow, t.wickLow);
      m.wickHigh = lerp(f.wickHigh, t.wickHigh);
    }
    if (done) this.morph = null;
    return !done;
  }

  /**
   * Build the grain buffer from `data`. `'pour'` scatters grains from above
   * (fresh pour-in + reveal ramp); `'morph'` flows grains from the prior state
   * by period identity and arms a body tween so the solid layer changes smoothly.
   */
  private buildGrains(data: OhlcDataSet, mode: BuildMode): void {
    const prevGrains = this.grains;
    const prevMetas = this.metas;

    const layout = layoutCandles(data, {
      seriesIndex: this.seriesIndex,
      maxCandles: this.cfg.maxCandles,
      maxSeries: this.cfg.maxSeries,
      spacing: this.cfg.spacing,
      width: this.style.width,
      body: this.style.body,
      direction: this.style.direction,
      rising: this.style.rising,
      falling: this.style.falling,
    });
    const { boxes, metas } = layout;
    this.layout = layout;
    this.metas = metas;
    this.data = data;
    this.seriesIndex = layout.seriesIndex;

    const weights = new Float32Array(metas.length);
    weights.set(this.hoverWeights.subarray(0, Math.min(metas.length, this.hoverWeights.length)));
    this.hoverWeights = weights;

    const dimWeights = new Float32Array(metas.length);
    dimWeights.set(this.dimWeights.subarray(0, Math.min(metas.length, this.dimWeights.length)));
    this.dimWeights = dimWeights;

    const counts = boxGrainCounts(boxes, {
      density: this.cfg.grainDensity,
      maxGrains: this.cfg.maxGrains,
    });
    const total = counts.reduce((a, b) => a + b, 0);

    const canMorph = mode === 'morph' && prevGrains.count > 0 && prevMetas.length > 0;
    const animateGrains = canMorph && this.cfg.morphGrains;

    let oldGrainsByCandle: Map<number, number[]> | null = null;
    let oldPoolByKey: Map<string, number[]> | null = null;
    const ghostCandles: number[] = [];
    let ghostTotal = 0;
    if (animateGrains) {
      oldGrainsByCandle = groupGrainsByCandle(prevGrains);
      oldPoolByKey = new Map();
      for (const m of prevMetas) {
        const list = oldGrainsByCandle.get(m.candleId);
        if (list) oldPoolByKey.set(candleKey(m.xValue), list);
      }
      if (this.cfg.exit === 'fall') {
        const newKeys = new Set(metas.map((m) => candleKey(m.xValue)));
        for (const m of prevMetas) {
          if (newKeys.has(candleKey(m.xValue))) continue;
          const list = oldGrainsByCandle.get(m.candleId);
          if (list && list.length > 0) {
            ghostCandles.push(m.candleId);
            ghostTotal += list.length;
          }
        }
      }
    }

    const g = allocGrains(total + ghostTotal);
    packBoxes(boxes, counts, g, {
      density: this.cfg.grainDensity,
      jitter: this.cfg.jitter,
      seed: 1,
    });

    if (!canMorph) {
      scatterStarts(g, { duration: this.cfg.duration, stagger: this.cfg.stagger, seed: 7 });
      this.morph = null;
    } else if (animateGrains) {
      this.morphGrainStarts(g, metas, counts, prevGrains, oldPoolByKey!);
      if (ghostCandles.length > 0) {
        this.appendGhosts(g, total, ghostCandles, prevGrains, oldGrainsByCandle!);
      }
      this.armBodyTween(metas, prevMetas);
    } else {
      // Snap every grain to its target, settled (negative delay => te>=1 at
      // now=0): no motion, only the body tween below animates the change.
      for (let i = 0; i < total; i++) {
        g.startX[i] = g.targetX[i]!;
        g.startY[i] = g.targetY[i]!;
        g.delay[i] = -this.cfg.duration;
      }
      this.armBodyTween(metas, prevMetas);
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
   * Assign morph starts per candle (grains are packed in box order, so `counts`
   * gives each candle a contiguous grain range):
   *
   * - **existing period** — map grain *k* to old grain *k* (`translate`, a
   *   smooth slide) or a random old grain (`reshuffle`);
   * - **new period** — enter from above (`pour`), up from the base (`rise`), or
   *   already settled in place (`continue`).
   */
  private morphGrainStarts(
    g: GrainBuffer,
    metas: CandleMeta[],
    counts: number[],
    prevGrains: GrainBuffer,
    oldPoolByKey: Map<string, number[]>,
  ): void {
    const rng = mulberry32(9);
    let off = 0;
    for (let bi = 0; bi < metas.length; bi++) {
      const cnt = counts[bi]!;
      if (cnt <= 0) continue;
      const m = metas[bi]!;
      const pool = oldPoolByKey.get(candleKey(m.xValue));
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
          g.delay[i] = this.cfg.reflow === 'withCandle' ? 0 : pourDelay(i);
        } else if (this.cfg.enter === 'continue') {
          g.startX[i] = g.targetX[i]!;
          g.startY[i] = g.targetY[i]!;
          g.delay[i] = -this.cfg.duration;
        } else if (this.cfg.enter === 'rise') {
          g.startX[i] = g.targetX[i]!;
          g.startY[i] = 0;
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
   * Append the removed candles' old grains as ghosts at `[offset, …)`: they
   * start where they were and fall off the bottom (`targetY < 0`), fading with
   * the global grain-fade. `barId = 0` is a safe hover index; ghosts have no
   * meta so they are never hit-tested, and are dropped on the next rebuild.
   */
  private appendGhosts(
    g: GrainBuffer,
    offset: number,
    ghostCandles: number[],
    prevGrains: GrainBuffer,
    oldGrainsByCandle: Map<number, number[]>,
  ): void {
    const rng = mulberry32(21);
    let gi = offset;
    for (const id of ghostCandles) {
      for (const src of oldGrainsByCandle.get(id)!) {
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
   * Arm a body tween from the old per-period geometry (matched by identity) to
   * the new one. A period with no predecessor opens from a flat line at its own
   * close, so a new candle grows out of its level rather than popping in.
   */
  private armBodyTween(metas: CandleMeta[], prevMetas: CandleMeta[]): void {
    const oldByKey = new Map<string, CandleBox>();
    for (const m of prevMetas) oldByKey.set(candleKey(m.xValue), boxOf(m));
    const from: CandleBox[] = [];
    const to: CandleBox[] = [];
    for (const m of metas) {
      const target = boxOf(m);
      to.push(target);
      const old = oldByKey.get(candleKey(m.xValue));
      const mid = (target.bodyLow + target.bodyHigh) / 2;
      from.push(
        old ?? {
          ...target,
          bodyLow: mid,
          bodyHigh: mid,
          wickLow: mid,
          wickHigh: mid,
        },
      );
    }
    this.morph = { start: 0, dur: this.cfg.morphDuration, from, to };
  }

  // --- Series selection (programmatic twin of the slider) -------------------

  /** Number of series (instruments) the slider can address. */
  get seriesCount(): number {
    return this.layout?.series.length ?? 0;
  }

  /** Series keys in slider order (after the `maxSeries` cap). */
  getSeriesKeys(): (Scalar | undefined)[] {
    return [...(this.layout?.series ?? [])];
  }

  /** Index of the series (instrument) currently drawn. */
  getSeriesIndex(): number {
    return this.seriesIndex;
  }

  /**
   * Show another instrument. The candles morph to the new prices (and the
   * handle eases across) exactly as when the user drags the slider — the same
   * code path, so a programmatic move and a dragged one are indistinguishable.
   */
  setSeriesIndex(index: number): void {
    if (this.disposed) return;
    const count = this.seriesCount;
    const next = count === 0 ? 0 : Math.max(0, Math.min(count - 1, Math.round(index)));
    if (next === this.seriesIndex) return;
    this.seriesIndex = next;
    this.buildGrains(this.data, 'morph');
    this.emit('seriesChange', {
      index: this.seriesIndex,
      key: this.layout?.series[this.seriesIndex],
    });
  }

  // --- Data ----------------------------------------------------------------

  /**
   * Replace the whole dataset (candles morph to the new prices), or — given an
   * array of {@link CandlePatch} — set prices on existing candles of one series
   * in place (default the series on screen). Patching just `close`/`actual` is
   * the streaming-feed path.
   */
  update(data: OhlcDataSet): void;
  update(patches: CandlePatch[], seriesIndex?: number): void;
  update(arg: OhlcDataSet | CandlePatch[], seriesIndex = this.seriesIndex): void {
    if (this.disposed) return;
    if (!Array.isArray(arg)) {
      if (!this.allowsData('dataUpdate', 'replace', [])) return;
      this.buildGrains(arg, 'morph');
      return;
    }
    if (!this.allowsData('dataUpdate', 'update', arg)) return;
    this.buildGrains(
      this.withSeries(seriesIndex, (c) => patchCandles(c, arg)),
      'morph',
    );
  }

  /**
   * Append candles to a series (default the one on screen; a series index past
   * the end creates one). New candles grow in and their grains pour from above.
   */
  add(candles: Candle | Candle[], seriesIndex = this.seriesIndex): void {
    if (this.disposed) return;
    const list = Array.isArray(candles) ? candles : [candles];
    if (!this.allowsData('dataAdd', 'add', list)) return;
    if (seriesIndex >= this.data.series.length) {
      const next = [...this.data.series, { candles: list.map((c) => ({ ...c })) }];
      this.buildGrains({ ...this.data, series: next }, 'morph');
      return;
    }
    this.buildGrains(
      this.withSeries(seriesIndex, (c) => appendCandles(c, list)),
      'morph',
    );
  }

  /**
   * Remove candles from a series (default the one on screen) by index
   * (negative = from the end) or `{ x }` match; the remaining candles reflow.
   */
  remove(refs: CandleRef | CandleRef[], seriesIndex = this.seriesIndex): void {
    if (this.disposed) return;
    const list = Array.isArray(refs) ? refs : [refs];
    if (!this.allowsData('dataRemove', 'remove', list)) return;
    this.buildGrains(
      this.withSeries(seriesIndex, (c) => removeCandles(c, list)),
      'morph',
    );
  }

  /** A copy of the dataset with `fn` applied to one series' candles. */
  private withSeries(index: number, fn: (candles: Candle[]) => Candle[]): OhlcDataSet {
    const series = this.data.series.map((s, i) =>
      i === index ? { ...s, candles: fn(s.candles) } : s,
    );
    return { ...this.data, series };
  }

  /** Re-run the pour-in animation with the current data (no morph). */
  repour(): void {
    if (this.disposed) return;
    this.buildGrains(this.data, 'pour');
  }

  /** Snapshot of the current dataset (series/candles deep-cloned). */
  getData(): OhlcDataSet {
    return {
      ...this.data,
      series: this.data.series.map((s) => ({ ...s, candles: s.candles.map((c) => ({ ...c })) })),
    };
  }

  // --- PanZoomable: programmatic pan & zoom (see {@link PanZoomable}) --------
  getView(): ViewTransform {
    return this.pz.getView();
  }
  setView(view: Partial<ViewTransform>): void {
    this.pz.setView(view);
  }
  panBy(dx: number, dy: number): void {
    this.pz.panBy(dx, dy);
  }
  panTo(x: number, y: number): void {
    this.pz.panTo(x, y);
  }
  zoomBy(factor: number, cx?: number, cy?: number): void {
    this.pz.zoomBy(factor, cx, cy);
  }
  zoomTo(scale: number, cx?: number, cy?: number): void {
    this.pz.zoomTo(scale, cx, cy);
  }
  resetView(): void {
    this.pz.resetView();
  }
  isPanZoomEnabled(): boolean {
    return this.pzCfg.enabled;
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
    // The wicks move with the candles, so a morph always repaints the overlay —
    // not only when the solid body layer is on.
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
    // Caller-owned layers repaint last, on top of the finished frame.
    this.afterDraw();
    this.raf = requestAnimationFrame(this.loop);
  };

  private easeHoverWeights(dt: number): void {
    const w = this.hoverWeights;
    const k = this.cfg.hoverFade > 0 && dt > 0 ? 1 - Math.exp(-dt / this.cfg.hoverFade) : 1;
    for (let i = 0; i < w.length; i++) {
      const target = i === this.hoveredCandleId ? 1 : 0;
      const next = w[i]! + (target - w[i]!) * k;
      w[i] = Math.abs(next - target) < 0.001 ? target : next;
    }
  }

  // Ease each candle's dim weight toward its target: 1 for every candle whose
  // direction group isn't the focused one, 0 when nothing is focused —
  // independent of hover, so isolating composes with (rather than fights)
  // pointer hover.
  private easeDimWeights(dt: number): void {
    const w = this.dimWeights;
    const k = this.cfg.dimFade > 0 && dt > 0 ? 1 - Math.exp(-dt / this.cfg.dimFade) : 1;
    for (let i = 0; i < w.length; i++) {
      const group = this.metas[i]?.rising ? 0 : 1;
      const target = this.focusedDirection !== null && group !== this.focusedDirection ? 1 : 0;
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
    // Time constant follows the candle morph, so handle and candles settle together.
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
      // Grains index a two-entry palette: 0 = rising, 1 = falling.
      palette: this.style.palette,
      viewport: [this.canvas.width, this.canvas.height],
      hoverWeights: this.hoverWeights,
      highlightGain: useHighlight ? this.cfg.highlightGain : 1,
      hoverJitterAmp: useJitter ? this.cfg.hoverJitterAmp : 0,
      hoverOpacity: useOpacity ? this.cfg.hoverOpacity : -1,
      dimWeights: this.dimWeights,
      dimOpacity: this.cfg.dimOpacity,
      settleJitterAmp: this.morph ? 0 : this.cfg.settleJitter,
      background: this.cfg.background,
      plotRect: this.plotRect,
      grainFade: this.revealState(now).grainFade,
      viewScale: this.view.scale,
      viewOffset: this.view.offset,
      clipToPlot: this.pzCfg.enabled,
    };
  }

  // --- Pointer -------------------------------------------------------------

  /** Pointer position in CSS px, relative to the chart element (hook context). */
  private cssPoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.el.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /** CSS-px position of any DOM event with client coords; `{0,0}` for the rest. */
  private cssPointOf(e: Event): { x: number; y: number } {
    const rect = this.el.getBoundingClientRect();
    const p = e as Partial<MouseEvent>;
    if (typeof p.clientX !== 'number' || typeof p.clientY !== 'number') return { x: 0, y: 0 };
    return { x: p.clientX - rect.left, y: p.clientY - rect.top };
  }

  /** Pointer position in device px (y-down), relative to the canvas. */
  private devicePoint(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - rect.left) * this.dpr, y: (e.clientY - rect.top) * this.dpr };
  }

  /** Pointer position in layout space (y-up), through the pan/zoom transform. */
  private layoutPoint(e: { clientX: number; clientY: number }): { lx: number; ly: number } {
    const rect = this.canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / Math.max(1, rect.width);
    const cy = 1 - (e.clientY - rect.top) / Math.max(1, rect.height);
    const [x0, y0, x1, y1] = this.plotRect;
    const plx = (cx - x0) / (x1 - x0 || 1);
    const ply = (cy - y0) / (y1 - y0 || 1);
    const v = this.view;
    return { lx: (plx - v.offset[0]) / v.scale[0], ly: (ply - v.offset[1]) / v.scale[1] };
  }

  /** The slider track in device px — one definition for hit-test and seek. */
  private track(): SliderTrack {
    return sliderTrack(
      this.sliderCfg,
      this.plotRect,
      this.canvas.width,
      this.canvas.height,
      this.dpr,
      this.sliderOffsetPx * this.dpr,
    );
  }

  /** True when `p` (device px) is close enough to the track to grab it. */
  private overSlider(p: { x: number; y: number }): boolean {
    if (!this.sliderCfg.show || !this.sliderCfg.interactive || this.seriesCount < 2) return false;
    const t = this.track();
    const slack = t.handle * 2;
    return p.x >= t.x0 - slack && p.x <= t.x1 + slack && Math.abs(p.y - t.y) <= slack;
  }

  /** Move the selection to wherever `p` (device px) points along the track. */
  private seekTo(p: { x: number; y: number }, e: PointerEvent): void {
    const f = fractionAtPx(this.track(), p.x);
    const index = indexAt(f, this.seriesCount);
    runMouseHook(this.cfg.mouse.onSliderSeek, index, e, this.cssPoint(e), () => {
      this.handlePos = f;
      this.overlayDirty = true;
      this.setSeriesIndex(index);
    });
  }

  private onPointerDown = (e: PointerEvent): void => {
    const p = this.devicePoint(e);
    if (!this.overSlider(p)) return;
    if (!this.allowsDrag('start', 'slider', this.cssPoint(e), 0, 0, e)) return;
    this.dragging = true;
    this.lastDragPx = this.cssPoint(e);
    this.dragPointerId = e.pointerId;
    this.canvas.setPointerCapture?.(e.pointerId);
    e.preventDefault();
    // Keep the pan/zoom controller (attached after this handler) from also
    // treating the grab as a drag-to-pan.
    e.stopImmediatePropagation();
    this.seekTo(p, e);
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (this.dragging && e.pointerId === this.dragPointerId) {
      this.dragging = false;
      this.dragPointerId = -1;
      this.allowsDrag('end', 'slider', this.cssPoint(e), 0, 0, e);
      this.canvas.releasePointerCapture?.(e.pointerId);
      // Snap the handle onto the selected tick.
      this.handlePos = trackPos(this.seriesIndex, this.seriesCount);
      this.overlayDirty = true;
      e.stopImmediatePropagation();
      return;
    }
    if (e.button !== 0 || this.pz.didDrag()) return;
    const { lx, ly } = this.layoutPoint(e);
    const candle = this.hitTest(lx, ly);
    const px = this.cssPoint(e);
    // One dispatch covers both surfaces: the standard cancellable `click` and
    // this chart's `onCandleClick` hook, in that order. The chart has no
    // built-in click behavior, so the hook's `defaultAction` is a no-op.
    if (
      !this.allows('click', { meta: candle, px, button: e.button, candle, event: e }, { native: e })
    ) {
      return;
    }
    runMouseHook(this.cfg.mouse.onCandleClick, candle, e, px, () => {});
  };

  private onDoubleClick = (e: MouseEvent): void => {
    const { lx, ly } = this.layoutPoint(e);
    const candle = this.hitTest(lx, ly);
    const px = this.cssPoint(e);
    this.emit('dblclick', { meta: candle, px, button: e.button }, { native: e });
  };

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.devicePoint(e);
    this.pointerPx = p;

    if (this.dragging) {
      const px = this.cssPoint(e);
      this.allowsDrag('move', 'slider', px, px.x - this.lastDragPx.x, px.y - this.lastDragPx.y, e);
      this.lastDragPx = px;
      this.seekTo(p, e);
      e.stopImmediatePropagation();
      return;
    }
    if (this.sliderCfg.interactive) {
      this.canvas.style.cursor = this.overSlider(p) ? 'ew-resize' : '';
    }

    const { lx, ly } = this.layoutPoint(e);
    const hit = this.hitTest(lx, ly);
    runMouseHook(this.cfg.mouse.onCandleHover, hit, e, this.cssPoint(e), () => {
      this.hoveredCandleId = hit?.candleId ?? -1;
      this.hovered = hit;
      if (this.chrome.currentValue.show) this.overlayDirty = true;
    });
    // The event fires whether or not the hook cancelled the built-in effect:
    // an observer is not an override.
    const id = hit?.candleId ?? -1;
    if (id !== this.lastEmittedHover) {
      this.lastEmittedHover = id;
      this.emit('hover', { candle: hit }, { native: e, cancelable: false });
    }
  };

  private onPointerLeave = (): void => {
    this.pointerPx = null;
    this.hoveredCandleId = -1;
    this.hovered = null;
    if (this.lastEmittedHover !== -1) {
      this.lastEmittedHover = -1;
      this.emit('hover', { candle: null }, { cancelable: false });
    }
    if (this.chrome.currentValue.show) this.overlayDirty = true;
  };

  /** Candle under a layout-space point, by column (see {@link hitCandle}). */
  private hitTest(lx: number, ly: number): CandleMeta | null {
    return hitCandle(this.metas, this.layout?.step ?? 0, lx, ly);
  }

  override dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('dblclick', this.onDoubleClick);
    this.ro?.disconnect();
    this.pz.detach();
    this.renderer?.dispose();
    super.dispose();
    this.legend?.dispose();
    this.title?.dispose();
    this.fps?.dispose();
    this.zoomControls?.dispose();
    this.overlay?.dispose();
    this.overlayCanvas?.remove();
    this.canvas.remove();
  }
}
