import type { ResolvedAxis } from '../../core/chrome/chrome.js';
import { type AxisTick, formatNumber } from '../../core/chrome/format.js';
import type { Scalar } from '../../core/data/types.js';
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

function formatValue(v: Scalar): string {
  if (typeof v === 'number') return formatNumber(v);
  if (v instanceof Date) return v.toLocaleDateString('en-US');
  return String(v);
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
 */
export function sliderTrack(
  slider: ResolvedSlider,
  plotRect: [number, number, number, number],
  deviceW: number,
  deviceH: number,
  dpr: number,
): SliderTrack {
  const [x0, y0, , y1] = plotRect;
  const x1 = plotRect[2];
  const handle = slider.handlePx * dpr;
  // The band sits just outside the plot on its edge.
  const y =
    slider.position === 'bottom'
      ? (1 - y0) * deviceH + handle + 4 * dpr
      : (1 - y1) * deviceH - handle - 4 * dpr;
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
 * labels, and the axis title when one is set. Mirrors {@link axisMargins}'s
 * accounting so the plot never overlaps the control.
 */
export function sliderBandPx(slider: ResolvedSlider, axis: ResolvedAxis): number {
  if (!slider.show) return 0;
  const ticks = axis.show && axis.ticks !== false;
  const labels = ticks ? axis.fontPx + 6 : 0;
  const title = axis.show && axis.label ? axis.fontPx + 6 : 0;
  return slider.handlePx * 2 + 8 + labels + title;
}
