import { describe, expect, it } from 'vitest';
import { allocGrains } from './grains.js';
import { type BarRect, grainCounts, packBars } from './pack.js';

const bars: BarRect[] = [
  { x: 0, width: 0.2, height: 0.5, colorIdx: 0, barId: 0 },
  { x: 0.3, width: 0.2, height: 1.0, colorIdx: 1, barId: 1 },
];

describe('grainCounts', () => {
  it('scales by area and density', () => {
    const c = grainCounts(bars, { density: 1 });
    // bar1 has double the height => ~2x grains of bar0
    expect(c[1]!).toBeGreaterThan(c[0]!);
  });
  it('respects maxGrains ceiling', () => {
    const c = grainCounts(bars, { density: 1000, maxGrains: 500 });
    expect(c.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(500);
  });
  it('zero density => zero grains', () => {
    expect(grainCounts(bars, { density: 0 })).toEqual([0, 0]);
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
