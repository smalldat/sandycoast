import type { DataSet, Scalar } from '../../core/data/types.js';
import type { Easing } from '../../core/particles/anim.js';
import type { BackendPreference } from '../../core/render/pick.js';
import type { GrainShape, RGBA } from '../../core/render/types.js';

export type HoverEffect = 'highlight' | 'jitter' | 'opacity';

/** Edge of the plot area. */
export type Side = 'left' | 'right' | 'top' | 'bottom';

export interface AxisConfig {
  /** Draw this axis. Default false. */
  show?: boolean;
  /** Approx tick count (number), or `false` for an axis line with no ticks. */
  ticks?: number | false;
  /** Format a tick value into its label. Default: compact number / locale date. */
  tickFormat?: (v: Scalar) => string;
  /** Axis title, drawn beside the ticks. */
  label?: string;
  /** Extend tick marks across the plot as grid lines. Default false. */
  gridLines?: boolean;
  /** Line/label color (CSS). Default a subdued gray. */
  color?: string;
  /** Tick label font size in px. Default 11. */
  fontPx?: number;
  /** Tick/title font-family stack (CSS). Default 'system-ui, sans-serif'. */
  fontFamily?: string;
  /** Tick/title font weight (CSS: e.g. 'bold', 600). Default 'normal'. */
  fontWeight?: string | number;
  /**
   * Reading direction of the rotated axis title. Y-axis only (ignored on X).
   * 'up' reads bottom-to-top (default), 'down' reads top-to-bottom.
   */
  titleDirection?: 'up' | 'down';
}

export interface LegendConfig {
  /** Show the legend. Default false. */
  show?: boolean;
  /** Which edge to place it on. Default 'bottom'. */
  position?: Side;
  /** Cross-axis alignment. Default 'center'. */
  align?: 'start' | 'center' | 'end';
  /** Swatch shape. Default follows the grain shape. */
  swatch?: 'disc' | 'square';
}

export interface CurrentValueConfig {
  /** Show the readout. Default false. */
  show?: boolean;
  /**
   * Where the readout box sits. `'pointer'` follows the cursor; a Side pins it to
   * that edge; `'axis'` (**On axes**) drops the floating box and instead shows the
   * value(s) directly on the axes — a highlighted marker beside the Y axis and/or
   * below the X axis. Default `'pointer'`.
   */
  mode?: 'pointer' | 'axis' | Side;
  /** Format the hovered bar into a readout string. */
  format?: (bar: BarMeta) => string;
  /**
   * Cursor guide line(s) drawn to the hovered point. `'y'` = horizontal line to
   * the value (Y) axis, `'x'` = vertical line to the category (X) axis, `'both'`
   * = crosshair, `'none'` = no line. When omitted, falls back to
   * {@link showGuide} (`true` → `'y'`, `false` → `'none'`). Default `'y'`.
   */
  guide?: 'none' | 'x' | 'y' | 'both';
  /** Legacy: draw a horizontal guide line to the value axis. Superseded by {@link guide}. Default true. */
  showGuide?: boolean;
  /**
   * When a guide line is on, highlight the corresponding axis with a value
   * marker (a filled tick label at the cursor's row/column). Default true.
   */
  markers?: boolean;
  /** Text/line color (CSS). */
  color?: string;
}

/** Where to pin the FPS meter, or `'off'` to hide it. */
export type FpsPosition = Side | 'off';

export interface FpsConfig {
  /**
   * Edge/corner to pin the meter to, or `'off'`. `left`/`right` sit in the top
   * corner; `top`/`bottom` are centered on that edge. Default `'off'`.
   */
  position?: FpsPosition;
  /** Text color (CSS). Default a subdued light gray. */
  color?: string;
}

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
  reveal?: {
    /**
     * When the fade begins. `'afterPour'` = once pour+settle finishes
     * (animation duration + stagger). A number = absolute seconds from start.
     * Default `'afterPour'`.
     */
    start?: 'afterPour' | number;
    /** Fade window length in ms. Default 500. */
    duration?: number;
    /** Fade easing. Default 'easeOutCubic'. */
    ease?: Easing;
    /** Grain end-opacity 0..1 (0 = disappear). Default 0. */
    grainsTo?: number;
  };
}

export interface BarChartConfig {
  data: DataSet;
  /** Grains per unit area of layout space. Higher = denser sand. */
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
  };
  /** X and Y axes; each off by default. */
  axes?: {
    x?: AxisConfig;
    y?: AxisConfig;
  };
  /** Positionable series legend; off by default. */
  legend?: LegendConfig;
  /** Current-value readout tied to hover; off by default. */
  currentValue?: CurrentValueConfig;
  /** Solid fill + border per bar, revealed as particles fade; off by default. */
  bars?: BarStyleConfig;
  /** On-screen FPS meter; off by default. */
  fps?: FpsConfig;
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
