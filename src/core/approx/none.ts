import type { Approximation, FitPoint } from './types.js';

/** No-op strategy: the approximation layer draws nothing. */
export class NoneApproximation implements Approximation {
  readonly kind = 'none';

  fit(_points: FitPoint[]): FitPoint[] {
    return [];
  }
}
