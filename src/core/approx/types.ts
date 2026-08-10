/** A point in the fit's working space (scatter passes layout-space `[0,1]` coords). */
export interface FitPoint {
  x: number;
  y: number;
}

/**
 * Swappable point-cloud fitting strategy: turns an unordered point cloud into
 * an ordered path to draw (a resampled curve, a regression line, …). Built-ins
 * live alongside this file (`straight`/`spline`/`leastSquares`); a caller can
 * pass any object satisfying this interface in place of the string `kind` to
 * plug in a custom fitter without the chart changing.
 */
export interface Approximation {
  readonly kind: string;
  fit(points: FitPoint[]): FitPoint[];
}
