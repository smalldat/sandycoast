import { describe, expect, it } from 'vitest';
import { allocGrains } from './grains.js';
import {
  type BoxRect,
  GRAINS_AT_UNIT_DENSITY,
  boxArea,
  boxGrainCounts,
  packBoxes,
} from './pack.js';

function box(x: number, y: number, over: Partial<BoxRect> = {}): BoxRect {
  return { x, y, width: 0.1, height: 0.2, colorIdx: 0, barId: 0, ...over };
}

describe('boxArea', () => {
  it('is width * height', () => {
    expect(boxArea(box(0.1, 0.5, { width: 0.2, height: 0.3 }))).toBeCloseTo(0.06, 10);
  });

  it('is zero for a degenerate box', () => {
    expect(boxArea(box(0.1, 0.5, { height: 0 }))).toBe(0);
    expect(boxArea(box(0.1, 0.5, { width: -1 }))).toBe(0);
  });
});

describe('boxGrainCounts', () => {
  it('spends the whole density-driven budget, shared by area', () => {
    const boxes = [box(0.1, 0.5, { height: 0.2 }), box(0.5, 0.5, { height: 0.1 })];
    const counts = boxGrainCounts(boxes, { density: 1 });
    expect(counts.reduce((a, b) => a + b, 0)).toBe(GRAINS_AT_UNIT_DENSITY);
    // Twice the area, twice the sand.
    expect(counts[0]! / counts[1]!).toBeCloseTo(2, 1);
  });

  it('is bounded by maxGrains, not by how many boxes there are', () => {
    const many = Array.from({ length: 500 }, (_, i) => box(i / 500, 0.4, { width: 0.001 }));
    const counts = boxGrainCounts(many, { density: 4, maxGrains: 5000 });
    expect(counts.reduce((a, b) => a + b, 0)).toBe(5000);
  });
});

describe('packBoxes', () => {
  it('writes every grain inside its own box', () => {
    const b = box(0.3, 0.4, { width: 0.2, height: 0.25, barId: 7, colorIdx: 1 });
    const counts = [400];
    const g = allocGrains(counts[0]!);
    const written = packBoxes([b], counts, g, { density: 1, jitter: 0 });

    expect(written).toBe(400);
    for (let i = 0; i < written; i++) {
      expect(g.targetX[i]!).toBeGreaterThanOrEqual(b.x);
      expect(g.targetX[i]!).toBeLessThanOrEqual(b.x + b.width);
      expect(g.targetY[i]!).toBeGreaterThanOrEqual(b.y);
      expect(g.targetY[i]!).toBeLessThanOrEqual(b.y + b.height);
      expect(g.barId[i]!).toBe(7);
      expect(g.colorIdx[i]!).toBe(1);
    }
  });

  it('floats the box off the baseline (unlike a bar)', () => {
    const b = box(0.1, 0.6, { height: 0.1 });
    const g = allocGrains(200);
    packBoxes([b], [200], g, { density: 1, jitter: 0 });
    // Nothing may leak down toward y=0: that is the whole difference from packBars.
    for (let i = 0; i < 200; i++) expect(g.targetY[i]!).toBeGreaterThanOrEqual(0.6);
  });

  it('skips degenerate boxes and honors the write offset', () => {
    const boxes = [box(0.1, 0.5, { height: 0 }), box(0.4, 0.5, { barId: 2 })];
    const g = allocGrains(110);
    const written = packBoxes(boxes, [50, 100], g, { density: 1, jitter: 0 }, 10);
    expect(written).toBe(100);
    expect(g.barId[10]!).toBe(2);
    // The first ten slots were left untouched by the offset.
    expect(g.targetX[0]!).toBe(0);
  });

  it('is deterministic for a given seed', () => {
    const b = box(0.2, 0.3);
    const a1 = allocGrains(100);
    const a2 = allocGrains(100);
    packBoxes([b], [100], a1, { density: 1, seed: 5 });
    packBoxes([b], [100], a2, { density: 1, seed: 5 });
    expect(Array.from(a1.targetX)).toEqual(Array.from(a2.targetX));
  });
});
