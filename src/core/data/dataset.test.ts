import { describe, expect, it } from 'vitest';
import {
  DataError,
  appendPoints,
  fromRows,
  inferType,
  patchPoints,
  removePoints,
  resolveTypes,
  seriesKeys,
  toNumeric,
  validate,
} from './dataset.js';

describe('inferType', () => {
  it('detects number/time/category', () => {
    expect(inferType(5)).toBe('number');
    expect(inferType(new Date())).toBe('time');
    expect(inferType('EU')).toBe('category');
  });
});

describe('resolveTypes', () => {
  it('infers per field and respects overrides', () => {
    const t = resolveTypes({
      points: [{ x: 'Q1', y: 10, z: 'EU' }],
    });
    expect(t).toEqual({ xType: 'category', yType: 'number', zType: 'category' });

    const forced = resolveTypes({ points: [{ x: 1, y: 2 }], xType: 'time' });
    expect(forced.xType).toBe('time');
  });

  it('skips leading nulls when inferring', () => {
    const t = resolveTypes({
      // biome-ignore lint/suspicious/noExplicitAny: intentional bad row
      points: [
        { x: null as any, y: 3 },
        { x: 7, y: 4 },
      ],
    });
    expect(t.xType).toBe('number');
  });

  it('handles empty dataset with defaults', () => {
    expect(resolveTypes({ points: [] })).toEqual({
      xType: 'category',
      yType: 'number',
      zType: 'category',
    });
  });
});

describe('seriesKeys', () => {
  it('returns distinct z in first-seen order', () => {
    expect(
      seriesKeys([
        { x: 1, y: 1, z: 'B' },
        { x: 2, y: 1, z: 'A' },
        { x: 3, y: 1, z: 'B' },
      ]),
    ).toEqual(['B', 'A']);
  });
  it('single series when z absent', () => {
    expect(seriesKeys([{ x: 1, y: 1 }])).toEqual([undefined]);
  });
});

describe('fromRows', () => {
  it('maps rows via accessors', () => {
    const ds = fromRows([{ d: 'Q1', s: 10, r: 'EU' }], {
      x: (r) => r.d,
      y: (r) => r.s,
      z: (r) => r.r,
    });
    expect(ds.points[0]).toEqual({ x: 'Q1', y: 10, z: 'EU' });
  });
});

describe('toNumeric', () => {
  it('converts time and number, NaN for category', () => {
    const d = new Date('2020-01-01T00:00:00Z');
    expect(toNumeric(d, 'time')).toBe(d.getTime());
    expect(toNumeric(5, 'number')).toBe(5);
    expect(Number.isNaN(toNumeric('EU', 'category'))).toBe(true);
  });
});

describe('patchPoints', () => {
  const pts = [
    { x: 'Q1', y: 1, z: 'EU' },
    { x: 'Q1', y: 2, z: 'US' },
    { x: 'Q2', y: 3, z: 'EU' },
  ];

  it('sets y on the point matching x and z', () => {
    const out = patchPoints(pts, [{ x: 'Q1', z: 'US', y: 99 }]);
    expect(out[1]).toEqual({ x: 'Q1', y: 99, z: 'US' });
    expect(pts[1]!.y).toBe(2); // input untouched (cloned)
  });

  it('matches every series at x when z is omitted', () => {
    const out = patchPoints(pts, [{ x: 'Q1', y: 7 }]);
    expect(out[0]!.y).toBe(7);
    expect(out[1]!.y).toBe(7);
    expect(out[2]!.y).toBe(3);
  });
});

describe('appendPoints', () => {
  it('concatenates clones without mutating input', () => {
    const a = [{ x: 'Q1', y: 1 }];
    const out = appendPoints(a, [{ x: 'Q2', y: 2 }]);
    expect(out).toHaveLength(2);
    expect(out[0]).not.toBe(a[0]);
    expect(a).toHaveLength(1);
  });
});

describe('removePoints', () => {
  const pts = [
    { x: 'Q1', y: 1, z: 'EU' },
    { x: 'Q1', y: 2, z: 'US' },
    { x: 'Q2', y: 3, z: 'EU' },
  ];

  it('removes by positional index (negative from end)', () => {
    expect(removePoints(pts, [-1])).toHaveLength(2);
    expect(removePoints(pts, [0]).map((p) => p.y)).toEqual([2, 3]);
  });

  it('removes a whole x-slot when z is omitted', () => {
    const out = removePoints(pts, [{ x: 'Q1' }]);
    expect(out).toEqual([{ x: 'Q2', y: 3, z: 'EU' }]);
  });

  it('removes a single series bar when z is given', () => {
    const out = removePoints(pts, [{ x: 'Q1', z: 'EU' }]);
    expect(out.map((p) => p.z)).toEqual(['US', 'EU']);
  });
});

describe('validate', () => {
  it('throws on missing x/y', () => {
    expect(() => validate({ points: [{ x: 1, y: undefined as unknown as number }] })).toThrow(
      DataError,
    );
  });
  it('passes valid data', () => {
    expect(() => validate({ points: [{ x: 1, y: 2 }] })).not.toThrow();
  });
});
