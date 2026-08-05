// Reuse the bar chart's reveal-ramp math verbatim so line/bar reveals match.
import { revealFactor } from '../../core/chrome/reveal.js';
import type { Easing } from '../../core/particles/anim.js';
import type { LineChartConfig, LineShape } from './types.js';

export { revealFactor };

export interface ResolvedLineFill {
  on: boolean;
  opacity: number;
}

export interface ResolvedLine {
  /** Whether a stroke is drawn (false when style is 'none'). */
  on: boolean;
  style: LineShape;
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

export interface ResolvedLineStyle {
  /** True when any solid layer is drawn (gates overlay mount + reveal loop). */
  enabled: boolean;
  /** Stack series into a stacked area chart. */
  stack: boolean;
  fill: ResolvedLineFill;
  line: ResolvedLine;
  reveal: ResolvedReveal;
}

export function resolveLineStyle(cfg: LineChartConfig): ResolvedLineStyle {
  const l = cfg.line;
  const fillCfg = l?.fill;
  const fill: ResolvedLineFill = {
    on: fillCfg != null,
    opacity: fillCfg?.opacity ?? 1,
  };

  const ln = l?.line;
  // A `line` block present but no style given defaults to a straight stroke.
  const style: LineShape = ln?.style ?? (ln != null ? 'straight' : 'none');
  const line: ResolvedLine = {
    on: ln != null && style !== 'none',
    style,
    width: ln?.width ?? 1,
    opacity: ln?.opacity ?? 1,
  };

  const rv = l?.reveal;
  const reveal: ResolvedReveal = {
    start: rv?.start ?? 'afterPour',
    duration: (rv?.duration ?? 500) / 1000,
    ease: rv?.ease ?? 'easeOutCubic',
    grainsTo: rv?.grainsTo ?? 0,
  };

  return { enabled: fill.on || line.on, stack: l?.stack ?? false, fill, line, reveal };
}
