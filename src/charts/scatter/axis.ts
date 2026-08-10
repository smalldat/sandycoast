import type { ResolvedAxis } from '../../core/chrome/chrome.js';
// Tick shape + label formatting are shared by every visual (they live in core).
import { type AxisTick, formatNumber, formatValue } from '../../core/chrome/format.js';
import type { ScatterLayout } from './layout.js';

export { formatNumber };
export type { AxisTick };

export interface AxisModel {
  x: AxisTick[];
  y: AxisTick[];
}

/**
 * Build tick lists for x and y from a {@link ScatterLayout} and resolved axis
 * config. Both axes are continuous scales here (unlike bar/line's slotted x),
 * so ticks come straight from `scale.ticks()`/`scale.scale()` with no
 * PLOT_HEIGHT multiplier — the domain headroom is already baked into the
 * scale itself (see `layout.ts`'s `AXIS_PADDING`).
 */
export function buildAxes(
  layout: ScatterLayout,
  xAxis: ResolvedAxis,
  yAxis: ResolvedAxis,
): AxisModel {
  return { x: buildTicks(layout.xScale, xAxis), y: buildTicks(layout.yScale, yAxis) };
}

function buildTicks(scale: ScatterLayout['xScale'], cfg: ResolvedAxis): AxisTick[] {
  if (!cfg.show || cfg.ticks === false) return [];
  const count = cfg.ticks === undefined ? 5 : cfg.ticks;
  const fmt = cfg.tickFormat ?? formatValue;
  return scale.ticks(count).map((v) => ({ value: v, pos: scale.scale(v), label: fmt(v) }));
}
