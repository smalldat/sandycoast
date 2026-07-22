import { describe, expect, it } from 'vitest';
import { parseColor } from '../../core/util/color.js';
import { layoutBars } from './layout.js';

const palette = ['#ff0000', '#00ff00'].map(parseColor);

describe('layoutBars', () => {
  it('emits one bar per (x, series) pair', () => {
    const { bars, metas } = layoutBars(
      {
        points: [
          { x: 'Q1', y: 10, z: 'EU' },
          { x: 'Q1', y: 20, z: 'US' },
          { x: 'Q2', y: 30, z: 'EU' },
          { x: 'Q2', y: 15, z: 'US' },
        ],
      },
      palette,
    );
    expect(bars.length).toBe(4);
    expect(metas.length).toBe(4);
  });

  it('keeps bars within layout bounds and taller value => taller bar', () => {
    const { bars, metas } = layoutBars(
      {
        points: [
          { x: 'A', y: 50 },
          { x: 'B', y: 100 },
        ],
      },
      palette,
    );
    for (const b of bars) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.width).toBeLessThanOrEqual(1 + 1e-9);
      expect(b.height).toBeLessThanOrEqual(1);
    }
    const a = metas.find((m) => m.xValue === 'A')!;
    const bb = metas.find((m) => m.xValue === 'B')!;
    expect(bb.height).toBeGreaterThan(a.height);
  });

  it('assigns distinct barIds and per-series color index', () => {
    const { bars } = layoutBars(
      {
        points: [
          { x: 'A', y: 1, z: 'S1' },
          { x: 'A', y: 2, z: 'S2' },
        ],
      },
      palette,
    );
    expect(new Set(bars.map((b) => b.barId)).size).toBe(2);
    expect(bars[0]!.colorIdx).toBe(0);
    expect(bars[1]!.colorIdx).toBe(1);
  });

  it('sorts numeric x ascending regardless of input order', () => {
    const { metas } = layoutBars(
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
});
