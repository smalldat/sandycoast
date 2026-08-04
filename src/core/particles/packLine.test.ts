import { describe, expect, it } from 'vitest';
import { allocGrains } from './grains.js';
import { type LineSeg, lineGrainCounts, packLine } from './pack.js';
import { mulberry32 } from './rng.js';

const segs: LineSeg[] = [
  { x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.6, colorIdx: 0, pointId: 0 },
  { x0: 0.5, y0: 0.6, x1: 0.9, y1: 0.3, colorIdx: 1, pointId: 1 },
];

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

/** Sample `y = f(x)` over [0,1] as `n` segments of a single series. */
function sampleSegs(n: number, f: (x: number) => number): LineSeg[] {
  return Array.from({ length: n }, (_, i) => ({
    x0: i / n,
    y0: f(i / n),
    x1: (i + 1) / n,
    y1: f((i + 1) / n),
    colorIdx: 0,
    pointId: i,
  }));
}

describe('lineGrainCounts', () => {
  it('weights grain counts by segment length', () => {
    const counts = lineGrainCounts(segs, { density: 1, thickness: 0.03 });
    expect(counts.length).toBe(2);
    expect(counts.every((n) => n > 0)).toBe(true);
    // seg0 is longer (0.4,0.4) than seg1 (0.4,-0.3), so it takes more grains.
    expect(counts[0]!).toBeGreaterThan(counts[1]!);
  });

  it('respects the global grain ceiling', () => {
    const counts = lineGrainCounts(segs, { density: 100, thickness: 0.03, maxGrains: 500 });
    expect(sum(counts)).toBe(500);
  });

  it('total is independent of the point count sampling the same curve', () => {
    const wave = (x: number): number => 0.5 + 0.4 * Math.sin(x * Math.PI * 6);
    const opts = { density: 0.6, thickness: 0.03, maxGrains: 100_000 };
    const coarse = sum(lineGrainCounts(sampleSegs(20, wave), opts));
    const fine = sum(lineGrainCounts(sampleSegs(5_000, wave), opts));
    expect(fine).toBe(coarse);
  });

  it('spends the whole budget on a densely sampled noisy line', () => {
    // Regression: per-segment flooring used to zero nearly every segment here,
    // leaving the chart far under its budget and clumped on the steep parts.
    const rand = mulberry32(3);
    const noisy = sampleSegs(5_000, () => rand());
    const counts = lineGrainCounts(noisy, { density: 1.4, thickness: 0.03, maxGrains: 10_000 });
    expect(sum(counts)).toBe(10_000);
  });
});

describe('packLine', () => {
  it('writes grains within layout bounds along the ribbon', () => {
    const counts = lineGrainCounts(segs, { density: 1, thickness: 0.03 });
    const total = counts.reduce((a, b) => a + b, 0);
    const g = allocGrains(total);
    const written = packLine(segs, counts, g, { density: 1, thickness: 0.03, seed: 1 });
    expect(written).toBe(total);
    for (let i = 0; i < total; i++) {
      expect(g.targetX[i]!).toBeGreaterThanOrEqual(0);
      expect(g.targetX[i]!).toBeLessThanOrEqual(1);
      expect(g.targetY[i]!).toBeGreaterThanOrEqual(0);
    }
  });

  it('tags each grain with its segment pointId for hover grouping', () => {
    const counts = lineGrainCounts(segs, { density: 1, thickness: 0.03 });
    const total = counts.reduce((a, b) => a + b, 0);
    const g = allocGrains(total);
    packLine(segs, counts, g, { density: 1, thickness: 0.03, seed: 1 });
    const ids = new Set<number>();
    for (let i = 0; i < total; i++) ids.add(g.barId[i]!);
    expect([...ids].sort()).toEqual([0, 1]);
  });
});
