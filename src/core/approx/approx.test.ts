import { describe, expect, it } from 'vitest';
import { catmullRomToBezier } from '../geometry/curve.js';
import { LeastSquaresApproximation } from './leastSquares.js';
import { NoneApproximation } from './none.js';
import { SplineApproximation } from './spline.js';
import { StraightApproximation } from './straight.js';
import type { FitPoint } from './types.js';

describe('NoneApproximation', () => {
  it('draws nothing', () => {
    const a = new NoneApproximation();
    expect(a.kind).toBe('none');
    expect(a.fit([{ x: 1, y: 2 }])).toEqual([]);
  });
});

describe('StraightApproximation', () => {
  it('connects points in the order given, without sorting by x', () => {
    const a = new StraightApproximation();
    const out = a.fit([
      { x: 2, y: 20 },
      { x: 0, y: 0 },
      { x: 1, y: 10 },
    ]);
    expect(out.map((p) => p.x)).toEqual([2, 0, 1]);
  });

  it('does not mutate the input array', () => {
    const input: FitPoint[] = [
      { x: 2, y: 0 },
      { x: 1, y: 0 },
    ];
    const out = new StraightApproximation().fit(input);
    expect(out).not.toBe(input);
    expect(input[0]).toEqual({ x: 2, y: 0 });
  });
});

describe('SplineApproximation', () => {
  it('passes through every source point in the order given, not sorted by x', () => {
    const a = new SplineApproximation();
    const src = [
      { x: 2, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
    ];
    const out = a.fit(src);
    // Resampled curve, but it must still pass through the original vertices,
    // in their original (non-x-sorted) order.
    for (const p of src) {
      expect(out.some((o) => Math.abs(o.x - p.x) < 1e-9 && Math.abs(o.y - p.y) < 1e-9)).toBe(true);
    }
    expect(out[0]).toEqual(src[0]);
  });

  it('returns the input unchanged for fewer than 2 points', () => {
    const a = new SplineApproximation();
    expect(a.fit([])).toEqual([]);
    expect(a.fit([{ x: 1, y: 1 }])).toEqual([{ x: 1, y: 1 }]);
  });
});

describe('catmullRomToBezier', () => {
  it('produces one segment fewer than the number of points', () => {
    const segs = catmullRomToBezier([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 0 },
      { x: 3, y: 1 },
    ]);
    expect(segs).toHaveLength(3);
    expect(segs[2]!.x).toBe(3);
    expect(segs[2]!.y).toBe(1);
  });
});

describe('LeastSquaresApproximation', () => {
  it('fits an exact line through collinear points', () => {
    const a = new LeastSquaresApproximation();
    const out = a.fit([
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 5 },
      { x: 3, y: 7 },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.x).toBe(0);
    expect(out[0]!.y).toBeCloseTo(1, 6);
    expect(out[1]!.x).toBe(3);
    expect(out[1]!.y).toBeCloseTo(7, 6);
  });

  it('minimizes squared error for a noisy cloud (matches a hand-computed fit)', () => {
    const a = new LeastSquaresApproximation();
    // y = 2x with symmetric noise; least squares should recover slope ~2, intercept ~0.
    const out = a.fit([
      { x: 0, y: 0.1 },
      { x: 1, y: 1.9 },
      { x: 2, y: 4.1 },
      { x: 3, y: 5.9 },
    ]);
    const slope = (out[1]!.y - out[0]!.y) / (out[1]!.x - out[0]!.x);
    expect(slope).toBeCloseTo(2, 1);
  });

  it('does not divide by ~0 on a near-vertical cloud (degenerate x span)', () => {
    const a = new LeastSquaresApproximation();
    const out = a.fit([
      { x: 5, y: 0 },
      { x: 5, y: 1 },
      { x: 5, y: 2 },
      { x: 5, y: 10 },
    ]);
    expect(out).toHaveLength(2);
    for (const p of out) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
      expect(p.x).toBeCloseTo(5, 6);
    }
    // The degenerate fallback spans the y-range as a vertical line.
    expect(Math.min(out[0]!.y, out[1]!.y)).toBeCloseTo(0, 6);
    expect(Math.max(out[0]!.y, out[1]!.y)).toBeCloseTo(10, 6);
  });

  it('handles 0 and 1 points without throwing', () => {
    const a = new LeastSquaresApproximation();
    expect(a.fit([])).toEqual([]);
    expect(a.fit([{ x: 1, y: 2 }])).toEqual([
      { x: 1, y: 2 },
      { x: 1, y: 2 },
    ]);
  });
});
