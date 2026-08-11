import type { ResolvedAxis, ResolvedChrome } from '../../core/chrome/chrome.js';
import { formatNumber } from '../../core/chrome/format.js';
import type { RGBA } from '../../core/render/types.js';
import { cssRGBA } from '../../core/util/color.js';
import {
  type ApproximationPath,
  type ResolvedApproximation,
  computeApproximationPaths,
} from './approximation.js';
import type { AxisModel } from './axis.js';
import { type ResolvedMarkerStyle, shapeForSeries, sizeForSeries } from './markerStyle.js';
import type { MarkerShape, ScatterMeta } from './types.js';

/** Slices below this hover weight are close enough to un-hovered to skip. */
const HOVER_EPSILON = 0.001;

function defaultFormat(p: ScatterMeta): string {
  const series = p.seriesKey !== undefined ? ` · ${String(p.seriesKey)}` : '';
  const x = typeof p.xValue === 'number' ? formatNumber(p.xValue) : String(p.xValue);
  const y = typeof p.yValue === 'number' ? formatNumber(p.yValue) : String(p.yValue);
  return `(${x}, ${y})${series}`;
}

function axisFont(cfg: ResolvedAxis, dpr: number): string {
  return `${cfg.fontWeight} ${cfg.fontPx * dpr}px ${cfg.fontFamily}`;
}

/** `RGBA` with an rgb gain (channels multiplied, then clamped) baked in. */
function gainedRGBA(c: RGBA, gain: number): RGBA {
  if (gain === 1) return c;
  return [Math.min(1, c[0] * gain), Math.min(1, c[1] * gain), Math.min(1, c[2] * gain), c[3]];
}

/**
 * Build one marker glyph's outline centered on the origin, `sizePx` wide/tall
 * (device px). `circle`/`square`/`triangle` are closed shapes meant to be
 * filled; `asterisk` is open strokes.
 */
function buildGlyphPath(shape: MarkerShape, sizePx: number): Path2D {
  const p = new Path2D();
  const r = sizePx / 2;
  switch (shape) {
    case 'circle':
      p.arc(0, 0, r, 0, Math.PI * 2);
      break;
    case 'square':
      p.rect(-r, -r, sizePx, sizePx);
      break;
    case 'triangle':
      // Equilateral triangle inscribed in the bounding circle, point up.
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) p.moveTo(x, y);
        else p.lineTo(x, y);
      }
      p.closePath();
      break;
    case 'asterisk': {
      // 3 diameters through the center = 6 ray tips.
      const lines = 3;
      for (let i = 0; i < lines; i++) {
        const a = (i * Math.PI) / lines;
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        p.moveTo(-x, -y);
        p.lineTo(x, y);
      }
      break;
    }
  }
  return p;
}

export interface ScatterOverlayState {
  /** Device-pixel canvas size. */
  deviceW: number;
  deviceH: number;
  dpr: number;
  /** Normalized plot rect [x0,y0,x1,y1], y-up (same one the grains use). */
  plotRect: [number, number, number, number];
  axes: AxisModel;
  chrome: ResolvedChrome;
  hoveredPoint: ScatterMeta | null;
  /** Pointer in device px (y-down), or null when outside. */
  pointer: { x: number; y: number } | null;
  /** Per-point metadata, indexed by pointId. */
  metas: ScatterMeta[];
  markerStyle: ResolvedMarkerStyle;
  approx: ResolvedApproximation;
  /** Reveal factor in [0,1]; scales marker/approximation opacity. */
  solid: number;
  /** Per-point hover weight in [0,1] (index = pointId). */
  hoverWeights: Float32Array;
  /** Color multiplier for a fully-hovered point (1 = highlight effect off). */
  highlightGain: number;
  /** Per-point dim weight in [0,1] (index = pointId); dims non-focused series. */
  dimWeights: Float32Array;
  /** Alpha multiplier for a fully-dimmed series (1 = no dim). */
  dimOpacity: number;
  /** Pan/zoom transform applied to layout coords (default identity). */
  viewScale?: [number, number];
  viewOffset?: [number, number];
  /** Clip plot-interior chrome (markers/approx/grid/ticks) to the plot rect. */
  clipToPlot?: boolean;
  /**
   * Bumped by the chart whenever point geometry changes (data rebuild, morph
   * tick). Keys the cached approximation fit — see {@link Overlay.approximationPaths}.
   */
  geomVersion: number;
}

/**
 * Canvas2D overlay drawn on top of the grain canvas. Renders solid marker
 * glyphs (cached `Path2D` per shape/size pair, per §4c), the approximation
 * trend/connector line, axis spines/ticks/labels, and the current-value
 * readout. Uses the same `plotRect` as the grains so everything stays
 * pixel-aligned.
 */
export class Overlay {
  private ctx: CanvasRenderingContext2D;
  /** Marker outlines, cached per (shape, device-px size) pair — never rebuilt per point per frame. */
  private glyphs = new Map<string, Path2D>();
  /** Fitted approximation paths, recomputed only when the geometry changes. */
  private approxCache: { key: number; paths: ApproximationPath[] } | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Overlay Canvas2D context unavailable');
    this.ctx = ctx;
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  dispose(): void {
    this.glyphs.clear();
    this.approxCache = null;
  }

  draw(s: ScatterOverlayState): void {
    const ctx = this.ctx;
    const { deviceW: W, deviceH: H, dpr } = s;
    ctx.clearRect(0, 0, W, H);
    if (!s.chrome.any && !s.markerStyle.enabled && !s.approx.enabled) return;

    const [x0, y0, x1, y1] = s.plotRect;
    const leftPx = x0 * W;
    const rightPx = x1 * W;
    const bottomPx = (1 - y0) * H; // layout y=0
    const topPx = (1 - y1) * H; // layout y=1

    // Pan/zoom transform, then layout (lx,ly) -> device px.
    const vsx = s.viewScale?.[0] ?? 1;
    const vsy = s.viewScale?.[1] ?? 1;
    const vox = s.viewOffset?.[0] ?? 0;
    const voy = s.viewOffset?.[1] ?? 0;
    const dx = (lx: number): number => (x0 + (lx * vsx + vox) * (x1 - x0)) * W;
    const dy = (ly: number): number => (1 - (y0 + (ly * vsy + voy) * (y1 - y0))) * H;

    // Solid layer first, so axes/ticks/current-value sit above it.
    if ((s.approx.enabled || s.markerStyle.enabled) && s.solid > 0) {
      this.clip(s.clipToPlot, leftPx, topPx, rightPx - leftPx, bottomPx - topPx, () => {
        if (s.approx.enabled) this.drawApproximation(s, dx, dy, dpr);
        if (s.markerStyle.enabled) this.drawMarkers(s, dx, dy, dpr);
      });
    }
    if (!s.chrome.any) return;

    this.drawYAxis(s, leftPx, rightPx, topPx, bottomPx, dy, dpr);
    this.drawXAxis(s, leftPx, rightPx, topPx, bottomPx, dx, dy, dpr);
    if (s.chrome.currentValue.show && s.hoveredPoint) {
      this.drawCurrentValue(s, leftPx, rightPx, topPx, bottomPx, dx, dy, dpr);
    }
  }

  /** Run `fn` with the canvas clipped to `[x,y,w,h]` when `on`; else run as-is. */
  private clip(
    on: boolean | undefined,
    x: number,
    y: number,
    w: number,
    h: number,
    fn: () => void,
  ): void {
    if (!on) {
      fn();
      return;
    }
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    fn();
    ctx.restore();
  }

  private glyphPath(shape: MarkerShape, sizePx: number): Path2D {
    const key = `${shape}:${sizePx}`;
    let p = this.glyphs.get(key);
    if (!p) {
      p = buildGlyphPath(shape, sizePx);
      this.glyphs.set(key, p);
    }
    return p;
  }

  private drawMarkers(
    s: ScatterOverlayState,
    dx: (lx: number) => number,
    dy: (ly: number) => number,
    dpr: number,
  ): void {
    const ctx = this.ctx;
    const style = s.markerStyle;
    for (const m of s.metas) {
      const w = s.hoverWeights[m.pointId] ?? 0;
      const gain = w > HOVER_EPSILON ? 1 + (s.highlightGain - 1) * w : 1;
      const dw = s.dimWeights[m.pointId] ?? 0;
      const dimMul = dw > HOVER_EPSILON ? 1 + (s.dimOpacity - 1) * dw : 1;
      const shape = shapeForSeries(style, m.seriesIndex);
      const sizePx = sizeForSeries(style, m.seriesIndex) * dpr;
      const path = this.glyphPath(shape, sizePx);
      const color = gainedRGBA(m.color, gain);
      const alpha = style.opacity * s.solid * dimMul;

      ctx.save();
      ctx.translate(dx(m.cx), dy(m.cy));
      if (shape === 'asterisk') {
        ctx.strokeStyle = cssRGBA(color, alpha);
        ctx.lineWidth = Math.max(1, sizePx * 0.18);
        ctx.lineCap = 'round';
        ctx.stroke(path);
      } else {
        ctx.fillStyle = cssRGBA(color, alpha);
        ctx.fill(path);
      }
      ctx.restore();
    }
  }

  /**
   * The current fitted approximation path per series, recomputed only when
   * `geomVersion` changes (rebuild or morph tick) — not on every hover repaint.
   */
  private approximationPaths(s: ScatterOverlayState): ApproximationPath[] {
    if (this.approxCache && this.approxCache.key === s.geomVersion) return this.approxCache.paths;
    const paths = computeApproximationPaths(s.metas, s.approx.strategy);
    this.approxCache = { key: s.geomVersion, paths };
    return paths;
  }

  private drawApproximation(
    s: ScatterOverlayState,
    dx: (lx: number) => number,
    dy: (ly: number) => number,
    dpr: number,
  ): void {
    const ctx = this.ctx;
    // Approximation paths are cached per series (recomputed only on geometry
    // change, not every frame), so the per-frame-eased dim weight can't live on
    // the path itself — look it up per series from a representative point's
    // weight instead (every point of a series shares the same eased target).
    const dimBySeries = new Map<number, number>();
    for (const m of s.metas) {
      if (!dimBySeries.has(m.seriesIndex)) {
        dimBySeries.set(m.seriesIndex, s.dimWeights[m.pointId] ?? 0);
      }
    }
    for (const path of this.approximationPaths(s)) {
      if (path.points.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(dx(path.points[0]!.x), dy(path.points[0]!.y));
      for (let i = 1; i < path.points.length; i++) {
        ctx.lineTo(dx(path.points[i]!.x), dy(path.points[i]!.y));
      }
      const dw = dimBySeries.get(path.seriesIndex) ?? 0;
      const dimMul = dw > HOVER_EPSILON ? 1 + (s.dimOpacity - 1) * dw : 1;
      ctx.globalAlpha = s.solid * s.approx.opacity * dimMul;
      ctx.strokeStyle = s.approx.color ?? cssRGBA(path.color);
      ctx.lineWidth = s.approx.width * dpr;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private drawYAxis(
    s: ScatterOverlayState,
    leftPx: number,
    rightPx: number,
    topPx: number,
    bottomPx: number,
    dy: (ly: number) => number,
    dpr: number,
  ): void {
    const cfg = s.chrome.y;
    if (!cfg.show) return;
    const ctx = this.ctx;
    const tick = 5 * dpr;

    ctx.strokeStyle = cfg.color;
    ctx.fillStyle = cfg.color;
    ctx.lineWidth = dpr;
    ctx.font = axisFont(cfg, dpr);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';

    let spineTop = bottomPx;
    for (const t of s.axes.y) {
      const py = dy(t.pos);
      if (py < spineTop) spineTop = py;
    }
    if (s.axes.y.length === 0) spineTop = topPx;
    ctx.beginPath();
    ctx.moveTo(leftPx, spineTop);
    ctx.lineTo(leftPx, bottomPx);
    ctx.stroke();

    let maxLabelW = 0;
    this.clip(s.clipToPlot, 0, topPx, rightPx, bottomPx - topPx, () => {
      for (const t of s.axes.y) {
        const py = dy(t.pos);
        if (cfg.gridLines) {
          ctx.save();
          ctx.globalAlpha = 0.4;
          ctx.beginPath();
          ctx.moveTo(leftPx, py);
          ctx.lineTo(rightPx, py);
          ctx.stroke();
          ctx.restore();
        }
        ctx.beginPath();
        ctx.moveTo(leftPx - tick, py);
        ctx.lineTo(leftPx, py);
        ctx.stroke();
        ctx.fillText(t.label, leftPx - tick - 4 * dpr, py);
        const w = ctx.measureText(t.label).width;
        if (w > maxLabelW) maxLabelW = w;
      }
    });

    if (cfg.label) {
      const titleX = leftPx - tick - 4 * dpr - maxLabelW - 6 * dpr - (cfg.fontPx * dpr) / 2;
      ctx.save();
      ctx.translate(titleX, (topPx + bottomPx) / 2);
      ctx.rotate(cfg.titleDirection === 'down' ? Math.PI / 2 : -Math.PI / 2);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(cfg.label, 0, 0);
      ctx.restore();
    }
  }

  private drawXAxis(
    s: ScatterOverlayState,
    leftPx: number,
    rightPx: number,
    topPx: number,
    bottomPx: number,
    dx: (lx: number) => number,
    dy: (ly: number) => number,
    dpr: number,
  ): void {
    const cfg = s.chrome.x;
    if (!cfg.show) return;
    const ctx = this.ctx;
    const tick = 5 * dpr;

    let gridTop = s.axes.y.length ? bottomPx : topPx;
    for (const t of s.axes.y) {
      const py = dy(t.pos);
      if (py < gridTop) gridTop = py;
    }

    ctx.strokeStyle = cfg.color;
    ctx.fillStyle = cfg.color;
    ctx.lineWidth = dpr;
    ctx.font = axisFont(cfg, dpr);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    ctx.beginPath();
    ctx.moveTo(leftPx, bottomPx);
    ctx.lineTo(rightPx, bottomPx);
    ctx.stroke();

    this.clip(s.clipToPlot, leftPx, 0, rightPx - leftPx, s.deviceH, () => {
      for (const t of s.axes.x) {
        const px = dx(t.pos);
        if (cfg.gridLines) {
          ctx.save();
          ctx.globalAlpha = 0.4;
          ctx.beginPath();
          ctx.moveTo(px, bottomPx);
          ctx.lineTo(px, gridTop);
          ctx.stroke();
          ctx.restore();
        }
        ctx.beginPath();
        ctx.moveTo(px, bottomPx);
        ctx.lineTo(px, bottomPx + tick);
        ctx.stroke();
        ctx.fillText(t.label, px, bottomPx + tick + 3 * dpr);
      }
    });

    if (cfg.label) {
      ctx.textBaseline = 'top';
      const ly = bottomPx + tick + 3 * dpr + cfg.fontPx * dpr + 4 * dpr;
      ctx.fillText(cfg.label, (leftPx + rightPx) / 2, ly);
    }
  }

  /**
   * A filled highlight label pinned to an axis: `'y'` sits just left of the value
   * axis, vertically centered on `py`; `'x'` sits just below the X axis,
   * horizontally centered on `px`.
   */
  private drawAxisMarker(
    px: number,
    py: number,
    text: string,
    axis: 'x' | 'y',
    color: string,
    dpr: number,
  ): void {
    const ctx = this.ctx;
    const fontPx = 11 * dpr;
    ctx.save();
    ctx.font = `${fontPx}px system-ui, sans-serif`;
    const padX = 5 * dpr;
    const padY = 3 * dpr;
    const bw = ctx.measureText(text).width + padX * 2;
    const bh = fontPx + padY * 2;
    const bx = axis === 'y' ? px - bw - 6 * dpr : px - bw / 2;
    const by = axis === 'y' ? py - bh / 2 : py + 6 * dpr;
    ctx.fillStyle = color;
    roundRect(ctx, bx, by, bw, bh, 3 * dpr);
    ctx.fill();
    ctx.fillStyle = 'rgba(16,20,28,0.95)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + bw / 2, by + bh / 2);
    ctx.restore();
  }

  private drawCurrentValue(
    s: ScatterOverlayState,
    leftPx: number,
    rightPx: number,
    topPx: number,
    bottomPx: number,
    dx: (lx: number) => number,
    dy: (ly: number) => number,
    dpr: number,
  ): void {
    const cfg = s.chrome.currentValue;
    const p = s.hoveredPoint!;
    const ctx = this.ctx;
    const cx = dx(p.cx);
    const cy = dy(p.cy);
    const onAxis = cfg.mode === 'axis';

    if (cfg.guideY || cfg.guideX) {
      ctx.save();
      ctx.strokeStyle = cfg.color;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = dpr;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      if (cfg.guideY) {
        ctx.beginPath();
        ctx.moveTo(leftPx, cy);
        ctx.lineTo(cx, cy);
        ctx.stroke();
      }
      if (cfg.guideX) {
        ctx.beginPath();
        ctx.moveTo(cx, bottomPx);
        ctx.lineTo(cx, cy);
        ctx.stroke();
      }
      ctx.restore();
    }

    if (cfg.guideY || cfg.guideX) {
      ctx.save();
      ctx.fillStyle = cssRGBA(p.color);
      ctx.beginPath();
      ctx.arc(cx, cy, 3 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (s.chrome.y.show && (onAxis || (cfg.markers && cfg.guideY))) {
      const yLabel = typeof p.yValue === 'number' ? formatNumber(p.yValue) : String(p.yValue);
      this.drawAxisMarker(leftPx, cy, yLabel, 'y', cfg.color, dpr);
    }
    if (s.chrome.x.show && (onAxis || (cfg.markers && cfg.guideX))) {
      const xLabel = typeof p.xValue === 'number' ? formatNumber(p.xValue) : String(p.xValue);
      this.drawAxisMarker(cx, bottomPx, xLabel, 'x', cfg.color, dpr);
    }

    if (onAxis) return;

    // `currentValue.format` is shared with the bar chart (typed for BarMeta);
    // for a scatter chart it receives this point's ScatterMeta.
    const fmt = cfg.format as unknown as ((p: ScatterMeta) => string) | undefined;
    const text = (fmt ?? defaultFormat)(p);
    const fontPx = 12 * dpr;
    ctx.font = `${fontPx}px system-ui, sans-serif`;
    const padX = 6 * dpr;
    const padY = 4 * dpr;
    const tw = ctx.measureText(text).width;
    const bw = tw + padX * 2;
    const bh = fontPx + padY * 2;

    let ax: number;
    let ay: number;
    if (cfg.mode === 'pointer' && s.pointer) {
      ax = s.pointer.x + 12 * dpr;
      ay = s.pointer.y - bh - 8 * dpr;
    } else if (cfg.mode === 'pointer') {
      ax = cx - bw / 2;
      ay = cy - bh - 6 * dpr;
    } else {
      switch (cfg.mode) {
        case 'top':
          ax = (leftPx + rightPx) / 2 - bw / 2;
          ay = topPx + 2 * dpr;
          break;
        case 'bottom':
          ax = (leftPx + rightPx) / 2 - bw / 2;
          ay = bottomPx - bh - 2 * dpr;
          break;
        case 'left':
          ax = leftPx + 4 * dpr;
          ay = topPx + 2 * dpr;
          break;
        default: // right
          ax = rightPx - bw - 4 * dpr;
          ay = topPx + 2 * dpr;
          break;
      }
    }
    ax = Math.max(leftPx, Math.min(ax, rightPx - bw));
    ay = Math.max(topPx, Math.min(ay, bottomPx - bh));

    ctx.save();
    ctx.fillStyle = 'rgba(16,20,28,0.92)';
    ctx.strokeStyle = cfg.color;
    ctx.lineWidth = dpr;
    roundRect(ctx, ax, ay, bw, bh, 4 * dpr);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = cfg.color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, ax + padX, ay + bh / 2);
    ctx.restore();
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
