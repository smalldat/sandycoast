import type { ResolvedAxis, ResolvedChrome } from '../../core/chrome/chrome.js';
import { type AxisTick, formatNumber } from '../../core/chrome/format.js';
import { type ResolvedSlider, drawSlider } from '../../core/chrome/slider.js';
import type { RGBA } from '../../core/render/types.js';
import { cssRGBA } from '../../core/util/color.js';
import type { AxisModel } from './axis.js';
import type { ResolvedActual, ResolvedCandleStyle } from './candleStyle.js';
import type { CandleMeta } from './types.js';

/** Candles below this hover weight are close enough to un-hovered to skip. */
const HOVER_EPSILON = 0.001;

function defaultFormat(c: CandleMeta): string {
  const n = (v: number): string => formatNumber(v);
  const live = c.actual !== undefined ? ` · live ${n(c.actual)}` : '';
  return `${String(c.xValue)} · O ${n(c.open)} H ${n(c.high)} L ${n(c.low)} C ${n(c.close)}${live}`;
}

function axisFont(cfg: ResolvedAxis, dpr: number): string {
  return `${cfg.fontWeight} ${cfg.fontPx * dpr}px ${cfg.fontFamily}`;
}

/** `RGBA` with an rgb gain (channels multiplied, then clamped) baked in. */
function gainedRGBA(c: RGBA, gain: number): RGBA {
  if (gain === 1) return c;
  return [Math.min(1, c[0] * gain), Math.min(1, c[1] * gain), Math.min(1, c[2] * gain), c[3]];
}

export interface CandleOverlayState {
  /** Device-pixel canvas size. */
  deviceW: number;
  deviceH: number;
  dpr: number;
  /** Normalized plot rect [x0,y0,x1,y1], y-up (same one the grains use). */
  plotRect: [number, number, number, number];
  axes: AxisModel;
  chrome: ResolvedChrome;
  /** Per-candle metadata, indexed by candleId. */
  metas: CandleMeta[];
  style: ResolvedCandleStyle;
  actual: ResolvedActual;
  /** Live price and its layout-space y, or undefined when the series has none. */
  actualValue: number | undefined;
  actualPos: number | undefined;
  /** Reveal factor in [0,1]; scales the solid body's fill/border opacity. */
  solid: number;
  /** Per-candle hover weight in [0,1] (index = candleId). */
  hoverWeights: Float32Array;
  /** Color multiplier for a fully-hovered candle (1 = highlight effect off). */
  highlightGain: number;
  /** Per-candle dim weight in [0,1] (index = candleId). */
  dimWeights: Float32Array;
  /** Alpha multiplier for a fully-dimmed candle (1 = no dim). */
  dimOpacity: number;
  hoveredCandle: CandleMeta | null;
  /** Pointer in device px (y-down), or null when outside. */
  pointer: { x: number; y: number } | null;
  slider: ResolvedSlider;
  sliderTicks: AxisTick[];
  /** Handle position along the track, 0..1 (animated, so not always on a tick). */
  sliderPos: number;
  /** Whether the slider has anything to select (more than one series). */
  sliderActive: boolean;
  /** Gutter already used on the slider's edge (the period axis), device px. */
  sliderOffsetPx: number;
  /** Pan/zoom transform applied to layout coords (default identity). */
  viewScale?: [number, number];
  viewOffset?: [number, number];
  /** Clip plot-interior chrome (candles/grid/ticks) to the plot rect. */
  clipToPlot?: boolean;
}

/**
 * Canvas2D overlay drawn on top of the grain canvas: the solid candle bodies,
 * the high-low wicks, the live-price line, the axes, the series slider and the
 * current-value readout. Uses the same `plotRect` as the grains so everything
 * stays pixel-aligned.
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

  dispose(): void {
    this.clear();
  }

  draw(s: CandleOverlayState): void {
    const ctx = this.ctx;
    const { deviceW: W, deviceH: H, dpr } = s;
    ctx.clearRect(0, 0, W, H);

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

    // Candles first, so axes / live price / readout sit above them.
    this.clip(s.clipToPlot, leftPx, topPx, rightPx - leftPx, bottomPx - topPx, () => {
      this.drawCandles(s, dx, dy, dpr);
    });

    if (s.chrome.y.show) this.drawYAxis(s, leftPx, rightPx, topPx, bottomPx, dy, dpr);
    if (s.chrome.x.show) this.drawXAxis(s, leftPx, rightPx, topPx, bottomPx, dx, dy, dpr);
    if (s.actual.show && s.actualPos !== undefined && s.actualValue !== undefined) {
      this.drawActual(s, leftPx, rightPx, topPx, bottomPx, dy, dpr);
    }
    if (s.slider.show && s.sliderActive) {
      drawSlider(ctx, {
        slider: s.slider,
        axis: s.chrome.x,
        ticks: s.sliderTicks,
        pos: s.sliderPos,
        plotRect: s.plotRect,
        deviceW: s.deviceW,
        deviceH: s.deviceH,
        dpr: s.dpr,
        offsetPx: s.sliderOffsetPx,
      });
    }
    if (s.chrome.currentValue.show && s.hoveredCandle) {
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
   * Wicks and solid bodies. The wick is stroked at full strength on every
   * frame — it is the only thing carrying the high/low prices, so it must not
   * wait for (or fade with) the particle→solid reveal; the body's fill and
   * border are the parts that resolve as the sand fades out.
   */
  private drawCandles(
    s: CandleOverlayState,
    dx: (lx: number) => number,
    dy: (ly: number) => number,
    dpr: number,
  ): void {
    const ctx = this.ctx;
    const style = s.style;
    const drawWick = style.wick.show;
    const drawBody = style.enabled && s.solid > 0;
    if (!drawWick && !drawBody) return;

    for (const m of s.metas) {
      const hw = s.hoverWeights[m.candleId] ?? 0;
      const gain = hw > HOVER_EPSILON ? 1 + (s.highlightGain - 1) * hw : 1;
      const dw = s.dimWeights[m.candleId] ?? 0;
      const dimMul = dw > HOVER_EPSILON ? 1 + (s.dimOpacity - 1) * dw : 1;
      const color = gainedRGBA(m.color, gain);
      const cx = dx(m.cx);

      if (drawWick) {
        ctx.beginPath();
        ctx.moveTo(cx, dy(m.wickLow));
        ctx.lineTo(cx, dy(m.wickHigh));
        ctx.strokeStyle = cssRGBA(color, style.wick.opacity * dimMul);
        ctx.lineWidth = style.wick.width * dpr;
        ctx.stroke();
      }

      if (!drawBody) continue;
      const left = dx(m.x0);
      const right = dx(m.x1);
      const top = dy(m.bodyHigh);
      const bottom = dy(m.bodyLow);
      const w = Math.max(1, right - left);
      const h = Math.max(1, bottom - top);
      if (style.fill.on) {
        ctx.fillStyle = cssRGBA(color, style.fill.opacity * s.solid * dimMul);
        ctx.fillRect(left, top, w, h);
      }
      if (style.border.show) {
        ctx.strokeStyle = cssRGBA(color, style.border.opacity * s.solid * dimMul);
        ctx.lineWidth = style.border.width * dpr;
        ctx.strokeRect(left, top, w, h);
      }
    }
  }

  /** The live-price rule across the plot, plus its marker on the price axis. */
  private drawActual(
    s: CandleOverlayState,
    leftPx: number,
    rightPx: number,
    topPx: number,
    bottomPx: number,
    dy: (ly: number) => number,
    dpr: number,
  ): void {
    const ctx = this.ctx;
    const cfg = s.actual;
    const color = cfg.color ?? s.chrome.currentValue.color;
    const py = dy(s.actualPos!);
    if (py < topPx || py > bottomPx) return;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = cfg.opacity;
    ctx.lineWidth = cfg.width * dpr;
    if (cfg.dash !== false) ctx.setLineDash(cfg.dash.map((d) => d * dpr));
    ctx.beginPath();
    ctx.moveTo(leftPx, py);
    ctx.lineTo(rightPx, py);
    ctx.stroke();
    ctx.restore();

    if (cfg.marker && s.chrome.y.show) {
      const label = (cfg.format ?? formatNumber)(s.actualValue!);
      this.drawAxisMarker(leftPx, py, label, 'y', color, dpr);
    }
  }

  private drawYAxis(
    s: CandleOverlayState,
    leftPx: number,
    rightPx: number,
    topPx: number,
    bottomPx: number,
    dy: (ly: number) => number,
    dpr: number,
  ): void {
    const cfg = s.chrome.y;
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
    s: CandleOverlayState,
    leftPx: number,
    rightPx: number,
    topPx: number,
    bottomPx: number,
    dx: (lx: number) => number,
    dy: (ly: number) => number,
    dpr: number,
  ): void {
    const cfg = s.chrome.x;
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
   * A filled highlight label pinned to an axis: `'y'` sits just left of the price
   * axis, vertically centered on `py`; `'x'` sits just below the period axis,
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
    s: CandleOverlayState,
    leftPx: number,
    rightPx: number,
    topPx: number,
    bottomPx: number,
    dx: (lx: number) => number,
    dy: (ly: number) => number,
    dpr: number,
  ): void {
    const cfg = s.chrome.currentValue;
    const c = s.hoveredCandle!;
    const ctx = this.ctx;
    const cx = dx(c.cx);
    // The crosshair tracks the close — the price the readout leads with.
    const cy = dy((c.bodyLow + c.bodyHigh) / 2);
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

    if (s.chrome.y.show && (onAxis || (cfg.markers && cfg.guideY))) {
      this.drawAxisMarker(leftPx, cy, formatNumber(c.close), 'y', cfg.color, dpr);
    }
    if (s.chrome.x.show && (onAxis || (cfg.markers && cfg.guideX))) {
      const label =
        c.xValue instanceof Date ? c.xValue.toLocaleDateString('en-US') : String(c.xValue);
      this.drawAxisMarker(cx, bottomPx, label, 'x', cfg.color, dpr);
    }

    if (onAxis) return;

    // `currentValue.format` is typed against this chart's own CandleMeta.
    const fmt = cfg.format as unknown as ((c: CandleMeta) => string) | undefined;
    const text = (fmt ?? defaultFormat)(c);
    const fontPx = 12 * dpr;
    ctx.font = `${fontPx}px system-ui, sans-serif`;
    const padX = 6 * dpr;
    const padY = 4 * dpr;
    const bw = ctx.measureText(text).width + padX * 2;
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
