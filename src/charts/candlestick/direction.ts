import type { Candle } from '../../core/data/ohlc.js';
import type { CandleDirection, CandleDirectionFn } from './types.js';

/**
 * The color rule: given a candle and the one before it, is this candle rising?
 *
 * Kept in its own module (SRP) so the rules are unit-testable without a chart,
 * and resolved through one function (OCP) so a caller's own
 * {@link CandleDirectionFn} drops straight in where a built-in name goes.
 */

/** Midpoint of a candle's trading range, guarding a transposed high/low. */
function midpoint(c: Candle): number {
  return (Math.max(c.high, c.low) + Math.min(c.high, c.low)) / 2;
}

/** The fallback every rule shares for a candle with nothing before it. */
function openClose(c: Candle): boolean {
  return c.close >= c.open;
}

const RULES: Record<CandleDirection, CandleDirectionFn> = {
  openClose: (c) => openClose(c),
  closeClose: (c, prev) => (prev ? c.close >= prev.close : openClose(c)),
  lowHigh: (c, prev) => (prev ? midpoint(c) >= midpoint(prev) : openClose(c)),
  closeInRange: (c) => {
    const hi = Math.max(c.high, c.low);
    const lo = Math.min(c.high, c.low);
    // A zero-width range has no upper half to close in — fall back rather than
    // calling every flat candle rising on a coin-flip comparison.
    if (hi === lo) return openClose(c);
    return c.close - lo >= hi - c.close;
  },
};

/**
 * Resolve a `candles.direction` config value into a concrete rule. A function
 * is passed through untouched; an unknown string falls back to `'openClose'`.
 */
export function resolveDirection(
  rule: CandleDirection | CandleDirectionFn | undefined,
): CandleDirectionFn {
  if (typeof rule === 'function') return rule;
  return RULES[rule ?? 'openClose'] ?? RULES.openClose;
}
