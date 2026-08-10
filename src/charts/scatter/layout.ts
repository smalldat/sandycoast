import { meshPoints, resolveMeshTypes, validateMesh } from '../../core/data/dataset.js';
import type { MeshDataSet } from '../../core/data/mesh.js';
import type { FieldType, Scalar } from '../../core/data/types.js';
import type { PointBlob } from '../../core/particles/pack.js';
import type { RGBA } from '../../core/render/types.js';
import { makeScale } from '../../core/scales/index.js';
import { LinearScale } from '../../core/scales/linear.js';
import { TimeScale } from '../../core/scales/time.js';
import type { Scale } from '../../core/scales/types.js';
import type { ScatterMeta } from './types.js';

/**
 * Domain headroom, as a fraction of the data span, added on each side of a
 * continuous (number/time) axis so the extreme points don't sit flush against
 * the plot edge. Bar/line get this from a shared baseline + {@link PLOT_HEIGHT};
 * scatter has no baseline on either axis, so both axes pad their own domain
 * here instead.
 */
const AXIS_PADDING = 0.08;

function padNumericDomain(values: number[]): [number, number] {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  if (lo === Number.POSITIVE_INFINITY) {
    lo = 0;
    hi = 1;
  }
  if (lo === hi) {
    const pad = lo === 0 ? 1 : Math.abs(lo) * 0.5;
    lo -= pad;
    hi += pad;
  }
  const pad = (hi - lo) * AXIS_PADDING;
  return [lo - pad, hi + pad];
}

function padTimeDomain(values: Date[]): [Date, Date] {
  const DAY = 24 * 60 * 60 * 1000;
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const d of values) {
    const t = d.getTime();
    if (t < lo) lo = t;
    if (t > hi) hi = t;
  }
  if (lo === Number.POSITIVE_INFINITY) {
    lo = 0;
    hi = DAY;
  }
  if (lo === hi) {
    lo -= DAY / 2;
    hi += DAY / 2;
  }
  const pad = (hi - lo) * AXIS_PADDING;
  return [new Date(lo - pad), new Date(hi + pad)];
}

/**
 * Build a continuous scale for one axis with domain headroom (number/time);
 * category falls back to {@link makeScale}'s band scale, which already pads
 * via its own `padding` fraction.
 */
function buildScale(type: FieldType, values: Scalar[]): Scale<Scalar> {
  if (type === 'number') {
    return new LinearScale(padNumericDomain(values as number[])) as Scale<Scalar>;
  }
  if (type === 'time') {
    return new TimeScale(padTimeDomain(values as Date[])) as Scale<Scalar>;
  }
  return makeScale(type, values);
}

export interface ScatterLayout {
  blobs: PointBlob[];
  metas: ScatterMeta[];
  xScale: Scale<Scalar>;
  yScale: Scale<Scalar>;
  xType: FieldType;
  yType: FieldType;
}

/**
 * Turn a {@link MeshDataSet} into per-point sand-cloud blobs (layout space
 * [0,1], y-up) plus per-point metadata for hover/morph. Unlike bar/line, both
 * axes are continuous (`core/scales`' `LinearScale`/`TimeScale`), and series
 * come from `ds.series` directly rather than a `z` grouping key.
 */
export function layoutScatter(
  ds: MeshDataSet,
  palette: RGBA[],
  pointRadius: number,
): ScatterLayout {
  validateMesh(ds);
  const { xType, yType } = resolveMeshTypes(ds);
  const all = meshPoints(ds);
  const xScale = buildScale(
    xType,
    all.map((p) => p.x),
  );
  const yScale = buildScale(
    yType,
    all.map((p) => p.y),
  );

  const blobs: PointBlob[] = [];
  const metas: ScatterMeta[] = [];
  let pointId = 0;

  for (let si = 0; si < ds.series.length; si++) {
    const series = ds.series[si]!;
    const colorIdx = si % palette.length;
    const color = palette[colorIdx]!;
    for (let i = 0; i < series.points.length; i++) {
      const p = series.points[i]!;
      const cx = xScale.scale(p.x);
      const cy = yScale.scale(p.y);

      blobs.push({ cx, cy, radius: pointRadius, colorIdx, barId: pointId });
      metas.push({
        pointId,
        seriesIndex: si,
        indexInSeries: i,
        seriesKey: series.key,
        xValue: p.x,
        yValue: p.y,
        meshValue: p.z,
        cx,
        cy,
        color,
      });
      pointId++;
    }
  }

  return { blobs, metas, xScale, yScale, xType, yType };
}
