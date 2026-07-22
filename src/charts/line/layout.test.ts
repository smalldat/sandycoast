import { describe, expect, it } from 'vitest';
import { parseColor } from '../../core/util/color.js';
import { layoutLine } from './layout.js';

const palette = ['#ff0000', '#00ff00'].map(parseColor);

describe('layoutLine', () => {
  it('emits one meta per (x, series) pair and one path per series', () => {
    const { metas, paths } = layoutLine(
      {
        points: [
          { x: 1, y: 10, z: 'EU' },
          { x: 1, y: 20, z: 'US' },
          { x: 2, y: 30, z: 'EU' },
          { x: 2, y: 15, z: 'US' },
        ],
      },
      palette,
    );
    expect(metas.length).toBe(4);
    expect(paths.length).toBe(2);
    expect(paths.every((p) => p.points.length === 2)).toBe(true);
  });

  it('builds one segment fewer than the point count per series', () => {
    const { segs } = layoutLine(
      {
        points: [
          { x: 1, y: 5 },
          { x: 2, y: 10 },
          { x: 3, y: 8 },
          { x: 4, y: 12 },
        ],
      },
      palette,
    );
    // 4 points, single series -> 3 segments.
    expect(segs.length).toBe(3);
  });

  it('keeps points within layout bounds and taller value => taller point', () => {
    const { metas } = layoutLine(
      {
        points: [
          { x: 1, y: 50 },
          { x: 2, y: 100 },
        ],
      },
      palette,
    );
    for (const m of metas) {
      expect(m.pos).toBeGreaterThanOrEqual(0);
      expect(m.pos).toBeLessThanOrEqual(1);
      expect(m.height).toBeLessThanOrEqual(1 + 1e-9);
    }
    const a = metas.find((m) => m.xValue === 1)!;
    const b = metas.find((m) => m.xValue === 2)!;
    expect(b.height).toBeGreaterThan(a.height);
  });

  it('sorts numeric x ascending regardless of input order', () => {
    const { metas } = layoutLine(
      {
        points: [
          { x: 3, y: 1 },
          { x: 1, y: 1 },
          { x: 2, y: 1 },
        ],
      },
      palette,
    );
    expect(metas.map((m) => m.xValue)).toEqual([1, 2, 3]);
  });

  it('segments chain consecutive points of the same series', () => {
    const { segs, metas } = layoutLine(
      {
        points: [
          { x: 1, y: 5, z: 'S1' },
          { x: 2, y: 9, z: 'S1' },
        ],
      },
      palette,
    );
    expect(segs.length).toBe(1);
    const seg = segs[0]!;
    const left = metas[seg.pointId]!;
    expect(left.xValue).toBe(1);
    expect(seg.x0).toBeCloseTo(left.pos);
    expect(seg.y0).toBeCloseTo(left.height);
  });
});
