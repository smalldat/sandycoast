// Shared path-tracing math, extracted from the line chart's overlay (it was
// coupled to line's own drawing loop) so the scatter chart's 'straight'/
// 'spline' approximations can reuse the exact same curve without importing
// from a sibling chart (see the `component-isolation` project convention).

/** A 2D point, structurally compatible with any `{x,y}` shape (e.g. FitPoint). */
export interface Vec2 {
  x: number;
  y: number;
}

/** One cubic bézier span of a Catmull-Rom-derived curve. */
export interface BezierSegment {
  c1x: number;
  c1y: number;
  c2x: number;
  c2y: number;
  /** The span's end point (== `points[i+1]` for the source array). */
  x: number;
  y: number;
}

/**
 * Convert a Catmull-Rom spline through `points` into cubic bézier spans (one
 * per consecutive pair). Pure math — no canvas dependency — so it can be
 * reused off-canvas (e.g. by the `spline` {@link Approximation}, which
 * resamples the curve into plain points).
 */
export function catmullRomToBezier(points: Vec2[]): BezierSegment[] {
  const n = points.length;
  if (n < 2) return [];
  const segs: BezierSegment[] = [];
  for (let i = 0; i < n - 1; i++) {
    const j = i > 0 ? i - 1 : i; // p0
    const k = i + 2 < n ? i + 2 : i + 1; // p3
    const p0 = points[j]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[k]!;
    segs.push({
      c1x: p1.x + (p2.x - p0.x) / 6,
      c1y: p1.y + (p2.y - p0.y) / 6,
      c2x: p2.x - (p3.x - p1.x) / 6,
      c2y: p2.y - (p3.y - p1.y) / 6,
      x: p2.x,
      y: p2.y,
    });
  }
  return segs;
}

export type CurveStyle = 'straight' | 'spline';

/**
 * Append a polyline from index 1 onward into `path` (the caller has already
 * moved to `xs[0], ys[0]`). `'spline'` traces Catmull-Rom-derived cubic
 * béziers instead of straight segments. Takes parallel typed-array-like
 * coordinates (rather than `Vec2[]`) to avoid per-point object allocation on
 * hot drawing paths.
 */
export function tracePolylinePath(
  path: CanvasPath,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  style: CurveStyle,
): void {
  const n = xs.length;
  if (n < 2) return;
  if (style === 'straight') {
    for (let i = 1; i < n; i++) path.lineTo(xs[i]!, ys[i]!);
    return;
  }
  for (let i = 0; i < n - 1; i++) {
    const j = i > 0 ? i - 1 : i;
    const k = i + 2 < n ? i + 2 : i + 1;
    const c1x = xs[i]! + (xs[i + 1]! - xs[j]!) / 6;
    const c1y = ys[i]! + (ys[i + 1]! - ys[j]!) / 6;
    const c2x = xs[i + 1]! - (xs[k]! - xs[i]!) / 6;
    const c2y = ys[i + 1]! - (ys[k]! - ys[i]!) / 6;
    path.bezierCurveTo(c1x, c1y, c2x, c2y, xs[i + 1]!, ys[i + 1]!);
  }
}
