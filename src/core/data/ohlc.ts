import type { FieldType, Scalar } from './types.js';

/**
 * One OHLC bar: the four standard price indicators for a period, plus an
 * optional `actual` (the live / last traded price at that point in time).
 *
 * A candle is *not* a {@link Point}: it carries four y values, not one, so it
 * gets its own additive type in `core/data/` rather than bending `Point.y`
 * (the same reasoning that gave the scatter chart `core/data/mesh.ts`).
 * `Point`/`DataSet` and `MeshDataSet` are untouched by this file.
 */
export interface Candle<X extends Scalar = Scalar> {
  /** Period start — a category label, a number, or a Date. */
  x: X;
  open: number;
  high: number;
  low: number;
  close: number;
  /**
   * Live / last traded price. Optional and orthogonal to `close`: the last
   * candle of a streaming series has a `close` that is still provisional,
   * while `actual` is the price right now. Drives the chart's live-price line
   * (see `CandlestickChartConfig.actual`), never the candle's own geometry.
   */
  actual?: number;
}

/** One instrument: an optional key (slider/legend label) plus its candles. */
export interface CandleSeries<X extends Scalar = Scalar> {
  key?: Scalar;
  candles: Candle<X>[];
}

/**
 * An OHLC dataset is a list of series (instruments). Candles from two
 * instruments can't share an x-slot legibly, so — like the pie chart's series
 * axis — the series array is a *selector*: the chart draws one at a time and
 * the slider picks which.
 */
export interface OhlcDataSet<X extends Scalar = Scalar> {
  series: CandleSeries<X>[];
  /** Optional explicit x field type; inferred from the data when omitted. */
  xType?: FieldType;
}

/**
 * Reference to an existing candle for {@link removeCandles}: a positional index
 * (negative counts from the end, `-1` = last) or a match by `x`.
 */
export type CandleRef = number | { x: Scalar };

/**
 * A price change: locate a candle by `x` and set whichever prices are given.
 * Streaming a live feed usually patches only `close` and `actual`.
 */
export interface CandlePatch {
  x: Scalar;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  actual?: number;
}
