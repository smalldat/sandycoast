import type { ResolvedAxis, ResolvedChrome } from '../../core/chrome/chrome.js';
import { type AxisTick, formatNumber } from '../../core/chrome/format.js';
import type { RGBA } from '../../core/render/types.js';
import { cssRGBA } from '../../core/util/color.js';
import type { ResolvedPieStyle } from './pieStyle.js';
import { type ResolvedSlider, sliderTrack } from './slider.js';
import type { SliceMeta } from './types.js';

/** Slices below this hover weight are close enough to un-hovered to skip. */
const HOVER_EPSILON = 0.001;

/** Quarter turn: our angles run clockwise from 12 o'clock, Canvas' from 3. */
const QUARTER = Math.PI / 2;

/** The solid slice layer pre-rasterized at gain 1, positioned in device px. */
interface SolidLayer {
  canvas: HTMLCanvasElement;
  left: number;
  top: number;
}

/** Disc placement in device pixels, derived from the square disc rect. */
interface Disc {
  cx: number;
  cy: number;
  /** Pixels per layout unit (the disc box is square, so one factor suffices). */
  scale: number;
}

export interface PieOverlayState {
  /** Device-pixel canvas size. */
  deviceW: number;
  deviceH: number;
  dpr: number;
  /** Full plot rect [x0,y0,x1,y1] (y-up): axes/legend/title/slider gutters removed. */
  plotRect: [number, number, number, number];
  /** Square sub-rect of the plot the disc is drawn in (the grains' plot rect). */
  discRect: [number, number, number, number];
  chrome: ResolvedChrome;
  /** Slices to draw solid fill/border for (empty when unused). */
  metas: SliceMeta[];
  style: ResolvedPieStyle;
  /** Reveal factor in [0,1]; scales fill/border opacity. */
  solid: number;
  /** Per-slice hover weight in [0,1] (index = sliceId). */
  hoverWeights: Float32Array;
  /** Color multiplier for a fully-hovered slice (1 = highlight effect off). */
  highlightGain: number;
  /** Per-slice dim weight in [0,1] (index = sliceId); dims non-focused slices. */
  dimWeights: Float32Array;
  /** Alpha multiplier for a fully-dimmed slice (1 = no dim). */
  dimOpacity: number;
  hoveredSlice: SliceMeta | null;
  /** Pointer in device px (y-down), or null when outside. */
  pointer: { x: number; y: number } | null;
  slider: ResolvedSlider;
  sliderTicks: AxisTick[];
  /** Handle position along the track, 0..1 (animated, so not always on a tick). */
  sliderPos: number;
  /** Whether the slider has anything to select (more than one series). */
  sliderActive: boolean;
  /**
   * Bumped by the chart whenever slice geometry or colors change (data rebuild,
   * morph tick). Together with the size/rect fields it keys the cached solid
   * layer — see {@link PieOverlay.solidLayer}.
   */
  geomVersion: number;
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

function defaultFormat(slice: SliceMeta): string {
  const pct = formatNumber(Math.round(slice.fraction * 1000) / 10);
  return `${String(slice.xValue)} = ${formatNumber(slice.value)} (${pct}%)`;
}

function axisFont(cfg: ResolvedAxis, dpr: number): string {
  return `${cfg.fontWeight} ${cfg.fontPx * dpr}px ${cfg.fontFamily}`;
}

/**
 * Canvas2D overlay drawn on top of the grain canvas. Renders the solid slice
 * layer, the series slider (track, ticks, handle) and the current-value readout.
 * Uses the same rects as the grains so everything stays pixel-aligned; text is
 * not drawn by the grain backends (they draw points only).
 */
export class PieOverlay {
  private ctx: CanvasRenderingContext2D;
  /** Pre-rasterized solid slice layer; see {@link solidLayer}. */
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

  /** Release the cached slice bitmap. */
  dispose(): void {
    if (this.layer) {
      this.layer.canvas.width = 0;
      this.layer.canvas.height = 0;
    }
    this.layer = null;
    this.layerKey = '';
  }

  draw(s: PieOverlayState): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, s.deviceW, s.deviceH);
    const drawSlider = s.slider.show && s.sliderActive;
    if (!s.chrome.any && !s.style.enabled && !drawSlider) return;

    if (s.style.enabled && s.solid > 0) this.drawSlices(s);
    if (drawSlider) this.drawSlider(s);
    if (s.chrome.currentValue.show && s.hoveredSlice) this.drawCurrentValue(s);
  }

  /** Disc center and layout→device scale from the square disc rect. */
  private disc(s: PieOverlayState): Disc {
    const [x0, y0, x1, y1] = s.discRect;
    return {
      cx: (x0 + (x1 - x0) / 2) * s.deviceW,
      cy: (1 - (y0 + (y1 - y0) / 2)) * s.deviceH,
      scale: (x1 - x0) * s.deviceW,
    };
  }

  /**
   * Every slice's solid fill + border rasterized once at gain 1, re-rendered
   * only when the geometry or the disc placement actually changes.
   *
   * Same reasoning as the bar chart's cached layer: the hover highlight
   * repaints the whole overlay every frame while the pointer is inside, but
   * only one wedge's tint changes — re-stroking the rest is wasted work.
   */
  private solidLayer(s: PieOverlayState, disc: Disc): SolidLayer | null {
    const { fill, border } = s.style;
    const key = [
      s.geomVersion,
      s.deviceW,
      s.deviceH,
      s.discRect.join(','),
      s.dpr,
      fill.on,
      fill.opacity,
      border.any,
      border.width,
      border.opacity,
    ].join('|');
    if (this.layer && this.layerKey === key) return this.layer;

    const pad = Math.ceil(border.width * s.dpr) + 2;
    const rMax = maxRadius(s.metas) * disc.scale;
    const left = Math.max(0, Math.floor(disc.cx - rMax) - pad);
    const top = Math.max(0, Math.floor(disc.cy - rMax) - pad);
    const right = Math.min(s.deviceW, Math.ceil(disc.cx + rMax) + pad);
    const bottom = Math.min(s.deviceH, Math.ceil(disc.cy + rMax) + pad);
    const lw = Math.max(1, right - left);
    const lh = Math.max(1, bottom - top);

    const canvas = this.layer?.canvas ?? document.createElement('canvas');
    if (canvas.width !== lw) canvas.width = lw;
    if (canvas.height !== lh) canvas.height = lh;
    const lctx = canvas.getContext('2d');
    if (!lctx) return null;
    lctx.clearRect(0, 0, lw, lh);

    for (const m of s.metas) this.paintSlice(lctx, s, m, disc, 1, 1, left, top);

    this.layer = { canvas, left, top };
    this.layerKey = key;
    return this.layer;
  }

  /**
   * Trace one wedge as a closed path in device px. `ox`/`oy` offset the center
   * so the same routine serves the cached layer and the live canvas.
   */
  private wedgePath(
    ctx: CanvasRenderingContext2D,
    m: SliceMeta,
    disc: Disc,
    ox: number,
    oy: number,
  ): void {
    const cx = disc.cx - ox;
    const cy = disc.cy - oy;
    const rOut = m.rOuter * disc.scale;
    const rIn = m.rInner * disc.scale;
    // Layout angles run clockwise from 12 o'clock; Canvas' run clockwise from 3.
    const a0 = m.a0 - QUARTER;
    const a1 = m.a1 - QUARTER;
    ctx.beginPath();
    if (rIn <= 0) {
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, rOut, a0, a1);
      ctx.closePath();
      return;
    }
    ctx.arc(cx, cy, rOut, a0, a1);
    ctx.arc(cx, cy, rIn, a1, a0, true);
    ctx.closePath();
  }

  /**
   * Paint one slice's fill + border, with `gain` brightening the rgb channels
   * and `alpha` scaling both layers' opacity.
   */
  private paintSlice(
    ctx: CanvasRenderingContext2D,
    s: PieOverlayState,
    m: SliceMeta,
    disc: Disc,
    gain: number,
    alpha: number,
    ox: number,
    oy: number,
  ): void {
    const { fill, border } = s.style;
    if (m.a1 <= m.a0) return;
    this.wedgePath(ctx, m, disc, ox, oy);
    if (fill.on) {
      ctx.fillStyle = gainedRGBA(m.color, gain, fill.opacity * alpha);
      ctx.fill();
    }
    if (border.any) {
      ctx.strokeStyle = gainedRGBA(m.color, gain, border.opacity * alpha);
      ctx.lineWidth = border.width * s.dpr;
      ctx.stroke();
    }
  }

  /**
   * Solid fill + border per slice, opacity scaled by the reveal factor. The
   * cached layer is blitted, then only the slices the hover highlight is
   * actually tinting are repainted on top.
   */
  private drawSlices(s: PieOverlayState): void {
    const ctx = this.ctx;
    const disc = this.disc(s);
    const layer = this.solidLayer(s, disc);
    if (!layer) return;

    ctx.globalAlpha = s.solid;
    ctx.drawImage(layer.canvas, layer.left, layer.top);
    ctx.globalAlpha = 1;

    if (s.highlightGain === 1 && s.dimOpacity === 1) return;
    for (const m of s.metas) {
      const w = s.hoverWeights[m.sliceId] ?? 0;
      const dw = s.dimWeights[m.sliceId] ?? 0;
      if (w <= HOVER_EPSILON && dw <= HOVER_EPSILON) continue;
      ctx.save();
      // Clip to the wedge plus its border bleed, clear the baked-in copy, then
      // repaint it brighter. Stroking the clip path itself would clip the
      // outer half of the stroke, so the clip is grown by the border width.
      const bleed = s.style.border.any ? s.style.border.width * s.dpr : 0;
      const grown = bleed / disc.scale;
      this.wedgePath(
        ctx,
        { ...m, rOuter: m.rOuter + grown, rInner: Math.max(0, m.rInner - grown) },
        disc,
        0,
        0,
      );
      ctx.clip();
      const r = (m.rOuter + grown) * disc.scale;
      ctx.clearRect(disc.cx - r, disc.cy - r, r * 2, r * 2);
      const gain = 1 + (s.highlightGain - 1) * w;
      const dimMul = 1 + (s.dimOpacity - 1) * dw;
      this.paintSlice(ctx, s, m, disc, gain, s.solid * dimMul, 0, 0);
      ctx.restore();
    }
  }

  /**
   * Series slider: a track across the plot width with a tick per series (thinned
   * by the X axis' `ticks`) and a handle at the selected index. Styling comes
   * from the X axis config, so it reads as the axis it replaces.
   */
  private drawSlider(s: PieOverlayState): void {
    const ctx = this.ctx;
    const cfg = s.chrome.x;
    const sl = s.slider;
    const dpr = s.dpr;
    const color = sl.color ?? cfg.color;
    const track = sliderTrack(sl, s.plotRect, s.deviceW, s.deviceH, dpr);
    const leftPx = track.x0;
    const rightPx = track.x1;
    const trackY = track.y;
    const handle = track.handle;

    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = sl.trackPx * dpr;
    ctx.lineCap = 'round';
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.moveTo(leftPx, trackY);
    ctx.lineTo(rightPx, trackY);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Ticks + labels.
    const tickLen = 4 * dpr;
    const labelY = sl.position === 'bottom' ? trackY + handle + 3 * dpr : trackY - handle - 3 * dpr;
    ctx.lineWidth = dpr;
    ctx.font = axisFont(cfg, dpr);
    ctx.textAlign = 'center';
    ctx.textBaseline = sl.position === 'bottom' ? 'top' : 'bottom';
    for (const t of s.sliderTicks) {
      const px = leftPx + t.pos * (rightPx - leftPx);
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(px, trackY - tickLen);
      ctx.lineTo(px, trackY + tickLen);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillText(t.label, px, labelY);
    }

    if (cfg.show && cfg.label) {
      const titleY =
        sl.position === 'bottom'
          ? labelY + cfg.fontPx * dpr + 4 * dpr
          : labelY - cfg.fontPx * dpr - 4 * dpr;
      ctx.fillText(cfg.label, (leftPx + rightPx) / 2, titleY);
    }

    // Handle.
    const hx = leftPx + s.sliderPos * (rightPx - leftPx);
    ctx.beginPath();
    ctx.arc(hx, trackY, handle, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(16,20,28,0.92)';
    ctx.fill();
    ctx.lineWidth = 2 * dpr;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.restore();
  }

  private drawCurrentValue(s: PieOverlayState): void {
    const cfg = s.chrome.currentValue;
    const slice = s.hoveredSlice!;
    const ctx = this.ctx;
    const dpr = s.dpr;
    const [x0, y0, x1, y1] = s.plotRect;
    const leftPx = x0 * s.deviceW;
    const rightPx = x1 * s.deviceW;
    const topPx = (1 - y1) * s.deviceH;
    const bottomPx = (1 - y0) * s.deviceH;

    // `currentValue.format` is shared with the bar chart (typed for BarMeta);
    // the pie hands it its own meta, so re-type the callback here.
    const fmt = cfg.format as unknown as ((m: SliceMeta) => string) | undefined;
    const text = (fmt ?? defaultFormat)(slice);
    const fontPx = 12 * dpr;
    ctx.font = `${fontPx}px system-ui, sans-serif`;
    const padX = 6 * dpr;
    const padY = 4 * dpr;
    const bw = ctx.measureText(text).width + padX * 2;
    const bh = fontPx + padY * 2;

    // Anchor by mode. 'axis' has no meaning without axes, so it follows the
    // pointer like the default.
    const disc = this.disc(s);
    let ax: number;
    let ay: number;
    if ((cfg.mode === 'pointer' || cfg.mode === 'axis') && s.pointer) {
      ax = s.pointer.x + 12 * dpr;
      ay = s.pointer.y - bh - 8 * dpr;
    } else if (cfg.mode === 'pointer' || cfg.mode === 'axis') {
      // No pointer (e.g. a programmatic hover): pin to the slice's mid-angle.
      const mid = (slice.a0 + slice.a1) / 2;
      const r = ((slice.rInner + slice.rOuter) / 2) * disc.scale;
      ax = disc.cx + Math.sin(mid) * r - bw / 2;
      ay = disc.cy - Math.cos(mid) * r - bh / 2;
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

function maxRadius(metas: SliceMeta[]): number {
  let r = 0;
  for (const m of metas) if (m.rOuter > r) r = m.rOuter;
  return r;
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
