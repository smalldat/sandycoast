// Series slider: a track with one tick per series and a draggable handle that
// picks which series a chart draws. Charts whose series axis is a *selector*
// rather than a visual dimension (the pie chart, the candlestick chart) share
// it, so — like the legend and the axes — it lives in `core/chrome` and is
// never imported chart-to-chart.

import type { Scalar } from '../data/types.js';
import type { ResolvedAxis } from './chrome.js';
import { type AxisTick, formatValue } from './format.js';
import type { SliderConfig } from './types.js';

export interface ResolvedSlider {
  show: boolean;
  position: 'top' | 'bottom';
  interactive: boolean;
  /** Track/handle color (CSS), or undefined to follow the X axis color. */
  color: string | undefined;
  handlePx: number;
  trackPx: number;
}

export function resolveSlider(cfg: SliderConfig | undefined): ResolvedSlider {
  return {
    show: cfg?.show ?? true,
    position: cfg?.position ?? 'bottom',
    interactive: cfg?.interactive ?? true,
    color: cfg?.color,
    handlePx: cfg?.handlePx ?? 7,
    trackPx: cfg?.trackPx ?? 3,
  };
}

/**
 * Position of series `index` along the track, 0..1. A single series sits in the
 * middle so the handle isn't pinned to the left edge.
 */
export function trackPos(index: number, count: number): number {
  if (count <= 1) return 0.5;
  return index / (count - 1);
}

/** Nearest series index for a track fraction, clamped into range. */
export function indexAt(fraction: number, count: number): number {
  if (count <= 1) return 0;
  const i = Math.round(fraction * (count - 1));
  return i < 0 ? 0 : i > count - 1 ? count - 1 : i;
}

/**
 * Slider ticks, built from the series keys with the **X axis** config — the same
 * `ticks` / `tickFormat` / label rules the bar chart's category axis uses, so a
 * config that thins a crowded X axis thins a crowded slider identically.
 */
export function sliderTicks(series: (Scalar | undefined)[], cfg: ResolvedAxis): AxisTick[] {
  if (!cfg.show || cfg.ticks === false) return [];
  const fmt = cfg.tickFormat ?? formatValue;
  let stride = 1;
  if (typeof cfg.ticks === 'number' && cfg.ticks > 0 && series.length > cfg.ticks) {
    stride = Math.ceil(series.length / cfg.ticks);
  }
  const out: AxisTick[] = [];
  for (let i = 0; i < series.length; i += stride) {
    const key = series[i];
    const value: Scalar = key === undefined ? i + 1 : key;
    out.push({ value, pos: trackPos(i, series.length), label: fmt(value) });
  }
  return out;
}

/** The slider track in device pixels: the chart and the overlay share this. */
export interface SliderTrack {
  x0: number;
  x1: number;
  y: number;
  /** Handle radius, device px (also the drag hit radius). */
  handle: number;
}

/**
 * Track geometry in device px for a plot rect. Kept here — not in the overlay —
 * so drawing and hit-testing can never drift apart.
 *
 * `offsetPx` (device px) pushes the track further away from the plot, for a
 * chart that already draws something in that gutter: a candlestick chart's
 * period axis sits between the plot and a bottom slider, and without the offset
 * the handle would land on top of its tick labels.
 */
export function sliderTrack(
  slider: ResolvedSlider,
  plotRect: [number, number, number, number],
  deviceW: number,
  deviceH: number,
  dpr: number,
  offsetPx = 0,
): SliderTrack {
  const [x0, y0, , y1] = plotRect;
  const x1 = plotRect[2];
  const handle = slider.handlePx * dpr;
  // The band sits just outside the plot on its edge, past anything already
  // drawn in that gutter.
  const y =
    slider.position === 'bottom'
      ? (1 - y0) * deviceH + offsetPx + handle + 4 * dpr
      : (1 - y1) * deviceH - offsetPx - handle - 4 * dpr;
  return { x0: x0 * deviceW, x1: x1 * deviceW, y, handle };
}

/** Track fraction 0..1 for a device-px x, clamped. */
export function fractionAtPx(track: SliderTrack, px: number): number {
  const span = track.x1 - track.x0;
  if (span <= 0) return 0;
  const f = (px - track.x0) / span;
  return f < 0 ? 0 : f > 1 ? 1 : f;
}

/**
 * Height the slider reserves on its edge, in CSS px: handle, track gap, tick
 * labels, and the axis title when one is set. Mirrors `axisMargins`'s
 * accounting so the plot never overlaps the control.
 */
export function sliderBandPx(slider: ResolvedSlider, axis: ResolvedAxis): number {
  if (!slider.show) return 0;
  const ticks = axis.show && axis.ticks !== false;
  const labels = ticks ? axis.fontPx + 6 : 0;
  const title = axis.show && axis.label ? axis.fontPx + 6 : 0;
  return slider.handlePx * 2 + 8 + labels + title;
}

/** Everything {@link drawSlider} needs; supplied by the chart's overlay state. */
export interface SliderRender {
  slider: ResolvedSlider;
  /** X axis config — styles the slider's ticks and title. */
  axis: ResolvedAxis;
  ticks: AxisTick[];
  /** Handle position along the track, 0..1 (animated, so not always on a tick). */
  pos: number;
  plotRect: [number, number, number, number];
  deviceW: number;
  deviceH: number;
  dpr: number;
  /** Extra gutter already in use on the slider's edge, device px. Default 0. */
  offsetPx?: number;
}

/**
 * Draw the slider — track, ticks (thinned by the X axis' `ticks` count), the
 * axis title, and the handle — onto an already-positioned overlay context.
 */
export function drawSlider(ctx: CanvasRenderingContext2D, s: SliderRender): void {
  const { slider: sl, axis: cfg, dpr } = s;
  const color = sl.color ?? cfg.color;
  const track = sliderTrack(sl, s.plotRect, s.deviceW, s.deviceH, dpr, s.offsetPx ?? 0);
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
  ctx.font = `${cfg.fontWeight} ${cfg.fontPx * dpr}px ${cfg.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = sl.position === 'bottom' ? 'top' : 'bottom';
  for (const t of s.ticks) {
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
  const hx = leftPx + s.pos * (rightPx - leftPx);
  ctx.beginPath();
  ctx.arc(hx, trackY, handle, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(16,20,28,0.92)';
  ctx.fill();
  ctx.lineWidth = 2 * dpr;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();
}
