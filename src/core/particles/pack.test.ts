import { describe, expect, it } from 'vitest';
import { allocGrains } from './grains.js';
import { type BarRect, distribute, grainCounts, packBars } from './pack.js';

const bars: BarRect[] = [
  { x: 0, width: 0.2, height: 0.5, colorIdx: 0, barId: 0 },
  { x: 0.3, width: 0.2, height: 1.0, colorIdx: 1, barId: 1 },
];

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

describe('distribute', () => {
  it('hands out every unit', () => {
    expect(sum(distribute(1000, [1, 2, 3, 4]))).toBe(1000);
  });

  it('splits in proportion to the weights', () => {
    expect(distribute(100, [1, 1, 2])).toEqual([25, 25, 50]);
  });

  it('does not starve slots when shares fall below one', () => {
    // 10k equal slots sharing 1000 units: flooring would zero all of them.
    const counts = distribute(1000, new Array(10_000).fill(1));
    expect(sum(counts)).toBe(1000);
    expect(counts.filter((n) => n > 0).length).toBe(1000);
    expect(Math.max(...counts)).toBe(1);
  });

  it('is deterministic under ties', () => {
    const w = new Array(7).fill(1);
    expect(distribute(10, w)).toEqual(distribute(10, w));
  });

  it('spreads evenly when every weight is zero', () => {
    expect(distribute(5, [0, 0, 0])).toEqual([2, 2, 1]);
  });

  it('handles empty and non-positive totals', () => {
    expect(distribute(100, [])).toEqual([]);
    expect(distribute(0, [1, 2])).toEqual([0, 0]);
  });
});

describe('grainCounts', () => {
  it('scales by area', () => {
    const c = grainCounts(bars, { density: 1 });
    // bar1 has double the height => ~2x grains of bar0
    expect(c[1]!).toBeGreaterThan(c[0]!);
  });
  it('respects maxGrains ceiling', () => {
    const c = grainCounts(bars, { density: 1000, maxGrains: 500 });
    expect(sum(c)).toBe(500);
  });
  it('zero density => zero grains', () => {
    expect(grainCounts(bars, { density: 0 })).toEqual([0, 0]);
  });
  it('total is independent of how many bars the data has', () => {
    const many: BarRect[] = Array.from({ length: 400 }, (_, i) => ({
      x: i / 400,
      width: 1 / 400,
      height: 0.75,
      colorIdx: 0,
      barId: i,
    }));
    const few = many.slice(0, 3);
    const opts = { density: 0.5, maxGrains: 50_000 };
    expect(sum(grainCounts(many, opts))).toBe(sum(grainCounts(few, opts)));
  });
});

describe('packBars', () => {
  it('writes targets within each bar rect', () => {
    const counts = grainCounts(bars, { density: 0.5, maxGrains: 5000 });
    const total = counts.reduce((a, b) => a + b, 0);
    const g = allocGrains(total);
    const written = packBars(bars, counts, g, { density: 0.5, jitter: 0 });
    expect(written).toBe(total);

    for (let i = 0; i < total; i++) {
      const bar = bars[g.barId[i]!]!;
      expect(g.targetX[i]!).toBeGreaterThanOrEqual(bar.x - 1e-6);
      expect(g.targetX[i]!).toBeLessThanOrEqual(bar.x + bar.width + 1e-6);
      expect(g.targetY[i]!).toBeGreaterThanOrEqual(0);
      expect(g.targetY[i]!).toBeLessThanOrEqual(bar.height + 1e-6);
    }
  });

  it('is deterministic for a fixed seed', () => {
    const counts = grainCounts(bars, { density: 0.5, maxGrains: 5000 });
    const total = counts.reduce((a, b) => a + b, 0);
    const a = allocGrains(total);
    const b = allocGrains(total);
    packBars(bars, counts, a, { density: 0.5, seed: 42 });
    packBars(bars, counts, b, { density: 0.5, seed: 42 });
    expect(Array.from(a.targetX)).toEqual(Array.from(b.targetX));
  });
});
