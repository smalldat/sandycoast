import type { ResolvedAxis, ResolvedChrome } from '../../core/chrome/chrome.js';
import type { Scalar } from '../../core/data/types.js';
import type { RGBA } from '../../core/render/types.js';
import { cssRGBA } from '../../core/util/color.js';
import { type AxisModel, formatNumber } from './axis.js';
import type { ResolvedBarStyle } from './barStyle.js';
import type { BarMeta } from './types.js';

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
  /** Pan/zoom transform applied to layout coords (default identity). */
  viewScale?: [number, number];
  viewOffset?: [number, number];
  /** Clip plot-interior chrome (bars/grid/ticks) to the plot rect (pan/zoom). */
  clipToPlot?: boolean;
  /**
   * Bumped by the chart whenever bar geometry or colors change (data rebuild,
   * morph tick). Together with the view/size fields it keys the cached solid
   * layer — see {@link Overlay.solidLayer}.
   */
  geomVersion: number;
}

/** Bars below this hover weight are close enough to un-hovered to skip. */
const HOVER_EPSILON = 0.001;

/** The solid bar layer pre-rasterized at gain 1, positioned in device px. */
interface SolidLayer {
  canvas: HTMLCanvasElement;
  left: number;
  top: number;
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
  /** Pre-rasterized solid bar layer; see {@link solidLayer}. */
  private layer: SolidLayer | null = null;
  /** Key the layer was rasterized for; a mismatch forces a re-render. */
  private layerKey = '';

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Overlay Canvas2D context unavailable');
    this.ctx = ctx;
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /** Release the cached bar bitmap (several MB on a wide chart). */
  dispose(): void {
    if (this.layer) {
      this.layer.canvas.width = 0;
      this.layer.canvas.height = 0;
    }
    this.layer = null;
    this.layerKey = '';
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

    // Pan/zoom transform, then layout (lx,ly) -> device px.
    const vsx = s.viewScale?.[0] ?? 1;
    const vsy = s.viewScale?.[1] ?? 1;
    const vox = s.viewOffset?.[0] ?? 0;
    const voy = s.viewOffset?.[1] ?? 0;
    const dx = (lx: number): number => (x0 + (lx * vsx + vox) * (x1 - x0)) * W;
    const dy = (ly: number): number => (1 - (y0 + (ly * vsy + voy) * (y1 - y0))) * H;

    // Solid fill/border first, so axes/ticks/current-value sit above it.
    if (s.barStyle.enabled && s.solid > 0) {
      this.clip(s.clipToPlot, leftPx, topPx, rightPx - leftPx, bottomPx - topPx, () =>
        this.drawBars(s, dx, dy, dpr),
      );
    }
    if (!s.chrome.any) return;

    this.drawYAxis(s, leftPx, rightPx, topPx, bottomPx, dy, dpr);
    this.drawXAxis(s, leftPx, rightPx, topPx, bottomPx, dx, dy, dpr);
    if (s.chrome.currentValue.show && s.hoveredBar) {
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
   * Every bar's solid fill + border rasterized once at gain 1, re-rendered only
   * when the geometry or the projection actually changes.
   *
   * A bar costs far less to draw than a line chart's area polygon, but the
   * count is what bites: 5k points across 3 series is 15k `fillRect`s plus 15k
   * border strokes, and the hover highlight repaints the whole overlay every
   * frame while the pointer is inside. Since only one bar's tint changes, the
   * other ~15k are re-rasterized for nothing.
   *
   * So the whole solid layer is cached and a steady-state frame is one
   * `drawImage`; {@link drawBars} then patches just the bars whose hover weight
   * is non-zero.
   */
  private solidLayer(
    s: OverlayState,
    dx: (lx: number) => number,
    dy: (ly: number) => number,
    dpr: number,
  ): SolidLayer | null {
    const { fill, border } = s.barStyle;
    const key = [
      s.geomVersion,
      s.deviceW,
      s.deviceH,
      s.plotRect.join(','),
      s.viewScale?.join(',') ?? '',
      s.viewOffset?.join(',') ?? '',
      dpr,
      fill.on,
      fill.opacity,
      border.any,
      border.width,
      border.opacity,
      `${border.top}${border.bottom}${border.left}${border.right}`,
    ].join('|');
    if (this.layer && this.layerKey === key) return this.layer;

    const [x0, y0, x1, y1] = s.plotRect;
    const pad = Math.ceil(border.width * dpr) + 2;
    const left = Math.max(0, Math.floor(x0 * s.deviceW) - pad);
    const top = Math.max(0, Math.floor((1 - y1) * s.deviceH) - pad);
    const right = Math.min(s.deviceW, Math.ceil(x1 * s.deviceW) + pad);
    const bottom = Math.min(s.deviceH, Math.ceil((1 - y0) * s.deviceH) + pad);
    const lw = Math.max(1, right - left);
    const lh = Math.max(1, bottom - top);

    const canvas = this.layer?.canvas ?? document.createElement('canvas');
    if (canvas.width !== lw) canvas.width = lw;
    if (canvas.height !== lh) canvas.height = lh;
    const lctx = canvas.getContext('2d');
    if (!lctx) return null;
    lctx.clearRect(0, 0, lw, lh);

    for (const m of s.metas) {
      this.paintBar(lctx, s, m, dx, dy, dpr, 1, 1, left, top);
    }

    this.layer = { canvas, left, top };
    this.layerKey = key;
    return this.layer;
  }

  /**
   * Paint one bar's fill + border into `ctx`, with `gain` brightening the rgb
   * channels and `alpha` scaling both layers' opacity. Coordinates are offset by
   * `ox`/`oy` so the same routine serves the cached layer and the live canvas.
   */
  private paintBar(
    ctx: CanvasRenderingContext2D,
    s: OverlayState,
    m: BarMeta,
    dx: (lx: number) => number,
    dy: (ly: number) => number,
    dpr: number,
    gain: number,
    alpha: number,
    ox: number,
    oy: number,
  ): void {
    const { fill, border } = s.barStyle;
    const L = dx(m.x0) - ox;
    const R = dx(m.x1) - ox;
    const B = dy(0) - oy; // bar base
    const T = dy(m.height) - oy; // bar top

    if (fill.on) {
      ctx.fillStyle = gainedRGBA(m.color, gain, fill.opacity * alpha);
      ctx.fillRect(L, T, R - L, B - T);
    }

    if (border.any) {
      const lw = border.width * dpr;
      // Half-pixel align odd widths so 1px edges stay crisp (matches spines).
      const h = lw % 2 === 0 ? 0 : 0.5;
      ctx.strokeStyle = gainedRGBA(m.color, gain, border.opacity * alpha);
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
    const layer = this.solidLayer(s, dx, dy, dpr);
    if (!layer) return;

    ctx.globalAlpha = s.solid;
    ctx.drawImage(layer.canvas, layer.left, layer.top);
    ctx.globalAlpha = 1;

    // Repaint only the bars the hover highlight is actually tinting — one on
    // the way in, at most one more easing back out.
    if (s.highlightGain === 1) return;
    const bw = Math.ceil(s.barStyle.border.width * dpr) + 2;
    for (const m of s.metas) {
      const w = s.hoverWeights[m.barId] ?? 0;
      if (w <= HOVER_EPSILON) continue;
      const L = dx(m.x0);
      const R = dx(m.x1);
      const B = dy(0);
      const T = dy(m.height);
      ctx.save();
      // Clip to the bar plus its border bleed so clearing the baked-in copy
      // can't chew into a neighbouring bar, then repaint it brighter.
      ctx.beginPath();
      ctx.rect(L - bw, T - bw, R - L + bw * 2, B - T + bw * 2);
      ctx.clip();
      ctx.clearRect(L, T, R - L, B - T);
      this.paintBar(ctx, s, m, dx, dy, dpr, 1 + (s.highlightGain - 1) * w, s.solid, 0, 0);
      ctx.restore();
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
      // Just below the tick labels, not pinned to the canvas bottom.
      ctx.textBaseline = 'top';
      const ly = bottomPx + tick + 3 * dpr + cfg.fontPx * dpr + 4 * dpr;
      ctx.fillText(cfg.label, (leftPx + rightPx) / 2, ly);
    }
  }

  /**
   * A filled highlight label pinned to an axis: `'y'` sits just left of the value
   * axis, vertically centered on `py`; `'x'` sits just below the category axis,
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
    const bar = s.hoveredBar!;
    const ctx = this.ctx;
    const barCx = dx((bar.x0 + bar.x1) / 2);
    const barTopY = dy(bar.height);
    const onAxis = cfg.mode === 'axis';

    // Guide line(s) to the hovered bar.
    if (cfg.guideY || cfg.guideX) {
      ctx.save();
      ctx.strokeStyle = cfg.color;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = dpr;
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      if (cfg.guideY) {
        ctx.beginPath();
        ctx.moveTo(leftPx, barTopY);
        ctx.lineTo(barCx, barTopY);
        ctx.stroke();
      }
      if (cfg.guideX) {
        ctx.beginPath();
        ctx.moveTo(barCx, bottomPx);
        ctx.lineTo(barCx, barTopY);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Highlighted value markers on the axes. Shown when a matching guide is on,
    // or unconditionally in 'axis' mode (the markers are the readout there).
    if (s.chrome.y.show && (onAxis || (cfg.markers && cfg.guideY))) {
      this.drawAxisMarker(leftPx, barTopY, formatNumber(bar.yValue), 'y', cfg.color, dpr);
    }
    if (s.chrome.x.show && (onAxis || (cfg.markers && cfg.guideX))) {
      this.drawAxisMarker(barCx, bottomPx, scalarLabel(bar.xValue), 'x', cfg.color, dpr);
    }

    // In 'axis' mode the readout lives on the axes; skip the floating box.
    if (onAxis) return;

    // `currentValue.format` is stored contravariantly by chrome (which knows
    // nothing about a chart's meta); re-type it to this chart's own meta.
    const fmt = cfg.format as unknown as ((m: BarMeta) => string) | undefined;
    const text = (fmt ?? defaultFormat)(bar);
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
