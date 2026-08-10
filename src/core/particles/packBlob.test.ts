import { describe, expect, it } from 'vitest';
import { allocGrains } from './grains.js';
import {
  GRAINS_AT_UNIT_DENSITY,
  type PointBlob,
  blobArea,
  blobGrainCounts,
  packBlobs,
} from './pack.js';

function blob(cx: number, cy: number, over: Partial<PointBlob> = {}): PointBlob {
  return { cx, cy, radius: 0.02, colorIdx: 0, barId: 0, ...over };
}

describe('blobArea', () => {
  it('is pi r^2', () => {
    expect(blobArea(blob(0.5, 0.5, { radius: 0.1 }))).toBeCloseTo(Math.PI * 0.01, 10);
  });

  it('is zero for a zero/negative radius', () => {
    expect(blobArea(blob(0.5, 0.5, { radius: 0 }))).toBe(0);
    expect(blobArea(blob(0.5, 0.5, { radius: -1 }))).toBe(0);
  });
});

describe('blobGrainCounts', () => {
  it('spends the whole density-driven budget, shared by area', () => {
    const blobs = [blob(0.2, 0.5, { radius: 0.1 }), blob(0.8, 0.5, { radius: 0.05 })];
    const counts = blobGrainCounts(blobs, { density: 1 });
    expect(counts.reduce((a, b) => a + b, 0)).toBe(GRAINS_AT_UNIT_DENSITY);
    // Radius 0.1 has 4x the area of radius 0.05, so ~4x the grains.
    expect(counts[0]!).toBeGreaterThan(counts[1]! * 3);
  });

  it('is independent of point count and respects the ceiling', () => {
    const many = Array.from({ length: 50 }, (_, i) => blob(i / 50, 0.5, { radius: 0.01 }));
    const counts = blobGrainCounts(many, { density: 1, maxGrains: 3000 });
    expect(counts.reduce((a, b) => a + b, 0)).toBe(3000);
  });
});

describe('packBlobs', () => {
  it('writes every grain inside its own cloud radius', () => {
    const b = blob(0.5, 0.4, { radius: 0.1, colorIdx: 2, barId: 3 });
    const counts = [500];
    const g = allocGrains(500);
    const written = packBlobs([b], counts, g, { density: 1, jitter: 1 });
    expect(written).toBe(500);

    for (let i = 0; i < 500; i++) {
      const dx = g.targetX[i]! - b.cx;
      const dy = g.targetY[i]! - b.cy;
      expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(b.radius + 1e-9);
      expect(g.colorIdx[i]).toBe(2);
      expect(g.barId[i]).toBe(3);
    }
  });

  it('spreads grains area-uniformly, not bunched at the center', () => {
    const b = blob(0.5, 0.5, { radius: 0.2 });
    const n = 4000;
    const g = allocGrains(n);
    packBlobs([b], [n], g, { density: 1, jitter: 1, seed: 2 });
    // Half the disc's area lies inside r = radius / sqrt(2).
    const mid = b.radius / Math.SQRT2;
    let inner = 0;
    for (let i = 0; i < n; i++) {
      if (Math.hypot(g.targetX[i]! - b.cx, g.targetY[i]! - b.cy) <= mid) inner++;
    }
    expect(inner / n).toBeGreaterThan(0.45);
    expect(inner / n).toBeLessThan(0.55);
  });

  it('jitter 0 collapses every grain onto the point center', () => {
    const b = blob(0.3, 0.6, { radius: 0.15 });
    const g = allocGrains(100);
    packBlobs([b], [100], g, { density: 1, jitter: 0 });
    for (let i = 0; i < 100; i++) {
      // Float32Array storage, so compare at float32 precision, not float64.
      expect(g.targetX[i]).toBeCloseTo(b.cx, 6);
      expect(g.targetY[i]).toBeCloseTo(b.cy, 6);
    }
  });

  it('skips degenerate blobs and zero counts', () => {
    const g = allocGrains(10);
    expect(packBlobs([blob(0.5, 0.5, { radius: 0 })], [10], g, { density: 1 })).toBe(0);
    expect(packBlobs([blob(0.5, 0.5)], [0], g, { density: 1 })).toBe(0);
  });
});
