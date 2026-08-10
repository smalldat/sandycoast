import { describe, expect, it } from 'vitest';
import type { MeshDataSet } from '../../core/data/mesh.js';
import { parseColor } from '../../core/util/color.js';
import { layoutScatter } from './layout.js';

const palette = ['#ff0000', '#00ff00'].map(parseColor);

describe('layoutScatter', () => {
  it('emits one blob and one meta per point, tagged by series', () => {
    const ds: MeshDataSet = {
      series: [
        {
          key: 'A',
          points: [
            { x: 1, y: 10 },
            { x: 2, y: 20 },
          ],
        },
        { key: 'B', points: [{ x: 1, y: 5 }] },
      ],
    };
    const { blobs, metas } = layoutScatter(ds, palette, 0.02);
    expect(blobs.length).toBe(3);
    expect(metas.length).toBe(3);
    expect(metas.map((m) => m.seriesKey)).toEqual(['A', 'A', 'B']);
    expect(metas.map((m) => m.indexInSeries)).toEqual([0, 1, 0]);
    expect(metas.map((m) => m.color)).toEqual([palette[0], palette[0], palette[1]]);
  });

  it('keeps blob centers within layout bounds with headroom off the extremes', () => {
    const ds: MeshDataSet = {
      series: [
        {
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 100 },
          ],
        },
      ],
    };
    const { blobs } = layoutScatter(ds, palette, 0.02);
    for (const b of blobs) {
      expect(b.cx).toBeGreaterThanOrEqual(0);
      expect(b.cx).toBeLessThanOrEqual(1);
      expect(b.cy).toBeGreaterThanOrEqual(0);
      expect(b.cy).toBeLessThanOrEqual(1);
    }
    // Domain padding keeps the extreme points off the plot edges.
    const xs = blobs.map((b) => b.cx).sort((a, c) => a - c);
    expect(xs[0]!).toBeGreaterThan(0);
    expect(xs[xs.length - 1]!).toBeLessThan(1);
  });

  it('positions a higher x/y value further right/up', () => {
    const ds: MeshDataSet = {
      series: [
        {
          points: [
            { x: 1, y: 1 },
            { x: 5, y: 9 },
          ],
        },
      ],
    };
    const { blobs } = layoutScatter(ds, palette, 0.02);
    expect(blobs[1]!.cx).toBeGreaterThan(blobs[0]!.cx);
    expect(blobs[1]!.cy).toBeGreaterThan(blobs[0]!.cy);
  });

  it('threads the mesh z value through to meta without driving position', () => {
    const ds: MeshDataSet = {
      series: [{ points: [{ x: 1, y: 1, z: { value: 42 } }] }],
    };
    const { metas } = layoutScatter(ds, palette, 0.02);
    expect(metas[0]!.meshValue).toEqual({ value: 42 });
  });

  it('carries pointId sequentially across series for grain barId use', () => {
    const ds: MeshDataSet = {
      series: [
        {
          points: [
            { x: 1, y: 1 },
            { x: 2, y: 2 },
          ],
        },
        { points: [{ x: 3, y: 3 }] },
      ],
    };
    const { blobs, metas } = layoutScatter(ds, palette, 0.02);
    expect(metas.map((m) => m.pointId)).toEqual([0, 1, 2]);
    expect(blobs.map((b) => b.barId)).toEqual([0, 1, 2]);
  });

  it('applies the configured cloud radius to every blob', () => {
    const ds: MeshDataSet = {
      series: [{ points: [{ x: 1, y: 1 }] }],
    };
    const { blobs } = layoutScatter(ds, palette, 0.05);
    expect(blobs[0]!.radius).toBe(0.05);
  });
});
