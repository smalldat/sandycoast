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
  SliderConfig,
  TitleConfig,
} from '../../core/chrome/types.js';
import type { Candle, CandleSeries, OhlcDataSet } from '../../core/data/ohlc.js';
import type { Scalar } from '../../core/data/types.js';
import type { Easing } from '../../core/particles/anim.js';
import type { BackendPreference } from '../../core/render/pick.js';
import type { GrainShape, RGBA } from '../../core/render/types.js';
import type { PanZoomConfig } from '../../core/view/types.js';

export type {
  AxisConfig,
  Candle,
  CandleSeries,
  DimConfig,
  FpsConfig,
  HoverEffect,
  LegendConfig,
  OhlcDataSet,
  SeriesFocusPayload,
  Side,
  SliderConfig,
  TitleConfig,
};

/** Hover readout config, with `format` typed against {@link CandleMeta}. */
export type CurrentValueConfig = CurrentValueConfigOf<CandleMeta>;

/** Default cap on how many candles of one series are drawn. */
export const DEFAULT_MAX_CANDLES = 5000;
/** Default cap on how many series (instruments) the slider can address. */
export const DEFAULT_MAX_SERIES = 1000;

/**
 * Which price difference decides a candle's color. All four rules fall back to
 * `'openClose'` for the first candle of a series (nothing precedes it):
 *
 * - `'openClose'` — rising when `close >= open`. The classic rule.
 * - `'closeClose'` — rising when this candle's `close` is at or above the
 *   **previous** candle's close: did the level rise since the last period.
 * - `'lowHigh'` — rising when this candle's low-high range **midpoint** is at
 *   or above the previous candle's midpoint: did the whole trading range shift
 *   up, regardless of where the period opened and closed.
 * - `'closeInRange'` — rising when the close sits in the upper half of the
 *   candle's own low-high range. Depends on no other candle.
 */
export type CandleDirection = 'openClose' | 'closeClose' | 'lowHigh' | 'closeInRange';

/**
 * A caller-supplied color rule: return `true` for a rising candle. Passing one
 * in place of a {@link CandleDirection} string plugs in an arbitrary rule
 * (moving averages, an external signal, …) without the chart changing — the
 * same swappable-strategy shape the scatter chart's `approximation` uses.
 */
export type CandleDirectionFn = (
  candle: Candle,
  previous: Candle | undefined,
  index: number,
) => boolean;

/**
 * Which pair of prices the candle **body** spans. `'openClose'` (default) is
 * the classic candle: an open→close body with high-low wicks above and below.
 * `'lowHigh'` turns each candle into a plain range bar — the body spans the
 * full low→high extent and there are no wicks to draw.
 */
export type CandleBody = 'openClose' | 'lowHigh';

/**
 * How candles are positioned along X. `'band'` (default) gives every candle an
 * evenly-spaced slot, so non-trading days collapse instead of leaving gaps —
 * standard trading-chart behavior. `'time'` positions candles at their real
 * x value on a continuous scale, so gaps in the data show as gaps on screen.
 * A categorical x has no continuous position, so it always uses `'band'`.
 */
export type CandleSpacing = 'band' | 'time';

/**
 * The candles themselves: their color rule, their geometry, and the solid
 * fill/border layer that resolves as the sand fades out. Mirrors the bar
 * chart's `bars` block.
 *
 * The **wicks are not part of the reveal**: they are the only carrier of the
 * high/low prices, so they are stroked solid from the first frame while the
 * bodies are still sand (see {@link CandleStyleConfig.wick}).
 */
export interface CandleStyleConfig {
  /** Color of a rising candle (CSS). Default a green. */
  rising?: string;
  /** Color of a falling candle (CSS). Default a red. */
  falling?: string;
  /** Which difference decides rising vs falling. Default `'openClose'`. */
  direction?: CandleDirection | CandleDirectionFn;
  /** Which prices the body spans. Default `'openClose'`. */
  body?: CandleBody;
  /** Body width as a fraction of the x step, 0..1. Default 0.62. */
  width?: number;
  /** Solid body fill; always the candle's own color, only opacity is settable. */
  fill?: {
    /** Fill opacity 0..1. Default 1. */
    opacity?: number;
  };
  /** Solid body outline; always the candle's own color. */
  border?: {
    /** Draw the outline. Default true when a `border` block is present. */
    show?: boolean;
    /** Stroke width in CSS px. Default 1. */
    width?: number;
    /** Stroke opacity 0..1. Default 1. */
    opacity?: number;
  };
  /**
   * High-low wicks, drawn solid throughout (never sand, never faded by the
   * reveal ramp). Ignored when `body` is `'lowHigh'` — the body already spans
   * the whole range.
   */
  wick?: {
    /** Draw the wicks. Default true. */
    show?: boolean;
    /** Stroke width in CSS px. Default 1. */
    width?: number;
    /** Stroke opacity 0..1. Default 1. */
    opacity?: number;
  };
  /** Timing of the particle→solid-body crossfade (shared by every visual). */
  reveal?: RevealConfig;
}

/**
 * The live-price line: a horizontal rule across the plot at the latest
 * `Candle.actual`, with a value marker on the price axis. Off by default —
 * a config without an `actual` block carries the values through hover and
 * events but draws nothing.
 */
export interface ActualConfig {
  /** Draw the line. Default true when an `actual` block is present. */
  show?: boolean;
  /** Line/marker color (CSS). Default: the current-value readout color. */
  color?: string;
  /** Line width in CSS px. Default 1. */
  width?: number;
  /** Line opacity 0..1. Default 0.9. */
  opacity?: number;
  /** Dash pattern in CSS px, or `false` for a solid line. Default `[4, 4]`. */
  dash?: number[] | false;
  /** Show the value marker on the Y axis. Default true. */
  marker?: boolean;
  /** Format the price for the axis marker. Default: compact number. */
  format?: (value: number) => string;
}

/**
 * What a {@link PointerOverrides} handler returns. Returning exactly `false`
 * suppresses the chart's own default reaction; a handler that returns nothing
 * (the common case — just observe, or draw your own UI) lets it run.
 */
export type PointerOverrideResult = unknown;

/**
 * Replacements for the chart's built-in mouse reactions. Every handler is
 * optional; returning `false` from one **suppresses** the chart's own default
 * for that gesture (and any event it would have emitted), so a caller can
 * drive its own tooltip, selection model or series switcher. Returning
 * anything else (including nothing) lets the default run as usual.
 */
export interface PointerOverrides {
  /** Pointer moved; `candle` is the one the chart would hover (null = none). */
  hover?: (candle: CandleMeta | null, event: PointerEvent) => PointerOverrideResult;
  /** Primary button released over the plot. */
  click?: (candle: CandleMeta | null, event: PointerEvent) => PointerOverrideResult;
  /** A legend entry was clicked; default is the isolate/dim toggle. */
  legendClick?: (index: number) => PointerOverrideResult;
  /** The series slider was dragged/clicked to `index`. */
  sliderSeek?: (index: number) => PointerOverrideResult;
}

export interface CandlestickChartConfig {
  data: OhlcDataSet;
  /**
   * Grain budget multiplier: the chart draws `grainDensity * 20_000` grains
   * (capped by {@link CandlestickChartConfig.maxGrains}), independent of how
   * many candles the data has. Candles share that budget by body area, so
   * adding candles subdivides the same sand rather than asking for more.
   */
  grainDensity?: number;
  /** Global grain ceiling (default 100k). */
  maxGrains?: number;
  background?: string;
  grain?: {
    sizePx?: number;
    shape?: GrainShape;
    /** Grid jitter fraction (0..1). */
    jitter?: number;
    /** Baseline settle wobble amplitude (layout units). */
    settleJitter?: number;
  };

  // --- Candle geometry & color --------------------------------------------
  /** How candles are positioned along X. Default `'band'`. */
  spacing?: CandleSpacing;
  /** Candle colors, color rule, body geometry and solid layer. */
  candles?: CandleStyleConfig;
  /** Live-price line at the latest `Candle.actual`; off by default. */
  actual?: ActualConfig;

  // --- Series selection ----------------------------------------------------
  /**
   * Index of the series (instrument) shown, clamped into range. Changing it
   * via {@link CandlestickChart.setSeriesIndex} morphs the candles across.
   * Default 0.
   */
  seriesIndex?: number;
  /** Max candles of a series drawn; extras are dropped. Default 5000. */
  maxCandles?: number;
  /** Max series the slider can address; extras are dropped. Default 1000. */
  maxSeries?: number;
  /** Series slider (the instrument picker). */
  slider?: SliderConfig;

  animation?: {
    /** Per-grain duration, milliseconds. */
    duration?: number;
    ease?: Easing;
    /** Pour stagger spread, milliseconds. */
    stagger?: number;
    /**
     * Transition length in **ms** for a series change / `update` / `add` /
     * `remove` (body tween + grain-fade window). Default `duration + stagger`.
     */
    morphDuration?: number;
    /**
     * How grains of an **unchanged** candle move on a data change.
     * `'translate'` (default) slides each grain 1:1 with a settle stagger;
     * `'reshuffle'` flows them from random old grains of that candle;
     * `'withCandle'` locks them to the body — rigid 1:1 move with no delay and
     * no grain-fade flash.
     */
    reflow?: 'translate' | 'reshuffle' | 'withCandle';
    /**
     * Animate the sand during an `update`/`add`/`remove` morph. `false` snaps
     * every grain straight to its new position so **only the solid body
     * tweens**. Ignored for the initial pour-in. Default `true`.
     */
    morphGrains?: boolean;
    /**
     * How an **added** candle's grains enter. `'pour'` (default) falls from
     * above the plot; `'rise'` grows up from the base; `'continue'` skips the
     * emergence entirely — best for a streaming price feed.
     */
    enter?: 'pour' | 'rise' | 'continue';
    /**
     * How a **removed** candle's grains leave. `'fall'` (default) drops them
     * off the bottom and fades; `'vanish'` removes them instantly.
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
    /** Replace the chart's built-in mouse reactions. */
    pointer?: PointerOverrides;
  };
  /**
   * X and Y axes; each off by default. X is the period axis (slotted or
   * continuous, per {@link CandlestickChartConfig.spacing}) and also styles
   * the **series slider's** ticks; Y is the price axis.
   */
  axes?: {
    x?: AxisConfig;
    y?: AxisConfig;
  };
  /**
   * Direction legend; off by default. Its two entries are the rising and
   * falling colors, so clicking one (with `interactive`) isolates every rising
   * or every falling candle.
   */
  legend?: LegendConfig;
  /** Chart title; shares the legend's placement vocabulary. Off by default. */
  title?: TitleConfig;
  /** Current-value readout tied to hover; off by default. */
  currentValue?: CurrentValueConfig;
  /** On-screen FPS meter; off by default. */
  fps?: FpsConfig;
  /** Pan & zoom (drag to pan, wheel/UI to zoom); off by default. */
  panZoom?: PanZoomConfig;
  /** Force a rendering backend; default 'auto' (WebGPU → Canvas2D). */
  backend?: BackendPreference;
}

/** Metadata for one drawn candle, surfaced on hover/click events. */
export interface CandleMeta {
  /** Stable per-rebuild id (index within the drawn series); also the grain `barId`. */
  candleId: number;
  /** Position within its series — same thing as `candleId`, named for clarity. */
  indexInSeries: number;
  /** Index of the series (instrument) this candle belongs to. */
  seriesIndex: number;
  seriesKey: Scalar | undefined;
  xValue: Scalar;
  open: number;
  high: number;
  low: number;
  close: number;
  /** The candle's live price, if it carried one. */
  actual: number | undefined;
  /** True when the color rule classed this candle as rising. */
  rising: boolean;
  /** Body left/right edge and center, layout space [0,1]. */
  x0: number;
  x1: number;
  cx: number;
  /** Body bottom/top, layout space [0,1]. */
  bodyLow: number;
  bodyHigh: number;
  /** Wick bottom/top (the full price range), layout space [0,1]. */
  wickLow: number;
  wickHigh: number;
  color: RGBA;
}

export interface HoverPayload {
  candle: CandleMeta | null;
}

export interface ClickPayload {
  candle: CandleMeta | null;
  event: PointerEvent;
}

export interface SeriesChangePayload {
  index: number;
  key: Scalar | undefined;
}
