import type { Scalar } from '../../core/data/types.js';
import type { ResolvedAxis } from './chrome.js';
import { type BarLayout, PLOT_HEIGHT } from './layout.js';

/** One rendered tick: its value, layout position [0,1], and formatted label. */
export interface AxisTick {
  value: Scalar;
  /** Layout position along the axis, [0,1]. */
  pos: number;
  label: string;
}

export interface AxisModel {
  x: AxisTick[];
  y: AxisTick[];
}

/** Compact number format: trims trailing zeros, keeps big/small readable. */
export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  if (v === 0) return '0';
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toLocaleString('en-US');
  if (abs < 0.001) return v.toExponential(1);
  return String(Math.round(v * 1000) / 1000);
}

function formatValue(v: Scalar): string {
  if (typeof v === 'number') return formatNumber(v);
  if (v instanceof Date) return v.toLocaleDateString('en-US');
  return String(v);
}

/**
 * Build tick lists for x and y from a {@link BarLayout} and resolved axis config.
 * Reuses the exact scales the grains were packed with so ticks align to bars.
 */
export function buildAxes(layout: BarLayout, xAxis: ResolvedAxis, yAxis: ResolvedAxis): AxisModel {
  return { x: buildX(layout, xAxis), y: buildY(layout, yAxis) };
}

function buildY(layout: BarLayout, cfg: ResolvedAxis): AxisTick[] {
  if (!cfg.show || cfg.ticks === false) return [];
  const count = cfg.ticks === undefined ? 5 : cfg.ticks;
  const fmt = cfg.tickFormat ?? formatValue;
  return layout.yScale.ticks(count).map((v) => ({
    value: v,
    pos: layout.yScale.scale(v) * PLOT_HEIGHT,
    label: fmt(v),
  }));
}

function buildX(layout: BarLayout, cfg: ResolvedAxis): AxisTick[] {
  if (!cfg.show || cfg.ticks === false) return [];
  const fmt = cfg.tickFormat ?? formatValue;
  const slots = layout.xSlots;
  // X is discrete slots (grouped bands). A tick count thins the labels evenly;
  // omitted count shows every slot.
  let stride = 1;
  if (typeof cfg.ticks === 'number' && cfg.ticks > 0 && slots.length > cfg.ticks) {
    stride = Math.ceil(slots.length / cfg.ticks);
  }
  const out: AxisTick[] = [];
  for (let i = 0; i < slots.length; i += stride) {
    const s = slots[i]!;
    out.push({ value: s.value, pos: s.center, label: fmt(s.value) });
  }
  return out;
}
