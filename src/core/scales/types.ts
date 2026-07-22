import type { Scalar } from '../data/types.js';

/**
 * A scale maps a domain value into normalized layout space `[0, 1]`.
 * The chart later maps `[0, 1]` into clip/device coordinates.
 */
export interface Scale<T extends Scalar> {
  /** Map a domain value to `[0, 1]`. */
  scale(v: T): number;
  /** Nice tick values for axes. */
  ticks(count?: number): T[];
  /** Band scales only: fractional slot width in `[0, 1]`. */
  bandwidth?(): number;
}
