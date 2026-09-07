import type { ResolvedAxis } from '../../core/chrome/chrome.js';
// Tick shape + label formatting are shared by every visual (they live in core).
import { type AxisTick, formatNumber, formatValue } from '../../core/chrome/format.js';
import type { CandleLayout } from './layout.js';

export { formatNumber };
export type { AxisTick };

export interface AxisModel {
  x: AxisTick[];
  y: AxisTick[];
}

/**
 * Build tick lists for the period (X) and price (Y) axes from a
 * {@link CandleLayout}. X follows whichever spacing the layout resolved:
 * discrete slots get one tick per candle (thinned by the `ticks` count, like
 * the bar chart's category axis), a continuous scale gets `scale.ticks()`.
 * Y always comes straight from the padded price scale.
 */
export function buildAxes(
  layout: CandleLayout,
  xAxis: ResolvedAxis,
  yAxis: ResolvedAxis,
): AxisModel {
  return { x: buildX(layout, xAxis), y: buildY(layout, yAxis) };
}

function buildY(layout: CandleLayout, cfg: ResolvedAxis): AxisTick[] {
  if (!cfg.show || cfg.ticks === false) return [];
  const count = cfg.ticks === undefined ? 5 : cfg.ticks;
  const fmt = cfg.tickFormat ?? formatValue;
  return layout.yScale
    .ticks(count)
    .map((v) => ({ value: v, pos: layout.yScale.scale(v), label: fmt(v) }));
}

function buildX(layout: CandleLayout, cfg: ResolvedAxis): AxisTick[] {
  if (!cfg.show || cfg.ticks === false) return [];
  const fmt = cfg.tickFormat ?? formatValue;

  if (layout.spacing === 'time' && layout.xScale) {
    const count = cfg.ticks === undefined ? 6 : cfg.ticks;
    return layout.xScale
      .ticks(count)
      .map((v) => ({ value: v, pos: layout.xScale!.scale(v), label: fmt(v) }));
  }

  // Discrete slots: a tick count thins the labels evenly, an omitted count
  // labels every candle (which is only readable for short series).
  const slots = layout.xSlots;
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
