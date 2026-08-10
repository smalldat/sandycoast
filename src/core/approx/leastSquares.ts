import type { Approximation, FitPoint } from './types.js';

/** Below this the normal-equations denominator is unreliable — treat x as constant. */
const DEGENERATE_EPSILON = 1e-9;

/**
 * Ordinary linear least-squares (`y = mx + b`) over the whole cloud, returned
 * as the two endpoints spanning the x-domain (closed-form, no iteration).
 */
export class LeastSquaresApproximation implements Approximation {
  readonly kind = 'leastSquares';

  fit(points: FitPoint[]): FitPoint[] {
    const n = points.length;
    if (n === 0) return [];
    if (n === 1) return [points[0]!, points[0]!];

    let sx = 0;
    let sy = 0;
    let sxx = 0;
    let sxy = 0;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const p of points) {
      sx += p.x;
      sy += p.y;
      sxx += p.x * p.x;
      sxy += p.x * p.y;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const meanX = sx / n;
    const meanY = sy / n;
    const denom = n * sxx - sx * sx;

    // Near-vertical cloud (~zero x variance): the closed-form slope blows up.
    // Guard it the same way LinearScale pads a zero-span domain — draw the
    // mean vertical instead of dividing by ~0.
    if (Math.abs(denom) < DEGENERATE_EPSILON) {
      return [
        { x: meanX, y: minY },
        { x: meanX, y: maxY },
      ];
    }

    const m = (n * sxy - sx * sy) / denom;
    const b = meanY - m * meanX;
    return [
      { x: minX, y: m * minX + b },
      { x: maxX, y: m * maxX + b },
    ];
  }
}
