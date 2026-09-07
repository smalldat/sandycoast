import { describe, expect, it } from 'vitest';
import { DataError, normalizeWind, validateWind } from './dataset.js';
import type { WindDataSet } from './wind.js';

const TAU = Math.PI * 2;

function ds(over: Partial<WindDataSet> = {}): WindDataSet {
  return {
    points: [
      { t: 3000, direction: 90, intensity: 5 },
      { t: 1000, direction: 0, intensity: 2 },
      { t: 2000, direction: 180, intensity: 9 },
    ],
    ...over,
  };
}

describe('validateWind', () => {
  it('accepts a well-formed dataset', () => {
    expect(() => validateWind(ds())).not.toThrow();
  });

  it('rejects a non-array points field', () => {
    expect(() => validateWind({ points: undefined as never })).toThrow(DataError);
  });

  it('names the offending row and field', () => {
    const bad: WindDataSet = { points: [{ t: 1, direction: 10, intensity: 1 }, { t: 2 } as never] };
    expect(() => validateWind(bad)).toThrow(/points\[1\]\.direction/);
  });

  it('rejects a t that is neither Date nor number', () => {
    const bad: WindDataSet = { points: [{ t: '2020-01-01' as never, direction: 0, intensity: 1 }] };
    expect(() => validateWind(bad)).toThrow(/must be a Date or an epoch number/);
  });

  it("rejects out-of-turn values when directionUnit is 'rad' (degrees mislabelled)", () => {
    const bad = ds({ directionUnit: 'rad' });
    expect(() => validateWind(bad)).toThrow(/directionUnit: 'deg'/);
  });

  it("accepts in-range radians when directionUnit is 'rad'", () => {
    const ok: WindDataSet = {
      directionUnit: 'rad',
      points: [{ t: 1, direction: 3.14, intensity: 1 }],
    };
    expect(() => validateWind(ok)).not.toThrow();
  });

  it('leaves non-finite values to normalizeWind rather than throwing', () => {
    const feed: WindDataSet = { points: [{ t: 1, direction: Number.NaN, intensity: 1 }] };
    expect(() => validateWind(feed)).not.toThrow();
  });
});

describe('normalizeWind', () => {
  it('sorts by time ascending regardless of input order', () => {
    expect(normalizeWind(ds()).points.map((p) => p.t)).toEqual([1000, 2000, 3000]);
  });

  it('keeps the source index as a stable id through the sort', () => {
    expect(normalizeWind(ds()).points.map((p) => p.id)).toEqual([1, 2, 0]);
  });

  it('converts degrees to radians clockwise from north', () => {
    const out = normalizeWind(ds()).points;
    expect(out[0]!.direction).toBeCloseTo(0);
    expect(out[1]!.direction).toBeCloseTo(Math.PI);
    expect(out[2]!.direction).toBeCloseTo(Math.PI / 2);
  });

  it('wraps degrees outside one turn into [0, 2π)', () => {
    const out = normalizeWind({
      points: [
        { t: 1, direction: 370, intensity: 1 },
        { t: 2, direction: -10, intensity: 1 },
      ],
    }).points;
    expect(out[0]!.direction).toBeCloseTo((10 * Math.PI) / 180);
    expect(out[1]!.direction).toBeCloseTo(TAU - (10 * Math.PI) / 180);
  });

  it('passes radians through untouched', () => {
    const out = normalizeWind({
      directionUnit: 'rad',
      points: [{ t: 1, direction: 1.5, intensity: 4 }],
    }).points;
    expect(out[0]!.direction).toBeCloseTo(1.5);
  });

  it('accepts Date as well as epoch numbers', () => {
    const out = normalizeWind({
      points: [{ t: new Date(5000), direction: 0, intensity: 1 }],
    }).points;
    expect(out[0]!.t).toBe(5000);
  });

  it('drops non-finite and negative rows, and counts them', () => {
    const res = normalizeWind({
      points: [
        { t: 1, direction: 0, intensity: 3 },
        { t: 2, direction: Number.NaN, intensity: 3 },
        { t: 3, direction: 0, intensity: Number.NaN },
        { t: Number.NaN, direction: 0, intensity: 3 },
        { t: 5, direction: 0, intensity: -1 },
      ],
    });
    expect(res.points).toHaveLength(1);
    expect(res.dropped).toBe(4);
  });

  it('breaks time ties on id so "latest" is well defined', () => {
    const out = normalizeWind({
      points: [
        { t: 100, direction: 0, intensity: 1 },
        { t: 100, direction: 0, intensity: 2 },
      ],
    }).points;
    expect(out.map((p) => p.id)).toEqual([0, 1]);
  });

  it('carries the custom payload and label defaults', () => {
    const res = normalizeWind({
      points: [{ t: 1, direction: 0, intensity: 1, custom: { stn: 7 } }],
      intensityUnit: 'kt',
    });
    expect(res.points[0]!.custom).toEqual({ stn: 7 });
    expect(res.intensityLabel).toBe('Speed');
    expect(res.intensityUnit).toBe('kt');
  });
});
