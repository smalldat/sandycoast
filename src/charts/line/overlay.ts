import type { Scalar } from '../../core/data/types.js';
import type { RGBA } from '../../core/render/types.js';
import { cssRGBA } from '../../core/util/color.js';
import { type AxisModel, formatNumber } from '../bar/axis.js';
import type { ResolvedAxis, ResolvedChrome } from '../bar/chrome.js';
import type { SeriesPath } from './layout.js';
import type { ResolvedLineStyle } from './lineStyle.js';
import type { LineMeta } from './types.js';

/** Compact label for any scalar (number / date / string) used on axis markers. */
function scalarLabel(v: Scalar): string {
  if (typeof v === 'number') return formatNumber(v);
  if (v instanceof Date) return v.toLocaleDateString('en-US');
  return String(v);
}

/** Canvas2D font string for an axis's ticks/title, scaled to device px. */
function axisFont(cfg: ResolvedAxis, dpr: number): string {
  return `${cfg.fontWeight} ${cfg.fontPx * dpr}px ${cfg.fontFamily}`;
}

export interface OverlayState {
  /** Device-pixel canvas size. */
  deviceW: number;
  deviceH: number;
  dpr: number;
  /** Normalized plot rect [x0,y0,x1,y1], y-up (same one the grains use). */
  plotRect: [number, number, number, number];
  axes: AxisModel;
  chrome: ResolvedChrome;
  hoveredPoint: LineMeta | null;
  /** Pointer in device px (y-down), or null when outside. */
  pointer: { x: number; y: number } | null;
  /** Per-point metadata (line vertices) indexed by pointId. */
  metas: LineMeta[];
  /** Per-series polylines to stroke/fill. */
  paths: SeriesPath[];
  lineStyle: ResolvedLineStyle;
  /** Stacked area mode: fill from each point's stack floor with straight edges. */
  stacked: boolean;
  /** Reveal factor in [0,1]; scales line/fill opacity. */
  solid: number;
  /** Per-point hover weight in [0,1] (index = pointId); brightens the series. */
  hoverWeights: Float32Array;
  /** Color multiplier for a fully-hovered series (1 = highlight effect off). */
  highlightGain: number;
  /** Pan/zoom transform applied to layout coords (default identity). */
  viewScale?: [number, number];
  viewOffset?: [number, number];
  /** Clip plot-interior chrome (line/grid/ticks) to the plot rect (pan/zoom). */
  clipToPlot?: boolean;
}

/** `cssRGBA` with an rgb gain (channels multiplied, then clamped) baked in. */
function gainedRGBA(c: RGBA, gain: number, alpha: number): string {
  if (gain === 1) return cssRGBA(c, alpha);
  const g: RGBA = [
    Math.min(1, c[0] * gain),
    Math.min(1, c[1] * gain),
    Math.min(1, c[2] * gain),
    c[3],
  ];
  return cssRGBA(g, alpha);
}

function defaultFormat(p: LineMeta): string {
  const series = p.seriesKey !== undefined ? ` · ${String(p.seriesKey)}` : '';
  const x = typeof p.xValue === 'number' ? formatNumber(p.xValue) : String(p.xValue);
  return `${x}${series} = ${formatNumber(p.yValue)}`;
}

/**
 * Canvas2D overlay drawn on top of the grain canvas. Renders the solid line
 * (straight or spline) + optional area fill, plus axis spines, ticks, tick
 * labels, optional grid lines, and the current-value readout. Uses the same
 * `plotRect` as the grains so everything stays pixel-aligned.
 */
export class Overlay {
  private ctx: CanvasRenderingContext2D;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Overlay Canvas2D context unavailable');
    this.ctx = ctx;
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(s: OverlayState): void {
    const ctx = this.ctx;
    const { deviceW: W, deviceH: H, dpr } = s;
    ctx.clearRect(0, 0, W, H);
    if (!s.chrome.any && !s.lineStyle.enabled) return;

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

    // Solid line/fill first, so axes/ticks/current-value sit above it.
    if (s.lineStyle.enabled && s.solid > 0) {
      this.clip(s.clipToPlot, leftPx, topPx, rightPx - leftPx, bottomPx - topPx, () =>
        this.drawSeries(s, dx, dy, dpr),
      );
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

  /**
   * Solid area fill + connecting line for each series, opacity scaled by the
   * reveal factor `s.solid`. Colors are always the series color (only opacity is
   * configurable). Drawn under the axes/current-value so chrome stays legible.
   */
  private drawSeries(
    s: OverlayState,
    dx: (lx: number) => number,
    dy: (ly: number) => number,
    dpr: number,
  ): void {
    const ctx = this.ctx;
    const { fill, line } = s.lineStyle;
    const solid = s.solid;
    // Stacked bands must tile without gaps, so their edges are straight (a spline
    // top wouldn't meet the next band's straight floor). Plain areas keep spline.
    const spline = line.style === 'spline' && !s.stacked;

    for (const path of s.paths) {
      const pts = path.points.map((mi) => {
        const m = s.metas[mi]!;
        return { x: dx(m.pos), y: dy(m.height), base: dy(m.baseHeight) };
      });
      if (pts.length === 0) continue;
      // All of a series' points share the same eased weight; take the first.
      const w = s.hoverWeights[path.points[0]!] ?? 0;
      const gain = w > 0 ? 1 + (s.highlightGain - 1) * w : 1;

      if (fill.on) {
        ctx.beginPath();
        ctx.moveTo(pts[0]!.x, pts[0]!.base);
        ctx.lineTo(pts[0]!.x, pts[0]!.y);
        if (spline) strokeSplinePath(ctx, pts);
        else for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
        // Trace the stack floor back under the top edge (reversed) so the band
        // sits on the series below; for plain areas every base is the baseline.
        for (let i = pts.length - 1; i >= 0; i--) ctx.lineTo(pts[i]!.x, pts[i]!.base);
        ctx.closePath();
        ctx.fillStyle = gainedRGBA(path.color, gain, fill.opacity * solid);
        ctx.fill();
      }

      if (line.on && pts.length > 1) {
        ctx.beginPath();
        ctx.moveTo(pts[0]!.x, pts[0]!.y);
        if (spline) strokeSplinePath(ctx, pts);
        else for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i]!.x, pts[i]!.y);
        ctx.strokeStyle = gainedRGBA(path.color, gain, line.opacity * solid);
        ctx.lineWidth = line.width * dpr;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();
      }
    }
  }

  private drawYAxis(
    s: OverlayState,
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
    // Under pan/zoom, ticks slide along the axis: clip the band vertically so
    // ticks/labels/grid that scroll past the plot's top/bottom are hidden.
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
    s: OverlayState,
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

    // Clip the band horizontally so X ticks/labels/grid that scroll past the
    // plot's left/right edges are hidden under pan/zoom.
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
   * horizontally centered on `px`. Dark text over the axis color reads as a lit
   * tick at the cursor's row/column.
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
    s: OverlayState,
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
    const cx = dx(p.pos);
    const cy = dy(p.height);
    const onAxis = cfg.mode === 'axis';

    // Guide line(s) to the hovered vertex.
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

    // Marker dot at the hovered vertex whenever a guide is shown.
    if (cfg.guideY || cfg.guideX) {
      ctx.save();
      ctx.fillStyle = cssRGBA(p.color);
      ctx.beginPath();
      ctx.arc(cx, cy, 3 * dpr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Highlighted value markers on the axes.
    if (s.chrome.y.show && (onAxis || (cfg.markers && cfg.guideY))) {
      this.drawAxisMarker(leftPx, cy, formatNumber(p.yValue), 'y', cfg.color, dpr);
    }
    if (s.chrome.x.show && (onAxis || (cfg.markers && cfg.guideX))) {
      this.drawAxisMarker(cx, bottomPx, scalarLabel(p.xValue), 'x', cfg.color, dpr);
    }

    // In 'axis' mode the readout lives on the axes; skip the floating box.
    if (onAxis) return;

    // `currentValue.format` is shared with the bar chart (typed for BarMeta);
    // for a line chart it receives this vertex's LineMeta.
    const fmt = cfg.format as unknown as ((p: LineMeta) => string) | undefined;
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

/**
 * Append a smooth Catmull-Rom curve through `pts[1..]` to the current path
 * (assumes the path is already at `pts[0]`). Converts each Catmull-Rom span to
 * a cubic bézier, giving a natural spline with no external control points.
 */
function strokeSplinePath(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]): void {
  const n = pts.length;
  if (n < 2) return;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y);
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
