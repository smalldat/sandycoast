// Chrome configuration shared by every visual: axes, legend, title, the
// current-value readout and the FPS meter. Charts import these from `core` —
// never from each other — so a chart component stays independently replaceable.

import type { Scalar } from '../data/types.js';

/** Edge of the plot area. */
export type Side = 'left' | 'right' | 'top' | 'bottom';

export type HoverEffect = 'highlight' | 'jitter' | 'opacity';

/**
 * Tuning for the legend click-to-isolate effect (see
 * {@link LegendConfig.interactive} and each chart's `focusSeries` method).
 * Has no effect until a series/slice is actually focused.
 */
export interface DimConfig {
  /** Opacity of dimmed series/slices, 0..1. Default 0.15. */
  opacity?: number;
  /** Ease in/out time for the dim transition, ms. Default 200. */
  fadeMs?: number;
}

/**
 * Emitted as the `seriesFocus` event whenever the isolated series/slice
 * changes — via a legend click or a `focusSeries()` call, both the same code
 * path. `index: null` means every series/slice is shown at full opacity.
 */
export interface SeriesFocusPayload {
  index: number | null;
}

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
  /**
   * Click an entry to isolate it — every other series/slice dims to
   * `interaction.dim.opacity`. Click the isolated entry again to clear it.
   * Default false (the legend stays presentational, exactly as today).
   */
  interactive?: boolean;
}

/**
 * Chart title drawn as a DOM layer on one edge of the chart, exactly like the
 * legend — same `position` / `align` vocabulary, so a title and a legend on the
 * same edge line up with each other.
 */
export interface TitleConfig {
  /** Title text. An empty string hides the title. */
  text?: string;
  /** Which edge to place it on. Default 'top'. */
  position?: Side;
  /** Cross-axis alignment, matching {@link LegendConfig.align}. Default 'center'. */
  align?: 'start' | 'center' | 'end';
  /** Text color (CSS). Default a bright neutral. */
  color?: string;
  /** Font size in px. Default 14. */
  fontPx?: number;
  /** Font-family stack (CSS). Default 'system-ui, sans-serif'. */
  fontFamily?: string;
  /** Font weight (CSS). Default 600. */
  fontWeight?: string | number;
}

/**
 * Hover readout. `M` is the chart's own hovered-item metadata (a bar, a line
 * vertex, a pie slice), so each chart types its `format` callback precisely.
 */
export interface CurrentValueConfig<M = unknown> {
  /** Show the readout. Default false. */
  show?: boolean;
  /**
   * Where the readout box sits. `'pointer'` follows the cursor; a Side pins it to
   * that edge; `'axis'` (**On axes**) drops the floating box and instead shows the
   * value(s) directly on the axes — a highlighted marker beside the Y axis and/or
   * below the X axis. Default `'pointer'`.
   */
  mode?: 'pointer' | 'axis' | Side;
  /** Format the hovered item into a readout string. */
  format?: (item: M) => string;
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

/**
 * A scrolling data table mounted on one edge of the chart, exactly like the
 * legend — same `position` / `align` vocabulary and the same measure-then-inset
 * contract, so a table, a legend and a title on one edge stack instead of
 * overlapping.
 *
 * Presentational only: the chart formats its own rows and hands them over, so
 * `core` never learns what any particular chart's data means.
 */
export interface TableConfig {
  /** Show the table. Default false. */
  show?: boolean;
  /** Which edge to place it on. Default 'right'. */
  position?: Side;
  /** Cross-axis alignment, matching {@link LegendConfig.align}. Default 'center'. */
  align?: 'start' | 'center' | 'end';
  /** Rows kept in the DOM. Default 500. */
  maxRows?: number;
  /** Click a row to select the matching mark. Default true. */
  interactive?: boolean;
  /** Keep the header visible while the body scrolls. Default true. */
  stickyHeader?: boolean;
  /** Scroll the selected row into view when the selection changes. Default true. */
  followSelection?: boolean;
  /** Max height (CSS length) before the body scrolls. Default '100%'. */
  maxHeight?: string;
  /** Max width (CSS length) on a left/right edge. Default '220px'. */
  maxWidth?: string;
  /** Font size in px. Default 11. */
  fontPx?: number;
  /** Font-family stack (CSS). Default 'system-ui, sans-serif'. */
  fontFamily?: string;
  /** Text color (CSS). */
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
