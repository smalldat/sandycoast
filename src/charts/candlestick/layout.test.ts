import { describe, expect, it } from 'vitest';
import type { Candle, OhlcDataSet } from '../../core/data/ohlc.js';
import { parseColor } from '../../core/util/color.js';
import { resolveDirection } from './direction.js';
import { type CandleLayoutOptions, hitCandle, layoutCandles } from './layout.js';

const RISING = parseColor('#00ff00');
const FALLING = parseColor('#ff0000');

function opts(over: Partial<CandleLayoutOptions> = {}): CandleLayoutOptions {
  return {
    seriesIndex: 0,
    maxCandles: 0,
    maxSeries: 0,
    spacing: 'band',
    width: 0.6,
    body: 'openClose',
    direction: resolveDirection('openClose'),
    rising: RISING,
    falling: FALLING,
    ...over,
  };
}

function candle(x: string | number | Date, o: number, h: number, l: number, c: number): Candle {
  return { x, open: o, high: h, low: l, close: c };
}

const THREE: OhlcDataSet = {
  series: [
    {
      key: 'ACME',
      candles: [
        candle('Mon', 10, 12, 9, 11),
        candle('Tue', 11, 13, 10.5, 10.6),
        candle('Wed', 10.6, 14, 10, 13.5),
      ],
    },
  ],
};

describe('layoutCandles — band spacing', () => {
  it('emits one body box and one meta per candle, evenly slotted', () => {
    const { boxes, metas, xSlots, step } = layoutCandles(THREE, opts());
    expect(boxes.length).toBe(3);
    expect(metas.length).toBe(3);
    expect(step).toBeCloseTo(1 / 3, 10);
    expect(xSlots.map((s) => s.center)).toEqual([1 / 6, 0.5, 5 / 6]);
    expect(metas.map((m) => m.cx)).toEqual([1 / 6, 0.5, 5 / 6]);
  });

  it('sizes the body from the width fraction of the step', () => {
    const { metas } = layoutCandles(THREE, opts({ width: 0.6 }));
    const m = metas[1]!;
    expect(m.x1 - m.x0).toBeCloseTo((1 / 3) * 0.6, 10);
    expect((m.x0 + m.x1) / 2).toBeCloseTo(m.cx, 10);
  });

  it('colors by the direction rule and indexes rising=0 / falling=1', () => {
    const { boxes, metas } = layoutCandles(THREE, opts());
    expect(metas.map((m) => m.rising)).toEqual([true, false, true]);
    expect(metas.map((m) => m.color)).toEqual([RISING, FALLING, RISING]);
    expect(boxes.map((b) => b.colorIdx)).toEqual([0, 1, 0]);
  });

  it('spans the body open→close and the wick low→high', () => {
    const { metas } = layoutCandles(THREE, opts());
    const [first] = metas;
    // Prices rise up the plot, so the higher price has the greater layout y.
    expect(first!.bodyHigh).toBeGreaterThan(first!.bodyLow);
    expect(first!.wickHigh).toBeGreaterThan(first!.bodyHigh);
    expect(first!.wickLow).toBeLessThan(first!.bodyLow);
  });

  it("spans the body low→high (and leaves no wick) for body: 'lowHigh'", () => {
    const { metas } = layoutCandles(THREE, opts({ body: 'lowHigh' }));
    const m = metas[0]!;
    expect(m.bodyHigh).toBeCloseTo(m.wickHigh, 10);
    expect(m.bodyLow).toBeCloseTo(m.wickLow, 10);
  });

  it('gives a doji a minimum body height so it still carries grains', () => {
    const doji: OhlcDataSet = { series: [{ candles: [candle('Mon', 10, 11, 9, 10)] }] };
    const { boxes, metas } = layoutCandles(doji, opts());
    expect(metas[0]!.bodyHigh - metas[0]!.bodyLow).toBeGreaterThan(0);
    expect(boxes[0]!.height).toBeGreaterThan(0);
  });

  it('reads the wick extent from all four prices when high/low are transposed', () => {
    const bad: OhlcDataSet = { series: [{ candles: [candle('Mon', 10, 9, 12, 11)] }] };
    const { metas } = layoutCandles(bad, opts());
    expect(metas[0]!.wickHigh).toBeGreaterThanOrEqual(metas[0]!.wickLow);
  });

  it('keeps every price inside the plot, with headroom off the extremes', () => {
    const { metas } = layoutCandles(THREE, opts());
    for (const m of metas) {
      expect(m.wickLow).toBeGreaterThan(0);
      expect(m.wickHigh).toBeLessThan(1);
      expect(m.x0).toBeGreaterThanOrEqual(0);
      expect(m.x1).toBeLessThanOrEqual(1);
    }
  });
});

describe('layoutCandles — series selection', () => {
  const two: OhlcDataSet = {
    series: [
      { key: 'A', candles: [candle('Mon', 10, 12, 9, 11)] },
      { key: 'B', candles: [candle('Mon', 50, 55, 48, 49)] },
    ],
  };

  it('draws only the selected series and reports every key', () => {
    const a = layoutCandles(two, opts({ seriesIndex: 0 }));
    const b = layoutCandles(two, opts({ seriesIndex: 1 }));
    expect(a.series).toEqual(['A', 'B']);
    expect(a.metas[0]!.close).toBe(11);
    expect(b.metas[0]!.close).toBe(49);
    expect(b.metas[0]!.seriesKey).toBe('B');
  });

  it('clamps an out-of-range series index', () => {
    expect(layoutCandles(two, opts({ seriesIndex: 9 })).seriesIndex).toBe(1);
    expect(layoutCandles(two, opts({ seriesIndex: -3 })).seriesIndex).toBe(0);
  });

  it('caps candles and series', () => {
    const capped = layoutCandles(THREE, opts({ maxCandles: 2 }));
    expect(capped.metas.length).toBe(2);
    expect(layoutCandles(two, opts({ maxSeries: 1 })).series).toEqual(['A']);
  });

  it('handles an empty dataset without throwing', () => {
    const empty = layoutCandles({ series: [] }, opts());
    expect(empty.metas).toEqual([]);
    expect(empty.actual).toBeUndefined();
  });
});

describe('layoutCandles — actual (live price)', () => {
  it('takes the last candle that carries one, and keeps it on screen', () => {
    const ds: OhlcDataSet = {
      series: [
        {
          candles: [
            { ...candle('Mon', 10, 12, 9, 11), actual: 10.5 },
            { ...candle('Tue', 11, 13, 10, 12), actual: 40 },
          ],
        },
      ],
    };
    const layout = layoutCandles(ds, opts());
    expect(layout.actual).toBe(40);
    // A live price far above every close still has to fit in the plot.
    const pos = layout.yScale.scale(40);
    expect(pos).toBeGreaterThan(0);
    expect(pos).toBeLessThan(1);
  });

  it('is undefined when no candle carries one', () => {
    expect(layoutCandles(THREE, opts()).actual).toBeUndefined();
  });
});

describe('layoutCandles — time spacing', () => {
  const day = 24 * 60 * 60 * 1000;
  const timed: OhlcDataSet = {
    series: [
      {
        candles: [
          candle(new Date(0), 10, 12, 9, 11),
          candle(new Date(day), 11, 13, 10, 12),
          // A three-day gap: a real weekend, which band spacing would collapse.
          candle(new Date(4 * day), 12, 14, 11, 13),
        ],
      },
    ],
  };

  it('positions candles at their real x, leaving the gap visible', () => {
    const { metas, spacing } = layoutCandles(timed, opts({ spacing: 'time' }));
    expect(spacing).toBe('time');
    const [a, b, c] = metas.map((m) => m.cx);
    expect(b! - a!).toBeGreaterThan(0);
    // The 3-day gap must be wider than the 1-day one — the whole reason to
    // choose time spacing over band.
    expect(c! - b!).toBeGreaterThan((b! - a!) * 2);
  });

  it('keeps the first and last body inside the plot', () => {
    const { metas } = layoutCandles(timed, opts({ spacing: 'time' }));
    expect(metas[0]!.x0).toBeGreaterThan(0);
    expect(metas[metas.length - 1]!.x1).toBeLessThan(1);
  });

  it('falls back to band spacing for a categorical x', () => {
    const { spacing, metas } = layoutCandles(THREE, opts({ spacing: 'time' }));
    expect(spacing).toBe('band');
    expect(metas.map((m) => m.cx)).toEqual([1 / 6, 0.5, 5 / 6]);
  });
});

describe('hitCandle', () => {
  const { metas, step } = layoutCandles(THREE, opts());

  it('selects by column, anywhere in the candle’s slot', () => {
    // Well above the first candle's wick, but still in its column.
    expect(hitCandle(metas, step, 1 / 6, 0.95)?.candleId).toBe(0);
    expect(hitCandle(metas, step, 0.5, 0.1)?.candleId).toBe(1);
  });

  it('picks the nearer column at a boundary', () => {
    expect(hitCandle(metas, step, 1 / 3 - 0.01, 0.5)?.candleId).toBe(0);
    expect(hitCandle(metas, step, 1 / 3 + 0.01, 0.5)?.candleId).toBe(1);
  });

  it('misses outside the plot vertically', () => {
    expect(hitCandle(metas, step, 0.5, 1.2)).toBeNull();
    expect(hitCandle(metas, step, 0.5, -0.2)).toBeNull();
  });

  it('misses beyond the last column', () => {
    expect(hitCandle(metas, step, 1.4, 0.5)).toBeNull();
  });
});
