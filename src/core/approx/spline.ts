import { catmullRomToBezier } from '../geometry/curve.js';
import type { Approximation, FitPoint } from './types.js';

/** Cubic bézier spans sampled per span for the resampled spline output. */
const SAMPLES_PER_SPAN = 12;

function bezierPoint(
  p0: FitPoint,
  c1x: number,
  c1y: number,
  c2x: number,
  c2y: number,
  p1: FitPoint,
  t: number,
): FitPoint {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  return {
    x: uu * u * p0.x + 3 * uu * t * c1x + 3 * u * tt * c2x + tt * t * p1.x,
    y: uu * u * p0.y + 3 * uu * t * c1y + 3 * u * tt * c2y + tt * t * p1.y,
  };
}

/**
 * Catmull-Rom smooth through the points in the order given (reuses
 * {@link catmullRomToBezier}, the curve math extracted from the line chart's
 * overlay). Ordering is the caller's responsibility — see
 * {@link StraightApproximation} for why this doesn't sort by x. The result is
 * a resampled point path — `Approximation.fit` returns points to connect with
 * straight segments, so the curve is flattened here rather than left as
 * canvas bézier calls the drawer would need to know about.
 */
export class SplineApproximation implements Approximation {
  readonly kind = 'spline';

  fit(points: FitPoint[]): FitPoint[] {
    if (points.length < 2) return [...points];
    const segs = catmullRomToBezier(points);
    const out: FitPoint[] = [points[0]!];
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]!;
      const p0 = points[i]!;
      for (let s = 1; s <= SAMPLES_PER_SPAN; s++) {
        out.push(
          bezierPoint(
            p0,
            seg.c1x,
            seg.c1y,
            seg.c2x,
            seg.c2y,
            { x: seg.x, y: seg.y },
            s / SAMPLES_PER_SPAN,
          ),
        );
      }
    }
    return out;
  }
}
