import {
  type ResolvedFill,
  type ResolvedReveal,
  resolveReveal,
  revealFactor,
} from '../../core/chrome/reveal.js';
import type { PieChartConfig } from './types.js';

// The reveal ramp is identical across every visual in the library; it lives in
// `core` and is re-exported here rather than copied.
export { revealFactor };
export type { ResolvedFill, ResolvedReveal };

export interface ResolvedSliceBorder {
  /** True when the wedge outline is drawn. */
  any: boolean;
  width: number;
  opacity: number;
}

export interface ResolvedPieStyle {
  /** True when any solid layer is drawn (gates the reveal loop). */
  enabled: boolean;
  fill: ResolvedFill;
  border: ResolvedSliceBorder;
  reveal: ResolvedReveal;
}

/** Resolve the `slices` config block into concrete values. */
export function resolvePieStyle(cfg: PieChartConfig): ResolvedPieStyle {
  const s = cfg.slices;
  const fillCfg = s?.fill;
  const fill: ResolvedFill = {
    on: fillCfg != null,
    opacity: fillCfg?.opacity ?? 1,
  };

  const bd = s?.border;
  const border: ResolvedSliceBorder = {
    any: bd != null && (bd.show ?? true),
    width: bd?.width ?? 1,
    opacity: bd?.opacity ?? 1,
  };

  return { enabled: fill.on || border.any, fill, border, reveal: resolveReveal(s?.reveal) };
}
