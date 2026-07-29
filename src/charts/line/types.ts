import type { DataSet, Scalar } from '../../core/data/types.js';
import type { Easing } from '../../core/particles/anim.js';
import type { BackendPreference } from '../../core/render/pick.js';
import type { GrainShape, RGBA } from '../../core/render/types.js';
import type { PanZoomConfig } from '../../core/view/types.js';
// Chrome config is identical to the bar chart's — the line chart reuses the
// exact same axis / legend / current-value / fps / hover interfaces.
import type {
  AxisConfig,
  CurrentValueConfig,
  FpsConfig,
  HoverEffect,
  LegendConfig,
  Side,
} from '../bar/types.js';

export type { AxisConfig, CurrentValueConfig, FpsConfig, HoverEffect, LegendConfig, Side };

/** How the connecting line is drawn once the sand resolves. */
export type LineShape = 'none' | 'straight' | 'spline';

/**
 * Solid line (+ optional area fill) drawn per series, revealed as the sand
 * particles fade out. The line-chart analogue of the bar chart's fill+border:
 * `line` replaces `border`, taking the **same** properties (width, opacity) but
 * a `style` (`none` | `straight` | `spline`) instead of per-side flags.
 * Off by default; a config without `line` renders exactly as before.
 */
export interface LineStyleConfig {
  /**
   * Stack the series into a stacked area chart: each series sits on top of the
   * cumulative total of the series below it (at every x), and the value (Y) axis
   * spans the stack total. Best paired with a visible `fill`. Default false.
   */
  stack?: boolean;
  /** Optional area fill below the line; always the series color, opacity only. */
  fill?: {
    /** Fill opacity 0..1. Default 1. */
    opacity?: number;
  };
  /** The connecting line; always the series color, only shape/width/opacity vary. */
  line?: {
    /**
     * `'none'` draws no line (sand only), `'straight'` connects points with
     * segments, `'spline'` with a smooth Catmull-Rom curve. Default `'straight'`
     * when a `line` block is present.
     */
    style?: LineShape;
    /** Stroke width in CSS px. Default 1. */
    width?: number;
    /** Stroke opacity 0..1. Default 1. */
    opacity?: number;
  };
  /** Timing of the particle→line crossfade. */
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

export interface LineChartConfig {
  data: DataSet;
  /** Grains per unit area of the line ribbon. Higher = denser sand. */
  grainDensity?: number;
  /** Global grain ceiling (default 100k). */
  maxGrains?: number;
  /** Ribbon thickness the sand is scattered within, layout units. Default 0.03. */
  lineThickness?: number;
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
     * Transition length in **ms** for `update`/`add`/`remove` (line tween +
     * grain-fade window). Default `duration + stagger`.
     */
    morphDuration?: number;
    /**
     * How grains of an **unchanged** part of the line move on a data change.
     * `'translate'` (default) slides each grain 1:1 with a settle stagger;
     * `'reshuffle'` flows them from random old grains; `'withLine'` locks them
     * to the line — rigid 1:1 move with **no delay and no grain-fade flash**.
     * Default `'translate'`.
     */
    reflow?: 'translate' | 'reshuffle' | 'withLine';
    /**
     * Animate the sand grains during an `update`/`add`/`remove` morph. `true`
     * (default) flows/pours/drops grains per `reflow`/`enter`/`exit`; `false`
     * snaps every grain straight to its new position with no motion (added
     * grains just appear, removed grains just vanish) so **only the solid line
     * tweens** on a data change. Ignored for the initial pour-in. Default `true`.
     */
    morphGrains?: boolean;
    /**
     * How an **added** point's grains enter. `'pour'` (default) falls from
     * above the plot; `'rise'` grows up from the base; `'continue'` skips the
     * emergence entirely — the new vertex appears settled at its value and the
     * line simply extends to it (best for continuous streaming). Default
     * `'pour'`.
     */
    enter?: 'pour' | 'rise' | 'continue';
    /**
     * How a **removed** point's grains leave. `'fall'` (default) lets them drop
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
       * on. The whole hovered series lifts toward this. Default 1.
       */
      opacity?: number;
      /** Enter/leave transition time in ms. Default 180. */
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
  /** Solid line + area fill per series, revealed as particles fade; off by default. */
  line?: LineStyleConfig;
  /** On-screen FPS meter; off by default. */
  fps?: FpsConfig;
  /** Pan & zoom (drag to pan, wheel/UI to zoom); off by default. */
  panZoom?: PanZoomConfig;
  /** Force a rendering backend; default 'auto' (WebGPU → Canvas2D). */
  backend?: BackendPreference;
}

/** Metadata for one line vertex (data point), surfaced on hover events. */
export interface LineMeta {
  /** Stable per-rebuild id (index into the meta list); also the grain `barId`. */
  pointId: number;
  seriesIndex: number;
  seriesKey: Scalar | undefined;
  xValue: Scalar;
  yValue: number;
  /** Layout-space x center [0,1] (shared across series at this x-slot). */
  pos: number;
  /** Layout-space y of this vertex (top of its band when stacked), 0 = baseline. */
  height: number;
  /** Layout-space y of this vertex's stack floor (0 when unstacked). */
  baseHeight: number;
  color: RGBA;
}

export interface HoverPayload {
  point: LineMeta | null;
}
