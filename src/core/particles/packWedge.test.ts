import { describe, expect, it } from 'vitest';
import { allocGrains } from './grains.js';
import {
  GRAINS_AT_UNIT_DENSITY,
  type Wedge,
  packWedges,
  wedgeArea,
  wedgeGrainCounts,
} from './pack.js';

const TAU = Math.PI * 2;

function wedge(a0: number, a1: number, over: Partial<Wedge> = {}): Wedge {
  return { cx: 0.5, cy: 0.5, a0, a1, rInner: 0, rOuter: 0.5, colorIdx: 0, barId: 0, ...over };
}

describe('wedgeArea', () => {
  it('sums to the disc area across a full turn', () => {
    const w = [wedge(0, TAU / 3), wedge(TAU / 3, TAU)];
    const total = w.reduce((a, x) => a + wedgeArea(x), 0);
    expect(total).toBeCloseTo(Math.PI * 0.5 * 0.5, 10);
  });

  it('discounts a donut hole', () => {
    const full = wedgeArea(wedge(0, TAU));
    const holed = wedgeArea(wedge(0, TAU, { rInner: 0.25 }));
    expect(holed).toBeCloseTo(full * (1 - 0.25 ** 2 / 0.5 ** 2), 10);
  });
});

describe('wedgeGrainCounts', () => {
  it('spends the whole density-driven budget, shared by area', () => {
    const wedges = [wedge(0, TAU / 4), wedge(TAU / 4, TAU)];
    const counts = wedgeGrainCounts(wedges, { density: 1 });
    expect(counts.reduce((a, b) => a + b, 0)).toBe(GRAINS_AT_UNIT_DENSITY);
    // A quarter turn gets a quarter of the sand (±1 from apportionment).
    expect(Math.abs(counts[0]! - GRAINS_AT_UNIT_DENSITY / 4)).toBeLessThanOrEqual(1);
  });

  it('is independent of slice count and respects the ceiling', () => {
    const many = Array.from({ length: 10 }, (_, i) => wedge((i * TAU) / 10, ((i + 1) * TAU) / 10));
    const counts = wedgeGrainCounts(many, { density: 1, maxGrains: 5000 });
    expect(counts.reduce((a, b) => a + b, 0)).toBe(5000);
  });
});

describe('packWedges', () => {
  it('writes every grain inside its own ring and sector', () => {
    const w = wedge(0, TAU / 4, { rInner: 0.1, rOuter: 0.4, colorIdx: 2, barId: 3 });
    const counts = [500];
    const g = allocGrains(500);
    const written = packWedges([w], counts, g, { density: 1, jitter: 0 });
    expect(written).toBe(500);

    for (let i = 0; i < 500; i++) {
      const dx = g.targetX[i]! - w.cx;
      const dy = g.targetY[i]! - w.cy;
      const r = Math.hypot(dx, dy);
      expect(r).toBeGreaterThanOrEqual(w.rInner - 1e-6);
      expect(r).toBeLessThanOrEqual(w.rOuter + 1e-6);
      // Angle clockwise from 12 o'clock must land inside the sector.
      const a = Math.atan2(dx, dy);
      expect(a).toBeGreaterThanOrEqual(w.a0 - 1e-6);
      expect(a).toBeLessThanOrEqual(w.a1 + 1e-6);
      expect(g.colorIdx[i]).toBe(2);
      expect(g.barId[i]).toBe(3);
    }
  });

  it('spreads grains evenly by area, not by radius', () => {
    // Half the disc's area lies inside r = rOuter / sqrt(2).
    const w = wedge(0, TAU, { rOuter: 0.5 });
    const n = 4000;
    const g = allocGrains(n);
    packWedges([w], [n], g, { density: 1, jitter: 0 });
    const mid = 0.5 / Math.SQRT2;
    let inner = 0;
    for (let i = 0; i < n; i++) {
      if (Math.hypot(g.targetX[i]! - w.cx, g.targetY[i]! - w.cy) <= mid) inner++;
    }
    expect(inner / n).toBeGreaterThan(0.45);
    expect(inner / n).toBeLessThan(0.55);
  });

  it('skips degenerate wedges and zero counts', () => {
    const g = allocGrains(10);
    expect(packWedges([wedge(1, 1)], [10], g, { density: 1 })).toBe(0);
    expect(packWedges([wedge(0, TAU, { rOuter: 0 })], [10], g, { density: 1 })).toBe(0);
    expect(packWedges([wedge(0, TAU)], [0], g, { density: 1 })).toBe(0);
  });
});
