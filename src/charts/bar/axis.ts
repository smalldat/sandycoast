import type { ResolvedAxis } from '../../core/chrome/chrome.js';
import { type AxisTick, formatNumber, formatValue } from '../../core/chrome/format.js';
import { type BarLayout, PLOT_HEIGHT } from './layout.js';

// Tick shape and number formatting are shared by every visual (they live in
// `core`); re-exported here so the bar chart's public surface is unchanged.
export { formatNumber };
export type { AxisTick };

export interface AxisModel {
  x: AxisTick[];
  y: AxisTick[];
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
