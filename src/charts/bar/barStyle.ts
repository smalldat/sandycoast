import {
  type ResolvedFill,
  type ResolvedReveal,
  resolveReveal,
  revealFactor,
} from '../../core/chrome/reveal.js';
import type { BarChartConfig } from './types.js';

// The reveal ramp and the fill/reveal shapes are shared by every visual; they
// live in `core` and are re-exported here so the public API is unchanged.
export { revealFactor };
export type { ResolvedFill, ResolvedReveal };

export interface ResolvedBorder {
  any: boolean;
  left: boolean;
  top: boolean;
  right: boolean;
  bottom: boolean;
  width: number;
  opacity: number;
}

export interface ResolvedBarStyle {
  /** True when any solid layer is drawn (gates overlay mount + reveal loop). */
  enabled: boolean;
  fill: ResolvedFill;
  border: ResolvedBorder;
  reveal: ResolvedReveal;
}

export function resolveBarStyle(cfg: BarChartConfig): ResolvedBarStyle {
  const b = cfg.bars;
  const fillCfg = b?.fill;
  const fill: ResolvedFill = {
    on: fillCfg != null,
    opacity: fillCfg?.opacity ?? 1,
  };

  const bd = b?.border;
  // If a border block is present but no side is specified, outline all four.
  const anySideSet =
    bd != null && (bd.left != null || bd.top != null || bd.right != null || bd.bottom != null);
  const sideDefault = bd != null && !anySideSet;
  const left = bd?.left ?? sideDefault;
  const top = bd?.top ?? sideDefault;
  const right = bd?.right ?? sideDefault;
  const bottom = bd?.bottom ?? sideDefault;
  const border: ResolvedBorder = {
    any: bd != null && (left || top || right || bottom),
    left,
    top,
    right,
    bottom,
    width: bd?.width ?? 1,
    opacity: bd?.opacity ?? 1,
  };

  return { enabled: fill.on || border.any, fill, border, reveal: resolveReveal(b?.reveal) };
}
