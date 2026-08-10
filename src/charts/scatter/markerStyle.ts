import { type ResolvedReveal, resolveReveal, revealFactor } from '../../core/chrome/reveal.js';
import type { MarkerShape, MarkerStyleConfig, ScatterChartConfig } from './types.js';

// The reveal ramp is identical across every visual in the library; it lives in
// `core` and is re-exported here rather than copied.
export { revealFactor };
export type { ResolvedReveal };

export interface ResolvedMarkerStyle {
  /** True when the solid marker layer is drawn (gates overlay mount + reveal loop). */
  enabled: boolean;
  shape: MarkerShape;
  shapes: MarkerShape[] | undefined;
  size: number;
  sizes: number[] | undefined;
  opacity: number;
  reveal: ResolvedReveal;
}

export function resolveMarkerStyle(cfg: ScatterChartConfig): ResolvedMarkerStyle {
  const m: MarkerStyleConfig | undefined = cfg.marker;
  return {
    enabled: m != null,
    shape: m?.shape ?? 'circle',
    shapes: m?.shapes,
    size: m?.size ?? 6,
    sizes: m?.sizes,
    opacity: m?.opacity ?? 1,
    reveal: resolveReveal(m?.reveal),
  };
}

/** Per-series shape, cycling `shapes` like `colors`; falls back to the default `shape`. */
export function shapeForSeries(style: ResolvedMarkerStyle, seriesIndex: number): MarkerShape {
  return style.shapes && style.shapes.length > 0
    ? style.shapes[seriesIndex % style.shapes.length]!
    : style.shape;
}

/** Per-series size, cycling `sizes`; falls back to the default `size`. */
export function sizeForSeries(style: ResolvedMarkerStyle, seriesIndex: number): number {
  return style.sizes && style.sizes.length > 0
    ? style.sizes[seriesIndex % style.sizes.length]!
    : style.size;
}
