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
import type { DataSet, Scalar } from '../../core/data/types.js';
import type { Easing } from '../../core/particles/anim.js';
import type { BackendPreference } from '../../core/render/pick.js';
import type { GrainShape, RGBA } from '../../core/render/types.js';

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

/** Hover readout config, with `format` typed against {@link SliceMeta}. */
export type CurrentValueConfig = CurrentValueConfigOf<SliceMeta>;

/** Default cap on how many points of one series become slices. */
export const DEFAULT_MAX_SLICES = 10;
/** Default cap on how many series the slider can address. */
export const DEFAULT_MAX_SERIES = 1000;

/**
 * Series slider: the pie shows exactly one series at a time, and the slider
 * picks which. It replaces the bar chart's X axis, and takes its tick styling
 * from the same {@link AxisConfig} block (`axes.x`).
 */
export interface SliderConfig {
  /** Draw the slider. Default true (hidden anyway when there is one series). */
  show?: boolean;
  /** Edge to pin it to. Default 'bottom'. */
  position?: 'top' | 'bottom';
  /** Let the user drag/click the handle. Default true. */
  interactive?: boolean;
  /** Track/handle color (CSS). Defaults to the X axis color. */
  color?: string;
  /** Handle radius in CSS px. Default 7. */
  handlePx?: number;
  /** Track thickness in CSS px. Default 3. */
  trackPx?: number;
}

/**
 * Solid fill + border drawn per slice, revealed as the sand particles fade out.
 * Mirrors the bar chart's `bars` block; the border outlines the whole wedge
 * rather than selectable sides.
 */
export interface PieStyleConfig {
  /** Fill always uses the slice's color; only opacity is configurable. */
  fill?: {
    /** Fill opacity 0..1. Default 1. */
    opacity?: number;
  };
  /** Border always uses the slice's color; color is not configurable. */
  border?: {
    /** Draw the wedge outline. Default true when a `border` block is present. */
    show?: boolean;
    /** Stroke width in CSS px. Default 1. */
    width?: number;
    /** Stroke opacity 0..1. Default 1. */
    opacity?: number;
  };
  /** Timing of the particle→solid crossfade (shared by every visual). */
  reveal?: RevealConfig;
}

export interface PieChartConfig {
  data: DataSet;
  /**
   * Grain budget multiplier: the chart draws `grainDensity * 20_000` grains
   * (capped by {@link PieChartConfig.maxGrains}), independent of how many slices
   * the data has. Slices share that budget by area. Higher = denser sand.
   */
  grainDensity?: number;
  /** Global grain ceiling (default 100k). */
  maxGrains?: number;
  /** Slice colors, CSS hex or rgb strings; cycled per **slice**. */
  colors?: string[];
  background?: string;
  grain?: {
    sizePx?: number;
    shape?: GrainShape;
    /** Polar-grid jitter fraction (0..1). */
    jitter?: number;
    /** Baseline settle wobble amplitude (layout units). */
    settleJitter?: number;
  };

  // --- Pie geometry --------------------------------------------------------
  /**
   * Hole radius as a fraction of the outer radius, 0..0.95. `0` (default) is a
   * pie; anything above cuts the middle out and makes it a donut.
   */
  innerRadius?: number;
  /** Outer radius as a fraction of the disc box's half-extent, 0..1. Default 0.92. */
  radius?: number;
  /** Rotation of the first slice's leading edge, degrees clockwise. Default 0 (12 o'clock). */
  startAngle?: number;
  /** Gap between adjacent slices, degrees. Default 0. */
  padAngle?: number;

  // --- Series selection ----------------------------------------------------
  /**
   * Index of the series shown, clamped to the available range. Changing it via
   * {@link PieChart.setSeriesIndex} animates the slices to the new values.
   * Default 0.
   */
  seriesIndex?: number;
  /** Max points of a series drawn as slices; extras are dropped. Default 10. */
  maxSlices?: number;
  /** Max series the slider can address; extras are dropped. Default 1000. */
  maxSeries?: number;
  /** Series slider (replaces the bar chart's X axis). */
  slider?: SliderConfig;

  animation?: {
    /** Per-grain duration, milliseconds. */
    duration?: number;
    ease?: Easing;
    /** Pour stagger spread, milliseconds. */
    stagger?: number;
    /**
     * Transition length in **ms** for a series change / `update` / `add` /
     * `remove` (wedge tween + grain-fade window). Default `duration + stagger`.
     */
    morphDuration?: number;
    /**
     * How grains of an **existing** slice move on a data change. `'translate'`
     * (default) maps each grain 1:1 with a settle stagger; `'reshuffle'` flows
     * them from random old grains of the slice; `'withSlice'` locks them to the
     * wedge — rigid move with no delay and no grain-fade flash.
     */
    reflow?: 'translate' | 'reshuffle' | 'withSlice';
    /**
     * How an **added** slice's grains enter. `'pour'` (default) falls from above
     * the plot; `'rise'` grows out from the center.
     */
    enter?: 'pour' | 'rise';
    /**
     * How a **removed** slice's grains leave. `'fall'` (default) drops them off
     * the bottom; `'vanish'` removes them instantly.
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
  /**
   * `axes.x` styles the **slider's** ticks (count, format, label, font, color) —
   * the same block the bar chart uses for its category axis. There is no Y axis
   * on a pie, so `axes.y` is ignored.
   */
  axes?: {
    x?: AxisConfig;
  };
  /** Slice legend; off by default. Entries are the slice categories. */
  legend?: LegendConfig;
  /** Chart title; shares the legend's placement vocabulary. */
  title?: TitleConfig;
  /** Current-value readout tied to hover; off by default. */
  currentValue?: CurrentValueConfig;
  /** Solid fill + border per slice, revealed as particles fade; off by default. */
  slices?: PieStyleConfig;
  /** On-screen FPS meter; off by default. */
  fps?: FpsConfig;
  /** Force a rendering backend; default 'auto' (WebGPU → Canvas2D). */
  backend?: BackendPreference;
}

/** Metadata for one drawn slice, surfaced on hover events. */
export interface SliceMeta {
  /** Grain `barId` slot — index of the slice within the drawn series. */
  sliceId: number;
  /** Slice category (the point's `x`). */
  xValue: Scalar;
  /** Series this slice belongs to (the point's `z`). */
  seriesKey: Scalar | undefined;
  /** Index of that series in the slider's range. */
  seriesIndex: number;
  /** Raw value (the point's `y`). */
  value: number;
  /** Share of the series total, 0..1. */
  fraction: number;
  /** Start angle, radians clockwise from 12 o'clock. */
  a0: number;
  /** End angle, radians clockwise from 12 o'clock. */
  a1: number;
  /** Hole radius, layout units (0 for a pie). */
  rInner: number;
  /** Outer radius, layout units. */
  rOuter: number;
  color: RGBA;
}

export interface HoverPayload {
  slice: SliceMeta | null;
}

export interface SeriesChangePayload {
  index: number;
  key: Scalar | undefined;
}
