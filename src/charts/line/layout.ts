import { resolveTypes, seriesKeys, toNumeric, validate } from '../../core/data/dataset.js';
import type { DataSet, Scalar } from '../../core/data/types.js';
import type { LineSeg } from '../../core/particles/pack.js';
import type { RGBA } from '../../core/render/types.js';
import { LinearScale } from '../../core/scales/linear.js';
// Share the exact vertical headroom the bar chart uses so the two align.
import { PLOT_HEIGHT } from '../bar/layout.js';
import type { LineMeta } from './types.js';

export { PLOT_HEIGHT };

function distinctX(ds: DataSet, xType: string): Scalar[] {
  const seen = new Set<string>();
  const vals: Scalar[] = [];
  for (const p of ds.points) {
    const k = String(p.x);
    if (!seen.has(k)) {
      seen.add(k);
      vals.push(p.x);
    }
  }
  if (xType === 'number' || xType === 'time') {
    vals.sort((a, b) => toNumeric(a, xType) - toNumeric(b, xType));
  }
  return vals;
}

/** Largest sum-of-series total over all x-slots (the stacked value-axis top). */
function maxStackTotal(
  xs: Scalar[],
  series: (Scalar | undefined)[],
  lookup: Map<string, number>,
): number {
  let max = 0;
  for (const x of xs) {
    let sum = 0;
    for (const s of series) sum += lookup.get(`${String(x)} ${String(s)}`) ?? 0;
    if (sum > max) max = sum;
  }
  return max;
}

/** One x-slot's value and its center in layout space [0,1] (for x-axis ticks). */
export interface XSlot {
  value: Scalar;
  /** Slot center, layout x in [0,1]. */
  center: number;
}

/** One series' polyline: the meta indices it connects, in x order, plus color. */
export interface SeriesPath {
  seriesIndex: number;
  seriesKey: Scalar | undefined;
  /** Meta indices in x-slot order. */
  points: number[];
  color: RGBA;
}

export interface LineLayout {
  /** Line ribbon segments (consecutive points per series) for grain packing. */
  segs: LineSeg[];
  metas: LineMeta[];
  /** Per-series polylines for drawing the solid line/area. */
  paths: SeriesPath[];
  /** X-slot centers, one per distinct x value, for axis tick placement. */
  xSlots: XSlot[];
  /** Y value scale (domain -> [0,1]); use with {@link PLOT_HEIGHT} for tick pos. */
  yScale: LinearScale;
  /** Field type of the x axis ('number' | 'time' | 'category'). */
  xType: string;
}

/**
 * Turn an XYZ dataset into per-series polylines (layout space [0,1], y-up) plus
 * per-point metadata for hover and ribbon segments for grain packing. All
 * series share the same evenly-spaced x-slots (one per distinct x value).
 */
export function layoutLine(ds: DataSet, palette: RGBA[], stack = false): LineLayout {
  validate(ds);
  const { xType, yType } = resolveTypes(ds);
  const xs = distinctX(ds, xType);
  const series = seriesKeys(ds.points);
  const numericY = yType === 'category' ? 'number' : yType;

  // (xKey, seriesKey) -> y value.
  const lookup = new Map<string, number>();
  for (const p of ds.points) {
    lookup.set(`${String(p.x)} ${String(p.z)}`, toNumeric(p.y, numericY));
  }

  // Stacked: the value axis must span the largest per-x stack total, not the
  // largest single value. Unstacked: the raw value range (through zero).
  const yScale = stack
    ? new LinearScale([0, maxStackTotal(xs, series, lookup)])
    : LinearScale.fromValues(
        ds.points.map((p) => toNumeric(p.y, numericY)),
        true,
      );

  const n = Math.max(1, xs.length);
  const step = 1 / n;

  const metas: LineMeta[] = [];
  const xSlots: XSlot[] = [];
  // (slotIndex, seriesIndex) -> meta index, so segments can chain points.
  const metaAt = new Map<string, number>();

  for (let xi = 0; xi < xs.length; xi++) {
    const center = xi * step + step / 2;
    xSlots.push({ value: xs[xi]!, center });
    // Running stack floor (data units) for this x-slot; unused when unstacked.
    let acc = 0;
    for (let si = 0; si < series.length; si++) {
      const value = lookup.get(`${String(xs[xi])} ${String(series[si])}`);
      if (value === undefined) continue;
      // Stacked bands rest on the cumulative total below; plain lines on zero.
      const base = stack ? acc : 0;
      const top = stack ? acc + value : value;
      if (stack) acc = top;
      const height = Math.max(0, yScale.scale(top)) * PLOT_HEIGHT;
      const baseHeight = Math.max(0, yScale.scale(base)) * PLOT_HEIGHT;
      const color = palette[si % palette.length]!;
      const pointId = metas.length;
      metaAt.set(`${xi} ${si}`, pointId);
      metas.push({
        pointId,
        seriesIndex: si,
        seriesKey: series[si],
        xValue: xs[xi]!,
        yValue: value,
        pos: center,
        height,
        baseHeight,
        color,
      });
    }
  }

  // Build per-series polylines and ribbon segments from consecutive points.
  const paths: SeriesPath[] = [];
  const segs: LineSeg[] = [];
  for (let si = 0; si < series.length; si++) {
    const idxs: number[] = [];
    for (let xi = 0; xi < xs.length; xi++) {
      const mi = metaAt.get(`${xi} ${si}`);
      if (mi !== undefined) idxs.push(mi);
    }
    if (idxs.length === 0) continue;
    paths.push({
      seriesIndex: si,
      seriesKey: series[si],
      points: idxs,
      color: palette[si % palette.length]!,
    });
    for (let k = 0; k < idxs.length - 1; k++) {
      const a = metas[idxs[k]!]!;
      const b = metas[idxs[k + 1]!]!;
      segs.push({
        x0: a.pos,
        y0: a.height,
        x1: b.pos,
        y1: b.height,
        colorIdx: si % palette.length,
        pointId: a.pointId,
      });
    }
    // A lone point (no segment) still gets a tiny ribbon so it renders sand.
    if (idxs.length === 1) {
      const a = metas[idxs[0]!]!;
      segs.push({
        x0: a.pos,
        y0: a.height,
        x1: a.pos,
        y1: a.height,
        colorIdx: si % palette.length,
        pointId: a.pointId,
      });
    }
  }

  return { segs, metas, paths, xSlots, yScale, xType };
}
