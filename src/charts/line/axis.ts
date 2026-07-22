import type { Scalar } from '../../core/data/types.js';
// Tick types + number formatting are shared with the bar chart.
import { type AxisModel, type AxisTick, formatNumber } from '../bar/axis.js';
import type { ResolvedAxis } from '../bar/chrome.js';
import { type LineLayout, PLOT_HEIGHT } from './layout.js';

export type { AxisModel, AxisTick };

function formatValue(v: Scalar): string {
  if (typeof v === 'number') return formatNumber(v);
  if (v instanceof Date) return v.toLocaleDateString('en-US');
  return String(v);
}

/**
 * Build tick lists for x and y from a {@link LineLayout} and resolved axis
 * config. Reuses the exact scales the grains were packed with so ticks align.
 */
export function buildAxes(layout: LineLayout, xAxis: ResolvedAxis, yAxis: ResolvedAxis): AxisModel {
  return { x: buildX(layout, xAxis), y: buildY(layout, yAxis) };
}

function buildY(layout: LineLayout, cfg: ResolvedAxis): AxisTick[] {
  if (!cfg.show || cfg.ticks === false) return [];
  const count = cfg.ticks === undefined ? 5 : cfg.ticks;
  const fmt = cfg.tickFormat ?? formatValue;
  return layout.yScale.ticks(count).map((v) => ({
    value: v,
    pos: layout.yScale.scale(v) * PLOT_HEIGHT,
    label: fmt(v),
  }));
}

function buildX(layout: LineLayout, cfg: ResolvedAxis): AxisTick[] {
  if (!cfg.show || cfg.ticks === false) return [];
  const fmt = cfg.tickFormat ?? formatValue;
  const slots = layout.xSlots;
  // X is discrete slots. A tick count thins the labels evenly; omitted count
  // shows every slot (thinned automatically only when a count is given).
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
