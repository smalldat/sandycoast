import { describe, expect, it } from 'vitest';
import {
  DataError,
  allCandles,
  appendCandles,
  patchCandles,
  removeCandles,
  resolveOhlcTypes,
  validateOhlc,
} from './dataset.js';
import type { Candle, OhlcDataSet } from './ohlc.js';

function candle(x: Candle['x'], close = 11): Candle {
  return { x, open: 10, high: 12, low: 9, close };
}

const DS: OhlcDataSet = {
  series: [
    { key: 'A', candles: [candle('Mon'), candle('Tue')] },
    { key: 'B', candles: [candle('Mon', 20)] },
  ],
};

describe('allCandles', () => {
  it('flattens every series in order', () => {
    expect(allCandles(DS).map((c) => c.close)).toEqual([11, 11, 20]);
  });
});

describe('resolveOhlcTypes', () => {
  it('infers the x type from the first candle', () => {
    expect(resolveOhlcTypes(DS).xType).toBe('category');
    const timed: OhlcDataSet = { series: [{ candles: [candle(new Date(0))] }] };
    expect(resolveOhlcTypes(timed).xType).toBe('time');
    const numeric: OhlcDataSet = { series: [{ candles: [candle(3)] }] };
    expect(resolveOhlcTypes(numeric).xType).toBe('number');
  });

  it('respects an explicit override and defaults an empty set to category', () => {
    expect(resolveOhlcTypes({ ...DS, xType: 'number' }).xType).toBe('number');
    expect(resolveOhlcTypes({ series: [] }).xType).toBe('category');
  });
});

describe('validateOhlc', () => {
  it('accepts a well-formed dataset', () => {
    expect(() => validateOhlc(DS)).not.toThrow();
  });

  it('rejects a missing x, a non-numeric price, and a bad actual', () => {
    expect(() =>
      validateOhlc({ series: [{ candles: [{ ...candle('Mon'), x: undefined as never }] }] }),
    ).toThrow(DataError);
    expect(() =>
      validateOhlc({ series: [{ candles: [{ ...candle('Mon'), close: '11' as never }] }] }),
    ).toThrow(DataError);
    expect(() =>
      validateOhlc({ series: [{ candles: [{ ...candle('Mon'), high: Number.NaN }] }] }),
    ).toThrow(DataError);
    expect(() =>
      validateOhlc({ series: [{ candles: [{ ...candle('Mon'), actual: Number.NaN }] }] }),
    ).toThrow(DataError);
  });

  it('rejects a malformed shape', () => {
    expect(() => validateOhlc({ series: undefined as never })).toThrow(DataError);
    expect(() => validateOhlc({ series: [{ candles: undefined as never }] })).toThrow(DataError);
  });

  it('tolerates a transposed high/low — the layout takes the extremes', () => {
    expect(() =>
      validateOhlc({
        series: [{ candles: [{ x: 'Mon', open: 10, high: 9, low: 12, close: 11 }] }],
      }),
    ).not.toThrow();
  });
});

describe('patchCandles', () => {
  it('sets only the given prices, matched by x', () => {
    const out = patchCandles(DS.series[0]!.candles, [{ x: 'Tue', close: 15, actual: 15.2 }]);
    expect(out[1]!.close).toBe(15);
    expect(out[1]!.actual).toBe(15.2);
    // Untouched fields keep their values — the streaming-feed contract.
    expect(out[1]!.open).toBe(10);
    expect(out[0]!.close).toBe(11);
  });

  it('does not mutate the input', () => {
    const input = DS.series[0]!.candles;
    patchCandles(input, [{ x: 'Mon', close: 99 }]);
    expect(input[0]!.close).toBe(11);
  });

  it('matches by String(), so a Date x can be patched', () => {
    const d = new Date(0);
    const out = patchCandles([candle(d)], [{ x: new Date(0), close: 42 }]);
    expect(out[0]!.close).toBe(42);
  });
});

describe('appendCandles / removeCandles', () => {
  it('appends clones', () => {
    const added = candle('Wed');
    const out = appendCandles(DS.series[0]!.candles, [added]);
    expect(out.length).toBe(3);
    expect(out[2]).not.toBe(added);
  });

  it('removes by positional index, negative from the end', () => {
    expect(removeCandles(DS.series[0]!.candles, [-1]).map((c) => c.x)).toEqual(['Mon']);
    expect(removeCandles(DS.series[0]!.candles, [0]).map((c) => c.x)).toEqual(['Tue']);
  });

  it('removes by x match', () => {
    expect(removeCandles(DS.series[0]!.candles, [{ x: 'Mon' }]).map((c) => c.x)).toEqual(['Tue']);
  });
});
