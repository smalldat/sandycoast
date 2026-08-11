import type { RevealConfig } from '../../core/chrome/reveal.js';
import type {
  AxisConfig,
  CurrentValueConfig as CurrentValueConfigOf,
  DimConfig,
  FpsConfig,
  FpsPosition,
  HoverEffect,
  LegendConfig,
  SeriesFocusPayload,
  Side,
  TitleConfig,
} from '../../core/chrome/types.js';
import type { DataSet, Scalar } from '../../core/data/types.js';
import type { Easing } from '../../core/particles/anim.js';
import type { BackendPreference } from '../../core/render/pick.js';
import type { GrainShape, RGBA } from '../../core/render/types.js';
import type { PanZoomConfig } from '../../core/view/types.js';

// Chrome config is shared by every visual and lives in `core`; re-exported here
// so the bar chart's public surface is unchanged.
export type {
  AxisConfig,
  DimConfig,
  FpsConfig,
  FpsPosition,
  HoverEffect,
  LegendConfig,
  SeriesFocusPayload,
  Side,
  TitleConfig,
};

/** Hover readout config, with `format` typed against {@link BarMeta}. */
export type CurrentValueConfig = CurrentValueConfigOf<BarMeta>;

/**
 * Solid fill + border drawn per bar, revealed as the sand particles fade out.
 * Off by default; a config without `bars` renders exactly as before.
 */
export interface BarStyleConfig {
  /** Fill always uses the bar's series color; only opacity is configurable. */
  fill?: {
    /** Fill opacity 0..1. Default 1. */
    opacity?: number;
  };
  /** Border always uses the bar's series color; color is not configurable. */
  border?: {
    /** Draw the left edge. Default: all four sides when a `border` block is present. */
    left?: boolean;
    top?: boolean;
    right?: boolean;
    bottom?: boolean;
    /** Stroke width in CSS px. Default 1. */
    width?: number;
    /** Stroke opacity 0..1. Default 1. */
    opacity?: number;
  };
  /** Timing of the particle→solid crossfade. */
  reveal?: RevealConfig;
}

export interface BarChartConfig {
  data: DataSet;
  /**
   * Grain budget multiplier: the chart draws `grainDensity * 20_000` grains
   * (capped by {@link BarChartConfig.maxGrains}), independent of how many bars
   * the data has. Bars share that budget by area. Higher = denser sand.
   */
  grainDensity?: number;
  /** Global grain ceiling (default 100k). */
  maxGrains?: number;
  /** Series colors, CSS hex or rgb strings; cycled per series. */
  colors?: string[];
  background?: string;
  grain?: {
    sizePx?: number;
    shape?: GrainShape;
    /** Grid jitter fraction (0..1). */
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
     * Transition length in **ms** for `update`/`add`/`remove` (border tween +
     * grain-fade window). Default `duration + stagger`.
     */
    morphDuration?: number;
    /**
     * How grains of an **unchanged** bar move on a data change. `'translate'`
     * (default) slides each grain 1:1 with a settle stagger; `'reshuffle'` flows
     * them from random old grains of the bar; `'withBar'` locks them to the bar
     * — rigid 1:1 move with **no delay and no grain-fade flash**, so the change
     * is indicated by the border and by added/removed particles alone. Default
     * `'translate'`.
     */
    reflow?: 'translate' | 'reshuffle' | 'withBar';
    /**
     * How an **added** bar's grains enter. `'pour'` (default) falls from above
     * the plot; `'rise'` grows up from the base. Default `'pour'`.
     */
    enter?: 'pour' | 'rise';
    /**
     * How a **removed** bar's grains leave. `'fall'` (default) lets them drop
     * off the bottom and fade; `'vanish'` removes them instantly. Default
     * `'fall'`.
     */
    exit?: 'fall' | 'vanish';
  };
  interaction?: {
    hover?: {
      effects?: HoverEffect[];
      highlightGain?: number;
      /** Extra motion amplitude for hovered grains (layout units). */
      jitterAmp?: number;
      /**
       * Target opacity 0..1 for hovered grains when the `'opacity'` effect is
       * on. Hovered grains lift from their current (possibly reveal-faded)
       * opacity toward this, making them stand out. Default 1.
       */
      opacity?: number;
      /**
       * Enter/leave transition time in ms. The hover effect eases in when the
       * pointer enters a bar and eases out on leave (or crossfades to the next
       * bar). Default 180.
       */
      fadeMs?: number;
    };
    /** Legend click-to-isolate tuning; see {@link LegendConfig.interactive}. */
    dim?: DimConfig;
  };
  /** X and Y axes; each off by default. */
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
  /** Solid fill + border per bar, revealed as particles fade; off by default. */
  bars?: BarStyleConfig;
  /** On-screen FPS meter; off by default. */
  fps?: FpsConfig;
  /** Pan & zoom (drag to pan, wheel/UI to zoom); off by default. */
  panZoom?: PanZoomConfig;
  /** Force a rendering backend; default 'auto' (WebGPU → Canvas2D). */
  backend?: BackendPreference;
}

/** Metadata for one drawn bar, surfaced on hover events. */
export interface BarMeta {
  barId: number;
  seriesIndex: number;
  seriesKey: Scalar | undefined;
  xValue: Scalar;
  yValue: number;
  /** Layout-space extents [0,1]. */
  x0: number;
  x1: number;
  height: number;
  color: RGBA;
}

export interface HoverPayload {
  bar: BarMeta | null;
}
