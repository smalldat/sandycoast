import type { RGBA } from '../../core/render/types.js';
import { cssRGBA } from '../../core/util/color.js';
import { type AxisModel, formatNumber } from './axis.js';
import type { ResolvedBarStyle } from './barStyle.js';
import type { ResolvedAxis, ResolvedChrome } from './chrome.js';
import type { BarMeta } from './types.js';

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
  hoveredBar: BarMeta | null;
  /** Pointer in device px (y-down), or null when outside. */
  pointer: { x: number; y: number } | null;
  /** Bars to draw solid fill/border for (empty when unused). */
  metas: BarMeta[];
  barStyle: ResolvedBarStyle;
  /** Reveal factor in [0,1]; scales fill/border opacity. */
  solid: number;
  /** Per-bar hover weight in [0,1] (index = barId); brightens the solid layer. */
  hoverWeights: Float32Array;
  /** Color multiplier for a fully-hovered bar (1 = highlight effect off). */
  highlightGain: number;
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

function defaultFormat(bar: BarMeta): string {
  const series = bar.seriesKey !== undefined ? ` · ${String(bar.seriesKey)}` : '';
  const x = typeof bar.xValue === 'number' ? formatNumber(bar.xValue) : String(bar.xValue);
  return `${x}${series} = ${formatNumber(bar.yValue)}`;
}

/**
 * Canvas2D overlay drawn on top of the grain canvas. Renders axis spines, ticks,
 * tick labels, optional grid lines, and the current-value readout. Uses the same
 * `plotRect` as the grains so everything stays pixel-aligned. Text is not drawn
 * by the grain backends (they draw points only).
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
    if (!s.chrome.any && !s.barStyle.enabled) return;

    const [x0, y0, x1, y1] = s.plotRect;
    const leftPx = x0 * W;
    const rightPx = x1 * W;
    const bottomPx = (1 - y0) * H; // layout y=0
    const topPx = (1 - y1) * H; // layout y=1

    // layout (lx,ly) -> device px
    const dx = (lx: number): number => (x0 + lx * (x1 - x0)) * W;
    const dy = (ly: number): number => (1 - (y0 + ly * (y1 - y0))) * H;

    // Solid fill/border first, so axes/ticks/current-value sit above it.
    if (s.barStyle.enabled && s.solid > 0) this.drawBars(s, dx, dy, dpr);
    if (!s.chrome.any) return;

    this.drawYAxis(s, leftPx, rightPx, topPx, bottomPx, dy, dpr);
    this.drawXAxis(s, leftPx, rightPx, topPx, bottomPx, dx, dy, dpr);
    if (s.chrome.currentValue.show && s.hoveredBar) {
      this.drawCurrentValue(s, leftPx, rightPx, topPx, bottomPx, dx, dy, dpr);
    }
  }

  /**
   * Solid fill + per-side border for each bar, opacity scaled by the reveal
   * factor `s.solid`. Colors are always the bar's series color (only opacity is
   * configurable). Drawn under the axes/current-value so chrome stays legible.
   */
  private drawBars(
    s: OverlayState,
    dx: (lx: number) => number,
    dy: (ly: number) => number,
    dpr: number,
  ): void {
    const ctx = this.ctx;
    const { fill, border } = s.barStyle;
    const solid = s.solid;

    for (const m of s.metas) {
      const L = dx(m.x0);
      const R = dx(m.x1);
      const B = dy(0); // bar base
      const T = dy(m.height); // bar top
      // Brighten the hovered bar's fill/border by the (eased) hover weight.
      const w = s.hoverWeights[m.barId] ?? 0;
      const gain = w > 0 ? 1 + (s.highlightGain - 1) * w : 1;

      if (fill.on) {
        ctx.fillStyle = gainedRGBA(m.color, gain, fill.opacity * solid);
        ctx.fillRect(L, T, R - L, B - T);
      }

      if (border.any) {
        const lw = border.width * dpr;
        // Half-pixel align odd widths so 1px edges stay crisp (matches spines).
        const h = lw % 2 === 0 ? 0 : 0.5;
        ctx.strokeStyle = gainedRGBA(m.color, gain, border.opacity * solid);
        ctx.lineWidth = lw;
        ctx.beginPath();
        if (border.top) {
          ctx.moveTo(L, T + h);
          ctx.lineTo(R, T + h);
        }
        if (border.bottom) {
          ctx.moveTo(L, B - h);
          ctx.lineTo(R, B - h);
        }
        if (border.left) {
          ctx.moveTo(L + h, T);
          ctx.lineTo(L + h, B);
        }
        if (border.right) {
          ctx.moveTo(R - h, T);
          ctx.lineTo(R - h, B);
        }
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

    // Spine: end at the top-most tick rather than the plot top, so the line
    // doesn't overshoot the highest labeled value. Falls back to the plot top
    // when there are no ticks.
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

    if (cfg.label) {
      // Sit just outside the widest tick label, not at the canvas edge.
      const titleX = leftPx - tick - 4 * dpr - maxLabelW - 6 * dpr - (cfg.fontPx * dpr) / 2;
      ctx.save();
      ctx.translate(titleX, (topPx + bottomPx) / 2);
      // 'up' reads bottom-to-top (-90°), 'down' reads top-to-bottom (+90°).
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

    // Grid lines stop at the top-most Y grid line rather than the plot top, so
    // they don't overshoot the highest labeled value. Falls back to plot top.
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

    // spine
    ctx.beginPath();
    ctx.moveTo(leftPx, bottomPx);
    ctx.lineTo(rightPx, bottomPx);
    ctx.stroke();

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

    if (cfg.label) {
      // Just below the tick labels, not pinned to the canvas bottom.
      ctx.textBaseline = 'top';
      const ly = bottomPx + tick + 3 * dpr + cfg.fontPx * dpr + 4 * dpr;
      ctx.fillText(cfg.label, (leftPx + rightPx) / 2, ly);
    }
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
    const bar = s.hoveredBar!;
    const ctx = this.ctx;
    const barCx = dx((bar.x0 + bar.x1) / 2);
    const barTopY = dy(bar.height);

    if (cfg.showGuide) {
      ctx.save();
      ctx.strokeStyle = cfg.color;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = dpr;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(leftPx, barTopY);
      ctx.lineTo(barCx, barTopY);
      ctx.stroke();
      ctx.restore();
    }

    const text = (cfg.format ?? defaultFormat)(bar);
    const fontPx = 12 * dpr;
    ctx.font = `${fontPx}px system-ui, sans-serif`;
    const padX = 6 * dpr;
    const padY = 4 * dpr;
    const tw = ctx.measureText(text).width;
    const bw = tw + padX * 2;
    const bh = fontPx + padY * 2;

    // Anchor point by mode.
    let ax: number;
    let ay: number;
    if (cfg.mode === 'pointer' && s.pointer) {
      ax = s.pointer.x + 12 * dpr;
      ay = s.pointer.y - bh - 8 * dpr;
    } else if (cfg.mode === 'pointer') {
      ax = barCx - bw / 2;
      ay = barTopY - bh - 6 * dpr;
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
    // Clamp inside the plot.
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
