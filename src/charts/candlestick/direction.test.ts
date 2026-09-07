import { describe, expect, it } from 'vitest';
import type { Candle } from '../../core/data/ohlc.js';
import { resolveDirection } from './direction.js';

function candle(over: Partial<Candle> = {}): Candle {
  return { x: 'p', open: 10, high: 12, low: 9, close: 11, ...over };
}

describe('resolveDirection', () => {
  it('openClose: rising when the close is at or above the open', () => {
    const rule = resolveDirection('openClose');
    expect(rule(candle({ open: 10, close: 11 }), undefined, 0)).toBe(true);
    expect(rule(candle({ open: 10, close: 10 }), undefined, 0)).toBe(true);
    expect(rule(candle({ open: 10, close: 9.5 }), undefined, 0)).toBe(false);
  });

  it('closeClose: compares against the previous close', () => {
    const rule = resolveDirection('closeClose');
    const prev = candle({ close: 12 });
    // Falls even though it closed above its own open, because it closed below
    // the previous bar — the whole point of the rule.
    expect(rule(candle({ open: 10, close: 11 }), prev, 1)).toBe(false);
    expect(rule(candle({ open: 13, close: 12.5 }), prev, 1)).toBe(true);
  });

  it('lowHigh: compares the range midpoints', () => {
    const rule = resolveDirection('lowHigh');
    const prev = candle({ high: 12, low: 10 }); // mid 11
    // Range shifted up even though the bar itself closed down.
    expect(rule(candle({ open: 13, close: 12, high: 14, low: 11 }), prev, 1)).toBe(true);
    expect(rule(candle({ open: 10, close: 11, high: 11, low: 9 }), prev, 1)).toBe(false);
  });

  it('closeInRange: rising when the close sits in the upper half of its range', () => {
    const rule = resolveDirection('closeInRange');
    expect(rule(candle({ high: 12, low: 10, close: 11.5 }), undefined, 0)).toBe(true);
    expect(rule(candle({ high: 12, low: 10, close: 10.5 }), undefined, 0)).toBe(false);
    // Exactly mid-range counts as rising (>=), like every other rule's tie.
    expect(rule(candle({ high: 12, low: 10, close: 11 }), undefined, 0)).toBe(true);
  });

  it('closeInRange falls back to open/close for a flat range', () => {
    const rule = resolveDirection('closeInRange');
    expect(rule(candle({ open: 10, high: 11, low: 11, close: 11 }), undefined, 0)).toBe(true);
    expect(rule(candle({ open: 12, high: 11, low: 11, close: 11 }), undefined, 0)).toBe(false);
  });

  it('every previous-candle rule falls back to open/close for the first candle', () => {
    for (const kind of ['closeClose', 'lowHigh'] as const) {
      const rule = resolveDirection(kind);
      expect(rule(candle({ open: 10, close: 11 }), undefined, 0)).toBe(true);
      expect(rule(candle({ open: 10, close: 9 }), undefined, 0)).toBe(false);
    }
  });

  it('passes a custom rule through untouched', () => {
    const custom = (c: Candle): boolean => c.high > 100;
    expect(resolveDirection(custom)).toBe(custom);
  });

  it('defaults to openClose for an omitted or unknown rule', () => {
    expect(resolveDirection(undefined)(candle({ open: 10, close: 11 }), undefined, 0)).toBe(true);
    const unknown = resolveDirection('nope' as never);
    expect(unknown(candle({ open: 10, close: 9 }), undefined, 0)).toBe(false);
  });
});
