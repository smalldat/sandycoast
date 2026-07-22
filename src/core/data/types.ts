/**
 * Generic X,Y,Z data model shared by every visual in the library.
 *
 * - `x`, `y`: numeric | datetime | string (categorical)
 * - `z`: optional series key; omit for a single series
 *
 * A field's runtime meaning is a {@link FieldType}, either declared on the
 * {@link DataSet} or inferred from the first non-null value.
 */
export type Scalar = number | Date | string;

export type FieldType = 'number' | 'time' | 'category';

export interface Point<
  X extends Scalar = Scalar,
  Y extends Scalar = Scalar,
  Z extends Scalar = Scalar,
> {
  x: X;
  y: Y;
  z?: Z;
}

export interface DataSet<
  X extends Scalar = Scalar,
  Y extends Scalar = Scalar,
  Z extends Scalar = Scalar,
> {
  points: Point<X, Y, Z>[];
  /** Optional explicit field types; inferred from data when omitted. */
  xType?: FieldType;
  yType?: FieldType;
  zType?: FieldType;
}

/**
 * Reference to an existing point for {@link removePoints}: a positional index
 * (negative counts from the end, `-1` = last) or a match by `x` (and `z` if the
 * series is set; omit `z` to match every series at that `x`).
 */
export type PointRef = number | { x: Scalar; z?: Scalar };

/** A value change: locate a point by `x` (+ optional `z`) and set its `y`. */
export interface PointPatch {
  x: Scalar;
  z?: Scalar;
  y: Scalar;
}

/** Accessor: pull a field out of an arbitrary row object. */
export type Accessor<Row, T extends Scalar> = (row: Row, index: number) => T;

export interface AccessorSpec<Row> {
  x: Accessor<Row, Scalar>;
  y: Accessor<Row, Scalar>;
  z?: Accessor<Row, Scalar>;
  xType?: FieldType;
  yType?: FieldType;
  zType?: FieldType;
}
