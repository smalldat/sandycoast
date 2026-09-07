import type { RevealConfig } from '../../core/chrome/reveal.js';
// Chrome config is shared by every visual and lives in `core`.
import type {
  AxisConfig,
  CurrentValueConfig as CurrentValueConfigOf,
  DimConfig,
  FpsConfig,
  HoverEffect,
  LegendConfig,
  Side,
  TableConfig,
  TitleConfig,
} from '../../core/chrome/types.js';
import type { WindDataSet } from '../../core/data/wind.js';
import type { MouseHook } from '../../core/interaction/mouse.js';
import type { Easing } from '../../core/particles/anim.js';
import type { BackendPreference } from '../../core/render/pick.js';
import type { GrainShape, RGBA } from '../../core/render/types.js';
import type { PetalMode, RadialMeasure, SectorAlign, SegmentOrder } from './binning.js';

export type {
  AxisConfig,
  DimConfig,
  FpsConfig,
  HoverEffect,
  LegendConfig,
  Side,
  TableConfig,
  TitleConfig,
};
export type { PetalMode, RadialMeasure, SectorAlign, SegmentOrder };

/** Hover readout config, with `format` typed against {@link SegmentMeta}. */
export type CurrentValueConfig = CurrentValueConfigOf<SegmentMeta>;

/** Default direction sectors around the compass. */
export const DEFAULT_SECTORS = 16;
/** Default cap on segments per sector before the tail is merged. */
export const DEFAULT_MAX_SEGMENTS = 120;
/** Default steps the intensity ramp is quantized to for grain coloring. */
export const DEFAULT_RAMP_STEPS = 16;

/** How a petal is split into stacked segments. */
export interface PetalConfig {
  /**
   * `'bands'` (default) segments by intensity band — the classic
   * meteorological rose. `'observations'` gives every reading its own segment,
   * which is what makes a table-row click and the latest-value highlight land
   * on one exact mark rather than on the band containing it.
   */
  mode?: PetalMode;
  /** Inner → outer ordering in `'observations'` mode. Default 'intensity'. */
  order?: SegmentOrder;
  /**
   * Cap on segments per sector; the outermost tail beyond it merges into one
   * aggregated segment. Merging rather than dropping keeps the petal's length
   * honest. Default 120.
   */
  maxSegmentsPerSector?: number;
  /** Sweep of a petal as a fraction of its sector, 0..1. Default 0.9. */
  width?: number;
  /** Gap trimmed from each petal's sweep, degrees. Default 0. */
  padAngle?: number;
  /**
   * Steps the intensity ramp is quantized to when coloring grains in
   * `'observations'` mode. Grains are batched per palette entry, so an
   * unquantized per-segment palette would cost a full pass over the grains for
   * every segment. The solid overlay always uses the exact ramp color.
   * Default 16.
   */
  rampSteps?: number;
}

/** Direction binning. */
export interface SectorConfig {
  /** Sectors around the compass, >= 2. Default 16. */
  count?: number;
  /**
   * `'centered'` (default) centers a sector on its compass point, so N spans
   * -11.25°..+11.25° at 16 sectors — the classic rose. `'edge'` starts sector 0
   * at due north instead.
   */
  align?: SectorAlign;
}

/** What a petal's length measures, and how the rings are scaled. */
export interface RadialConfig {
  /**
   * `'count'` (default) — observations from that direction; `'percent'` — the
   * same as a share of all readings; `'intensitySum'` — summed speed;
   * `'intensityMax'` — the strongest reading, with segments subdividing it.
   */
  measure?: RadialMeasure;
  /** Explicit axis maximum in the measure's units; defaults to the largest petal. */
  max?: number;
  /** Bearing the ring labels are drawn along, degrees. Default 45. */
  labelAngle?: number;
}

/** Intensity bands (used by `petals.mode: 'bands'`). */
export interface BandsConfig {
  /** Explicit interior thresholds, ascending. Overrides `derive`/`count`. */
  thresholds?: number[];
  /** How to derive thresholds when none are given. Default 'equal'. */
  derive?: 'quantile' | 'equal';
  /** How many bands to derive. Default 4. */
  count?: number;
}

/** The central calm circle: readings too weak to have a meaningful direction. */
export interface CalmConfig {
  /** Readings with intensity strictly below this are calm. Default 0 (none). */
  below?: number;
  /** Draw the calm circle. Default true when any reading is calm. */
  show?: boolean;
  /** Fill color (CSS). Defaults to the first palette entry. */
  color?: string;
}

/** Emphasis on the most recent reading(s). */
export interface HighlightConfig {
  /** Highlight the latest reading(s). Default true. */
  show?: boolean;
  /**
   * `'latest'` (default) — the single newest reading; `'latestN'` — the newest
   * {@link count}; `'latestTimestamp'` — every reading sharing the newest time.
   */
  select?: 'latest' | 'latestN' | 'latestTimestamp';
  /** How many readings when `select` is `'latestN'`. Default 3. */
  count?: number;
  /** Fade emphasis by recency so the newest reads strongest. Default true when count > 1. */
  ramp?: boolean;
  /** `'glow'` (default) brightens the grains; `'outline'` strokes the segment; `'color'` recolors it. */
  mode?: 'glow' | 'outline' | 'color';
  /** Stroke/fill color for `'outline'` / `'color'` (CSS). */
  color?: string;
  /** Grain brightness gain when `'glow'`. Default 1.8. */
  gain?: number;
  /** Stroke width when `'outline'`, CSS px. Default 2. */
  outlinePx?: number;
}

/**
 * The time table: a scrolling list of readings mounted like the legend.
 *
 * Placement, sizing and interactivity come from the shared {@link TableConfig}
 * in `core/chrome` (the table itself is chart-agnostic); what the wind rose
 * adds is how *its* columns are formatted.
 */
export interface WindRoseTableConfig extends TableConfig {
  /** Format the time column. Default: locale time, or date+time across days. */
  timeFormat?: (t: Date) => string;
  /** Format the direction column. Default: compass bearing (N, NNE, …). */
  directionFormat?: (deg: number) => string;
  /** Opt-in extra column fed from `WindPoint.custom`; omitted entirely when unset. */
  customColumn?: { label: string; format: (custom: unknown, o: ObservationMeta) => string };
}

/**
 * Solid fill + border drawn per segment, revealed as the sand particles fade
 * out. Mirrors the pie's `slices` block.
 */
export interface RoseStyleConfig {
  fill?: {
    /** Fill opacity 0..1. Default 1. */
    opacity?: number;
  };
  border?: {
    /** Outline each segment. Default true when a `border` block is present. */
    show?: boolean;
    /** Stroke width in CSS px. Default 1. */
    width?: number;
    /** Stroke opacity 0..1. Default 1. */
    opacity?: number;
  };
  /** Timing of the particle→solid crossfade (shared by every visual). */
  reveal?: RevealConfig;
}

/**
 * Caller hooks that can cancel or replace the chart's built-in pointer
 * behavior. Each receives the mark, the raw DOM event and `defaultAction()`;
 * returning `false` suppresses the default. The `hover` / `select` events fire
 * either way — see `core/interaction/mouse.ts`.
 */
export interface MouseConfig {
  onPetalHover?: MouseHook<SegmentMeta>;
  onPetalClick?: MouseHook<SegmentMeta>;
  onPetalDblClick?: MouseHook<SegmentMeta, MouseEvent>;
  onBackgroundClick?: MouseHook<null>;
  onTableRowClick?: MouseHook<ObservationMeta, MouseEvent>;
}

export interface WindRoseChartConfig<Custom = unknown> {
  data: WindDataSet<Custom>;
  /**
   * Grain budget multiplier: the chart draws `grainDensity * 20_000` grains
   * (capped by {@link WindRoseChartConfig.maxGrains}), independent of how many
   * segments the data has. Segments share that budget by area.
   */
  grainDensity?: number;
  /** Global grain ceiling (default 100k). */
  maxGrains?: number;
  /**
   * Colors. Cycled per **band** in `'bands'` mode; read as sequential **ramp
   * stops** over the intensity range in `'observations'` mode.
   */
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

  // --- Rose geometry -------------------------------------------------------
  /** Outer radius as a fraction of the disc box's half-extent, 0..1. Default 0.92. */
  radius?: number;
  /** Minimum central hole as a fraction of the outer radius, 0..0.95. Default 0. */
  innerRadius?: number;
  /** Rotation of due north, degrees clockwise. Default 0 (12 o'clock). */
  north?: number;
  /** Run bearings clockwise (the compass convention). Default true. */
  clockwise?: boolean;

  sectors?: SectorConfig;
  petals?: PetalConfig;
  radial?: RadialConfig;
  bands?: BandsConfig;
  calm?: CalmConfig;
  highlight?: HighlightConfig;

  animation?: {
    /** Per-grain duration, milliseconds. */
    duration?: number;
    ease?: Easing;
    /** Pour stagger spread, milliseconds. */
    stagger?: number;
    /**
     * Transition length in **ms** for `update`/`add`/`remove` (segment tween +
     * grain-fade window). Default `duration + stagger`.
     */
    morphDuration?: number;
    /**
     * How grains of an **existing** segment move on a data change.
     * `'translate'` (default) maps each grain 1:1 with a settle stagger;
     * `'reshuffle'` flows them from random old grains; `'withPetal'` locks them
     * to the wedge — rigid move, no delay, no grain-fade flash.
     */
    reflow?: 'translate' | 'reshuffle' | 'withPetal';
    /** Animate grains on morph, or snap them so only the solid tweens. Default true. */
    morphGrains?: boolean;
    /**
     * How a **new** segment enters. `'grow'` (default) opens it at the petal's
     * rim — the streaming case; `'pour'` falls from above; `'rise'` grows out
     * of the center.
     */
    enter?: 'grow' | 'pour' | 'rise';
    /**
     * How a **removed** segment leaves. `'shrink'` (default) collapses it back
     * into the petal; `'fall'` drops the grains off the bottom; `'vanish'`
     * removes them instantly.
     */
    exit?: 'shrink' | 'fall' | 'vanish';
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
    /** Dimming of the un-selected segments; see {@link DimConfig}. */
    dim?: DimConfig;
    /** Overridable pointer behavior. */
    mouse?: MouseConfig;
  };

  /**
   * `axes.x` styles the **compass** labels around the rim (count, format,
   * font, color); `axes.y` styles the **radial** rings and their labels. Same
   * blocks every other chart uses, re-mapped to polar meanings.
   */
  axes?: {
    x?: AxisConfig;
    y?: AxisConfig;
  };
  /**
   * Band legend; off by default, and only meaningful in `'bands'` mode. In
   * `'observations'` mode the colors are a continuous ramp with nothing
   * discrete to name, so the legend is ignored rather than mislabelled.
   */
  legend?: LegendConfig;
  /** The time table. Off by default. */
  table?: WindRoseTableConfig;
  /** Chart title; shares the legend's placement vocabulary. */
  title?: TitleConfig;
  /** Current-value readout tied to hover; off by default. */
  currentValue?: CurrentValueConfig;
  /** Solid fill + border per segment, revealed as particles fade. */
  segments?: RoseStyleConfig;
  /** On-screen FPS meter; off by default. */
  fps?: FpsConfig;
  /** Force a rendering backend; default 'auto' (WebGPU → Canvas2D). */
  backend?: BackendPreference;
}

/** Metadata for one drawn segment, surfaced on hover/selection events. */
export interface SegmentMeta {
  /** Grain `barId` slot — index of the segment within the drawn rose. */
  segmentId: number;
  /** Stable identity across rebuilds: the morph, selection and table key. */
  key: string;
  /** Sector index, 0 = the sector owning due north. */
  sector: number;
  /** Bearing of the sector's center, degrees clockwise from north. */
  bearingDeg: number;
  /** Compass label for that bearing (N, NNE, NE, …). */
  bearing: string;
  /** Band index in `'bands'` mode; `-1` otherwise. */
  band: number;
  /** Band bounds when `band >= 0`; `hi` is `Infinity` for the top band. */
  bandLo: number;
  bandHi: number;
  /** True when this segment is the merged tail of a capped sector. */
  aggregated: boolean;
  /** True when this is the central calm circle rather than a petal segment. */
  calm: boolean;
  /** Source `WindPoint` indices folded into this segment. */
  observationIds: number[];
  /** How many readings it holds. */
  count: number;
  /** Its contribution in the radial measure's units. */
  value: number;
  /** The petal's whole value, for context in a readout. */
  petalValue: number;
  intensityMin: number;
  intensityMax: number;
  /** Newest member's time, epoch ms. */
  latestT: number;
  /** Start angle, radians clockwise from 12 o'clock (after `north`/`clockwise`). */
  a0: number;
  /** End angle, radians clockwise from 12 o'clock. */
  a1: number;
  rInner: number;
  rOuter: number;
  color: RGBA;
}

/** One reading, as the table renders it and events report it. */
export interface ObservationMeta<Custom = unknown> {
  /** Index into the caller's `data.points`. */
  id: number;
  /** Epoch ms. */
  t: number;
  /** Direction in degrees clockwise from north, normalized to [0, 360). */
  directionDeg: number;
  /** Compass label for that direction. */
  bearing: string;
  intensity: number;
  custom: Custom | undefined;
  /** Key of the segment currently holding it, or `null` when calm. */
  segmentKey: string | null;
}

export interface HoverPayload {
  segment: SegmentMeta | null;
}

export interface SelectPayload {
  segmentKey: string | null;
  observationId: number | null;
  segment: SegmentMeta | null;
}

export interface HighlightPayload {
  observations: ObservationMeta[];
}
