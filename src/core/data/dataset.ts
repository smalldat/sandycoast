import type { MeshDataSet, MeshPoint } from './mesh.js';
import type {
  AccessorSpec,
  DataSet,
  FieldType,
  Point,
  PointPatch,
  PointRef,
  Scalar,
} from './types.js';

/** Infer a {@link FieldType} from a sample value. */
export function inferType(v: Scalar): FieldType {
  if (v instanceof Date) return 'time';
  if (typeof v === 'number') return 'number';
  return 'category';
}

function firstNonNull<T>(items: T[], pick: (t: T) => unknown): T | undefined {
  for (const it of items) {
    const v = pick(it);
    if (v !== null && v !== undefined) return it;
  }
  return undefined;
}

/** Resolve field types for a dataset, respecting explicit overrides. */
export function resolveTypes<X extends Scalar, Y extends Scalar, Z extends Scalar>(
  ds: DataSet<X, Y, Z>,
): { xType: FieldType; yType: FieldType; zType: FieldType } {
  const { points } = ds;
  if (points.length === 0) {
    return {
      xType: ds.xType ?? 'category',
      yType: ds.yType ?? 'number',
      zType: ds.zType ?? 'category',
    };
  }
  const sx = firstNonNull(points, (p) => p.x) ?? points[0]!;
  const sy = firstNonNull(points, (p) => p.y) ?? points[0]!;
  const sz = firstNonNull(points, (p) => p.z);
  return {
    xType: ds.xType ?? inferType(sx.x),
    yType: ds.yType ?? inferType(sy.y),
    zType: ds.zType ?? (sz?.z !== undefined ? inferType(sz.z) : 'category'),
  };
}

/** Distinct series keys (z), in first-seen order. `undefined` z => single series. */
export function seriesKeys<X extends Scalar, Y extends Scalar, Z extends Scalar>(
  points: Point<X, Y, Z>[],
): (Z | undefined)[] {
  const seen = new Set<unknown>();
  const out: (Z | undefined)[] = [];
  for (const p of points) {
    const key = p.z;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  }
  return out;
}

/** Build a {@link DataSet} from arbitrary rows via accessors. */
export function fromRows<Row>(rows: Row[], spec: AccessorSpec<Row>): DataSet {
  const points: Point[] = rows.map((row, i) => {
    const p: Point = { x: spec.x(row, i), y: spec.y(row, i) };
    if (spec.z) p.z = spec.z(row, i);
    return p;
  });
  const ds: DataSet = { points };
  if (spec.xType) ds.xType = spec.xType;
  if (spec.yType) ds.yType = spec.yType;
  if (spec.zType) ds.zType = spec.zType;
  return ds;
}

/** Coerce a scalar to a sortable/plottable number given its field type. */
export function toNumeric(v: Scalar, type: FieldType): number {
  if (type === 'time') return v instanceof Date ? v.getTime() : Number(v);
  if (type === 'number') return typeof v === 'number' ? v : Number(v);
  return Number.NaN; // category has no intrinsic numeric value
}

/**
 * Whether point `p` matches `x` (and `z` when provided). Comparison is by
 * `String()` so it lines up with the layout's slot/series keying (handles
 * numbers, dates, and categories uniformly). Omitting `z` matches every series
 * at that `x`.
 */
function pointMatches(p: Point, x: Scalar, z?: Scalar): boolean {
  return String(p.x) === String(x) && (z === undefined || String(p.z) === String(z));
}

/**
 * Return a copy of `points` with `y` set on every point matching each patch's
 * `x` (+ optional `z`). Points are cloned; the input array is untouched.
 */
export function patchPoints(points: Point[], patches: PointPatch[]): Point[] {
  const out = points.map((p) => ({ ...p }));
  for (const patch of patches) {
    for (const p of out) {
      if (pointMatches(p, patch.x, patch.z)) p.y = patch.y;
    }
  }
  return out;
}

/** Return a new array with `add` appended (both cloned). */
export function appendPoints(points: Point[], add: Point[]): Point[] {
  return [...points.map((p) => ({ ...p })), ...add.map((p) => ({ ...p }))];
}

/**
 * Return a copy of `points` with every point matched by a {@link PointRef}
 * removed. Numeric refs are positional (negative counts from the end); object
 * refs match by `x` (+ optional `z`).
 */
export function removePoints(points: Point[], refs: PointRef[]): Point[] {
  const drop = new Set<number>();
  const matchers: { x: Scalar; z?: Scalar }[] = [];
  for (const r of refs) {
    if (typeof r === 'number') drop.add(r < 0 ? points.length + r : r);
    else matchers.push(r);
  }
  return points.filter((p, i) => {
    if (drop.has(i)) return false;
    return !matchers.some((m) => pointMatches(p, m.x, m.z));
  });
}

export class DataError extends Error {}

/** Validate structural invariants; throws {@link DataError} on violation. */
export function validate<X extends Scalar, Y extends Scalar, Z extends Scalar>(
  ds: DataSet<X, Y, Z>,
): void {
  if (!Array.isArray(ds.points)) throw new DataError('dataset.points must be an array');
  for (let i = 0; i < ds.points.length; i++) {
    const p = ds.points[i]!;
    if (p.x === null || p.x === undefined) throw new DataError(`point[${i}].x is missing`);
    if (p.y === null || p.y === undefined) throw new DataError(`point[${i}].y is missing`);
  }
}

// --- MeshDataSet counterparts (scatter/mesh charts) -------------------------
//
// A MeshDataSet groups points by explicit series array rather than a `z`
// discriminator (see core/data/mesh.ts), so it needs its own resolveTypes/
// validate rather than reusing the Point<X,Y,Z> versions above.

/** All points across every series of a mesh dataset, in series order. */
export function meshPoints<Custom>(ds: MeshDataSet<Custom>): MeshPoint<Scalar, Scalar, Custom>[] {
  const out: MeshPoint<Scalar, Scalar, Custom>[] = [];
  for (const s of ds.series) out.push(...s.points);
  return out;
}

/** Resolve x/y field types for a mesh dataset, respecting explicit overrides. */
export function resolveMeshTypes(ds: MeshDataSet): { xType: FieldType; yType: FieldType } {
  const points = meshPoints(ds);
  if (points.length === 0) {
    return {
      xType: ds.xType ?? 'category',
      yType: ds.yType ?? 'number',
    };
  }
  const sx = firstNonNull(points, (p) => p.x) ?? points[0]!;
  const sy = firstNonNull(points, (p) => p.y) ?? points[0]!;
  return {
    xType: ds.xType ?? inferType(sx.x),
    yType: ds.yType ?? inferType(sy.y),
  };
}

/** Validate structural invariants of a mesh dataset; throws {@link DataError}. */
export function validateMesh(ds: MeshDataSet): void {
  if (!Array.isArray(ds.series)) throw new DataError('meshDataset.series must be an array');
  for (let si = 0; si < ds.series.length; si++) {
    const s = ds.series[si]!;
    if (!Array.isArray(s.points)) {
      throw new DataError(`meshDataset.series[${si}].points must be an array`);
    }
    for (let i = 0; i < s.points.length; i++) {
      const p = s.points[i]!;
      if (p.x === null || p.x === undefined) {
        throw new DataError(`meshDataset.series[${si}].points[${i}].x is missing`);
      }
      if (p.y === null || p.y === undefined) {
        throw new DataError(`meshDataset.series[${si}].points[${i}].y is missing`);
      }
    }
  }
}
