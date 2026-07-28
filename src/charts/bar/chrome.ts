import type { Scalar } from '../../core/data/types.js';
import type { GrainShape } from '../../core/render/types.js';
import type { AxisConfig, BarMeta, CurrentValueConfig, LegendConfig, Side } from './types.js';

/**
 * Minimal config surface {@link resolveChrome} reads. Both {@link BarChartConfig}
 * and the line chart's config satisfy it, so chrome is shared across charts.
 */
export interface ChromeInput {
  axes?: { x?: AxisConfig; y?: AxisConfig };
  legend?: LegendConfig;
  currentValue?: CurrentValueConfig;
  grain?: { shape?: GrainShape };
}

export interface ResolvedAxis {
  show: boolean;
  ticks: number | false | undefined;
  tickFormat: ((v: Scalar) => string) | undefined;
  label: string | undefined;
  gridLines: boolean;
  color: string;
  fontPx: number;
  fontFamily: string;
  fontWeight: string | number;
  /** Rotated title reading direction. Y-axis only; 'up' or 'down'. */
  titleDirection: 'up' | 'down';
}

export interface ResolvedLegend {
  show: boolean;
  position: Side;
  align: 'start' | 'center' | 'end';
  swatch: 'disc' | 'square';
}

export interface ResolvedCurrentValue {
  show: boolean;
  mode: 'pointer' | 'axis' | Side;
  format: ((bar: BarMeta) => string) | undefined;
  /** Vertical guide line to the X axis. */
  guideX: boolean;
  /** Horizontal guide line to the Y axis. */
  guideY: boolean;
  /** Highlight the axis with a value marker at the cursor row/column. */
  markers: boolean;
  color: string;
}

export interface ResolvedChrome {
  x: ResolvedAxis;
  y: ResolvedAxis;
  legend: ResolvedLegend;
  currentValue: ResolvedCurrentValue;
  /** True when any chrome is active (skip overlay/margins entirely if false). */
  any: boolean;
}

/** Default subdued color for axis lines/labels (works on dark backgrounds). */
const AXIS_COLOR = 'rgba(205,211,222,0.55)';
const VALUE_COLOR = 'rgba(232,236,242,0.95)';

function resolveAxis(cfg: AxisConfig | undefined): ResolvedAxis {
  return {
    show: cfg?.show ?? false,
    ticks: cfg?.ticks,
    tickFormat: cfg?.tickFormat,
    label: cfg?.label,
    gridLines: cfg?.gridLines ?? false,
    color: cfg?.color ?? AXIS_COLOR,
    fontPx: cfg?.fontPx ?? 11,
    fontFamily: cfg?.fontFamily ?? 'system-ui, sans-serif',
    fontWeight: cfg?.fontWeight ?? 'normal',
    titleDirection: cfg?.titleDirection ?? 'up',
  };
}

export function resolveChrome(cfg: ChromeInput): ResolvedChrome {
  const x = resolveAxis(cfg.axes?.x);
  const y = resolveAxis(cfg.axes?.y);
  const legend: ResolvedLegend = {
    show: cfg.legend?.show ?? false,
    position: cfg.legend?.position ?? 'bottom',
    align: cfg.legend?.align ?? 'center',
    swatch: cfg.legend?.swatch ?? (cfg.grain?.shape === 'quad' ? 'square' : 'disc'),
  };
  const cv: CurrentValueConfig | undefined = cfg.currentValue;
  // `guide` supersedes the legacy `showGuide` boolean (true → 'y', false → 'none').
  const guide = cv?.guide ?? ((cv?.showGuide ?? true) ? 'y' : 'none');
  const currentValue: ResolvedCurrentValue = {
    show: cv?.show ?? false,
    mode: cv?.mode ?? 'pointer',
    format: cv?.format,
    guideX: guide === 'x' || guide === 'both',
    guideY: guide === 'y' || guide === 'both',
    markers: cv?.markers ?? true,
    color: cv?.color ?? VALUE_COLOR,
  };
  const any = x.show || y.show || legend.show || currentValue.show;
  return { x, y, legend, currentValue, any };
}

/** Plot margins in CSS px, before the legend's measured extent is folded in. */
export interface Margins {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/**
 * Base margins from enabled axes (label/tick room). Legend extent is added by
 * the caller after measuring the legend DOM. Values are CSS px.
 */
export function axisMargins(c: ResolvedChrome): Margins {
  const m: Margins = { top: 4, right: 8, bottom: 4, left: 8 };
  if (c.x.show) m.bottom += c.x.fontPx + 12 + (c.x.label ? c.x.fontPx + 6 : 0);
  if (c.y.show) m.left += c.y.fontPx * 3.2 + 10 + (c.y.label ? c.y.fontPx + 6 : 0);
  return m;
}

/** Convert CSS-px margins + device size/DPR into a normalized plot rect (y-up). */
export function marginsToPlotRect(
  m: Margins,
  deviceW: number,
  deviceH: number,
  dpr: number,
): [number, number, number, number] {
  const w = Math.max(1, deviceW);
  const h = Math.max(1, deviceH);
  const left = (m.left * dpr) / w;
  const right = (m.right * dpr) / w;
  const top = (m.top * dpr) / h;
  const bottom = (m.bottom * dpr) / h;
  // y-up: y0 = bottom edge, y1 = top edge.
  return [clamp01(left), clamp01(bottom), clamp01(1 - right), clamp01(1 - top)];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
