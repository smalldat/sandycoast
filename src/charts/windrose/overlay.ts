import type { ResolvedAxis, ResolvedChrome } from '../../core/chrome/chrome.js';
import { formatNumber } from '../../core/chrome/format.js';
import type { RGBA } from '../../core/render/types.js';
import { cssRGBA } from '../../core/util/color.js';
import type { RoseAxes } from './axis.js';
import type { ResolvedHighlight, ResolvedRoseStyle } from './roseStyle.js';
import type { SegmentMeta } from './types.js';

/** Segments below this weight are close enough to un-emphasised to skip. */
const EPSILON = 0.001;

/** Quarter turn: our angles run clockwise from 12 o'clock, Canvas' from 3. */
const QUARTER = Math.PI / 2;

/** The solid segment layer pre-rasterized at gain 1, positioned in device px. */
interface SolidLayer {
  canvas: HTMLCanvasElement;
  left: number;
  top: number;
}

/** Rose placement in device pixels, derived from the square rose rect. */
interface Disc {
  cx: number;
  cy: number;
  /** Pixels per layout unit (the rose box is square, so one factor suffices). */
  scale: number;
}

export interface WindRoseOverlayState {
  deviceW: number;
  deviceH: number;
  dpr: number;
  /** Full plot rect [x0,y0,x1,y1] (y-up): chrome gutters removed. */
  plotRect: [number, number, number, number];
  /** Square sub-rect of the plot the rose is drawn in (the grains' plot rect). */
  roseRect: [number, number, number, number];
  chrome: ResolvedChrome;
  metas: SegmentMeta[];
  style: ResolvedRoseStyle;
  /** Reveal factor in [0,1]; scales fill/border opacity. */
  solid: number;
  hoverWeights: Float32Array;
  highlightGain: number;
  dimWeights: Float32Array;
  dimOpacity: number;
  /** Per-segment latest-value emphasis in [0,1] (index = segmentId). */
  highlightWeights: Float32Array;
  highlight: ResolvedHighlight;
  hoveredSegment: SegmentMeta | null;
  /** Pointer in device px (y-down), or null when outside. */
  pointer: { x: number; y: number } | null;
  axes: RoseAxes;
  /** Spoke the ring labels are drawn along, radians clockwise from 12 o'clock. */
  ringLabelAngle: number;
  /** Label/unit for the intensity indicator, used by the default readout. */
  intensityLabel: string;
  intensityUnit: string;
  /** True when the radial measure is a percentage. */
  percent: boolean;
  /**
   * Bumped by the chart whenever segment geometry or colors change (rebuild,
   * morph tick). Together with the size/rect fields it keys the cached layer.
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

function axisFont(cfg: ResolvedAxis, dpr: number): string {
  return `${cfg.fontWeight} ${cfg.fontPx * dpr}px ${cfg.fontFamily}`;
}

/** Default readout: what the segment is, how much it holds, how strong it blew. */
function defaultFormat(s: WindRoseOverlayState, m: SegmentMeta): string {
  const unit = s.intensityUnit ? ` ${s.intensityUnit}` : '';
  const amount = s.percent ? `${formatNumber(m.value)}%` : formatNumber(m.value);
  if (m.calm) return `Calm — ${amount} (${m.count} readings)`;
  const range =
    m.intensityMin === m.intensityMax
      ? `${formatNumber(m.intensityMax)}${unit}`
      : `${formatNumber(m.intensityMin)}–${formatNumber(m.intensityMax)}${unit}`;
  // An aggregated segment says so outright rather than implying it is one
  // reading: it is the merged tail of a capped sector.
  const what = m.aggregated ? `${m.count} readings` : m.count === 1 ? '1 reading' : `${m.count}`;
  return `${m.bearing} · ${range} · ${amount} (${what})`;
}

/**
 * Canvas2D overlay drawn on top of the grain canvas: radial rings, the solid
 * segment layer, compass labels, the latest-value emphasis and the readout.
 * Uses the same rects as the grains so everything stays pixel-aligned.
 */
export class WindRoseOverlay {
  private ctx: CanvasRenderingContext2D;
  private layer: SolidLayer | null = null;
  private layerKey = '';

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Overlay Canvas2D context unavailable');
    this.ctx = ctx;
  }

  clear(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  dispose(): void {
    if (this.layer) {
      this.layer.canvas.width = 0;
      this.layer.canvas.height = 0;
    }
    this.layer = null;
    this.layerKey = '';
  }

  draw(s: WindRoseOverlayState): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, s.deviceW, s.deviceH);
    if (!s.chrome.any && !s.style.enabled) return;

    const disc = this.disc(s);
    // Rings sit under the petals so a long petal reads as crossing them.
    if (s.axes.rings.length > 0) this.drawRings(s, disc);
    if (s.style.enabled && s.solid > 0) this.drawSegments(s, disc);
    if (s.axes.rings.length > 0) this.drawRingLabels(s, disc);
    if (s.axes.compass.length > 0) this.drawCompass(s, disc);
    if (s.chrome.currentValue.show && s.hoveredSegment) this.drawCurrentValue(s, disc);
  }

  /** Rose center and layout→device scale from the square rose rect. */
  private disc(s: WindRoseOverlayState): Disc {
    const [x0, y0, x1, y1] = s.roseRect;
    return {
      cx: (x0 + (x1 - x0) / 2) * s.deviceW,
      cy: (1 - (y0 + (y1 - y0) / 2)) * s.deviceH,
      scale: (x1 - x0) * s.deviceW,
    };
  }

  private drawRings(s: WindRoseOverlayState, disc: Disc): void {
    const ctx = this.ctx;
    const cfg = s.chrome.y;
    ctx.save();
    ctx.strokeStyle = cfg.color;
    ctx.lineWidth = s.dpr;
    ctx.globalAlpha = 0.35;
    for (const ring of s.axes.rings) {
      ctx.beginPath();
      ctx.arc(disc.cx, disc.cy, ring.radius * disc.scale, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Ring values, drawn along one spoke so they do not stack on top of the
   * petals they are scaling.
   */
  private drawRingLabels(s: WindRoseOverlayState, disc: Disc): void {
    const ctx = this.ctx;
    const cfg = s.chrome.y;
    const a = s.ringLabelAngle;
    ctx.save();
    ctx.font = axisFont(cfg, s.dpr);
    ctx.fillStyle = cfg.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const ring of s.axes.rings) {
      const r = ring.radius * disc.scale;
      const x = disc.cx + Math.sin(a) * r;
      const y = disc.cy - Math.cos(a) * r;
      // A pill behind the label so it stays readable over a petal.
      const w = ctx.measureText(ring.label).width + 6 * s.dpr;
      const h = cfg.fontPx * s.dpr + 2 * s.dpr;
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = 'rgba(16,20,28,0.8)';
      ctx.fillRect(x - w / 2, y - h / 2, w, h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = cfg.color;
      ctx.fillText(ring.label, x, y);
    }
    ctx.restore();
  }

  private drawCompass(s: WindRoseOverlayState, disc: Disc): void {
    const ctx = this.ctx;
    const cfg = s.chrome.x;
    const r = disc.scale * 0.5;
    ctx.save();
    ctx.font = axisFont(cfg, s.dpr);
    ctx.fillStyle = cfg.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const pad = cfg.fontPx * s.dpr * 0.9;
    for (const tick of s.axes.compass) {
      const x = disc.cx + Math.sin(tick.angle) * (r - pad);
      const y = disc.cy - Math.cos(tick.angle) * (r - pad);
      ctx.fillText(tick.label, x, y);
    }
    ctx.restore();
  }

  /**
   * Every segment's solid fill + border rasterized once at gain 1, re-rendered
   * only when the geometry or the rose placement actually changes.
   *
   * Same reasoning as the pie's cached layer: hover repaints the whole overlay
   * every frame while the pointer is inside, but only a segment or two change
   * tint — re-stroking the rest is wasted work, and a rose has far more
   * segments than a pie has slices.
   */
  private solidLayer(s: WindRoseOverlayState, disc: Disc): SolidLayer | null {
    const { fill, border } = s.style;
    const key = [
      s.geomVersion,
      s.deviceW,
      s.deviceH,
      s.roseRect.join(','),
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

    for (const m of s.metas) this.paintSegment(lctx, s, m, disc, 1, 1, left, top);

    this.layer = { canvas, left, top };
    this.layerKey = key;
    return this.layer;
  }

  /**
   * Trace one segment as a closed path in device px. `ox`/`oy` offset the
   * center so the same routine serves the cached layer and the live canvas.
   */
  private segmentPath(
    ctx: CanvasRenderingContext2D,
    m: { a0: number; a1: number; rInner: number; rOuter: number },
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

  private paintSegment(
    ctx: CanvasRenderingContext2D,
    s: WindRoseOverlayState,
    m: SegmentMeta,
    disc: Disc,
    gain: number,
    alpha: number,
    ox: number,
    oy: number,
    colorOverride?: string,
  ): void {
    const { fill, border } = s.style;
    if (m.a1 <= m.a0 || m.rOuter <= m.rInner) return;
    this.segmentPath(ctx, m, disc, ox, oy);
    if (fill.on) {
      ctx.fillStyle = colorOverride ?? gainedRGBA(m.color, gain, fill.opacity * alpha);
      ctx.fill();
    }
    if (border.any) {
      ctx.strokeStyle = colorOverride ?? gainedRGBA(m.color, gain, border.opacity * alpha);
      ctx.lineWidth = border.width * s.dpr;
      ctx.stroke();
    }
  }

  /**
   * Blit the cached layer, then repaint only the segments whose hover, dim or
   * latest-value weight is actually non-zero.
   */
  private drawSegments(s: WindRoseOverlayState, disc: Disc): void {
    const ctx = this.ctx;
    const layer = this.solidLayer(s, disc);
    if (!layer) return;

    ctx.globalAlpha = s.solid;
    ctx.drawImage(layer.canvas, layer.left, layer.top);
    ctx.globalAlpha = 1;

    const outline = s.highlight.show && s.highlight.mode === 'outline';
    for (const m of s.metas) {
      const w = s.hoverWeights[m.segmentId] ?? 0;
      const dw = s.dimWeights[m.segmentId] ?? 0;
      const hw = s.highlight.show ? (s.highlightWeights[m.segmentId] ?? 0) : 0;
      if (w <= EPSILON && dw <= EPSILON && hw <= EPSILON) continue;

      ctx.save();
      // Clip to the segment plus its border bleed, clear the baked-in copy,
      // then repaint it. Stroking the clip path itself would clip the outer
      // half of the stroke, so the clip is grown by the border width.
      const bleed = s.style.border.any ? s.style.border.width * s.dpr : 0;
      const grown = bleed / disc.scale;
      this.segmentPath(
        ctx,
        { ...m, rOuter: m.rOuter + grown, rInner: Math.max(0, m.rInner - grown) },
        disc,
        0,
        0,
      );
      ctx.clip();
      const r = (m.rOuter + grown) * disc.scale;
      ctx.clearRect(disc.cx - r, disc.cy - r, r * 2, r * 2);

      // Hover and the latest-value glow both brighten, so they compose as one
      // gain rather than fighting over the same pixels.
      const glow = s.highlight.mode === 'glow' ? hw : 0;
      const gain = 1 + (s.highlightGain - 1) * w + (s.highlight.gain - 1) * glow;
      const dimMul = 1 + (s.dimOpacity - 1) * dw;
      const recolor =
        s.highlight.mode === 'color' && hw > EPSILON && s.highlight.color
          ? s.highlight.color
          : undefined;
      this.paintSegment(ctx, s, m, disc, gain, s.solid * dimMul, 0, 0, recolor);
      ctx.restore();

      if (outline && hw > EPSILON) this.strokeHighlight(s, m, disc, hw);
    }
  }

  /** Stroke the latest-value outline outside the clip, so it is never clipped. */
  private strokeHighlight(
    s: WindRoseOverlayState,
    m: SegmentMeta,
    disc: Disc,
    weight: number,
  ): void {
    const ctx = this.ctx;
    ctx.save();
    this.segmentPath(ctx, m, disc, 0, 0);
    ctx.strokeStyle = s.highlight.color ?? cssRGBA(m.color, 1);
    ctx.lineWidth = s.highlight.outlinePx * s.dpr;
    ctx.globalAlpha = Math.min(1, weight) * s.solid;
    ctx.stroke();
    ctx.restore();
  }

  private drawCurrentValue(s: WindRoseOverlayState, disc: Disc): void {
    const cfg = s.chrome.currentValue;
    const seg = s.hoveredSegment!;
    const ctx = this.ctx;
    const dpr = s.dpr;
    const [x0, y0, x1, y1] = s.plotRect;
    const leftPx = x0 * s.deviceW;
    const rightPx = x1 * s.deviceW;
    const topPx = (1 - y1) * s.deviceH;
    const bottomPx = (1 - y0) * s.deviceH;

    // `currentValue.format` is shared across charts (typed contravariantly in
    // chrome); the rose hands it its own meta, so re-type the callback here.
    const fmt = cfg.format as unknown as ((m: SegmentMeta) => string) | undefined;
    const text = fmt ? fmt(seg) : defaultFormat(s, seg);
    const fontPx = 12 * dpr;
    ctx.font = `${fontPx}px system-ui, sans-serif`;
    const padX = 6 * dpr;
    const padY = 4 * dpr;
    const bw = ctx.measureText(text).width + padX * 2;
    const bh = fontPx + padY * 2;

    let ax: number;
    let ay: number;
    if ((cfg.mode === 'pointer' || cfg.mode === 'axis') && s.pointer) {
      ax = s.pointer.x + 12 * dpr;
      ay = s.pointer.y - bh - 8 * dpr;
    } else if (cfg.mode === 'pointer' || cfg.mode === 'axis') {
      // No pointer (a programmatic selection): pin to the segment's mid-angle.
      const mid = (seg.a0 + seg.a1) / 2;
      const r = ((seg.rInner + seg.rOuter) / 2) * disc.scale;
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

function maxRadius(metas: SegmentMeta[]): number {
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
