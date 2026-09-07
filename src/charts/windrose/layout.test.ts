import { describe, expect, it } from 'vitest';
import { normalizeWind } from '../../core/data/dataset.js';
import type { NormalizedWind } from '../../core/data/wind.js';
import { CENTER, polarToLayout } from '../../core/layout/polar.js';
import type { RGBA } from '../../core/render/types.js';
import { type WindRoseLayoutOptions, hitSegment, layoutWindRose } from './layout.js';

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

const PALETTE: RGBA[] = [
  [1, 0, 0, 1],
  [0, 1, 0, 1],
  [0, 0, 1, 1],
  [1, 1, 0, 1],
];

function opts(over: Partial<WindRoseLayoutOptions> = {}): WindRoseLayoutOptions {
  return {
    sectors: 4,
    sectorAlign: 'centered',
    mode: 'bands',
    measure: 'count',
    order: 'intensity',
    maxSegmentsPerSector: 120,
    calmBelow: 0,
    calmShow: true,
    bands: { thresholds: [5] },
    radius: 1,
    innerRadius: 0,
    north: 0,
    clockwise: true,
    petalWidth: 1,
    padAngle: 0,
    rampSteps: 16,
    ...over,
  };
}

/** Readings at the given (degrees, intensity) pairs, one second apart. */
function wind(pairs: [number, number][]): NormalizedWind {
  return normalizeWind({
    points: pairs.map(([direction, intensity], i) => ({ t: 1000 * (i + 1), direction, intensity })),
  });
}

describe('layoutWindRose', () => {
  it('builds one wedge per segment, keyed for morph and selection', () => {
    const l = layoutWindRose(
      wind([
        [0, 1],
        [0, 9],
      ]),
      PALETTE,
      opts(),
    );
    expect(l.wedges).toHaveLength(2);
    expect(l.metas.map((m) => m.key)).toEqual(['s0b0', 's0b1']);
    expect(l.wedges.map((w) => w.barId)).toEqual([0, 1]);
  });

  it('stacks segments outward without gaps or overlap', () => {
    const l = layoutWindRose(
      wind([
        [0, 1],
        [0, 9],
      ]),
      PALETTE,
      opts(),
    );
    const [inner, outer] = l.metas;
    expect(inner!.rInner).toBeCloseTo(l.rInner);
    expect(inner!.rOuter).toBeCloseTo(outer!.rInner);
    expect(outer!.rOuter).toBeCloseTo(l.rOuter);
  });

  it('scales petals against the largest one by default', () => {
    const l = layoutWindRose(
      wind([
        [0, 1],
        [0, 1],
        [90, 1],
      ]),
      PALETTE,
      opts({ bands: { thresholds: [] } }),
    );
    const north = l.metas.find((m) => m.sector === 0)!;
    const east = l.metas.find((m) => m.sector === 1)!;
    expect(l.radialMax).toBe(2);
    expect(north.rOuter).toBeCloseTo(l.rOuter);
    // Half the count, so half the radial span.
    expect(east.rOuter).toBeCloseTo(l.rInner + (l.rOuter - l.rInner) / 2);
  });

  it('honours an explicit radial maximum, leaving headroom above the data', () => {
    const l = layoutWindRose(wind([[0, 1]]), PALETTE, opts({ radialMax: 4 }));
    expect(l.metas[0]!.rOuter).toBeCloseTo(l.rOuter / 4);
  });

  it("reports values as percentages under measure 'percent'", () => {
    const l = layoutWindRose(
      wind([
        [0, 1],
        [0, 1],
        [90, 1],
        [90, 1],
      ]),
      PALETTE,
      opts({ measure: 'percent', bands: { thresholds: [] } }),
    );
    expect(l.grandTotal).toBeCloseTo(100);
    expect(l.metas[0]!.value).toBeCloseTo(50);
  });

  it('centers a petal on its compass bearing', () => {
    const l = layoutWindRose(wind([[90, 3]]), PALETTE, opts({ sectors: 4 }));
    const m = l.metas[0]!;
    expect((m.a0 + m.a1) / 2).toBeCloseTo(Math.PI / 2);
    expect(m.bearingDeg).toBeCloseTo(90);
    expect(m.bearing).toBe('E');
  });

  it('narrows the petal within its sector by petalWidth', () => {
    const l = layoutWindRose(wind([[0, 3]]), PALETTE, opts({ sectors: 4, petalWidth: 0.5 }));
    const m = l.metas[0]!;
    expect(m.a1 - m.a0).toBeCloseTo(TAU / 4 / 2);
  });

  it('rotates the whole rose by north', () => {
    const l = layoutWindRose(wind([[0, 3]]), PALETTE, opts({ north: Math.PI / 2 }));
    const m = l.metas[0]!;
    expect((m.a0 + m.a1) / 2).toBeCloseTo(Math.PI / 2);
  });

  it('mirrors bearings when clockwise is off', () => {
    const l = layoutWindRose(wind([[90, 3]]), PALETTE, opts({ clockwise: false }));
    const m = l.metas[0]!;
    expect((m.a0 + m.a1) / 2).toBeCloseTo(-Math.PI / 2);
  });

  it('keeps a configured hole even with no calm readings', () => {
    const l = layoutWindRose(wind([[0, 3]]), PALETTE, opts({ innerRadius: 0.5 }));
    expect(l.rInner).toBeCloseTo(l.rOuter * 0.5);
    expect(l.metas[0]!.rInner).toBeCloseTo(l.rInner);
  });

  describe('calm circle', () => {
    it('grows a central disc from the calm readings and starts petals at its edge', () => {
      const l = layoutWindRose(
        wind([
          [0, 0.5],
          [0, 9],
          [0, 9],
        ]),
        PALETTE,
        opts({ calmBelow: 1 }),
      );
      expect(l.calm).not.toBeNull();
      expect(l.calm!.count).toBe(1);
      expect(l.rInner).toBeGreaterThan(0);
      expect(l.calm!.rOuter).toBeCloseTo(l.rInner);
      for (const m of l.metas.filter((s) => !s.calm)) {
        expect(m.rInner).toBeGreaterThanOrEqual(l.rInner - 1e-9);
      }
    });

    it('never lets an overwhelmingly calm dataset swallow the rose', () => {
      const l = layoutWindRose(
        wind([
          [0, 0.1],
          [0, 0.1],
          [0, 0.1],
          [0, 0.1],
          [0, 9],
        ]),
        PALETTE,
        opts({ calmBelow: 1 }),
      );
      expect(l.rInner).toBeLessThanOrEqual(l.rOuter * 0.5 + 1e-9);
    });

    it('is absent when nothing is calm', () => {
      const l = layoutWindRose(wind([[0, 9]]), PALETTE, opts({ calmBelow: 1 }));
      expect(l.calm).toBeNull();
    });

    it('maps calm readings to the calm mark so a table row still finds one', () => {
      const l = layoutWindRose(
        wind([
          [0, 0.5],
          [0, 9],
        ]),
        PALETTE,
        opts({ calmBelow: 1, mode: 'observations' }),
      );
      expect(l.segmentKeyByObservation.get(0)).toBe('calm');
      expect(l.segmentKeyByObservation.get(1)).toBe('o1');
    });
  });

  describe('coloring', () => {
    it('cycles the palette per band in bands mode', () => {
      const l = layoutWindRose(
        wind([
          [0, 1],
          [0, 9],
        ]),
        PALETTE,
        opts(),
      );
      expect(l.metas[0]!.color).toEqual(PALETTE[0]);
      expect(l.metas[1]!.color).toEqual(PALETTE[1]);
      expect(l.wedges.map((w) => w.colorIdx)).toEqual([0, 1]);
    });

    it('reads the palette as an intensity ramp in observations mode', () => {
      const l = layoutWindRose(
        wind([
          [0, 0],
          [0, 10],
        ]),
        PALETTE,
        opts({ mode: 'observations' }),
      );
      // Lowest reading sits at the ramp's first stop, highest at its last.
      expect(l.metas[0]!.color).toEqual(PALETTE[0]);
      expect(l.metas[1]!.color).toEqual(PALETTE[3]);
    });

    it('keeps the grain palette small by quantizing the ramp', () => {
      const many: [number, number][] = [];
      for (let i = 0; i < 200; i++) many.push([0, i]);
      const l = layoutWindRose(wind(many), PALETTE, opts({ mode: 'observations', rampSteps: 8 }));
      expect(l.metas.length).toBeGreaterThan(8);
      // 8 ramp buckets + the calm color, however many segments there are.
      expect(l.grainPalette).toHaveLength(9);
      for (const w of l.wedges) expect(w.colorIdx).toBeLessThan(9);
    });
  });

  describe("measure 'intensityMax'", () => {
    it('makes the petal as long as the strongest reading, not their sum', () => {
      const l = layoutWindRose(
        wind([
          [0, 4],
          [0, 9],
          [90, 9],
        ]),
        PALETTE,
        opts({ measure: 'intensityMax', mode: 'observations' }),
      );
      const north = l.metas.filter((m) => m.sector === 0);
      const east = l.metas.filter((m) => m.sector === 1);
      expect(north[north.length - 1]!.rOuter).toBeCloseTo(l.rOuter);
      expect(east[0]!.rOuter).toBeCloseTo(l.rOuter);
    });
  });

  describe('segment cap', () => {
    it('keeps the petal length honest when the tail is merged', () => {
      const many: [number, number][] = [];
      for (let i = 0; i < 10; i++) many.push([0, i + 1]);
      const l = layoutWindRose(
        wind(many),
        PALETTE,
        opts({ mode: 'observations', maxSegmentsPerSector: 4 }),
      );
      const segs = l.metas.filter((m) => !m.calm);
      expect(segs).toHaveLength(4);
      expect(segs[3]!.aggregated).toBe(true);
      expect(segs[3]!.count).toBe(7);
      // All ten readings still fill the petal to the axis maximum.
      expect(segs[3]!.rOuter).toBeCloseTo(l.rOuter);
    });
  });
});

describe('hitSegment', () => {
  /** Layout-space point at a bearing (degrees) and radius. */
  function at(deg: number, r: number): { x: number; y: number } {
    return polarToLayout(CENTER, CENTER, deg * DEG, r);
  }

  it('finds the segment under a point', () => {
    const l = layoutWindRose(
      wind([
        [0, 1],
        [0, 9],
      ]),
      PALETTE,
      opts(),
    );
    const inner = l.metas[0]!;
    const p = at(0, (inner.rInner + inner.rOuter) / 2);
    expect(hitSegment(l.metas, p.x, p.y)?.key).toBe('s0b0');
  });

  it('distinguishes stacked segments by radius', () => {
    const l = layoutWindRose(
      wind([
        [0, 1],
        [0, 9],
      ]),
      PALETTE,
      opts(),
    );
    const outer = l.metas[1]!;
    const p = at(0, (outer.rInner + outer.rOuter) / 2);
    expect(hitSegment(l.metas, p.x, p.y)?.key).toBe('s0b1');
  });

  it('returns null outside the rose', () => {
    const l = layoutWindRose(wind([[0, 5]]), PALETTE, opts());
    const p = at(0, l.rOuter + 0.05);
    expect(hitSegment(l.metas, p.x, p.y)).toBeNull();
  });

  it('returns null in an empty sector', () => {
    const l = layoutWindRose(wind([[0, 5]]), PALETTE, opts({ sectors: 4 }));
    const p = at(180, 0.2);
    expect(hitSegment(l.metas, p.x, p.y)).toBeNull();
  });

  it('matches a petal whose sweep wraps past north', () => {
    // Sector 0 centered on north spans -45°..45° at 4 sectors: test both sides.
    const l = layoutWindRose(wind([[0, 5]]), PALETTE, opts({ sectors: 4 }));
    const m = l.metas[0]!;
    const r = (m.rInner + m.rOuter) / 2;
    expect(hitSegment(l.metas, at(20, r).x, at(20, r).y)?.key).toBe(m.key);
    expect(hitSegment(l.metas, at(340, r).x, at(340, r).y)?.key).toBe(m.key);
  });

  it('finds the calm circle without swallowing the petals above it', () => {
    const l = layoutWindRose(
      wind([
        [0, 0.5],
        [0, 9],
      ]),
      PALETTE,
      opts({ calmBelow: 1 }),
    );
    const center = hitSegment(l.metas, CENTER, CENTER);
    expect(center?.calm).toBe(true);
    const petal = l.metas.find((m) => !m.calm)!;
    const p = at(0, (petal.rInner + petal.rOuter) / 2);
    expect(hitSegment(l.metas, p.x, p.y)?.key).toBe(petal.key);
  });
});
