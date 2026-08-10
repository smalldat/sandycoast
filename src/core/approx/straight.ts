import type { Approximation, FitPoint } from './types.js';

/**
 * Connect points consecutively, in the order given — a plain connect-the-dots
 * polyline. Ordering is the caller's responsibility: a function-shaped cloud
 * (one y per x) typically wants points sorted by x, but a non-monotonic shape
 * (e.g. a spiral) wants its own natural order, so this strategy doesn't
 * impose one.
 */
export class StraightApproximation implements Approximation {
  readonly kind = 'straight';

  fit(points: FitPoint[]): FitPoint[] {
    return [...points];
  }
}
