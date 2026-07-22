import type { FieldType, Scalar } from '../data/types.js';
import { BandScale } from './band.js';
import { LinearScale } from './linear.js';
import { TimeScale } from './time.js';
import type { Scale } from './types.js';

export { BandScale } from './band.js';
export { LinearScale } from './linear.js';
export { TimeScale } from './time.js';
export type { Scale } from './types.js';

/**
 * Build the appropriate scale for a field given its values and type.
 * `distinct` supplies category order for band scales.
 */
export function makeScale(
  type: FieldType,
  values: Scalar[],
  opts: { includeZero?: boolean; distinct?: Scalar[]; padding?: number } = {},
): Scale<Scalar> {
  if (type === 'number') {
    return LinearScale.fromValues(values as number[], opts.includeZero ?? true) as Scale<Scalar>;
  }
  if (type === 'time') {
    return TimeScale.fromValues(values as Date[]) as Scale<Scalar>;
  }
  const distinct = opts.distinct ?? Array.from(new Set(values.map(String))).map((s) => s as Scalar);
  return new BandScale(distinct, opts.padding) as Scale<Scalar>;
}
