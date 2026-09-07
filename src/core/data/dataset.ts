import type { MeshDataSet, MeshPoint } from './mesh.js';
import type { Candle, CandlePatch, CandleRef, OhlcDataSet } from './ohlc.js';
import type {
  AccessorSpec,
  DataSet,
  FieldType,
  Point,
  PointPatch,
  PointRef,
  Scalar,
} from './types.js';
import type { NormalizedWind, WindDataSet, WindObservation } from './wind.js';

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

// --- WindDataSet counterparts (wind rose chart) -----------------------------
//
// A wind observation carries one dimension (time) and two indicators
// (direction, intensity) â€” a shape neither Point<X,Y,Z> nor MeshPoint has a
// slot for (see core/data/wind.ts), so it needs its own validate/normalize.

const TAU = Math.PI * 2;

/**
 * Validate structural invariants of a wind dataset; throws {@link DataError}.
 *
 * Non-finite and negative *values* are not an error â€” a live feed produces
 * those, and {@link normalizeWind} drops those rows. What throws here is a
 * mis-shaped dataset: a missing field, a field of the wrong kind, or a
 * `direction` that cannot mean what `directionUnit` says it means.
 */
export function validateWind(ds: WindDataSet): void {
  if (!Array.isArray(ds.points)) throw new DataError('windDataset.points must be an array');
  const unit = ds.directionUnit ?? 'deg';
  for (let i = 0; i < ds.points.length; i++) {
    const p = ds.points[i]!;
    const at = `windDataset.points[${i}]`;
    if (p.t === null || p.t === undefined) throw new DataError(`${at}.t is missing`);
    if (!(p.t instanceof Date) && typeof p.t !== 'number') {
      throw new DataError(`${at}.t must be a Date or an epoch number`);
    }
    if (typeof p.direction !== 'number') throw new DataError(`${at}.direction must be a number`);
    if (typeof p.intensity !== 'number') throw new DataError(`${at}.intensity must be a number`);
    // Degrees wrap freely (370Â° and -10Â° are both meaningful headings), but a
    // "radian" outside one turn is almost always degrees mislabelled, and a
    // silent reinterpretation would rotate the whole rose without saying so.
    if (unit === 'rad' && Number.isFinite(p.direction)) {
      if (p.direction < 0 || p.direction > TAU + 1e-9) {
        throw new DataError(
          `${at}.direction (${p.direction}) is outside [0, 2Ď€] but directionUnit is 'rad' â€” did you mean directionUnit: 'deg'?`,
        );
      }
    }
  }
}

/**
 * Normalize a wind dataset for the chart: direction to radians clockwise from
 * north in `[0, 2Ď€)`, time to epoch ms, rows sorted oldest â†’ newest.
 *
 * Rows whose time, direction or intensity is non-finite â€” or whose intensity is
 * negative â€” are **dropped rather than clamped**: a NaN heading has no sector,
 * and inventing one would put a mark somewhere the data never claimed. The
 * count is reported so a caller can surface the disagreement.
 *
 * Sorting happens here rather than in the caller: "the latest observation" has
 * to mean the same thing whatever order the rows arrived in.
 */
export function normalizeWind<Custom>(ds: WindDataSet<Custom>): NormalizedWind<Custom> {
  const toRad = (ds.directionUnit ?? 'deg') === 'rad' ? 1 : Math.PI / 180;
  const out: WindObservation<Custom>[] = [];
  let dropped = 0;

  for (let i = 0; i < ds.points.length; i++) {
    const p = ds.points[i]!;
    const t = p.t instanceof Date ? p.t.getTime() : p.t;
    if (!Number.isFinite(t) || !Number.isFinite(p.direction) || !Number.isFinite(p.intensity)) {
      dropped++;
      continue;
    }
    if (p.intensity < 0) {
      dropped++;
      continue;
    }
    let dir = (p.direction * toRad) % TAU;
    if (dir < 0) dir += TAU;
    out.push({ id: i, t, direction: dir, intensity: p.intensity, custom: p.custom });
  }

  // Ties break on id, so a burst of same-millisecond readings still has a
  // well-defined "latest" instead of depending on the sort's stability.
  out.sort((a, b) => a.t - b.t || a.id - b.id);

  return {
    points: out,
    dropped,
    intensityLabel: ds.intensityLabel ?? 'Speed',
    intensityUnit: ds.intensityUnit ?? '',
  };
}

// --- OhlcDataSet counterparts (candlestick chart) --------------------------
//
// An OhlcDataSet carries four prices per x instead of a single `y` and groups
// candles by an explicit series array (see core/data/ohlc.ts), so it needs its
// own resolveTypes/validate rather than reusing either set above.

/** The four price fields every candle carries, in a fixed order. */
const PRICE_FIELDS = ['open', 'high', 'low', 'close'] as const;

/** All candles across every series of an OHLC dataset, in series order. */
export function allCandles(ds: OhlcDataSet): Candle[] {
  const out: Candle[] = [];
  for (const s of ds.series) out.push(...s.candles);
  return out;
}

/** Resolve the x field type for an OHLC dataset, respecting an explicit override. */
export function resolveOhlcTypes(ds: OhlcDataSet): { xType: FieldType } {
  const candles = allCandles(ds);
  if (candles.length === 0) return { xType: ds.xType ?? 'category' };
  const sx = firstNonNull(candles, (c) => c.x) ?? candles[0]!;
  return { xType: ds.xType ?? inferType(sx.x) };
}

/**
 * Validate structural invariants of an OHLC dataset; throws {@link DataError}.
 * `high < low` is *not* an error â€” the layout takes the wick extent from the
 * min/max of all four prices, so a transposed pair still draws something
 * sensible rather than an inverted candle.
 */
export function validateOhlc(ds: OhlcDataSet): void {
  if (!Array.isArray(ds.series)) throw new DataError('ohlcDataset.series must be an array');
  for (let si = 0; si < ds.series.length; si++) {
    const s = ds.series[si]!;
    if (!Array.isArray(s.candles)) {
      throw new DataError(`ohlcDataset.series[${si}].candles must be an array`);
    }
    for (let i = 0; i < s.candles.length; i++) {
      const c = s.candles[i]!;
      const at = `ohlcDataset.series[${si}].candles[${i}]`;
      if (c.x === null || c.x === undefined) throw new DataError(`${at}.x is missing`);
      for (const f of PRICE_FIELDS) {
        if (typeof c[f] !== 'number' || !Number.isFinite(c[f])) {
          throw new DataError(`${at}.${f} must be a finite number`);
        }
      }
      if (c.actual !== undefined && (typeof c.actual !== 'number' || !Number.isFinite(c.actual))) {
        throw new DataError(`${at}.actual must be a finite number when present`);
      }
    }
  }
}

/** Whether candle `c` matches `x`, compared by `String()` like {@link patchPoints}. */
function candleMatches(c: Candle, x: Scalar): boolean {
  return String(c.x) === String(x);
}

/**
 * Return a copy of `candles` with each patch's given prices applied to the
 * candle at that `x`. Candles are cloned; the input array is untouched.
 * Omitted price fields keep their current value, so a live feed can patch just
 * `close`/`actual` without restating the rest of the bar.
 */
export function patchCandles(candles: Candle[], patches: CandlePatch[]): Candle[] {
  const out = candles.map((c) => ({ ...c }));
  for (const patch of patches) {
    for (const c of out) {
      if (!candleMatches(c, patch.x)) continue;
      for (const f of PRICE_FIELDS) {
        const v = patch[f];
        if (v !== undefined) c[f] = v;
      }
      if (patch.actual !== undefined) c.actual = patch.actual;
    }
  }
  return out;
}

/** Return a new array with `add` appended (both cloned). */
export function appendCandles(candles: Candle[], add: Candle[]): Candle[] {
  return [...candles.map((c) => ({ ...c })), ...add.map((c) => ({ ...c }))];
}

/**
 * Return a copy of `candles` with every candle matched by a {@link CandleRef}
 * removed. Numeric refs are positional (negative counts from the end); object
 * refs match by `x`.
 */
export function removeCandles(candles: Candle[], refs: CandleRef[]): Candle[] {
  const drop = new Set<number>();
  const matchers: Scalar[] = [];
  for (const r of refs) {
    if (typeof r === 'number') drop.add(r < 0 ? candles.length + r : r);
    else matchers.push(r.x);
  }
  return candles.filter((c, i) => {
    if (drop.has(i)) return false;
    return !matchers.some((x) => candleMatches(c, x));
  });
}
