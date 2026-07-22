import { describe, expect, it } from 'vitest';
import { allocGrains } from './grains.js';
import { type LineSeg, lineGrainCounts, packLine } from './pack.js';

const segs: LineSeg[] = [
  { x0: 0.1, y0: 0.2, x1: 0.5, y1: 0.6, colorIdx: 0, pointId: 0 },
  { x0: 0.5, y0: 0.6, x1: 0.9, y1: 0.3, colorIdx: 1, pointId: 1 },
];

describe('lineGrainCounts', () => {
  it('scales grain counts with segment length', () => {
    const counts = lineGrainCounts(segs, { density: 1, thickness: 0.03 });
    expect(counts.length).toBe(2);
    expect(counts.every((n) => n > 0)).toBe(true);
  });

  it('respects the global grain ceiling', () => {
    const counts = lineGrainCounts(segs, { density: 100, thickness: 0.03, maxGrains: 500 });
    const total = counts.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(500);
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
