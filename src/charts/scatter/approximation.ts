import { LeastSquaresApproximation } from '../../core/approx/leastSquares.js';
import { NoneApproximation } from '../../core/approx/none.js';
import { SplineApproximation } from '../../core/approx/spline.js';
import { StraightApproximation } from '../../core/approx/straight.js';
import type { Approximation, FitPoint } from '../../core/approx/types.js';
import type { Scalar } from '../../core/data/types.js';
import type { RGBA } from '../../core/render/types.js';
import type { ScatterApproximationConfig, ScatterMeta } from './types.js';

export interface ResolvedApproximation {
  /** True when a fit strategy other than `'none'` is active. */
  enabled: boolean;
  strategy: Approximation;
  width: number;
  opacity: number;
  /** Stroke color override (CSS); undefined falls back to the series color. */
  color: string | undefined;
}

function resolveStrategy(kind: ScatterApproximationConfig['kind']): Approximation {
  // A caller-supplied object passes straight through — the "swappable
  // interface" ask: any object satisfying Approximation works, unmodified.
  if (kind && typeof kind === 'object') return kind;
  switch (kind) {
    case 'straight':
      return new StraightApproximation();
    case 'spline':
      return new SplineApproximation();
    case 'leastSquares':
      return new LeastSquaresApproximation();
    default:
      return new NoneApproximation();
  }
}

export function resolveApproximation(
  cfg: ScatterApproximationConfig | undefined,
): ResolvedApproximation {
  const strategy = resolveStrategy(cfg?.kind);
  return {
    enabled: strategy.kind !== 'none',
    strategy,
    width: cfg?.width ?? 1,
    opacity: cfg?.opacity ?? 1,
    color: cfg?.color,
  };
}

/** One series' fitted trend/connector path, in layout space [0,1]. */
export interface ApproximationPath {
  seriesIndex: number;
  seriesKey: Scalar | undefined;
  points: FitPoint[];
  color: RGBA;
}

/**
 * Run `strategy` over each series' point cloud independently (in layout
 * space), so a multi-series scatter gets one trend line per series, colored
 * by that series unless {@link ScatterApproximationConfig.color} overrides it.
 */
export function computeApproximationPaths(
  metas: ScatterMeta[],
  strategy: Approximation,
): ApproximationPath[] {
  const bySeries = new Map<number, ScatterMeta[]>();
  for (const m of metas) {
    const list = bySeries.get(m.seriesIndex);
    if (list) list.push(m);
    else bySeries.set(m.seriesIndex, [m]);
  }
  const out: ApproximationPath[] = [];
  for (const [seriesIndex, list] of bySeries) {
    const cloud: FitPoint[] = list.map((m) => ({ x: m.cx, y: m.cy }));
    const points = strategy.fit(cloud);
    if (points.length === 0) continue;
    out.push({ seriesIndex, seriesKey: list[0]!.seriesKey, points, color: list[0]!.color });
  }
  return out;
}
