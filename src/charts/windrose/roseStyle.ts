import {
  type ResolvedFill,
  type ResolvedReveal,
  resolveReveal,
  revealFactor,
} from '../../core/chrome/reveal.js';
import type { WindObservation } from '../../core/data/wind.js';
import type { WindRoseChartConfig } from './types.js';

// The reveal ramp is identical across every visual in the library; it lives in
// `core` and is re-exported here rather than copied.
export { revealFactor };
export type { ResolvedFill, ResolvedReveal };

export interface ResolvedSegmentBorder {
  /** True when the segment outline is drawn. */
  any: boolean;
  width: number;
  opacity: number;
}

export interface ResolvedRoseStyle {
  /** True when any solid layer is drawn (gates the reveal loop). */
  enabled: boolean;
  fill: ResolvedFill;
  border: ResolvedSegmentBorder;
  reveal: ResolvedReveal;
}

/** Resolve the `segments` config block into concrete values. */
export function resolveRoseStyle(cfg: WindRoseChartConfig): ResolvedRoseStyle {
  const s = cfg.segments;
  const fillCfg = s?.fill;
  const fill: ResolvedFill = {
    on: fillCfg != null,
    opacity: fillCfg?.opacity ?? 1,
  };

  const bd = s?.border;
  const border: ResolvedSegmentBorder = {
    any: bd != null && (bd.show ?? true),
    width: bd?.width ?? 1,
    opacity: bd?.opacity ?? 1,
  };

  return { enabled: fill.on || border.any, fill, border, reveal: resolveReveal(s?.reveal) };
}

export interface ResolvedHighlight {
  show: boolean;
  select: 'latest' | 'latestN' | 'latestTimestamp';
  count: number;
  ramp: boolean;
  mode: 'glow' | 'outline' | 'color';
  color: string | undefined;
  gain: number;
  outlinePx: number;
}

/** Resolve the `highlight` config block. */
export function resolveHighlight(cfg: WindRoseChartConfig): ResolvedHighlight {
  const h = cfg.highlight;
  const select = h?.select ?? 'latest';
  const count = Math.max(1, Math.floor(h?.count ?? 3));
  return {
    show: h?.show ?? true,
    select,
    count,
    // A ramp across a single mark says nothing, so it only defaults on when
    // there is actually a trail to fade.
    ramp: h?.ramp ?? (select === 'latest' ? false : count > 1),
    mode: h?.mode ?? 'glow',
    color: h?.color,
    gain: h?.gain ?? 1.8,
    outlinePx: h?.outlinePx ?? 2,
  };
}

/** One highlighted reading: its source id and how strongly it reads. */
export interface HighlightTarget {
  /** Source `WindPoint` index. */
  id: number;
  /** Emphasis in [0,1]; 1 is the newest when the recency ramp is on. */
  weight: number;
}

/**
 * Which readings the highlight selects, newest first.
 *
 * `observations` must be sorted oldest → newest, which `normalizeWind`
 * guarantees, so "latest" is the tail rather than whatever arrived last.
 */
export function highlightTargets(
  observations: WindObservation[],
  h: ResolvedHighlight,
): HighlightTarget[] {
  if (!h.show || observations.length === 0) return [];

  if (h.select === 'latestTimestamp') {
    const newest = observations[observations.length - 1]!.t;
    const out: HighlightTarget[] = [];
    for (let i = observations.length - 1; i >= 0; i--) {
      const o = observations[i]!;
      if (o.t !== newest) break;
      out.push({ id: o.id, weight: 1 });
    }
    return out;
  }

  const take = h.select === 'latest' ? 1 : Math.min(h.count, observations.length);
  const out: HighlightTarget[] = [];
  for (let k = 0; k < take; k++) {
    const o = observations[observations.length - 1 - k]!;
    out.push({ id: o.id, weight: h.ramp ? 1 - k / take : 1 });
  }
  return out;
}
