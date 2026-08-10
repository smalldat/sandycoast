import type { FieldType, Scalar } from './types.js';

/**
 * Per-point value payload: accompanying data beyond position, used today for
 * optional coloring and reserved for future mesh height/topology.
 */
export interface MeshValue<Custom = unknown> {
  /** Numeric value — coloring today, mesh height/weight later. */
  value?: number;
  /**
   * Independent per-point timestamp (not the x axis — e.g. "when this sample
   * was captured", orthogonal to its plotted position).
   */
  datetime?: Date;
  /**
   * Caller-defined payload, opaque to the chart; carried through to hover
   * events and, later, mesh construction untouched.
   */
  custom?: Custom;
}

export interface MeshPoint<X extends Scalar = Scalar, Y extends Scalar = Scalar, Custom = unknown> {
  x: X;
  y: Y;
  z?: MeshValue<Custom>;
}

/** One scatter series: an optional key (legend label) plus its points. */
export interface MeshSeries<Custom = unknown> {
  key?: Scalar;
  points: MeshPoint<Scalar, Scalar, Custom>[];
}

/**
 * A scatter/mesh dataset is a list of series — `z` no longer discriminates
 * series membership (it is a per-point value payload, see {@link MeshValue}),
 * so series membership is explicit array structure instead.
 */
export interface MeshDataSet<Custom = unknown> {
  series: MeshSeries<Custom>[];
  /** Optional explicit field types; inferred from data when omitted. */
  xType?: FieldType;
  yType?: FieldType;
}
