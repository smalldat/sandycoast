// Reuse the bar chart's chrome infrastructure verbatim (axes/legend/margins/fps).
import { axisMargins, marginsToPlotRect, resolveChrome } from '../../core/chrome/chrome.js';
import type { ResolvedChrome } from '../../core/chrome/chrome.js';
import { FpsMeter, type ResolvedFps, resolveFps } from '../../core/chrome/fps.js';
import { Legend, type LegendEntry } from '../../core/chrome/legend.js';
import { Title } from '../../core/chrome/title.js';
import type { MeshDataSet, MeshPoint } from '../../core/data/mesh.js';
import { ease, scatterStarts } from '../../core/particles/anim.js';
import { type GrainBuffer, allocGrains } from '../../core/particles/grains.js';
import { blobGrainCounts, packBlobs } from '../../core/particles/pack.js';
import { mulberry32 } from '../../core/particles/rng.js';
import { pickRenderer } from '../../core/render/pick.js';
import type { FrameUniforms, RGBA, Renderer } from '../../core/render/types.js';
import { DEFAULT_PALETTE, parseColor } from '../../core/util/color.js';
import { Emitter } from '../../core/util/emitter.js';
import { PanZoomController } from '../../core/view/controller.js';
import { ZoomControls } from '../../core/view/controls.js';
import {
  type PanZoomable,
  type ResolvedPanZoom,
  type ViewTransform,
  resolvePanZoom,
} from '../../core/view/types.js';
import { type ResolvedApproximation, resolveApproximation } from './approximation.js';
import { type AxisModel, buildAxes } from './axis.js';
import { type ScatterLayout, layoutScatter } from './layout.js';
import { type ResolvedMarkerStyle, resolveMarkerStyle, revealFactor } from './markerStyle.js';
import { Overlay } from './overlay.js';
import type { HoverPayload, ScatterChartConfig, ScatterMeta } from './types.js';

interface Resolved {
  grainDensity: number;
  maxGrains: number;
  pointRadius: number;
  palette: RGBA[];
  background: RGBA;
  grainSizePx: number;
  grainShape: 'quad' | 'disc';
  jitter: number;
  settleJitter: number;
  duration: number;
  ease: FrameUniforms['easing'];
  stagger: number;
  /** Transition window (marker tween + grain fade) for update/add/remove, seconds. */
  morphDuration: number;
  reflow: 'translate' | 'reshuffle' | 'withMarker';
  /** Animate grains on morph, or snap them to targets (marker-only transition). */
  morphGrains: boolean;
  enter: 'pour' | 'rise' | 'continue';
  exit: 'fall' | 'vanish';
  hoverEffects: Set<'highlight' | 'jitter' | 'opacity'>;
  highlightGain: number;
  hoverJitterAmp: number;
  hoverOpacity: number;
  hoverFade: number;
}

function resolve(cfg: ScatterChartConfig): Resolved {
  const hover = cfg.interaction?.hover;
  const anim = cfg.animation;
  const duration = anim?.duration != null ? anim.duration / 1000 : 0.9;
  const stagger = anim?.stagger != null ? anim.stagger / 1000 : 0.5;
  return {
    grainDensity: cfg.grainDensity ?? 0.6,
    maxGrains: cfg.maxGrains ?? 100_000,
    pointRadius: cfg.pointRadius ?? 0.02,
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
    enter: anim?.enter ?? 'pour',
    exit: anim?.exit ?? 'fall',
    hoverEffects: new Set(hover?.effects ?? ['highlight', 'jitter']),
    highlightGain: hover?.highlightGain ?? 1.6,
    hoverJitterAmp: hover?.jitterAmp ?? 0.008,
    hoverOpacity: hover?.opacity ?? 1,
    hoverFade: (hover?.fadeMs ?? 180) / 1000,
  };
}

type Events = { hover: HoverPayload };

/** How grains enter on a data build: fresh pour vs. morph from the prior state. */
type BuildMode = 'pour' | 'morph';

/** A point's animated position (layout space). */
interface PointBox {
  cx: number;
  cy: number;
}

/** An in-flight marker tween: interpolate `from → to` per point over `dur`. */
interface MorphTween {
  start: number;
  dur: number;
  from: PointBox[];
  to: PointBox[];
}

/**
 * Data identity of a point: there is no `z` series-discriminator to key on
 * (see `core/data/mesh.ts`), so morph identity falls back to its position
 * within its series — an insert/remove *inside* a series shifts every later
 * index's identity, same limitation the line chart has for points sharing an
 * x-slot.
 */
function pointKey(seriesIndex: number, indexInSeries: number): string {
  return `${seriesIndex} ${indexInSeries}`;
}

/** Group grain indices by their `barId` (= point id), preserving order. */
function groupGrainsByPoint(grains: GrainBuffer): Map<number, number[]> {
  const byPoint = new Map<number, number[]>();
  for (let i = 0; i < grains.count; i++) {
    const b = grains.barId[i]!;
    let arr = byPoint.get(b);
    if (!arr) {
      arr = [];
      byPoint.set(b, arr);
    }
    arr.push(i);
  }
  return byPoint;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Sand scatter chart. Mounts into an element, renders each point as a small
 * cloud of settling grains with a solid marker glyph resolving on top, via the
 * best available backend (WebGPU → Canvas2D), and exposes hover events.
 * Mirrors {@link BarChart}/{@link LineChart}: same config surface and
 * lifecycle, with continuous X/Y positioning (`core/scales`) and an explicit
 * `series` array (no `z` grouping key) in place of the bar/line data model.
 */
export class ScatterChart implements PanZoomable {
  private el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private cfg: Resolved;
  private renderer: Renderer | null = null;
  private grains: GrainBuffer = allocGrains(0);
  private metas: ScatterMeta[] = [];
  /** Current dataset (source of truth for {@link update}/{@link add}/{@link remove}). */
  private data: MeshDataSet = { series: [] };
  private emitter = new Emitter<Events>();

  /** Reveal timing regime: fresh pour vs. in-place morph (marker stays solid). */
  private revealMode: BuildMode = 'pour';
  /** Active marker tween, or null when settled. */
  private morph: MorphTween | null = null;

  private chrome: ResolvedChrome;
  private markerStyle: ResolvedMarkerStyle;
  private approx: ResolvedApproximation;
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
  private layout: ScatterLayout | null = null;
  private axes: AxisModel = { x: [], y: [] };
  private plotRect: [number, number, number, number] = [0, 0, 1, 1];
  private hovered: ScatterMeta | null = null;
  private pointerPx: { x: number; y: number } | null = null;
  /**
   * Bumped whenever point geometry changes (rebuild, morph tick) so the overlay
   * knows when its cached approximation fit is stale.
   */
  private geomVersion = 0;
  /** Set by pointer events; the RAF loop coalesces them into one redraw. */
  private overlayDirty = false;
  private raf = 0;
  private startTime = 0;
  private lastFrameMs = 0;
  private hoveredPointId = -1;
  /** Per-point hover weight in [0,1], eased toward 1 for the hovered point. */
  private hoverWeights = new Float32Array(0);
  private dpr = 1;
  private ro: ResizeObserver | null = null;
  private disposed = false;
  private ready: Promise<void>;

  constructor(el: HTMLElement, config: ScatterChartConfig) {
    this.el = el;
    this.data = config.data;
    this.cfg = resolve(config);
    this.chrome = resolveChrome(config);
    this.markerStyle = resolveMarkerStyle(config);
    this.approx = resolveApproximation(config.approximation);
    this.fpsCfg = resolveFps(config);
    this.pzCfg = resolvePanZoom(config.panZoom);
    this.pz = new PanZoomController(
      this.pzCfg,
      () => this.plotRect,
      () => this.onViewChange(),
    );
    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    el.appendChild(this.canvas);

    if (this.chrome.any || this.markerStyle.enabled || this.approx.enabled) this.mountChrome();
    if (this.fpsCfg.show) {
      this.ensureRelative();
      this.fps = new FpsMeter(this.el, this.fpsCfg.position, this.fpsCfg.color);
    }
    if (this.pzCfg.enabled) {
      this.ensureRelative();
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
    this.overlay = new Overlay(oc);

    if (this.chrome.legend.show) this.legend = new Legend(this.el, this.chrome.legend);
    if (this.chrome.title.show) this.title = new Title(this.el, this.chrome.title);
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  get backend(): Renderer['kind'] | null {
    return this.renderer?.kind ?? null;
  }

  on<K extends keyof Events>(event: K, fn: (p: Events[K]) => void): () => void {
    return this.emitter.on(event, fn);
  }

  private async boot(data: MeshDataSet, backend: ScatterChartConfig['backend']): Promise<void> {
    this.renderer = await pickRenderer(backend ?? 'auto');
    this.resizeCanvas();
    await this.renderer.init(this.canvas);
    this.buildGrains(data, 'pour');

    this.canvas.addEventListener('pointermove', this.onPointerMove);
    this.canvas.addEventListener('pointerleave', this.onPointerLeave);
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

  private refreshChrome(data: MeshDataSet): void {
    if (!this.chrome.any || !this.layout) return;
    this.axes = buildAxes(this.layout, this.chrome.x, this.chrome.y);
    if (this.legend) this.legend.setEntries(this.legendEntries(data));
    this.recomputePlotRect();
    this.drawOverlay();
  }

  private legendEntries(data: MeshDataSet): LegendEntry[] {
    return data.series.map((s, i) => ({
      label: s.key === undefined ? `Series ${i + 1}` : String(s.key),
      color: this.cfg.palette[i % this.cfg.palette.length]!,
    }));
  }

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
      hoveredPoint: this.hovered,
      pointer: this.pointerPx,
      metas: this.metas,
      markerStyle: this.markerStyle,
      approx: this.approx,
      solid,
      hoverWeights: this.hoverWeights,
      highlightGain: this.cfg.hoverEffects.has('highlight') ? this.cfg.highlightGain : 1,
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

  private solidEnabled(): boolean {
    return this.markerStyle.enabled || this.approx.enabled;
  }

  /**
   * Whether the solid layer should keep redrawing for hover: the highlight
   * effect is on, markers are solid, and some point's weight is still
   * non-zero (hovered or easing out).
   */
  private solidHoverActive(): boolean {
    if (!this.markerStyle.enabled || !this.cfg.hoverEffects.has('highlight')) return false;
    if (this.hoveredPointId !== -1) return true;
    for (let i = 0; i < this.hoverWeights.length; i++)
      if (this.hoverWeights[i]! > 0.001) return true;
    return false;
  }

  private nowSeconds(): number {
    return (performance.now() - this.startTime) / 1000;
  }

  /** Reveal state at `now` (seconds): grain fade-out + marker/approx fade-in. */
  private revealState(now: number): { grainFade: number; solid: number } {
    if (!this.solidEnabled()) return { grainFade: 1, solid: 0 };
    const r = this.markerStyle;
    if (this.revealMode === 'morph') {
      if (!this.morph || this.cfg.reflow === 'withMarker') {
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
   * Advance the active marker tween: write the eased `from → to` position into
   * each `meta` so overlay draw, hit-test, and current-value all use the tweened
   * geometry. Snaps to `to` and clears the tween once complete.
   */
  private applyMorph(now: number): boolean {
    const mo = this.morph;
    if (!mo) return false;
    const p = mo.dur > 0 ? (now - mo.start) / mo.dur : 1;
    const done = p >= 1;
    const e = done ? 1 : ease(clamp01(p), this.markerStyle.reveal.ease);
    const n = Math.min(this.metas.length, mo.from.length, mo.to.length);
    for (let i = 0; i < n; i++) {
      const f = mo.from[i]!;
      const t = mo.to[i]!;
      const m = this.metas[i]!;
      m.cx = f.cx + (t.cx - f.cx) * e;
      m.cy = f.cy + (t.cy - f.cy) * e;
    }
    this.geomVersion++;
    if (done) this.morph = null;
    return !done;
  }

  /**
   * Build the grain buffer from `data`. `'pour'` scatters grains from above
   * (fresh pour-in + reveal ramp); `'morph'` flows grains from the prior state
   * by data identity and arms a marker tween so the solid layer changes smoothly.
   */
  private buildGrains(data: MeshDataSet, mode: BuildMode): void {
    const prevGrains = this.grains;
    const prevMetas = this.metas;

    const layout = layoutScatter(data, this.cfg.palette, this.cfg.pointRadius);
    const { blobs, metas } = layout;
    this.layout = layout;
    this.metas = metas;
    this.data = data;
    this.geomVersion++;

    const weights = new Float32Array(metas.length);
    weights.set(this.hoverWeights.subarray(0, Math.min(metas.length, this.hoverWeights.length)));
    this.hoverWeights = weights;

    const counts = blobGrainCounts(blobs, {
      density: this.cfg.grainDensity,
      maxGrains: this.cfg.maxGrains,
    });
    const total = counts.reduce((a, b) => a + b, 0);

    const canMorph = mode === 'morph' && prevGrains.count > 0 && prevMetas.length > 0;
    const animateGrains = canMorph && this.cfg.morphGrains;

    let oldGrainsByPoint: Map<number, number[]> | null = null;
    let oldPoolByKey: Map<string, number[]> | null = null;
    const ghostPoints: number[] = [];
    let ghostTotal = 0;
    if (animateGrains) {
      oldGrainsByPoint = groupGrainsByPoint(prevGrains);
      oldPoolByKey = new Map();
      for (const m of prevMetas) {
        const list = oldGrainsByPoint.get(m.pointId);
        if (list) oldPoolByKey.set(pointKey(m.seriesIndex, m.indexInSeries), list);
      }
      if (this.cfg.exit === 'fall') {
        const newKeys = new Set(metas.map((m) => pointKey(m.seriesIndex, m.indexInSeries)));
        for (const m of prevMetas) {
          if (newKeys.has(pointKey(m.seriesIndex, m.indexInSeries))) continue;
          const list = oldGrainsByPoint.get(m.pointId);
          if (list && list.length > 0) {
            ghostPoints.push(m.pointId);
            ghostTotal += list.length;
          }
        }
      }
    }

    const g = allocGrains(total + ghostTotal);
    packBlobs(blobs, counts, g, {
      density: this.cfg.grainDensity,
      jitter: this.cfg.jitter,
      seed: 1,
    });

    if (!canMorph) {
      scatterStarts(g, { duration: this.cfg.duration, stagger: this.cfg.stagger, seed: 7 });
      this.morph = null;
    } else if (animateGrains) {
      this.morphGrainStarts(g, blobs, metas, counts, prevGrains, oldPoolByKey!);
      if (ghostPoints.length > 0) {
        this.appendGhosts(g, total, ghostPoints, prevGrains, oldGrainsByPoint!);
      }
      this.armMarkerTween(metas, prevMetas);
    } else {
      // Snap every grain to its target, settled (negative delay => te>=1 at
      // now=0): no motion, only the marker tween below animates the change.
      for (let i = 0; i < total; i++) {
        g.startX[i] = g.targetX[i]!;
        g.startY[i] = g.targetY[i]!;
        g.delay[i] = -this.cfg.duration;
      }
      this.armMarkerTween(metas, prevMetas);
    }
    this.revealMode = canMorph ? 'morph' : 'pour';

    this.grains = g;
    this.renderer?.upload(g);
    this.startTime = performance.now();
    this.lastSolid = -1;
    if (this.morph) this.applyMorph(0);

    this.refreshChrome(data);
  }

  /**
   * Assign morph starts per point (grains are packed in blob order, so
   * `counts` gives each point's contiguous grain range):
   *
   * - **existing point** — map grain *k* to old grain *k* (`translate`, a
   *   smooth slide) or a random old grain (`reshuffle`);
   * - **new point** — enter from above (`pour`), up from the base (`rise`), or
   *   already settled at its target (`continue`).
   */
  private morphGrainStarts(
    g: GrainBuffer,
    blobs: ScatterLayout['blobs'],
    metas: ScatterMeta[],
    counts: number[],
    prevGrains: GrainBuffer,
    oldPoolByKey: Map<string, number[]>,
  ): void {
    const rng = mulberry32(9);
    let off = 0;
    for (let bi = 0; bi < blobs.length; bi++) {
      const cnt = counts[bi]!;
      if (cnt <= 0) continue;
      const m = metas[bi]!;
      const pool = oldPoolByKey.get(pointKey(m.seriesIndex, m.indexInSeries));
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
          g.delay[i] = this.cfg.reflow === 'withMarker' ? 0 : pourDelay(i);
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
   * Append the removed points' old grains as ghosts at `[offset, …)`: they
   * start where they were and fall off the bottom (`targetY < 0`), fading with
   * the global grain-fade. `barId = 0` is a safe hover index; ghosts have no
   * meta so they are never hit-tested, and are dropped on the next rebuild.
   */
  private appendGhosts(
    g: GrainBuffer,
    offset: number,
    ghostPoints: number[],
    prevGrains: GrainBuffer,
    oldGrainsByPoint: Map<number, number[]>,
  ): void {
    const rng = mulberry32(21);
    let gi = offset;
    for (const pt of ghostPoints) {
      for (const src of oldGrainsByPoint.get(pt)!) {
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
   * Arm a marker tween from the old per-point positions (matched by identity)
   * to the new ones. Points with no predecessor grow in from their final
   * position (no slide-in, since there is no baseline to grow from). Only
   * meaningful when the solid layer is enabled.
   */
  private armMarkerTween(metas: ScatterMeta[], prevMetas: ScatterMeta[]): void {
    if (!this.solidEnabled()) {
      this.morph = null;
      return;
    }
    const oldByKey = new Map<string, PointBox>();
    for (const m of prevMetas) {
      oldByKey.set(pointKey(m.seriesIndex, m.indexInSeries), { cx: m.cx, cy: m.cy });
    }
    const from: PointBox[] = [];
    const to: PointBox[] = [];
    for (const m of metas) {
      to.push({ cx: m.cx, cy: m.cy });
      const old = oldByKey.get(pointKey(m.seriesIndex, m.indexInSeries));
      from.push(old ?? { cx: m.cx, cy: m.cy });
    }
    this.morph = { start: 0, dur: this.cfg.morphDuration, from, to };
  }

  /** Replace the whole dataset; grains + marker tween smoothly rather than re-pouring. */
  update(data: MeshDataSet): void {
    if (this.disposed) return;
    this.buildGrains(data, 'morph');
  }

  /**
   * Append one or more points to a series (by index, default 0; created if it
   * doesn't exist yet); new markers grow in and their grains pour from above.
   */
  add(points: MeshPoint | MeshPoint[], seriesIndex = 0): void {
    if (this.disposed) return;
    const list = Array.isArray(points) ? points : [points];
    const series = this.data.series;
    const idx = Math.min(Math.max(0, seriesIndex), series.length);
    const nextSeries =
      idx === series.length
        ? [...series, { points: list.map((p) => ({ ...p })) }]
        : series.map((s, i) =>
            i === idx ? { ...s, points: [...s.points, ...list.map((p) => ({ ...p }))] } : s,
          );
    this.buildGrains({ ...this.data, series: nextSeries }, 'morph');
  }

  /**
   * Remove points from a series (by index, default 0) by their index within
   * that series (negative = from end); the point cloud reflows.
   */
  remove(indices: number | number[], seriesIndex = 0): void {
    if (this.disposed) return;
    const series = this.data.series;
    if (seriesIndex < 0 || seriesIndex >= series.length) return;
    const points = series[seriesIndex]!.points;
    const drop = new Set(
      (Array.isArray(indices) ? indices : [indices]).map((i) => (i < 0 ? points.length + i : i)),
    );
    const nextSeries = series.map((s, i) =>
      i === seriesIndex ? { ...s, points: s.points.filter((_, pi) => !drop.has(pi)) } : s,
    );
    this.buildGrains({ ...this.data, series: nextSeries }, 'morph');
  }

  /** Re-run the pour-in animation with the current data (no morph). */
  repour(): void {
    if (this.disposed) return;
    this.buildGrains(this.data, 'pour');
  }

  /** Snapshot of the current dataset (series/points deep-cloned). */
  getData(): MeshDataSet {
    return {
      ...this.data,
      series: this.data.series.map((s) => ({ ...s, points: s.points.map((p) => ({ ...p })) })),
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

  private loop = (): void => {
    if (this.disposed || !this.renderer) return;
    const nowMs = performance.now();
    const dt = this.lastFrameMs ? (nowMs - this.lastFrameMs) / 1000 : 0;
    this.lastFrameMs = nowMs;
    this.fps?.sample(dt, nowMs);
    this.easeHoverWeights(dt);
    const now = (nowMs - this.startTime) / 1000;
    this.renderer.frame(this.uniforms(now));
    if (this.solidEnabled()) {
      if (this.morph) {
        this.applyMorph(now);
        this.drawOverlay(now);
      } else {
        const solid = this.revealState(now).solid;
        if (solid !== this.lastSolid || this.solidHoverActive() || this.overlayDirty) {
          this.drawOverlay(now);
        }
      }
    } else if (this.overlayDirty) {
      this.drawOverlay(now);
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private easeHoverWeights(dt: number): void {
    const w = this.hoverWeights;
    const k = this.cfg.hoverFade > 0 && dt > 0 ? 1 - Math.exp(-dt / this.cfg.hoverFade) : 1;
    for (let i = 0; i < w.length; i++) {
      const target = i === this.hoveredPointId ? 1 : 0;
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
      settleJitterAmp: this.morph ? 0 : this.cfg.settleJitter,
      background: this.cfg.background,
      plotRect: this.plotRect,
      grainFade: this.revealState(now).grainFade,
      viewScale: this.view.scale,
      viewOffset: this.view.offset,
      clipToPlot: this.pzCfg.enabled,
    };
  }

  private onPointerMove = (e: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / rect.width;
    const cy = 1 - (e.clientY - rect.top) / rect.height;
    const [x0, y0, x1, y1] = this.plotRect;
    const plx = (cx - x0) / (x1 - x0);
    const ply = (cy - y0) / (y1 - y0);
    const v = this.view;
    const lx = (plx - v.offset[0]) / v.scale[0];
    const ly = (ply - v.offset[1]) / v.scale[1];
    const hit = this.hitTest(lx, ly);
    const id = hit?.pointId ?? -1;
    this.pointerPx = {
      x: (e.clientX - rect.left) * this.dpr,
      y: (e.clientY - rect.top) * this.dpr,
    };
    if (id !== this.hoveredPointId) {
      this.hoveredPointId = id;
      this.hovered = hit;
      this.emitter.emit('hover', { point: hit });
    }
    if (this.overlay && this.chrome.currentValue.show) this.overlayDirty = true;
  };

  private onPointerLeave = (): void => {
    this.pointerPx = null;
    if (this.hoveredPointId !== -1) {
      this.hoveredPointId = -1;
      this.hovered = null;
      this.emitter.emit('hover', { point: null });
    }
    if (this.overlay && this.chrome.currentValue.show) this.overlayDirty = true;
  };

  /** Nearest-point hit-test in layout space (within a small radius). */
  private hitTest(lx: number, ly: number): ScatterMeta | null {
    const R = 0.03;
    let best: ScatterMeta | null = null;
    let bestD = R * R;
    for (const m of this.metas) {
      const dxp = m.cx - lx;
      const dyp = m.cy - ly;
      const d = dxp * dxp + dyp * dyp;
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return best;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerleave', this.onPointerLeave);
    this.ro?.disconnect();
    this.pz.detach();
    this.renderer?.dispose();
    this.emitter.clear();
    this.legend?.dispose();
    this.title?.dispose();
    this.fps?.dispose();
    this.zoomControls?.dispose();
    this.overlay?.dispose();
    this.overlayCanvas?.remove();
    this.canvas.remove();
  }
}
