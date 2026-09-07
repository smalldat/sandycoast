import { allCandles, resolveOhlcTypes, toNumeric, validateOhlc } from '../../core/data/dataset.js';
import type { Candle, OhlcDataSet } from '../../core/data/ohlc.js';
import type { FieldType, Scalar } from '../../core/data/types.js';
import type { BoxRect } from '../../core/particles/pack.js';
import type { RGBA } from '../../core/render/types.js';
import { LinearScale } from '../../core/scales/linear.js';
import { TimeScale } from '../../core/scales/time.js';
import type { Scale } from '../../core/scales/types.js';
import type { CandleBody, CandleDirectionFn, CandleMeta, CandleSpacing } from './types.js';
import { DEFAULT_MAX_CANDLES, DEFAULT_MAX_SERIES } from './types.js';

/**
 * Headroom added above and below the price range, as a fraction of its span.
 * A price axis has no meaningful baseline (prices don't start at zero), so the
 * domain pads itself here the way the scatter chart's continuous axes do,
 * rather than reserving headroom with a `PLOT_HEIGHT` multiplier.
 */
const PRICE_PADDING = 0.06;

/**
 * Smallest body height in layout units. A doji (open === close) would
 * otherwise be a zero-area box: no grains, no fill, nothing but a wick.
 */
const MIN_BODY = 0.0025;

/** One x-slot's value and its center in layout space [0,1] (for axis ticks). */
export interface XSlot {
  value: Scalar;
  /** Slot center, layout x in [0,1]. */
  center: number;
}

/** Geometry knobs {@link layoutCandles} needs, already resolved to values. */
export interface CandleLayoutOptions {
  /** Which series (instrument) to draw; clamped into range. */
  seriesIndex: number;
  /** Cap on candles drawn per series. */
  maxCandles: number;
  /** Cap on addressable series. */
  maxSeries: number;
  /** How candles are positioned along X. */
  spacing: CandleSpacing;
  /** Body width as a fraction of the x step, 0..1. */
  width: number;
  /** Which prices the body spans. */
  body: CandleBody;
  /** The resolved color rule (see `direction.ts`). */
  direction: CandleDirectionFn;
  rising: RGBA;
  falling: RGBA;
}

export interface CandleLayout {
  /** Body rects, the only geometry grains are packed into. */
  boxes: BoxRect[];
  metas: CandleMeta[];
  /** Every addressable series key, in order (already capped). */
  series: (Scalar | undefined)[];
  /** The series actually drawn, clamped into `[0, series.length - 1]`. */
  seriesIndex: number;
  /** X-slot centers, one per candle — band spacing's axis ticks. */
  xSlots: XSlot[];
  /** Continuous x scale when spacing resolved to `'time'`; null for band. */
  xScale: Scale<Scalar> | null;
  /** Price scale (domain → [0,1]), already padded. */
  yScale: LinearScale;
  xType: FieldType;
  /** The spacing actually used (a categorical x always falls back to band). */
  spacing: CandleSpacing;
  /** Distance between adjacent candle centers, layout units (hit-testing). */
  step: number;
  /** Latest `Candle.actual` in the drawn series, or undefined if none carried one. */
  actual: number | undefined;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

/** Series keys in order, `undefined` for a series that didn't name itself. */
function seriesKeysOf(ds: OhlcDataSet, maxSeries: number): (Scalar | undefined)[] {
  return ds.series.slice(0, maxSeries).map((s) => s.key);
}

/** Price domain across the drawn candles, padded so nothing sits flush to an edge. */
function priceScale(candles: Candle[], actual: number | undefined): LinearScale {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  const consider = (v: number): void => {
    if (!Number.isFinite(v)) return;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  };
  for (const c of candles) {
    consider(c.open);
    consider(c.high);
    consider(c.low);
    consider(c.close);
  }
  // The live-price line must stay on screen even when it has run past the last
  // candle's range, so it widens the domain like any other price.
  if (actual !== undefined) consider(actual);

  if (lo === Number.POSITIVE_INFINITY) return new LinearScale([0, 1]);
  const pad = (hi - lo) * PRICE_PADDING;
  return new LinearScale([lo - pad, hi + pad]);
}

/** Median gap between consecutive x values — the candle "step" in data units. */
function medianGap(values: number[]): number {
  const gaps: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const g = Math.abs(values[i]! - values[i - 1]!);
    if (Number.isFinite(g) && g > 0) gaps.push(g);
  }
  if (gaps.length === 0) return 0;
  gaps.sort((a, b) => a - b);
  return gaps[gaps.length >> 1]!;
}

/**
 * Continuous x scale for `'time'` spacing, with half a candle of headroom on
 * each side so the first and last body aren't sliced by the plot edge.
 */
function continuousXScale(values: number[], xType: FieldType, width: number): Scale<Scalar> {
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
  const gap = medianGap(values) || (hi - lo) / Math.max(1, values.length - 1) || 1;
  const pad = (gap * Math.max(width, 0.2)) / 2 + gap * 0.1;
  if (xType === 'time') {
    return new TimeScale([new Date(lo - pad), new Date(hi + pad)]) as Scale<Scalar>;
  }
  return new LinearScale([lo - pad, hi + pad]) as Scale<Scalar>;
}

/**
 * Turn one series of an {@link OhlcDataSet} into candle bodies (layout space
 * [0,1], y-up) plus per-candle metadata for hover and morphing.
 *
 * Like the pie chart's series axis, the series array is a *selector*: only
 * `opts.seriesIndex` is drawn and the chart morphs between instruments as the
 * slider moves. Color comes from the direction rule (rising/falling), not from
 * a per-series palette, so `colorIdx` is 0 for rising and 1 for falling.
 */
export function layoutCandles(ds: OhlcDataSet, opts: CandleLayoutOptions): CandleLayout {
  validateOhlc(ds);
  const { xType } = resolveOhlcTypes(ds);
  const maxSeries = Math.max(1, Math.floor(opts.maxSeries || DEFAULT_MAX_SERIES));
  const maxCandles = Math.max(1, Math.floor(opts.maxCandles || DEFAULT_MAX_CANDLES));

  const series = seriesKeysOf(ds, maxSeries);
  const seriesIndex =
    series.length === 0 ? 0 : clamp(Math.round(opts.seriesIndex), 0, series.length - 1);
  const candles = (ds.series[seriesIndex]?.candles ?? []).slice(0, maxCandles);

  // A category has no continuous position, so `'time'` degrades to band rather
  // than inventing numeric x values for it.
  const spacing: CandleSpacing = opts.spacing === 'time' && xType !== 'category' ? 'time' : 'band';
  const width = clamp(opts.width, 0.02, 1);

  // The live-price line takes the last candle that carries an `actual`, so a
  // streaming feed only has to set it on the candle it is currently filling.
  let actual: number | undefined;
  for (const c of candles) if (c.actual !== undefined) actual = c.actual;

  const yScale = priceScale(candles, actual);
  const n = Math.max(1, candles.length);

  let xScale: Scale<Scalar> | null = null;
  let step = 1 / n;
  let centers: number[];
  if (spacing === 'time') {
    xScale = continuousXScale(
      candles.map((c) => toNumeric(c.x, xType)),
      xType,
      width,
    );
    centers = candles.map((c) => clamp01(xScale!.scale(c.x)));
    // The step is measured on the laid-out centers rather than re-scaling a
    // synthetic x: the scale only accepts the domain's own value type.
    const gap = medianGap(centers);
    step = gap > 0 ? gap : 1 / n;
  } else {
    centers = candles.map((_, i) => (i + 0.5) / n);
  }

  const halfW = (step * width) / 2;
  const boxes: BoxRect[] = [];
  const metas: CandleMeta[] = [];
  const xSlots: XSlot[] = [];

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i]!;
    const rising = opts.direction(c, candles[i - 1], i);
    const colorIdx = rising ? 0 : 1;
    const color = rising ? opts.rising : opts.falling;

    const cx = centers[i]!;
    xSlots.push({ value: c.x, center: cx });

    // A transposed high/low would otherwise draw an inverted wick, so the
    // range is taken from the extremes of all four prices.
    const rangeHigh = Math.max(c.open, c.high, c.low, c.close);
    const rangeLow = Math.min(c.open, c.high, c.low, c.close);
    const bodyTop = opts.body === 'lowHigh' ? rangeHigh : Math.max(c.open, c.close);
    const bodyBottom = opts.body === 'lowHigh' ? rangeLow : Math.min(c.open, c.close);

    const wickHigh = clamp01(yScale.scale(rangeHigh));
    const wickLow = clamp01(yScale.scale(rangeLow));
    let bodyHigh = clamp01(yScale.scale(bodyTop));
    let bodyLow = clamp01(yScale.scale(bodyBottom));
    if (bodyHigh - bodyLow < MIN_BODY) {
      const mid = (bodyHigh + bodyLow) / 2;
      bodyLow = clamp01(mid - MIN_BODY / 2);
      bodyHigh = clamp01(bodyLow + MIN_BODY);
    }

    const x0 = clamp01(cx - halfW);
    const x1 = clamp01(cx + halfW);

    boxes.push({
      x: x0,
      y: bodyLow,
      width: Math.max(0, x1 - x0),
      height: Math.max(0, bodyHigh - bodyLow),
      colorIdx,
      barId: i,
    });
    metas.push({
      candleId: i,
      indexInSeries: i,
      seriesIndex,
      seriesKey: series[seriesIndex],
      xValue: c.x,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      actual: c.actual,
      rising,
      x0,
      x1,
      cx,
      bodyLow,
      bodyHigh,
      wickLow,
      wickHigh,
      color,
    });
  }

  return {
    boxes,
    metas,
    series,
    seriesIndex,
    xSlots,
    xScale,
    yScale,
    xType,
    spacing,
    step,
    actual,
  };
}

/**
 * Candle under a point in layout space (y-up), or null. Hit-testing is by
 * **column**: anywhere in a candle's x-slot selects it, the way a trading
 * chart's crosshair behaves, rather than demanding a hit on the thin body.
 */
export function hitCandle(
  metas: CandleMeta[],
  step: number,
  lx: number,
  ly: number,
): CandleMeta | null {
  if (ly < 0 || ly > 1) return null;
  const reach = Math.max(step, 0.001) / 2;
  let best: CandleMeta | null = null;
  let bestD = reach;
  for (const m of metas) {
    const d = Math.abs(m.cx - lx);
    if (d <= bestD) {
      bestD = d;
      best = m;
    }
  }
  return best;
}

/** Every candle in the dataset, across series — re-exported for callers. */
export { allCandles };
