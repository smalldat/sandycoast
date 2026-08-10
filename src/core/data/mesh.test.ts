import { describe, expect, it } from 'vitest';
import { DataError, meshPoints, resolveMeshTypes, validateMesh } from './dataset.js';
import type { MeshDataSet } from './mesh.js';

describe('meshPoints', () => {
  it('flattens series in order', () => {
    const ds: MeshDataSet = {
      series: [
        { key: 'A', points: [{ x: 1, y: 2 }] },
        {
          key: 'B',
          points: [
            { x: 3, y: 4 },
            { x: 5, y: 6 },
          ],
        },
      ],
    };
    expect(meshPoints(ds)).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
      { x: 5, y: 6 },
    ]);
  });
});

describe('resolveMeshTypes', () => {
  it('infers per field and respects overrides', () => {
    const t = resolveMeshTypes({
      series: [{ points: [{ x: 'Q1', y: 10 }] }],
    });
    expect(t).toEqual({ xType: 'category', yType: 'number' });

    const forced = resolveMeshTypes({
      series: [{ points: [{ x: 1, y: 2 }] }],
      xType: 'time',
    });
    expect(forced.xType).toBe('time');
  });

  it('skips leading nulls when inferring', () => {
    const t = resolveMeshTypes({
      series: [
        {
          points: [
            // biome-ignore lint/suspicious/noExplicitAny: intentional bad row
            { x: null as any, y: 3 },
            { x: 7, y: 4 },
          ],
        },
      ],
    });
    expect(t.xType).toBe('number');
  });

  it('handles an empty dataset with defaults', () => {
    expect(resolveMeshTypes({ series: [] })).toEqual({ xType: 'category', yType: 'number' });
    expect(resolveMeshTypes({ series: [{ points: [] }] })).toEqual({
      xType: 'category',
      yType: 'number',
    });
  });
});

describe('validateMesh', () => {
  it('throws when series is not an array', () => {
    // biome-ignore lint/suspicious/noExplicitAny: intentional bad shape
    expect(() => validateMesh({ series: undefined as any })).toThrow(DataError);
  });

  it('throws on missing x/y', () => {
    expect(() =>
      validateMesh({ series: [{ points: [{ x: 1, y: undefined as unknown as number }] }] }),
    ).toThrow(DataError);
  });

  it('passes valid data', () => {
    expect(() =>
      validateMesh({ series: [{ points: [{ x: 1, y: 2, z: { value: 5 } }] }] }),
    ).not.toThrow();
  });
});
