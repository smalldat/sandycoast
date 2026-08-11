import type { Approximation } from '../../core/approx/types.js';
import type { RevealConfig } from '../../core/chrome/reveal.js';
// Chrome config is shared by every visual and lives in `core`.
import type {
  AxisConfig,
  CurrentValueConfig as CurrentValueConfigOf,
  DimConfig,
  FpsConfig,
  HoverEffect,
  LegendConfig,
  SeriesFocusPayload,
  Side,
  TitleConfig,
} from '../../core/chrome/types.js';
import type { MeshDataSet, MeshValue } from '../../core/data/mesh.js';
import type { Scalar } from '../../core/data/types.js';
import type { Easing } from '../../core/particles/anim.js';
import type { BackendPreference } from '../../core/render/pick.js';
import type { GrainShape, RGBA } from '../../core/render/types.js';
import type { PanZoomConfig } from '../../core/view/types.js';

export type {
  AxisConfig,
  DimConfig,
  FpsConfig,
  HoverEffect,
  LegendConfig,
  SeriesFocusPayload,
  Side,
  TitleConfig,
};

/** Hover readout config, with `format` typed against {@link ScatterMeta}. */
export type CurrentValueConfig = CurrentValueConfigOf<ScatterMeta>;

/** Solid marker glyph shape drawn once the sand cloud resolves. */
export type MarkerShape = 'circle' | 'triangle' | 'square' | 'asterisk';

/**
 * Solid marker glyph drawn per point, revealed as the sand particles fade
 * out — the scatter analogue of the line chart's solid `line` / bar chart's
 * solid `border`. Off by default; a config without `marker` renders sand only.
 */
export interface MarkerStyleConfig {
  /** Default shape for every series. Default 'circle'. */
  shape?: MarkerShape;
  /** Per-series shape cycling, like `colors`. Overrides `shape` per series. */
  shapes?: MarkerShape[];
  /** Marker size, CSS px. Default 6. */
  size?: number;
  /** Per-series size cycling. */
  sizes?: number[];
  /** Marker fill opacity 0..1. Default 1. */
  opacity?: number;
  /** Timing of the particle→marker crossfade (shared RevealConfig). */
  reveal?: RevealConfig;
}

/**
 * Trend/connector fit over the point cloud, drawn once the markers resolve.
 * Off by default. Passing an {@link Approximation} object in place of a
 * `kind` string plugs in a fully custom fitter without touching the chart.
 */
export interface ScatterApproximationConfig {
  kind?: 'none' | 'straight' | 'spline' | 'leastSquares' | Approximation;
  /** Stroke width, CSS px. Default 1. */
  width?: number;
  /** Stroke opacity 0..1. Default 1. */
  opacity?: number;
  /** Stroke color (CSS). Default: the series color. */
  color?: string;
}

export interface ScatterChartConfig {
  data: MeshDataSet;
  /**
   * Grain budget multiplier: the chart draws `grainDensity * 20_000` grains
   * (capped by {@link ScatterChartConfig.maxGrains}), independent of how many
   * points the data has. Points share that budget by cloud area, so adding
   * points subdivides the same sand rather than asking for more.
   */
  grainDensity?: number;
  /** Global grain ceiling (default 100k). */
  maxGrains?: number;
  /** Cloud radius grains scatter within per point, layout units. Default 0.02. */
  pointRadius?: number;
  /** Series colors, CSS hex or rgb strings; cycled per series. */
  colors?: string[];
  background?: string;
  grain?: {
    sizePx?: number;
    shape?: GrainShape;
    /** Polar-disc jitter fraction (0..1): 0 = pinpoint, 1 = full cloud radius. */
    jitter?: number;
    /** Baseline settle wobble amplitude (layout units). */
    settleJitter?: number;
  };
  animation?: {
    /** Per-grain duration, milliseconds. */
    duration?: number;
    ease?: Easing;
    /** Pour stagger spread, milliseconds. */
    stagger?: number;
    /**
     * Transition length in **ms** for `update`/`add`/`remove` (marker tween +
     * grain-fade window). Default `duration + stagger`.
     */
    morphDuration?: number;
    /**
     * How grains of an **unchanged** point move on a data change. `'translate'`
     * (default) slides each grain 1:1 with a settle stagger; `'reshuffle'` flows
     * them from random old grains; `'withMarker'` locks them to the marker —
     * rigid 1:1 move with **no delay and no grain-fade flash**. Default
     * `'translate'`.
     */
    reflow?: 'translate' | 'reshuffle' | 'withMarker';
    /**
     * Animate the sand grains during an `update`/`add`/`remove` morph. `true`
     * (default) flows/pours/drops grains per `reflow`/`enter`/`exit`; `false`
     * snaps every grain straight to its new position with no motion so
     * **only the solid marker tweens** on a data change. Ignored for the
     * initial pour-in. Default `true`.
     */
    morphGrains?: boolean;
    /**
     * How an **added** point's grains enter. `'pour'` (default) falls from
     * above the plot; `'rise'` grows up from the base; `'continue'` skips the
     * emergence entirely — the new marker appears already settled at its
     * position (best for continuous streaming). Default `'pour'`.
     */
    enter?: 'pour' | 'rise' | 'continue';
    /**
     * How a **removed** point's grains leave. `'fall'` (default) lets them
     * drop off the bottom and fade; `'vanish'` removes them instantly.
     * Default `'fall'`.
     */
    exit?: 'fall' | 'vanish';
  };
  interaction?: {
    hover?: {
      effects?: HoverEffect[];
      highlightGain?: number;
      /** Extra motion amplitude for hovered grains (layout units). */
      jitterAmp?: number;
      /** Target opacity 0..1 for hovered grains when `'opacity'` is on. Default 1. */
      opacity?: number;
      /** Enter/leave transition time in ms. Default 180. */
      fadeMs?: number;
    };
    /** Legend click-to-isolate tuning; see {@link LegendConfig.interactive}. */
    dim?: DimConfig;
  };
  /** X and Y axes; each off by default. Both are continuous (numeric/time). */
  axes?: {
    x?: AxisConfig;
    y?: AxisConfig;
  };
  /** Positionable series legend; off by default. */
  legend?: LegendConfig;
  /** Chart title; shares the legend's placement vocabulary. Off by default. */
  title?: TitleConfig;
  /** Current-value readout tied to hover; off by default. */
  currentValue?: CurrentValueConfig;
  /** Solid marker per point, revealed as particles fade; off by default. */
  marker?: MarkerStyleConfig;
  /** Trend/connector fit over the point cloud; off by default. */
  approximation?: ScatterApproximationConfig;
  /** On-screen FPS meter; off by default. */
  fps?: FpsConfig;
  /** Pan & zoom (drag to pan, wheel/UI to zoom); off by default. */
  panZoom?: PanZoomConfig;
  /** Force a rendering backend; default 'auto' (WebGPU → Canvas2D). */
  backend?: BackendPreference;
}

/** Metadata for one drawn point, surfaced on hover events. */
export interface ScatterMeta {
  /** Stable per-rebuild id (index into the meta list); also the grain `barId`. */
  pointId: number;
  seriesIndex: number;
  /** Position within its series — the morph identity key (there is no `z` key). */
  indexInSeries: number;
  seriesKey: Scalar | undefined;
  xValue: Scalar;
  yValue: Scalar;
  /** The point's `z` value payload, if any (coloring today, mesh data later). */
  meshValue: MeshValue | undefined;
  /** Layout-space x [0,1]. */
  cx: number;
  /** Layout-space y [0,1]. */
  cy: number;
  color: RGBA;
}

export interface HoverPayload {
  point: ScatterMeta | null;
}
