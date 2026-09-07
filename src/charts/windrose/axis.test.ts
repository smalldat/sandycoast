import { describe, expect, it } from 'vitest';
import type { ResolvedAxis } from '../../core/chrome/chrome.js';
import { normalizeWind } from '../../core/data/dataset.js';
import type { RGBA } from '../../core/render/types.js';
import { compassTicks, niceStep, radialRings } from './axis.js';
import { type WindRoseLayoutOptions, layoutWindRose } from './layout.js';

const PALETTE: RGBA[] = [
  [1, 0, 0, 1],
  [0, 1, 0, 1],
];

const OPTS = { north: 0, clockwise: true, percent: false };

function axis(over: Partial<ResolvedAxis> = {}): ResolvedAxis {
  return {
    show: true,
    ticks: undefined,
    tickFormat: undefined,
    label: undefined,
    gridLines: false,
    color: '#fff',
    fontPx: 11,
    fontFamily: 'sans-serif',
    fontWeight: 'normal',
    titleDirection: 'up',
    ...over,
  };
}

function layoutOpts(over: Partial<WindRoseLayoutOptions> = {}): WindRoseLayoutOptions {
  return {
    sectors: 4,
    sectorAlign: 'centered',
    mode: 'bands',
    measure: 'count',
    order: 'intensity',
    maxSegmentsPerSector: 120,
    calmBelow: 0,
    calmShow: true,
    bands: { thresholds: [] },
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

describe('compassTicks', () => {
  it('is empty when the axis is off', () => {
    expect(compassTicks(16, axis({ show: false }), OPTS)).toEqual([]);
    expect(compassTicks(16, axis({ ticks: false }), OPTS)).toEqual([]);
  });

  it('labels every sector by default', () => {
    const ticks = compassTicks(8, axis(), OPTS);
    expect(ticks.map((t) => t.label)).toEqual(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);
  });

  it('thins by a stride so the survivors stay evenly spaced', () => {
    const ticks = compassTicks(16, axis({ ticks: 4 }), OPTS);
    expect(ticks.map((t) => t.label)).toEqual(['N', 'E', 'S', 'W']);
  });

  it('drops consecutive duplicates past the 16-point rose', () => {
    // 32 sectors round in pairs onto the same compass point; printing the same
    // label twice in a row would read as a mistake rather than as precision.
    const labels = compassTicks(32, axis(), OPTS).map((t) => t.label);
    for (let i = 1; i < labels.length; i++) expect(labels[i]).not.toBe(labels[i - 1]);
  });

  it('applies the compass framing to the drawn angle but not the bearing', () => {
    const rotated = compassTicks(4, axis(), { ...OPTS, north: Math.PI / 2 });
    expect(rotated[0]!.bearingDeg).toBe(0);
    expect(rotated[0]!.angle).toBeCloseTo(Math.PI / 2);
  });

  it('mirrors the drawn angle when clockwise is off', () => {
    const ccw = compassTicks(4, axis(), { ...OPTS, clockwise: false });
    expect(ccw[1]!.angle).toBeCloseTo(-Math.PI / 2);
  });

  it('honours a caller tickFormat over compass labels', () => {
    const ticks = compassTicks(4, axis({ tickFormat: (v) => `${v}°` }), OPTS);
    expect(ticks.map((t) => t.label)).toEqual(['0°', '90°', '180°', '270°']);
  });
});

describe('niceStep', () => {
  it('picks round steps', () => {
    expect(niceStep(10, 5)).toBe(2);
    expect(niceStep(100, 4)).toBe(20);
    expect(niceStep(1, 4)).toBeCloseTo(0.2);
  });

  it('is zero for a degenerate range', () => {
    expect(niceStep(0, 4)).toBe(0);
    expect(niceStep(-5, 4)).toBe(0);
  });
});

describe('radialRings', () => {
  function build(counts: number, over: Partial<WindRoseLayoutOptions> = {}) {
    const points = Array.from({ length: counts }, (_, i) => ({
      t: 1000 * (i + 1),
      direction: 0,
      intensity: 5,
    }));
    return layoutWindRose(normalizeWind({ points }), PALETTE, layoutOpts(over));
  }

  it('is empty when the axis is off', () => {
    expect(radialRings(build(4), axis({ show: false }), OPTS)).toEqual([]);
  });

  it('places rings on round values up to the maximum', () => {
    const rings = radialRings(build(10), axis({ ticks: 5 }), OPTS);
    expect(rings.map((r) => r.value)).toEqual([2, 4, 6, 8, 10]);
  });

  it('never draws a ring beyond the axis maximum', () => {
    const layout = build(7);
    for (const ring of radialRings(layout, axis({ ticks: 4 }), OPTS)) {
      expect(ring.value).toBeLessThanOrEqual(layout.radialMax + 1e-9);
      expect(ring.radius).toBeLessThanOrEqual(layout.rOuter + 1e-9);
    }
  });

  it('starts the scale at the petals’ root, not the disc center', () => {
    // With a calm circle in the middle, a ring at radius 0 would claim the
    // calm disc's edge is zero when the scale actually starts there.
    const points = [
      { t: 1000, direction: 0, intensity: 0.2 },
      { t: 2000, direction: 0, intensity: 9 },
      { t: 3000, direction: 0, intensity: 9 },
    ];
    const layout = layoutWindRose(normalizeWind({ points }), PALETTE, layoutOpts({ calmBelow: 1 }));
    expect(layout.rInner).toBeGreaterThan(0);
    const rings = radialRings(layout, axis({ ticks: 2 }), OPTS);
    for (const ring of rings) expect(ring.radius).toBeGreaterThan(layout.rInner);
  });

  it('labels percentages as percentages', () => {
    const layout = build(4, { measure: 'percent' });
    const rings = radialRings(layout, axis({ ticks: 4 }), { ...OPTS, percent: true });
    expect(rings.every((r) => r.label.endsWith('%'))).toBe(true);
  });
});
