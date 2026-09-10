import type { ChartEvents, ChartFrameInfo } from '../../core/chart/kernel.js';
import { ChartKernel } from '../../core/chart/kernel.js';
import {
  type ResolvedChrome,
  axisMargins,
  marginsToPlotRect,
  resolveChrome,
} from '../../core/chrome/chrome.js';
import { FpsMeter, type ResolvedFps, resolveFps } from '../../core/chrome/fps.js';
import { Legend, type LegendEntry } from '../../core/chrome/legend.js';
import { Title } from '../../core/chrome/title.js';
import { appendPoints, patchPoints, removePoints, seriesKeys } from '../../core/data/dataset.js';
import type { DataSet, Point, PointPatch, PointRef } from '../../core/data/types.js';
import { ease, scatterStarts } from '../../core/particles/anim.js';
import { type GrainBuffer, allocGrains } from '../../core/particles/grains.js';
import { grainCounts, packBars } from '../../core/particles/pack.js';
import { mulberry32 } from '../../core/particles/rng.js';
import { pickRenderer } from '../../core/render/pick.js';
import type { FrameUniforms, RGBA, Renderer } from '../../core/render/types.js';
import { DEFAULT_PALETTE, parseColor } from '../../core/util/color.js';
import { PanZoomController } from '../../core/view/controller.js';
import { ZoomControls } from '../../core/view/controls.js';
import {
  type PanZoomable,
  type ResolvedPanZoom,
  type ViewTransform,
  resolvePanZoom,
} from '../../core/view/types.js';
import { type AxisModel, buildAxes } from './axis.js';
import { type ResolvedBarStyle, resolveBarStyle, revealFactor } from './barStyle.js';
import { type BarLayout, layoutBars } from './layout.js';
import { Overlay } from './overlay.js';
import type { BarChartConfig, BarMeta, HoverPayload, SeriesFocusPayload } from './types.js';

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
  /** Transition window (border tween + grain fade) for update/add/remove, seconds. */
  morphDuration: number;
  reflow: 'translate' | 'reshuffle' | 'withBar';
  enter: 'pour' | 'rise';
  exit: 'fall' | 'vanish';
  hoverEffects: Set<'highlight' | 'jitter' | 'opacity'>;
  highlightGain: number;
  hoverJitterAmp: number;
  hoverOpacity: number;
  hoverFade: number;
  /** Alpha multiplier for a fully-dimmed (isolated-out) series. */
  dimOpacity: number;
  /** Dim ease in/out time, seconds. */
  dimFade: number;
}

function resolve(cfg: BarChartConfig): Resolved {
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
  };
}

// A type alias, not an interface: only the former carries the implicit index
// signature that `ChartKernel`'s `Record<string, object>` constraint needs.
/** Events this chart adds on top of the standard set every chart inherits. */
type BarExtraEvents = {
  hover: HoverPayload;
  seriesFocus: SeriesFocusPayload;
};

/** Items the bar chart's data methods accept, as reported by the `data*` events. */
type BarItem = Point | PointPatch | PointRef;

/** Everything {@link BarChart.on} accepts: the standard events plus the two above. */
export type BarChartEvents = ChartEvents<BarMeta, BarItem, BarExtraEvents>;

/** How grains enter on a data build: fresh pour vs. morph from the prior state. */
type BuildMode = 'pour' | 'morph';

/** A bar's animated geometry box (layout space). */
interface BarBox {
  x0: number;
  x1: number;
  height: number;
}

/** An in-flight border tween: interpolate `from → to` per bar over `dur`. */
interface MorphTween {
  start: number;
  dur: number;
  from: BarBox[];
  to: BarBox[];
}

/** Data identity of a bar (x + series), used to match bars across a rebuild. */
function barKey(xValue: unknown, seriesKey: unknown): string {
  return `${String(xValue)} ${String(seriesKey)}`;
}

/** Group grain indices by their `barId`, preserving buffer order within each bar. */
function groupGrainsByBar(grains: GrainBuffer): Map<number, number[]> {
  const byBar = new Map<number, number[]>();
  for (let i = 0; i < grains.count; i++) {
    const b = grains.barId[i]!;
    let arr = byBar.get(b);
    if (!arr) {
      arr = [];
      byBar.set(b, arr);
    }
    arr.push(i);
  }
  return byBar;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Sand bar chart. Mounts into an element, renders bars as animated grains via
 * the best available backend (WebGPU → Canvas2D), and exposes hover events.
 */
export class BarChart extends ChartKernel<BarMeta, BarItem, BarExtraEvents> implements PanZoomable {
  private el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private cfg: Resolved;
  private renderer: Renderer | null = null;
  private grains: GrainBuffer = allocGrains(0);
  private metas: BarMeta[] = [];
  /** Current dataset (source of truth for {@link update}/{@link add}/{@link remove}). */
  private data: DataSet = { points: [] };

  /** Reveal timing regime: fresh pour vs. in-place morph (border stays solid). */
  private revealMode: BuildMode = 'pour';
  /** Active border tween, or null when settled. */
  private morph: MorphTween | null = null;

  // Chrome (axes / legend / current value).
  private chrome: ResolvedChrome;
  private barStyle: ResolvedBarStyle;
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
  private layout: BarLayout | null = null;
  private axes: AxisModel = { x: [], y: [] };
  private plotRect: [number, number, number, number] = [0, 0, 1, 1];
  private hovered: BarMeta | null = null;
  private pointerPx: { x: number; y: number } | null = null;
  /**
   * Bumped whenever bar geometry changes (rebuild, morph tick) so the overlay
   * knows when its cached solid layer is stale.
   */
  private geomVersion = 0;
  /** Set by pointer events; the RAF loop coalesces them into one redraw. */
  private overlayDirty = false;
  private raf = 0;
  private startTime = 0;
  private lastFrameMs = 0;
  private hoveredBarId = -1;
  /** Per-bar hover weight in [0,1], eased toward 1 for the hovered bar. */
  private hoverWeights = new Float32Array(0);
  /** Series index isolated via the legend / `focusSeries()`, or null. */
  private focusedSeries: number | null = null;
  /** Per-bar dim weight in [0,1], eased toward 1 for non-focused series. */
  private dimWeights = new Float32Array(0);
  private dpr = 1;
  private ro: ResizeObserver | null = null;
  private disposed = false;
  private ready: Promise<void>;

  constructor(el: HTMLElement, config: BarChartConfig) {
    super();
    this.el = el;
    // Seat data synchronously so getData() is valid before the async boot runs
    // buildGrains(); otherwise a rebuild firing mid-boot captures empty data.
    this.data = config.data;
    this.cfg = resolve(config);
    this.chrome = resolveChrome(config);
    this.barStyle = resolveBarStyle(config);
    this.fpsCfg = resolveFps(config);
    this.pzCfg = resolvePanZoom(config.panZoom);
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

    if (this.chrome.any || this.barStyle.enabled) this.mountChrome();
    if (this.fpsCfg.show) {
      this.ensureRelative(this.el);
      this.fps = new FpsMeter(this.el, this.fpsCfg.position, this.fpsCfg.color);
    }
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

  /** Create the overlay canvas + DOM legend layers (only when chrome is used). */
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

  private async boot(data: DataSet, backend: BarChartConfig['backend']): Promise<void> {
    this.renderer = await pickRenderer(backend ?? 'auto');
    this.resizeCanvas();
    await this.renderer.init(this.canvas);
    this.buildGrains(data, 'pour');

    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
    this.canvas.addEventListener('pointerup', this.onPointerUp);
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
        this.recomputePlotRect();
        this.drawOverlay();
      }
    }
  }

  /** Rebuild axis model + legend and redraw the overlay (layout/data change). */
  private refreshChrome(data: DataSet): void {
    if (!this.chrome.any || !this.layout) return;
    this.axes = buildAxes(this.layout, this.chrome.x, this.chrome.y);
    if (this.legend) {
      this.legend.setEntries(this.legendEntries(data));
      this.legend.setFocus(this.focusedSeries);
    }
    this.recomputePlotRect();
    this.drawOverlay();
  }

  /** Legend entry `i` was clicked: toggle isolation of series `i`. */
  private handleLegendClick(i: number): void {
    this.setFocus(this.focusedSeries === i ? null : i);
  }

  private setFocus(index: number | null): void {
    if (index === this.focusedSeries) return;
    this.focusedSeries = index;
    this.legend?.setFocus(index);
    this.emit('seriesFocus', { index }, { cancelable: false });
  }

  /**
   * Isolate one series by index — it stays at full opacity, every other
   * series dims to `interaction.dim.opacity`. `null` clears the isolation.
   * Equivalent to clicking that series' legend entry; fires `seriesFocus`.
   */
  focusSeries(index: number | null): void {
    this.setFocus(index);
  }

  /** Currently isolated series index, or `null`. */
  getFocusedSeries(): number | null {
    return this.focusedSeries;
  }

  private legendEntries(data: DataSet): LegendEntry[] {
    const keys = seriesKeys(data.points);
    return keys.map((k, i) => ({
      label: k === undefined ? `Series ${i + 1}` : String(k),
      color: this.cfg.palette[i % this.cfg.palette.length]!,
    }));
  }

  /** Compute the plot rect from axis margins + measured legend extent. */
  private recomputePlotRect(): void {
    if (!this.chrome.any) {
      this.plotRect = [0, 0, 1, 1];
      this.positionZoomControls();
      return;
    }
    const m = axisMargins(this.chrome);
    if (this.legend && this.chrome.legend.show) {
      m[this.chrome.legend.position] += this.legend.measure() + 6;
    }
    if (this.title && this.chrome.title.show) {
      m[this.chrome.title.position] += this.title.measure() + 4;
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
    // FPS 'left'/'right' badges sit in the top corners; drop the controls below
    // one if they share a corner.
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
      hoveredBar: this.hovered,
      pointer: this.pointerPx,
      metas: this.metas,
      barStyle: this.barStyle,
      solid,
      hoverWeights: this.hoverWeights,
      highlightGain: this.cfg.hoverEffects.has('highlight') ? this.cfg.highlightGain : 1,
      dimWeights: this.dimWeights,
      dimOpacity: this.cfg.dimOpacity,
      viewScale: this.view.scale,
      viewOffset: this.view.offset,
      clipToPlot: this.pzCfg.enabled,
      geomVersion: this.geomVersion,
    });
    this.overlayDirty = false;
  }

  /** Current pan/zoom transform. */
  private get view(): ViewTransform {
    return this.pz.getView();
  }

  /**
   * Whether the solid layer should keep redrawing for hover: the highlight
   * effect is on, bars are solid, and some bar's weight is still non-zero
   * (hovered or easing out). Keeps the overlay in sync with the eased weights.
   */
  private solidHoverActive(): boolean {
    if (!this.barStyle.enabled || !this.cfg.hoverEffects.has('highlight')) return false;
    if (this.hoveredBarId !== -1) return true;
    for (let i = 0; i < this.hoverWeights.length; i++)
      if (this.hoverWeights[i]! > 0.001) return true;
    return false;
  }

  /** Whether the dim transition is still easing (needs the solid layer to keep repainting). */
  private solidDimActive(): boolean {
    if (!this.barStyle.enabled) return false;
    if (this.focusedSeries !== null) return true;
    for (let i = 0; i < this.dimWeights.length; i++) if (this.dimWeights[i]! > 0.001) return true;
    return false;
  }

  private nowSeconds(): number {
    return (performance.now() - this.startTime) / 1000;
  }

  /** Reveal state at `now` (seconds): grain fade-out + fill/border fade-in. */
  private revealState(now: number): { grainFade: number; solid: number } {
    const r = this.barStyle;
    if (!r.enabled) return { grainFade: 1, solid: 0 };
    // Morph regime: the border stays fully resolved (solid = 1); grains re-appear
    // as they set off and fade back to their steady opacity as they settle.
    if (this.revealMode === 'morph') {
      // 'withBar' keeps grains at their steady opacity (no re-appear flash), so
      // unchanged bars ride the border quietly; other reflows ramp back in.
      if (!this.morph || this.cfg.reflow === 'withBar') {
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
   * Advance the active border tween: write the eased `from → to` box into each
   * `meta` (so overlay draw, hit-test, and current-value all use the tweened
   * geometry). Snaps to `to` and clears the tween once complete. No-op / false
   * when no tween is active.
   */
  private applyMorph(now: number): boolean {
    const mo = this.morph;
    if (!mo) return false;
    const p = mo.dur > 0 ? (now - mo.start) / mo.dur : 1;
    const done = p >= 1;
    const e = done ? 1 : ease(clamp01(p), this.barStyle.reveal.ease);
    const n = Math.min(this.metas.length, mo.from.length, mo.to.length);
    for (let i = 0; i < n; i++) {
      const f = mo.from[i]!;
      const t = mo.to[i]!;
      const m = this.metas[i]!;
      m.x0 = f.x0 + (t.x0 - f.x0) * e;
      m.x1 = f.x1 + (t.x1 - f.x1) * e;
      m.height = f.height + (t.height - f.height) * e;
    }
    this.geomVersion++;
    if (done) this.morph = null;
    return !done;
  }

  /**
   * Build the grain buffer from `data`. `'pour'` scatters grains from above
   * (fresh pour-in + reveal ramp); `'morph'` flows grains from the prior state
   * by data identity and arms a border tween so the solid layer changes smoothly
   * without re-fading.
   */
  private buildGrains(data: DataSet, mode: BuildMode): void {
    const prevGrains = this.grains;
    const prevMetas = this.metas;

    const layout = layoutBars(data, this.cfg.palette);
    const { bars, metas } = layout;
    this.layout = layout;
    this.metas = metas;
    this.data = data;
    this.geomVersion++;

    // Clamp focus regardless of whether a legend is mounted — focusSeries()
    // works without one, and a stale out-of-range index would otherwise dim
    // every series (no meta's seriesIndex would match it).
    const seriesCount = seriesKeys(data.points).length;
    if (this.focusedSeries !== null && this.focusedSeries >= seriesCount) {
      this.focusedSeries = null;
    }

    // Resize hover weights to bar count, preserving overlapping indices.
    const weights = new Float32Array(metas.length);
    weights.set(this.hoverWeights.subarray(0, Math.min(metas.length, this.hoverWeights.length)));
    this.hoverWeights = weights;

    const dimWeights = new Float32Array(metas.length);
    dimWeights.set(this.dimWeights.subarray(0, Math.min(metas.length, this.dimWeights.length)));
    this.dimWeights = dimWeights;

    const counts = grainCounts(bars, {
      density: this.cfg.grainDensity,
      maxGrains: this.cfg.maxGrains,
    });
    const total = counts.reduce((a, b) => a + b, 0);

    const canMorph = mode === 'morph' && prevGrains.count > 0 && prevMetas.length > 0;

    // Morph identity maps + removed-bar ghosts (grains that fall off on exit).
    let oldGrainsByBar: Map<number, number[]> | null = null;
    let oldBarByKey: Map<string, number> | null = null;
    const ghostBars: number[] = [];
    let ghostTotal = 0;
    if (canMorph) {
      oldGrainsByBar = groupGrainsByBar(prevGrains);
      oldBarByKey = new Map();
      for (const m of prevMetas) oldBarByKey.set(barKey(m.xValue, m.seriesKey), m.barId);
      if (this.cfg.exit === 'fall') {
        const newKeys = new Set(metas.map((m) => barKey(m.xValue, m.seriesKey)));
        for (const m of prevMetas) {
          if (newKeys.has(barKey(m.xValue, m.seriesKey))) continue;
          const list = oldGrainsByBar.get(m.barId);
          if (list && list.length > 0) {
            ghostBars.push(m.barId);
            ghostTotal += list.length;
          }
        }
      }
    }

    const g = allocGrains(total + ghostTotal);
    packBars(bars, counts, g, {
      density: this.cfg.grainDensity,
      jitter: this.cfg.jitter,
      seed: 1,
    });

    if (!canMorph) {
      scatterStarts(g, { duration: this.cfg.duration, stagger: this.cfg.stagger, seed: 7 });
      this.morph = null;
    } else {
      this.morphGrainStarts(g, metas, counts, prevGrains, oldGrainsByBar!, oldBarByKey!);
      if (ghostBars.length > 0) {
        this.appendGhosts(g, total, ghostBars, prevGrains, oldGrainsByBar!);
      }
      this.armBorderTween(metas, prevMetas);
    }
    this.revealMode = canMorph ? 'morph' : 'pour';

    this.grains = g;
    this.renderer?.upload(g);
    this.startTime = performance.now();
    this.lastSolid = -1; // re-arm reveal redraw for the new grains
    // Seat the tween at its start so the first overlay frame draws `from`.
    if (this.morph) this.applyMorph(0);

    this.refreshChrome(data);
  }

  /**
   * Assign morph starts per bar (grains are packed in bar order, so `counts`
   * gives each bar's contiguous grain range):
   *
   * - **existing bar** — map grain *k* to old grain *k* (`reflow: 'translate'`,
   *   a smooth slide) or a random old grain (`'reshuffle'`);
   * - **added bar** — enter from above (`enter: 'pour'`) or up from the base
   *   (`'rise'`).
   */
  private morphGrainStarts(
    g: GrainBuffer,
    metas: BarMeta[],
    counts: number[],
    prevGrains: GrainBuffer,
    oldGrainsByBar: Map<number, number[]>,
    oldBarByKey: Map<string, number>,
  ): void {
    const rng = mulberry32(9);
    let off = 0;
    for (let bi = 0; bi < metas.length; bi++) {
      const cnt = counts[bi]!;
      if (cnt <= 0) continue;
      const m = metas[bi]!;
      const oldBar = oldBarByKey.get(barKey(m.xValue, m.seriesKey));
      const pool = oldBar !== undefined ? oldGrainsByBar.get(oldBar) : undefined;
      const pourDelay = (gi: number): number =>
        this.cfg.stagger * (g.targetY[gi]! * 0.5 + rng() * 0.5);
      for (let k = 0; k < cnt; k++) {
        const i = off + k;
        if (pool && pool.length > 0) {
          // 'translate' / 'withBar' map grain k to old grain k (1:1 slide);
          // 'reshuffle' picks a random old grain.
          const src =
            this.cfg.reflow === 'reshuffle'
              ? pool[(rng() * pool.length) | 0]!
              : pool[Math.min(pool.length - 1, ((k * pool.length) / cnt) | 0)]!;
          g.startX[i] = prevGrains.targetX[src]!;
          g.startY[i] = prevGrains.targetY[src]!;
          // 'withBar' rides the bar with no stagger; others settle in.
          g.delay[i] = this.cfg.reflow === 'withBar' ? 0 : pourDelay(i);
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
   * Append the removed bars' old grains as ghosts at `[offset, …)`: they start
   * where they were and fall off the bottom (`targetY < 0`), fading with the
   * global grain-fade. `barId = 0` is a safe hover index; ghosts have no meta so
   * they are never hit-tested, and are dropped on the next rebuild.
   */
  private appendGhosts(
    g: GrainBuffer,
    offset: number,
    ghostBars: number[],
    prevGrains: GrainBuffer,
    oldGrainsByBar: Map<number, number[]>,
  ): void {
    const rng = mulberry32(21);
    let gi = offset;
    for (const bar of ghostBars) {
      for (const src of oldGrainsByBar.get(bar)!) {
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
   * Arm a border tween from the old per-bar geometry (matched by identity) to
   * the new one. Bars with no predecessor grow from height 0 at their final x.
   * Only meaningful when the solid layer is enabled.
   */
  private armBorderTween(metas: BarMeta[], prevMetas: BarMeta[]): void {
    if (!this.barStyle.enabled) {
      this.morph = null;
      return;
    }
    const oldBoxByKey = new Map<string, BarBox>();
    for (const m of prevMetas) {
      oldBoxByKey.set(barKey(m.xValue, m.seriesKey), { x0: m.x0, x1: m.x1, height: m.height });
    }
    const from: BarBox[] = [];
    const to: BarBox[] = [];
    for (const m of metas) {
      to.push({ x0: m.x0, x1: m.x1, height: m.height });
      const old = oldBoxByKey.get(barKey(m.xValue, m.seriesKey));
      from.push(old ?? { x0: m.x0, x1: m.x1, height: 0 });
    }
    this.morph = { start: 0, dur: this.cfg.morphDuration, from, to };
  }

  /**
   * Replace the whole dataset (grains morph to the new targets), or — given an
   * array of {@link PointPatch} — set `y` on existing points in place. Either
   * way the solid border/fill tween smoothly rather than re-pouring.
   */
  update(data: DataSet): void;
  update(patches: PointPatch[]): void;
  update(arg: DataSet | PointPatch[]): void {
    if (this.disposed) return;
    const patches = Array.isArray(arg) ? arg : null;
    if (!this.allowsData('dataUpdate', patches ? 'update' : 'replace', patches ?? [])) return;
    const next: DataSet = patches
      ? { ...this.data, points: patchPoints(this.data.points, patches) }
      : (arg as DataSet);
    this.buildGrains(next, 'morph');
  }

  /** Append one or more points; new bars grow in and their grains pour from above. */
  add(points: Point | Point[]): void {
    if (this.disposed) return;
    const add = Array.isArray(points) ? points : [points];
    if (!this.allowsData('dataAdd', 'add', add)) return;
    this.buildGrains({ ...this.data, points: appendPoints(this.data.points, add) }, 'morph');
  }

  /** Remove points by index (negative = from end) or `{x, z?}` match; bars reflow. */
  remove(refs: PointRef | PointRef[]): void {
    if (this.disposed) return;
    const list = Array.isArray(refs) ? refs : [refs];
    if (!this.allowsData('dataRemove', 'remove', list)) return;
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

  private loop = (): void => {
    if (this.disposed || !this.renderer) return;
    const nowMs = performance.now();
    const dt = this.lastFrameMs ? (nowMs - this.lastFrameMs) / 1000 : 0;
    this.lastFrameMs = nowMs;
    this.fps?.sample(dt, nowMs);
    this.easeHoverWeights(dt);
    this.easeDimWeights(dt);
    const now = (nowMs - this.startTime) / 1000;
    this.renderer.frame(this.uniforms(now));
    // Redraw the solid overlay while a border tween runs, or while the pour
    // reveal factor is still moving; otherwise it stays quiet (event-driven).
    if (this.barStyle.enabled) {
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
    // Caller-owned layers repaint last, on top of the finished frame.
    this.afterDraw();
    this.raf = requestAnimationFrame(this.loop);
  };

  /**
   * Ease each bar's hover weight toward its target (1 for the hovered bar, 0
   * otherwise) so enter/leave — and crossfades between bars — animate smoothly.
   * Frame-rate independent exponential smoothing with time constant `hoverFade`.
   */
  private easeHoverWeights(dt: number): void {
    const w = this.hoverWeights;
    // Fraction of the remaining gap to close this frame.
    const k = this.cfg.hoverFade > 0 && dt > 0 ? 1 - Math.exp(-dt / this.cfg.hoverFade) : 1;
    for (let i = 0; i < w.length; i++) {
      const target = i === this.hoveredBarId ? 1 : 0;
      const next = w[i]! + (target - w[i]!) * k;
      // Snap to endpoints to avoid endless tiny updates.
      w[i] = Math.abs(next - target) < 0.001 ? target : next;
    }
  }

  // Ease each bar's dim weight toward its target: 1 for every bar whose series
  // isn't the focused one, 0 when nothing is focused — independent of hover so
  // isolating a series composes with (rather than fights) pointer hover.
  private easeDimWeights(dt: number): void {
    const w = this.dimWeights;
    const k = this.cfg.dimFade > 0 && dt > 0 ? 1 - Math.exp(-dt / this.cfg.dimFade) : 1;
    for (let i = 0; i < w.length; i++) {
      const seriesIndex = this.metas[i]?.seriesIndex;
      const target = this.focusedSeries !== null && seriesIndex !== this.focusedSeries ? 1 : 0;
      const next = w[i]! + (target - w[i]!) * k;
      w[i] = Math.abs(next - target) < 0.001 ? target : next;
    }
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
      plotRect: this.plotRect,
      grainFade: this.revealState(now).grainFade,
      viewScale: this.view.scale,
      viewOffset: this.view.offset,
      clipToPlot: this.pzCfg.enabled,
    };
  }

  /** Pointer position in CSS px, relative to the chart element. */
  private cssPoint(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  /** Bar under the pointer, inverting the plot rect and pan/zoom transform. */
  private hitAt(e: { clientX: number; clientY: number }): BarMeta | null {
    const rect = this.canvas.getBoundingClientRect();
    // Canvas-fraction pointer (y-up), then into plot-local layout space.
    const cx = (e.clientX - rect.left) / rect.width;
    const cy = 1 - (e.clientY - rect.top) / rect.height;
    const [x0, y0, x1, y1] = this.plotRect;
    // Plot-local fraction, then invert the pan/zoom transform into data space.
    const plx = (cx - x0) / (x1 - x0);
    const ply = (cy - y0) / (y1 - y0);
    const v = this.view;
    return this.hitTest((plx - v.offset[0]) / v.scale[0], (ply - v.offset[1]) / v.scale[1]);
  }

  private onPointerMove = (e: PointerEvent): void => {
    const hit = this.hitAt(e);
    const id = hit?.barId ?? -1;
    const px = this.cssPoint(e);
    this.pointerPx = { x: px.x * this.dpr, y: px.y * this.dpr };
    if (id !== this.hoveredBarId) {
      this.hoveredBarId = id;
      this.hovered = hit;
      this.emit('hover', { bar: hit }, { native: e, cancelable: false });
    }
    // Mark dirty rather than drawing here: pointer events fire faster than the
    // display refreshes, and each redraw repaints the whole overlay.
    if (this.overlay && this.chrome.currentValue.show) this.overlayDirty = true;
  };

  private onPointerLeave = (): void => {
    this.pointerPx = null;
    if (this.hoveredBarId !== -1) {
      this.hoveredBarId = -1;
      this.hovered = null;
      this.emit('hover', { bar: null }, { cancelable: false });
    }
    // Mark dirty rather than drawing here: pointer events fire faster than the
    // display refreshes, and each redraw repaints the whole overlay.
    if (this.overlay && this.chrome.currentValue.show) this.overlayDirty = true;
  };

  /**
   * Click fires on pointer-up rather than -down so a drag-to-pan that ends over
   * a bar is not also reported as a click on it.
   */
  private onPointerUp = (e: PointerEvent): void => {
    if (this.pz.didDrag()) return;
    this.dispatchClick('click', this.hitAt(e), e, this.cssPoint(e), undefined, () => {});
  };

  private onDoubleClick = (e: MouseEvent): void => {
    this.dispatchClick('dblclick', this.hitAt(e), e, this.cssPoint(e), undefined, () => {});
  };

  /** Bar-region hit-test in layout space; cheap enough for 100k grains. */
  private hitTest(lx: number, ly: number): BarMeta | null {
    for (const m of this.metas) {
      if (lx >= m.x0 && lx <= m.x1 && ly >= 0 && ly <= m.height) return m;
    }
    return null;
  }

  override dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
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
