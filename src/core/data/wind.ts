import type { FieldType } from './types.js';

/**
 * One wind observation: a single dimension (time) and **two** indicators
 * (direction and intensity).
 *
 * Neither `Point` (whose `z` is a series key) nor `MeshPoint` (whose `z` is a
 * value payload) has a slot for a second indicator, so the wind rose gets its
 * own additive point type — the precedent `core/data/mesh.ts` set for the
 * scatter chart. `Point`/`DataSet` and `MeshPoint`/`MeshDataSet` are untouched.
 */
export interface WindPoint<Custom = unknown> {
  /** The dimension: when the observation was taken. */
  t: Date | number;
  /**
   * Indicator 1 — the compass direction the wind comes **from** (the
   * meteorological convention). Units follow {@link WindDataSet.directionUnit}.
   */
  direction: number;
  /** Indicator 2 — wind speed / magnitude. Negative and non-finite are dropped. */
  intensity: number;
  /**
   * Caller-defined payload, opaque to the chart; carried through to hover
   * events, the time table and selection events untouched.
   */
  custom?: Custom;
}

export interface WindDataSet<Custom = unknown> {
  points: WindPoint<Custom>[];
  /** Unit of {@link WindPoint.direction}. Default `'deg'`. */
  directionUnit?: 'deg' | 'rad';
  /** Column header for the intensity indicator (table, readout). Default 'Speed'. */
  intensityLabel?: string;
  /** Unit suffix for intensity (e.g. 'kt', 'm/s'); used in labels only. */
  intensityUnit?: string;
  /** Explicit type for the time dimension; inferred when omitted. */
  tType?: FieldType;
}

/**
 * An observation after {@link normalizeWind}: time as epoch ms, direction as
 * radians clockwise from north in `[0, 2π)`, and a stable id.
 */
export interface WindObservation<Custom = unknown> {
  /**
   * Index into the **source** `points` array, so a caller can map a hovered or
   * selected mark back to the row they supplied. Also the morph identity key:
   * appending observations (the streaming case) never renumbers earlier ones.
   */
  id: number;
  /** Epoch milliseconds. */
  t: number;
  /** Radians clockwise from north, in `[0, 2π)`. */
  direction: number;
  intensity: number;
  custom: Custom | undefined;
}

/** The result of {@link normalizeWind}: usable observations plus what was dropped. */
export interface NormalizedWind<Custom = unknown> {
  /** Valid observations, sorted by `t` ascending (stable within equal times). */
  points: WindObservation<Custom>[];
  /** How many source rows were dropped as unusable (non-finite / negative). */
  dropped: number;
  intensityLabel: string;
  intensityUnit: string;
}
