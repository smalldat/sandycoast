import type { ResolvedAxis } from '../../core/chrome/chrome.js';
import { formatNumber } from '../../core/chrome/format.js';
import { bearingLabel } from './compass.js';
import type { WindRoseLayout } from './layout.js';

/**
 * The rose's two axes, both re-mapped from the shared `AxisConfig` blocks:
 * `axes.x` labels the compass around the rim, `axes.y` scales the rings.
 * Pure model — the overlay draws what this describes.
 */

const TAU = Math.PI * 2;

export interface CompassTick {
  sector: number;
  /** Drawn angle, radians clockwise from 12 o'clock (north/clockwise applied). */
  angle: number;
  /** Bearing in degrees clockwise from north, before the compass framing. */
  bearingDeg: number;
  label: string;
}

export interface RadialRing {
  /** Value in the measure's units. */
  value: number;
  /** Radius in layout units. */
  radius: number;
  label: string;
}

export interface RoseAxes {
  compass: CompassTick[];
  rings: RadialRing[];
}

export interface RoseAxisOptions {
  north: number;
  clockwise: boolean;
  /** Percent measures label as `12%` rather than a bare number. */
  percent: boolean;
}

/**
 * Compass labels around the rim, one per sector, thinned to roughly
 * `cfg.ticks` of them.
 *
 * Thinning keeps a **stride**, not a subset chosen by label, so the labels that
 * survive stay evenly spaced around the circle. Consecutive duplicates are
 * dropped: past 16 sectors two neighbours can round to the same compass point,
 * and printing `NNE` twice reads as a mistake rather than as precision.
 */
export function compassTicks(
  sectors: number,
  cfg: ResolvedAxis,
  opts: RoseAxisOptions,
): CompassTick[] {
  if (!cfg.show || cfg.ticks === false) return [];
  const n = Math.max(2, Math.floor(sectors));
  let stride = 1;
  if (typeof cfg.ticks === 'number' && cfg.ticks > 0 && n > cfg.ticks) {
    stride = Math.ceil(n / cfg.ticks);
  }
  const sweep = TAU / n;
  const out: CompassTick[] = [];
  let last = '';
  for (let s = 0; s < n; s += stride) {
    const bearingDeg = ((s * sweep * 180) / Math.PI) % 360;
    const label = cfg.tickFormat ? cfg.tickFormat(bearingDeg) : bearingLabel(bearingDeg);
    if (label === last) continue;
    last = label;
    out.push({
      sector: s,
      angle: opts.north + (opts.clockwise ? s * sweep : -s * sweep),
      bearingDeg,
      label,
    });
  }
  return out;
}

/**
 * Concentric rings at rounded values up to the radial maximum.
 *
 * The innermost ring is the petals' root, not the disc center: with a calm
 * circle in the middle, a ring drawn at radius 0 would claim the calm disc's
 * edge is zero when the scale actually starts there.
 */
export function radialRings(
  layout: WindRoseLayout,
  cfg: ResolvedAxis,
  opts: RoseAxisOptions,
): RadialRing[] {
  if (!cfg.show || cfg.ticks === false) return [];
  const want = typeof cfg.ticks === 'number' && cfg.ticks > 0 ? Math.floor(cfg.ticks) : 4;
  const step = niceStep(layout.radialMax, want);
  if (!(step > 0)) return [];
  const span = layout.rOuter - layout.rInner;
  const out: RadialRing[] = [];
  for (let v = step; v <= layout.radialMax + step * 0.001; v += step) {
    const frac = v / layout.radialMax;
    if (frac > 1.0001) break;
    out.push({
      value: v,
      radius: layout.rInner + frac * span,
      label: cfg.tickFormat
        ? cfg.tickFormat(v)
        : opts.percent
          ? `${formatNumber(v)}%`
          : formatNumber(v),
    });
  }
  return out;
}

/** Build both axes for a layout. */
export function buildRoseAxes(
  layout: WindRoseLayout,
  x: ResolvedAxis,
  y: ResolvedAxis,
  opts: RoseAxisOptions,
): RoseAxes {
  return {
    compass: compassTicks(layout.bins.length, x, opts),
    rings: radialRings(layout, y, opts),
  };
}

/**
 * A round step (1/2/5 × 10ⁿ) giving roughly `count` rings up to `max`.
 *
 * The ladder rounds to the **nearest** nice number rather than up: with
 * `max = 100, count = 4` the raw step is 25, and rounding up to 50 would leave
 * two rings where the caller asked for four. 20 is both nicer and closer.
 */
export function niceStep(max: number, count: number): number {
  if (!(max > 0) || count < 1) return 0;
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = norm <= 1.5 ? 1 : norm <= 3 ? 2 : norm <= 7 ? 5 : 10;
  return step * mag;
}
