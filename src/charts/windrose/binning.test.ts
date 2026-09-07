import { describe, expect, it } from 'vitest';
import type { WindObservation } from '../../core/data/wind.js';
import {
  type BinOptions,
  bandEdges,
  bandOf,
  bandRanges,
  binDirections,
  sectorBounds,
  sectorOf,
  segmentKeyByObservation,
} from './binning.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

function opts(over: Partial<BinOptions> = {}): BinOptions {
  return {
    sectors: 16,
    sectorAlign: 'centered',
    mode: 'bands',
    measure: 'count',
    order: 'intensity',
    maxSegmentsPerSector: 120,
    calmBelow: 0,
    bands: { derive: 'equal', count: 4 },
    ...over,
  };
}

/** Observations at the given (degrees, intensity) pairs, one second apart. */
function obs(pairs: [number, number][]): WindObservation[] {
  return pairs.map(([deg, intensity], i) => ({
    id: i,
    t: 1000 * (i + 1),
    direction: (((deg * DEG) % TAU) + TAU) % TAU,
    intensity,
    custom: undefined,
  }));
}

describe('sectorOf', () => {
  it("centers sector 0 on due north when align is 'centered'", () => {
    expect(sectorOf(0, 16, 'centered')).toBe(0);
    expect(sectorOf(11 * DEG, 16, 'centered')).toBe(0);
    expect(sectorOf(349 * DEG, 16, 'centered')).toBe(0);
  });

  it('treats bin bounds as half-open, so a boundary lands in exactly one sector', () => {
    // 16 sectors, centered: sector 0 is [-11.25°, +11.25°), sector 1 starts at 11.25°.
    expect(sectorOf(11.25 * DEG, 16, 'centered')).toBe(1);
    expect(sectorOf(11.249 * DEG, 16, 'centered')).toBe(0);
  });

  it('wraps a heading just shy of a full turn into the north bin', () => {
    expect(sectorOf(TAU - 1e-9, 16, 'centered')).toBe(0);
    expect(sectorOf(359.999 * DEG, 16, 'centered')).toBe(0);
  });

  it("starts sector 0 at due north when align is 'edge'", () => {
    expect(sectorOf(0, 4, 'edge')).toBe(0);
    expect(sectorOf(89 * DEG, 4, 'edge')).toBe(0);
    expect(sectorOf(90 * DEG, 4, 'edge')).toBe(1);
    expect(sectorOf(359 * DEG, 4, 'edge')).toBe(3);
  });

  it('never returns an out-of-range sector for any heading', () => {
    for (let deg = 0; deg < 360; deg += 0.5) {
      const s = sectorOf(deg * DEG, 16, 'centered');
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(16);
    }
  });
});

describe('sectorBounds', () => {
  it("puts the compass point mid-sector when 'centered'", () => {
    const b = sectorBounds(0, 16, 'centered');
    expect(b.center).toBeCloseTo(0);
    expect(b.a0).toBeCloseTo(-11.25 * DEG);
    expect(b.a1).toBeCloseTo(11.25 * DEG);
  });

  it("puts the compass point at the leading edge when 'edge'", () => {
    const b = sectorBounds(1, 4, 'edge');
    expect(b.a0).toBeCloseTo(Math.PI / 2);
    expect(b.center).toBeCloseTo(Math.PI / 2 + Math.PI / 4);
  });
});

describe('bandEdges', () => {
  it('honours explicit thresholds, sorted and deduped', () => {
    expect(bandEdges([], { thresholds: [10, 5, 5, 15] })).toEqual([5, 10, 15]);
  });

  it('derives equal-width interior edges across the intensity range', () => {
    const points = obs([
      [0, 0],
      [0, 20],
    ]);
    expect(bandEdges(points, { derive: 'equal', count: 4 })).toEqual([5, 10, 15]);
  });

  it('derives quantile edges from the distribution', () => {
    const points = obs([
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 100],
    ]);
    const edges = bandEdges(points, { derive: 'quantile', count: 2 });
    expect(edges).toHaveLength(1);
    expect(edges[0]).toBeCloseTo(2.5);
  });

  it('collapses to a single band when every intensity is equal', () => {
    const points = obs([
      [0, 7],
      [0, 7],
    ]);
    expect(bandEdges(points, { derive: 'equal', count: 4 })).toEqual([]);
    expect(bandEdges(points, { derive: 'quantile', count: 4 })).toEqual([]);
  });
});

describe('bandOf / bandRanges', () => {
  it('assigns bands on half-open intervals', () => {
    const edges = [5, 10];
    expect(bandOf(edges, 0)).toBe(0);
    expect(bandOf(edges, 4.99)).toBe(0);
    expect(bandOf(edges, 5)).toBe(1);
    expect(bandOf(edges, 9.99)).toBe(1);
    expect(bandOf(edges, 10)).toBe(2);
    expect(bandOf(edges, 999)).toBe(2);
  });

  it('describes one more range than there are edges', () => {
    expect(bandRanges([5, 10])).toEqual([
      { lo: 0, hi: 5 },
      { lo: 5, hi: 10 },
      { lo: 10, hi: Number.POSITIVE_INFINITY },
    ]);
  });
});

describe('binDirections', () => {
  it('returns every sector, including empty ones', () => {
    const res = binDirections(obs([[0, 5]]), opts({ sectors: 8 }));
    expect(res.bins).toHaveLength(8);
    expect(res.bins[4]!.segments).toEqual([]);
    expect(res.bins[4]!.total).toBe(0);
  });

  it("counts observations per sector under measure 'count'", () => {
    const res = binDirections(
      obs([
        [0, 5],
        [2, 6],
        [90, 4],
      ]),
      opts({ sectors: 4, sectorAlign: 'centered' }),
    );
    expect(res.bins[0]!.total).toBe(2);
    expect(res.bins[1]!.total).toBe(1);
    expect(res.maxTotal).toBe(2);
    expect(res.grandTotal).toBe(3);
  });

  it("sums intensity under measure 'intensitySum'", () => {
    const res = binDirections(
      obs([
        [0, 5],
        [2, 6],
      ]),
      opts({ sectors: 4, measure: 'intensitySum' }),
    );
    expect(res.bins[0]!.total).toBe(11);
    expect(res.grandTotal).toBe(11);
  });

  it("takes the max, not the sum, under measure 'intensityMax'", () => {
    const res = binDirections(
      obs([
        [0, 5],
        [2, 9],
      ]),
      opts({ sectors: 4, measure: 'intensityMax', mode: 'observations' }),
    );
    expect(res.bins[0]!.total).toBe(9);
  });

  it('diverts readings below the calm threshold out of the petals', () => {
    const res = binDirections(
      obs([
        [0, 0.5],
        [0, 5],
      ]),
      opts({ sectors: 4, calmBelow: 1 }),
    );
    expect(res.calm.members).toEqual([0]);
    expect(res.calm.weight).toBe(1);
    expect(res.bins[0]!.total).toBe(1);
    // Calm still counts toward the whole, so percentages stay honest.
    expect(res.grandTotal).toBe(2);
  });

  describe("mode 'bands'", () => {
    it('makes one segment per non-empty band, ordered inner → outer', () => {
      const res = binDirections(
        obs([
          [0, 1],
          [0, 1],
          [0, 9],
        ]),
        opts({ sectors: 4, bands: { thresholds: [5] } }),
      );
      const segs = res.bins[0]!.segments;
      expect(segs).toHaveLength(2);
      expect(segs.map((s) => s.band)).toEqual([0, 1]);
      expect(segs.map((s) => s.weight)).toEqual([2, 1]);
      expect(segs[0]!.key).toBe('s0b0');
    });

    it('reports each band segment its member range and newest time', () => {
      const res = binDirections(
        obs([
          [0, 1],
          [0, 4],
        ]),
        opts({ sectors: 4, bands: { thresholds: [5] } }),
      );
      const seg = res.bins[0]!.segments[0]!;
      expect(seg.intensityMin).toBe(1);
      expect(seg.intensityMax).toBe(4);
      expect(seg.latestT).toBe(2000);
    });
  });

  describe("mode 'observations'", () => {
    it('makes one addressable segment per reading, keyed by observation id', () => {
      const res = binDirections(
        obs([
          [0, 9],
          [0, 1],
        ]),
        opts({ sectors: 4, mode: 'observations' }),
      );
      const segs = res.bins[0]!.segments;
      expect(segs.map((s) => s.key)).toEqual(['o1', 'o0']);
      expect(segs.every((s) => s.members.length === 1)).toBe(true);
    });

    it('orders segments by intensity inward → outward by default', () => {
      const res = binDirections(
        obs([
          [0, 9],
          [0, 1],
          [0, 5],
        ]),
        opts({ sectors: 4, mode: 'observations', order: 'intensity' }),
      );
      expect(res.bins[0]!.segments.map((s) => s.intensityMax)).toEqual([1, 5, 9]);
    });

    it("orders segments oldest → newest under order 'time'", () => {
      const res = binDirections(
        obs([
          [0, 9],
          [0, 1],
        ]),
        opts({ sectors: 4, mode: 'observations', order: 'time' }),
      );
      expect(res.bins[0]!.segments.map((s) => s.latestT)).toEqual([1000, 2000]);
    });
  });

  describe('segment cap', () => {
    it('merges the tail instead of dropping it, preserving the petal total', () => {
      const res = binDirections(
        obs([
          [0, 1],
          [0, 2],
          [0, 3],
          [0, 4],
          [0, 5],
        ]),
        opts({ sectors: 4, mode: 'observations', maxSegmentsPerSector: 3 }),
      );
      const segs = res.bins[0]!.segments;
      expect(segs).toHaveLength(3);
      // Total still equals every observation — nothing was thrown away.
      expect(res.bins[0]!.total).toBe(5);
      const agg = segs[2]!;
      expect(agg.aggregated).toBe(true);
      expect(agg.key).toBe('s0agg');
      expect(agg.members).toHaveLength(3);
      expect(agg.intensityMin).toBe(3);
      expect(agg.intensityMax).toBe(5);
    });

    it('leaves an under-cap sector untouched', () => {
      const res = binDirections(
        obs([
          [0, 1],
          [0, 2],
        ]),
        opts({ sectors: 4, mode: 'observations', maxSegmentsPerSector: 3 }),
      );
      expect(res.bins[0]!.segments.every((s) => !s.aggregated)).toBe(true);
    });
  });
});

describe('segmentKeyByObservation', () => {
  it('maps every observation to the segment holding it', () => {
    const res = binDirections(
      obs([
        [0, 1],
        [90, 9],
      ]),
      opts({ sectors: 4, mode: 'observations' }),
    );
    const map = segmentKeyByObservation(res.bins);
    expect(map.get(0)).toBe('o0');
    expect(map.get(1)).toBe('o1');
  });

  it('maps several observations onto one band segment', () => {
    const res = binDirections(
      obs([
        [0, 1],
        [0, 2],
      ]),
      opts({ sectors: 4, bands: { thresholds: [5] } }),
    );
    const map = segmentKeyByObservation(res.bins);
    expect(map.get(0)).toBe('s0b0');
    expect(map.get(1)).toBe('s0b0');
  });
});
