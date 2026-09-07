import { resolveTypes, seriesKeys, toNumeric, validate } from '../../core/data/dataset.js';
import type { DataSet, Point, Scalar } from '../../core/data/types.js';
import {
  CENTER,
  MAX_RADIUS,
  angleInWedge,
  clamp,
  layoutToAngle,
} from '../../core/layout/polar.js';
import type { Wedge } from '../../core/particles/pack.js';
import type { RGBA } from '../../core/render/types.js';
import { DEFAULT_MAX_SERIES, DEFAULT_MAX_SLICES, type SliceMeta } from './types.js';

// Disc geometry is shared with the wind rose and lives in `core/layout/polar`.
// Re-exported here so the pie's public surface is unchanged.
export { CENTER, MAX_RADIUS };

const TAU = Math.PI * 2;

/** Geometry knobs {@link layoutPie} needs, already resolved to numbers. */
export interface PieLayoutOptions {
  /** Which series to draw (clamped into range). */
  seriesIndex: number;
  /** Cap on slices per series. */
  maxSlices: number;
  /** Cap on addressable series. */
  maxSeries: number;
  /** Hole radius as a fraction of the outer radius, 0..0.95. */
  innerRadius: number;
  /** Outer radius as a fraction of {@link MAX_RADIUS}, 0..1. */
  radius: number;
  /** Rotation of the first slice, radians clockwise from 12 o'clock. */
  startAngle: number;
  /** Gap between adjacent slices, radians. */
  padAngle: number;
}

export interface PieLayout {
  wedges: Wedge[];
  metas: SliceMeta[];
  /** Every addressable series key, in first-seen order (already capped). */
  series: (Scalar | undefined)[];
  /** The series actually drawn, clamped into `[0, series.length - 1]`. */
  seriesIndex: number;
  /** Sum of the drawn slices' values (0 when the series is empty). */
  total: number;
}

/**
 * Points belonging to `key`, in data order, capped at `maxSlices`.
 *
 * The cap truncates rather than aggregating: a pie with dozens of hair-thin
 * wedges reads as noise, and silently folding the tail into an "other" bucket
 * would invent a category the caller never supplied.
 */
function sliceOf(points: Point[], key: Scalar | undefined, maxSlices: number): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    if (p.z !== key) continue;
    out.push(p);
    if (out.length >= maxSlices) break;
  }
  return out;
}

/**
 * Turn one series of an XYZ dataset into pie/donut wedges (layout space, angles
 * clockwise from 12 o'clock) plus per-slice metadata for hover.
 *
 * The series axis is a *selector*, not a visual dimension: only
 * `opts.seriesIndex` is drawn, and the chart animates between series as the
 * slider moves. Colors cycle per **slice**, so the legend describes categories.
 */
export function layoutPie(ds: DataSet, palette: RGBA[], opts: PieLayoutOptions): PieLayout {
  validate(ds);
  const { yType } = resolveTypes(ds);
  const maxSeries = Math.max(1, Math.floor(opts.maxSeries || DEFAULT_MAX_SERIES));
  const maxSlices = Math.max(1, Math.floor(opts.maxSlices || DEFAULT_MAX_SLICES));

  const series = seriesKeys(ds.points).slice(0, maxSeries);
  const seriesIndex =
    series.length === 0 ? 0 : clamp(Math.round(opts.seriesIndex), 0, series.length - 1);
  const key = series[seriesIndex];
  const points = sliceOf(ds.points, key, maxSlices);

  const values = points.map((p) => toNumeric(p.y, yType === 'category' ? 'number' : yType));
  // Negative and non-finite values have no meaning as a share of a whole, so
  // they weigh nothing — the raw value is still reported on hover.
  const weights = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = weights.reduce((a, b) => a + b, 0);

  const rOuter = MAX_RADIUS * clamp(opts.radius, 0, 1);
  const rInner = rOuter * clamp(opts.innerRadius, 0, 0.95);
  // Padding can't eat more than the circle: clamp the total gap to half a turn.
  const pad = points.length > 1 ? clamp(opts.padAngle, 0, Math.PI / points.length) : 0;
  const usable = TAU - pad * points.length;

  const wedges: Wedge[] = [];
  const metas: SliceMeta[] = [];
  let angle = opts.startAngle;

  for (let i = 0; i < points.length; i++) {
    // An all-zero series still deserves visible geometry: split the circle
    // evenly rather than collapsing every wedge to nothing.
    const fraction = total > 0 ? weights[i]! / total : 1 / points.length;
    const a0 = angle + pad / 2;
    const a1 = a0 + usable * fraction;
    angle = a1 + pad / 2;
    const colorIdx = i % palette.length;
    const color = palette[colorIdx]!;

    wedges.push({ cx: CENTER, cy: CENTER, a0, a1, rInner, rOuter, colorIdx, barId: i });
    metas.push({
      sliceId: i,
      xValue: points[i]!.x,
      seriesKey: key,
      seriesIndex,
      value: values[i]!,
      fraction,
      a0,
      a1,
      rInner,
      rOuter,
      color,
    });
  }

  return { wedges, metas, series, seriesIndex, total };
}

/**
 * Slice under a point in layout space, or null. `lx`/`ly` are layout coords
 * (y-up) inside the same square box the wedges were built in.
 */
export function hitSlice(metas: SliceMeta[], lx: number, ly: number): SliceMeta | null {
  const dx = lx - CENTER;
  const dy = ly - CENTER;
  const r = Math.hypot(dx, dy);
  // Angle clockwise from 12 o'clock, matching the wedge convention.
  const a = layoutToAngle(dx, dy);
  for (const m of metas) {
    if (r < m.rInner || r > m.rOuter) continue;
    // Wedges may start at any rotation and wrap past a full turn; `angleInWedge`
    // tests every equivalent revolution the sweep can cover.
    if (angleInWedge(a, m.a0, m.a1)) return m;
  }
  return null;
}
