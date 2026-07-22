import { type Easing, ease } from '../../core/particles/anim.js';
import type { BarChartConfig } from './types.js';

/**
 * Reveal factor in [0,1] at time `now` (seconds). 0 before `start`, eased ramp
 * across `duration` seconds, 1 after. Drives both the grain fade-out and the
 * fill/border fade-in. `duration <= 0` snaps to a step at `start`.
 */
export function revealFactor(now: number, start: number, duration: number, easing: Easing): number {
  if (now <= start) return 0;
  if (duration <= 0) return 1;
  const p = (now - start) / duration;
  return ease(p, easing);
}

export interface ResolvedFill {
  on: boolean;
  opacity: number;
}

export interface ResolvedBorder {
  any: boolean;
  left: boolean;
  top: boolean;
  right: boolean;
  bottom: boolean;
  width: number;
  opacity: number;
}

export interface ResolvedReveal {
  /** Fade start: 'afterPour' or absolute seconds from animation start. */
  start: 'afterPour' | number;
  /** Fade window in seconds. */
  duration: number;
  ease: Easing;
  /** Grain end-opacity in [0,1]. */
  grainsTo: number;
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

  const rv = b?.reveal;
  const reveal: ResolvedReveal = {
    start: rv?.start ?? 'afterPour',
    duration: (rv?.duration ?? 500) / 1000,
    ease: rv?.ease ?? 'easeOutCubic',
    grainsTo: rv?.grainsTo ?? 0,
  };

  return { enabled: fill.on || border.any, fill, border, reveal };
}
