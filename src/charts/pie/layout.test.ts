import { describe, expect, it } from 'vitest';
import type { DataSet } from '../../core/data/types.js';
import type { RGBA } from '../../core/render/types.js';
import { CENTER, MAX_RADIUS, hitSlice, layoutPie } from './layout.js';
import type { PieLayoutOptions } from './layout.js';

const PALETTE: RGBA[] = [
  [1, 0, 0, 1],
  [0, 1, 0, 1],
  [0, 0, 1, 1],
];

const TAU = Math.PI * 2;

function opts(over: Partial<PieLayoutOptions> = {}): PieLayoutOptions {
  return {
    seriesIndex: 0,
    maxSlices: 10,
    maxSeries: 1000,
    innerRadius: 0,
    radius: 1,
    startAngle: 0,
    padAngle: 0,
    ...over,
  };
}

/** Two series ("a", "b") of three categories each. */
function twoSeries(): DataSet {
  return {
    points: [
      { x: 'X', y: 1, z: 'a' },
      { x: 'Y', y: 1, z: 'a' },
      { x: 'Z', y: 2, z: 'a' },
      { x: 'X', y: 3, z: 'b' },
      { x: 'Y', y: 1, z: 'b' },
      { x: 'Z', y: 0, z: 'b' },
    ],
  };
}

describe('layoutPie', () => {
  it('splits the circle by value share', () => {
    const { metas } = layoutPie(twoSeries(), PALETTE, opts());
    expect(metas.map((m) => m.fraction)).toEqual([0.25, 0.25, 0.5]);
    const sweep = metas.reduce((a, m) => a + (m.a1 - m.a0), 0);
    expect(sweep).toBeCloseTo(TAU, 10);
    // Slices are contiguous: each starts where the previous ended.
    expect(metas[1]!.a0).toBeCloseTo(metas[0]!.a1, 10);
    expect(metas[2]!.a1).toBeCloseTo(TAU, 10);
  });

  it('draws only the selected series and reports its key', () => {
    const { metas, seriesIndex, series } = layoutPie(
      twoSeries(),
      PALETTE,
      opts({ seriesIndex: 1 }),
    );
    expect(series).toEqual(['a', 'b']);
    expect(seriesIndex).toBe(1);
    expect(metas.map((m) => m.seriesKey)).toEqual(['b', 'b', 'b']);
    // 3 / 1 / 0 of a total of 4.
    expect(metas.map((m) => m.fraction)).toEqual([0.75, 0.25, 0]);
  });

  it('clamps an out-of-range series index instead of drawing nothing', () => {
    const hi = layoutPie(twoSeries(), PALETTE, opts({ seriesIndex: 99 }));
    expect(hi.seriesIndex).toBe(1);
    const lo = layoutPie(twoSeries(), PALETTE, opts({ seriesIndex: -5 }));
    expect(lo.seriesIndex).toBe(0);
  });

  it('caps slices per series and series overall', () => {
    const points = [];
    for (let s = 0; s < 5; s++) {
      for (let i = 0; i < 20; i++) points.push({ x: `c${i}`, y: 1, z: `s${s}` });
    }
    const { metas, series } = layoutPie({ points }, PALETTE, opts({ maxSlices: 4, maxSeries: 2 }));
    expect(metas).toHaveLength(4);
    expect(series).toEqual(['s0', 's1']);
    // The kept slices still fill the whole circle.
    expect(metas.reduce((a, m) => a + (m.a1 - m.a0), 0)).toBeCloseTo(TAU, 10);
  });

  it('splits evenly when every value is zero or negative', () => {
    const ds: DataSet = {
      points: [
        { x: 'a', y: 0 },
        { x: 'b', y: -4 },
      ],
    };
    const { metas } = layoutPie(ds, PALETTE, opts());
    expect(metas.map((m) => m.fraction)).toEqual([0.5, 0.5]);
    // The raw value is still reported, sign and all.
    expect(metas.map((m) => m.value)).toEqual([0, -4]);
  });

  it('cuts a donut hole and honours the radius fraction', () => {
    const { metas } = layoutPie(twoSeries(), PALETTE, opts({ innerRadius: 0.5, radius: 0.8 }));
    const rOuter = MAX_RADIUS * 0.8;
    expect(metas[0]!.rOuter).toBeCloseTo(rOuter, 10);
    expect(metas[0]!.rInner).toBeCloseTo(rOuter * 0.5, 10);
  });

  it('leaves a gap between slices when padAngle is set', () => {
    const pad = 0.1;
    const { metas } = layoutPie(twoSeries(), PALETTE, opts({ padAngle: pad }));
    expect(metas[1]!.a0 - metas[0]!.a1).toBeCloseTo(pad, 10);
    const sweep = metas.reduce((a, m) => a + (m.a1 - m.a0), 0);
    expect(sweep).toBeCloseTo(TAU - pad * metas.length, 10);
  });
});

describe('hitSlice', () => {
  it('finds the slice under a point and misses outside the disc', () => {
    const { metas } = layoutPie(twoSeries(), PALETTE, opts());
    // Straight up from the center is the first slice (angles start at 12 o'clock).
    expect(hitSlice(metas, CENTER, CENTER + 0.2)?.xValue).toBe('X');
    // 9 o'clock (three quarters of a turn clockwise) is inside the last slice,
    // which spans the whole bottom half.
    expect(hitSlice(metas, CENTER - 0.2, CENTER)?.xValue).toBe('Z');
    // Beyond the rim.
    expect(hitSlice(metas, CENTER, CENTER + 0.9)).toBeNull();
  });

  it('misses inside a donut hole', () => {
    const { metas } = layoutPie(twoSeries(), PALETTE, opts({ innerRadius: 0.6 }));
    expect(hitSlice(metas, CENTER, CENTER + 0.05)).toBeNull();
    expect(hitSlice(metas, CENTER, CENTER + 0.45)?.xValue).toBe('X');
  });
});
