import {
  type ResolvedFill,
  type ResolvedReveal,
  resolveReveal,
  revealFactor,
} from '../../core/chrome/reveal.js';
import type { RGBA } from '../../core/render/types.js';
import { parseColor } from '../../core/util/color.js';
import { resolveDirection } from './direction.js';
import type {
  ActualConfig,
  CandleBody,
  CandleDirectionFn,
  CandlestickChartConfig,
} from './types.js';

// The reveal ramp and the fill shape are shared by every visual; they live in
// `core` and are re-exported here so the chart's public surface is one import.
export { revealFactor };
export type { ResolvedFill, ResolvedReveal };

/** Default rising color — a green that reads on both light and dark grounds. */
export const DEFAULT_RISING = '#2eb872';
/** Default falling color. */
export const DEFAULT_FALLING = '#e0555c';

export interface ResolvedCandleBorder {
  show: boolean;
  width: number;
  opacity: number;
}

export interface ResolvedWick {
  show: boolean;
  width: number;
  opacity: number;
}

export interface ResolvedCandleStyle {
  /** True when a solid body layer is drawn (gates the reveal ramp). */
  enabled: boolean;
  /** Palette the grains index into: `[rising, falling]`. */
  palette: RGBA[];
  rising: RGBA;
  falling: RGBA;
  /** The color rule, already resolved to a callable. */
  direction: CandleDirectionFn;
  body: CandleBody;
  /** Body width as a fraction of the x step. */
  width: number;
  fill: ResolvedFill;
  border: ResolvedCandleBorder;
  wick: ResolvedWick;
  reveal: ResolvedReveal;
}

export function resolveCandleStyle(cfg: CandlestickChartConfig): ResolvedCandleStyle {
  const c = cfg.candles;
  const rising = parseColor(c?.rising ?? DEFAULT_RISING);
  const falling = parseColor(c?.falling ?? DEFAULT_FALLING);

  const fillCfg = c?.fill;
  const fill: ResolvedFill = { on: fillCfg != null, opacity: fillCfg?.opacity ?? 1 };

  const bd = c?.border;
  const border: ResolvedCandleBorder = {
    show: bd != null && (bd.show ?? true),
    width: bd?.width ?? 1,
    opacity: bd?.opacity ?? 1,
  };

  const wk = c?.wick;
  const body = c?.body ?? 'openClose';
  const wick: ResolvedWick = {
    // A `'lowHigh'` body already spans the whole range: there is no wick left
    // to draw, so the flag is forced off rather than drawing a hidden line.
    show: body === 'openClose' && (wk?.show ?? true),
    width: wk?.width ?? 1,
    opacity: wk?.opacity ?? 1,
  };

  return {
    enabled: fill.on || border.show,
    palette: [rising, falling],
    rising,
    falling,
    direction: resolveDirection(c?.direction),
    body,
    width: c?.width ?? 0.62,
    fill,
    border,
    wick,
    reveal: resolveReveal(c?.reveal),
  };
}

export interface ResolvedActual {
  show: boolean;
  /** Line/marker color, or undefined to follow the current-value color. */
  color: string | undefined;
  width: number;
  opacity: number;
  dash: number[] | false;
  marker: boolean;
  format: ((v: number) => string) | undefined;
}

/** Resolve the live-price line block. Absent block ⇒ nothing drawn. */
export function resolveActual(cfg: ActualConfig | undefined): ResolvedActual {
  return {
    show: cfg != null && (cfg.show ?? true),
    color: cfg?.color,
    width: cfg?.width ?? 1,
    opacity: cfg?.opacity ?? 0.9,
    dash: cfg?.dash ?? [4, 4],
    marker: cfg?.marker ?? true,
    format: cfg?.format,
  };
}
