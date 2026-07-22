import { appendPoints, patchPoints, removePoints, seriesKeys } from '../../core/data/dataset.js';
import type { DataSet, Point, PointPatch, PointRef } from '../../core/data/types.js';
import { ease, scatterStarts } from '../../core/particles/anim.js';
import { type GrainBuffer, allocGrains } from '../../core/particles/grains.js';
import { lineGrainCounts, packLine } from '../../core/particles/pack.js';
import { mulberry32 } from '../../core/particles/rng.js';
import { pickRenderer } from '../../core/render/pick.js';
import type { FrameUniforms, RGBA, Renderer } from '../../core/render/types.js';
import { DEFAULT_PALETTE, parseColor } from '../../core/util/color.js';
import { Emitter } from '../../core/util/emitter.js';
// Reuse the bar chart's chrome infrastructure verbatim (axes/legend/margins/fps).
import { axisMargins, marginsToPlotRect, resolveChrome } from '../bar/chrome.js';
import type { ResolvedChrome } from '../bar/chrome.js';
import { FpsMeter, type ResolvedFps, resolveFps } from '../bar/fps.js';
import { Legend, type LegendEntry } from '../bar/legend.js';
import { type AxisModel, buildAxes } from './axis.js';
import { type LineLayout, layoutLine } from './layout.js';
import { type ResolvedLineStyle, resolveLineStyle, revealFactor } from './lineStyle.js';
import { Overlay } from './overlay.js';
import type { HoverPayload, LineChartConfig, LineMeta } from './types.js';

interface Resolved {
  grainDensity: number;
  maxGrains: number;
  lineThickness: number;
  palette: RGBA[];
  background: RGBA;
  grainSizePx: number;
  grainShape: 'quad' | 'disc';
  jitter: number;
  settleJitter: number;
  duration: number;
  ease: FrameUniforms['easing'];
  stagger: number;
  /** Transition window (line tween + grain fade) for update/add/remove, seconds. */
  morphDuration: number;
  reflow: 'translate' | 'reshuffle' | 'withLine';
  enter: 'pour' | 'rise' | 'continue';
  exit: 'fall' | 'vanish';
  hoverEffects: Set<'highlight' | 'jitter' | 'opacity'>;
  highlightGain: number;
  hoverJitterAmp: number;
  hoverOpacity: number;
  hoverFade: number;
}

function resolve(cfg: LineChartConfig): Resolved {
  const hover = cfg.interaction?.hover;
  const anim = cfg.animation;
  const duration = anim?.duration != null ? anim.duration / 1000 : 0.9;
  const stagger = anim?.stagger != null ? anim.stagger / 1000 : 0.5;
  return {
    grainDensity: cfg.grainDensity ?? 0.6,
    maxGrains: cfg.maxGrains ?? 100_000,
    lineThickness: cfg.lineThickness ?? 0.03,
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
  };
}

type Events = { hover: HoverPayload };

/** How grains enter on a data build: fresh pour vs. morph from the prior state. */
type BuildMode = 'pour' | 'morph';

/** A line vertex's animated position (layout space). */
interface PointBox {
  pos: number;
  height: number;
}

/** An in-flight line tween: interpolate `from → to` per vertex over `dur`. */
interface MorphTween {
  start: number;
  dur: number;
  from: PointBox[];
  to: PointBox[];
}

/** Data identity of a vertex (x + series), used to match points across a rebuild. */
function pointKey(xValue: unknown, seriesKey: unknown): string {
  return `${String(xValue)} ${String(seriesKey)}`;
}

/** Group grain indices by their `barId` (= left-point id), preserving order. */
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
 * Sand line chart. Mounts into an element, renders each series' line as animated
 * grains scattered along the path via the best available backend
 * (WebGPU → Canvas2D), and exposes hover events. Mirrors {@link BarChart}: same
 * config surface and lifecycle, with a line style (`none`/`straight`/`spline`)
 * in place of the bar border.
 */
export class LineChart {
  private el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private cfg: Resolved;
  private renderer: Renderer | null = null;
  private grains: GrainBuffer = allocGrains(0);
  private metas: LineMeta[] = [];
  /** Current dataset (source of truth for {@link update}/{@link add}/{@link remove}). */
  private data: DataSet = { points: [] };
  private emitter = new Emitter<Events>();

  /** Reveal timing regime: fresh pour vs. in-place morph (line stays solid). */
  private revealMode: BuildMode = 'pour';
  /** Active line tween, or null when settled. */
  private morph: MorphTween | null = null;

  private chrome: ResolvedChrome;
  private lineStyle: ResolvedLineStyle;
  /** Last drawn reveal factor; -1 forces the next overlay redraw. */
  private lastSolid = -1;
  private overlayCanvas: HTMLCanvasElement | null = null;
  private overlay: Overlay | null = null;
  private legend: Legend | null = null;
  private fpsCfg: ResolvedFps;
  private fps: FpsMeter | null = null;
  private layout: LineLayout | null = null;
  private axes: AxisModel = { x: [], y: [] };
  private plotRect: [number, number, number, number] = [0, 0, 1, 1];
  private hovered: LineMeta | null = null;
  private pointerPx: { x: number; y: number } | null = null;
  private raf = 0;
  private startTime = 0;
  private lastFrameMs = 0;
  private hoveredPointId = -1;
  /** Series index under the pointer, or -1. Hover highlights the whole series. */
  private hoveredSeriesIndex = -1;
  /** Per-point hover weight in [0,1], eased toward 1 for the hovered series. */
  private hoverWeights = new Float32Array(0);
  private dpr = 1;
  private ro: ResizeObserver | null = null;
  private disposed = false;
  private ready: Promise<void>;

  constructor(el: HTMLElement, config: LineChartConfig) {
    this.el = el;
    this.data = config.data;
    this.cfg = resolve(config);
    this.chrome = resolveChrome(config);
    this.lineStyle = resolveLineStyle(config);
    this.fpsCfg = resolveFps(config);
    this.canvas = document.createElement('canvas');
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    el.appendChild(this.canvas);

    if (this.chrome.any || this.lineStyle.enabled) this.mountChrome();
    if (this.fpsCfg.show) {
      this.ensureRelative();
      this.fps = new FpsMeter(this.el, this.fpsCfg.position, this.fpsCfg.color);
    }

    this.ready = this.boot(config.data, config.backend);
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

  private async boot(data: DataSet, backend: LineChartConfig['backend']): Promise<void> {
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

  private refreshChrome(data: DataSet): void {
    if (!this.chrome.any || !this.layout) return;
    this.axes = buildAxes(this.layout, this.chrome.x, this.chrome.y);
    if (this.legend) this.legend.setEntries(this.legendEntries(data));
    this.recomputePlotRect();
    this.drawOverlay();
  }

  private legendEntries(data: DataSet): LegendEntry[] {
    const keys = seriesKeys(data.points);
    return keys.map((k, i) => ({
      label: k === undefined ? `Series ${i + 1}` : String(k),
      color: this.cfg.palette[i % this.cfg.palette.length]!,
    }));
  }

  private recomputePlotRect(): void {
    if (!this.chrome.any) {
      this.plotRect = [0, 0, 1, 1];
      return;
    }
    const m = axisMargins(this.chrome);
    if (this.legend && this.chrome.legend.show) {
      m[this.chrome.legend.position] += this.legend.measure() + 6;
    }
    this.plotRect = marginsToPlotRect(m, this.canvas.width, this.canvas.height, this.dpr);
  }

  private drawOverlay(now = this.nowSeconds()): void {
    if (!this.overlay || !this.overlayCanvas || !this.layout) return;
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
      paths: this.layout.paths,
      lineStyle: this.lineStyle,
      solid,
      hoverWeights: this.hoverWeights,
      highlightGain: this.cfg.hoverEffects.has('highlight') ? this.cfg.highlightGain : 1,
    });
  }

  /**
   * Whether the solid layer should keep redrawing for hover: the highlight
   * effect is on, the line/fill is solid, and some point's weight is still
   * non-zero (hovered series or easing out).
   */
  private solidHoverActive(): boolean {
    if (!this.lineStyle.enabled || !this.cfg.hoverEffects.has('highlight')) return false;
    if (this.hoveredSeriesIndex !== -1) return true;
    for (let i = 0; i < this.hoverWeights.length; i++)
      if (this.hoverWeights[i]! > 0.001) return true;
    return false;
  }

  private nowSeconds(): number {
    return (performance.now() - this.startTime) / 1000;
  }

  /** Reveal state at `now` (seconds): grain fade-out + line/fill fade-in. */
  private revealState(now: number): { grainFade: number; solid: number } {
    const r = this.lineStyle;
    if (!r.enabled) return { grainFade: 1, solid: 0 };
    if (this.revealMode === 'morph') {
      if (!this.morph || this.cfg.reflow === 'withLine') {
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
   * Advance the active line tween: write the eased `from → to` position into
   * each `meta` so overlay draw, hit-test, and current-value all use the tweened
   * geometry. Snaps to `to` and clears the tween once complete.
   */
  private applyMorph(now: number): boolean {
    const mo = this.morph;
    if (!mo) return false;
    const p = mo.dur > 0 ? (now - mo.start) / mo.dur : 1;
    const done = p >= 1;
    const e = done ? 1 : ease(clamp01(p), this.lineStyle.reveal.ease);
    const n = Math.min(this.metas.length, mo.from.length, mo.to.length);
    for (let i = 0; i < n; i++) {
      const f = mo.from[i]!;
      const t = mo.to[i]!;
      const m = this.metas[i]!;
      m.pos = f.pos + (t.pos - f.pos) * e;
      m.height = f.height + (t.height - f.height) * e;
    }
    if (done) this.morph = null;
    return !done;
  }

  /**
   * Build the grain buffer from `data`. `'pour'` scatters grains from above
   * (fresh pour-in + reveal ramp); `'morph'` flows grains from the prior state
   * by data identity and arms a line tween so the solid layer changes smoothly.
   */
  private buildGrains(data: DataSet, mode: BuildMode): void {
    const prevGrains = this.grains;
    const prevMetas = this.metas;

    const layout = layoutLine(data, this.cfg.palette);
    const { segs, metas } = layout;
    this.layout = layout;
    this.metas = metas;
    this.data = data;

    const weights = new Float32Array(metas.length);
    weights.set(this.hoverWeights.subarray(0, Math.min(metas.length, this.hoverWeights.length)));
    this.hoverWeights = weights;

    const counts = lineGrainCounts(segs, {
      density: this.cfg.grainDensity,
      maxGrains: this.cfg.maxGrains,
      thickness: this.cfg.lineThickness,
    });
    const total = counts.reduce((a, b) => a + b, 0);

    const canMorph = mode === 'morph' && prevGrains.count > 0 && prevMetas.length > 0;

    let oldGrainsByPoint: Map<number, number[]> | null = null;
    let oldPoolByKey: Map<string, number[]> | null = null;
    const ghostPoints: number[] = [];
    let ghostTotal = 0;
    if (canMorph) {
      oldGrainsByPoint = groupGrainsByPoint(prevGrains);
      oldPoolByKey = new Map();
      for (const m of prevMetas) {
        const list = oldGrainsByPoint.get(m.pointId);
        if (list) oldPoolByKey.set(pointKey(m.xValue, m.seriesKey), list);
      }
      if (this.cfg.exit === 'fall') {
        const newKeys = new Set(metas.map((m) => pointKey(m.xValue, m.seriesKey)));
        for (const m of prevMetas) {
          if (newKeys.has(pointKey(m.xValue, m.seriesKey))) continue;
          const list = oldGrainsByPoint.get(m.pointId);
          if (list && list.length > 0) {
            ghostPoints.push(m.pointId);
            ghostTotal += list.length;
          }
        }
      }
    }

    const g = allocGrains(total + ghostTotal);
    packLine(segs, counts, g, {
      density: this.cfg.grainDensity,
      thickness: this.cfg.lineThickness,
      jitter: this.cfg.jitter,
      seed: 1,
    });

    if (!canMorph) {
      scatterStarts(g, { duration: this.cfg.duration, stagger: this.cfg.stagger, seed: 7 });
      this.morph = null;
    } else {
      this.morphGrainStarts(g, segs, metas, counts, prevGrains, oldPoolByKey!);
      if (ghostPoints.length > 0) {
        this.appendGhosts(g, total, ghostPoints, prevGrains, oldGrainsByPoint!);
      }
      this.armLineTween(metas, prevMetas);
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
   * Assign morph starts per segment (grains are packed in segment order, so
   * `counts` gives each segment's contiguous grain range):
   *
   * - **existing segment** — map grain *k* to old grain *k* (`translate`, a
   *   smooth slide) or a random old grain (`reshuffle`);
   * - **new segment** — enter from above (`pour`) or up from the base (`rise`).
   */
  private morphGrainStarts(
    g: GrainBuffer,
    segs: LineLayout['segs'],
    metas: LineMeta[],
    counts: number[],
    prevGrains: GrainBuffer,
    oldPoolByKey: Map<string, number[]>,
  ): void {
    const rng = mulberry32(9);
    let off = 0;
    for (let si = 0; si < segs.length; si++) {
      const cnt = counts[si]!;
      if (cnt <= 0) continue;
      const seg = segs[si]!;
      const m = metas[seg.pointId]!;
      const pool = oldPoolByKey.get(pointKey(m.xValue, m.seriesKey));
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
          g.delay[i] = this.cfg.reflow === 'withLine' ? 0 : pourDelay(i);
        } else if (this.cfg.enter === 'continue') {
          // No emergence: land the grain settled at its target so the line just
          // extends to the new value. Negative delay => te>=1 at now=0 (no move,
          // no settle wobble).
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
   * Append the removed points' old grains as ghosts at `[offset, …)`: they start
   * where they were and fall off the bottom (`targetY < 0`), fading with the
   * global grain-fade. `barId = 0` is a safe hover index; ghosts have no meta so
   * they are never hit-tested, and are dropped on the next rebuild.
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
   * Arm a line tween from the old per-vertex positions (matched by identity) to
   * the new ones. Vertices with no predecessor grow from the baseline (height 0)
   * at their final x. Only meaningful when the solid layer is enabled.
   */
  private armLineTween(metas: LineMeta[], prevMetas: LineMeta[]): void {
    if (!this.lineStyle.enabled) {
      this.morph = null;
      return;
    }
    const oldByKey = new Map<string, PointBox>();
    for (const m of prevMetas) {
      oldByKey.set(pointKey(m.xValue, m.seriesKey), { pos: m.pos, height: m.height });
    }
    const from: PointBox[] = [];
    const to: PointBox[] = [];
    for (const m of metas) {
      to.push({ pos: m.pos, height: m.height });
      const old = oldByKey.get(pointKey(m.xValue, m.seriesKey));
      // New vertices normally grow from the baseline; 'continue' skips that and
      // seats them at their value so the line just extends to it.
      const fresh =
        this.cfg.enter === 'continue'
          ? { pos: m.pos, height: m.height }
          : { pos: m.pos, height: 0 };
      from.push(old ?? fresh);
    }
    this.morph = { start: 0, dur: this.cfg.morphDuration, from, to };
  }

  /**
   * Replace the whole dataset (grains morph to the new targets), or — given an
   * array of {@link PointPatch} — set `y` on existing points in place. Either
   * way the solid line/fill tween smoothly rather than re-pouring.
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

  /** Append one or more points; new vertices grow in and their grains pour from above. */
  add(points: Point | Point[]): void {
    if (this.disposed) return;
    const add = Array.isArray(points) ? points : [points];
    this.buildGrains({ ...this.data, points: appendPoints(this.data.points, add) }, 'morph');
  }

  /** Remove points by index (negative = from end) or `{x, z?}` match; line reflows. */
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

  private loop = (): void => {
    if (this.disposed || !this.renderer) return;
    const nowMs = performance.now();
    const dt = this.lastFrameMs ? (nowMs - this.lastFrameMs) / 1000 : 0;
    this.lastFrameMs = nowMs;
    this.fps?.sample(dt, nowMs);
    this.easeHoverWeights(dt);
    const now = (nowMs - this.startTime) / 1000;
    this.renderer.frame(this.uniforms(now));
    if (this.lineStyle.enabled) {
      if (this.morph) {
        this.applyMorph(now);
        this.drawOverlay(now);
      } else {
        const solid = this.revealState(now).solid;
        if (solid !== this.lastSolid || this.solidHoverActive()) this.drawOverlay(now);
      }
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  // Ease each point's hover weight toward its target. Unlike the bar chart —
  // where only the hovered bar lifts — every grain of the hovered *series*
  // targets 1, so hovering a line animates the whole line.
  private easeHoverWeights(dt: number): void {
    const w = this.hoverWeights;
    const k = this.cfg.hoverFade > 0 && dt > 0 ? 1 - Math.exp(-dt / this.cfg.hoverFade) : 1;
    for (let i = 0; i < w.length; i++) {
      const target = this.metas[i]?.seriesIndex === this.hoveredSeriesIndex ? 1 : 0;
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
      // Suppress the settle wobble while morphing: each rebuild resets the move
      // clock, which would otherwise re-spike the wobble for every grain and
      // read as glitter during continuous updates. Full amplitude when idle.
      settleJitterAmp: this.morph ? 0 : this.cfg.settleJitter,
      background: this.cfg.background,
      plotRect: this.plotRect,
      grainFade: this.revealState(now).grainFade,
    };
  }

  private onPointerMove = (e: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / rect.width;
    const cy = 1 - (e.clientY - rect.top) / rect.height;
    const [x0, y0, x1, y1] = this.plotRect;
    const lx = (cx - x0) / (x1 - x0);
    const ly = (cy - y0) / (y1 - y0);
    const hit = this.hitTest(lx, ly);
    const id = hit?.pointId ?? -1;
    this.pointerPx = {
      x: (e.clientX - rect.left) * this.dpr,
      y: (e.clientY - rect.top) * this.dpr,
    };
    this.hoveredSeriesIndex = hit?.seriesIndex ?? -1;
    if (id !== this.hoveredPointId) {
      this.hoveredPointId = id;
      this.hovered = hit;
      this.emitter.emit('hover', { point: hit });
    }
    if (this.overlay && this.chrome.currentValue.show) this.drawOverlay();
  };

  private onPointerLeave = (): void => {
    this.pointerPx = null;
    this.hoveredSeriesIndex = -1;
    if (this.hoveredPointId !== -1) {
      this.hoveredPointId = -1;
      this.hovered = null;
      this.emitter.emit('hover', { point: null });
    }
    if (this.overlay && this.chrome.currentValue.show) this.drawOverlay();
  };

  /** Nearest-vertex hit-test in layout space (within a small radius). */
  private hitTest(lx: number, ly: number): LineMeta | null {
    let best: LineMeta | null = null;
    let bestD = 0.05 * 0.05; // squared radius threshold
    for (const m of this.metas) {
      const dxp = m.pos - lx;
      const dyp = m.height - ly;
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
    this.renderer?.dispose();
    this.emitter.clear();
    this.legend?.dispose();
    this.fps?.dispose();
    this.overlayCanvas?.remove();
    this.canvas.remove();
  }
}
