import { describe, expect, it } from 'vitest';
import type { WindObservation } from '../../core/data/wind.js';
import { highlightTargets, resolveHighlight, resolveRoseStyle } from './roseStyle.js';
import type { WindRoseChartConfig } from './types.js';

const DATA: WindRoseChartConfig['data'] = { points: [] };

function cfg(over: Partial<WindRoseChartConfig> = {}): WindRoseChartConfig {
  return { data: DATA, ...over };
}

/** `n` readings, oldest first, one second apart. */
function obs(n: number, t?: (i: number) => number): WindObservation[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    t: t ? t(i) : 1000 * (i + 1),
    direction: 0,
    intensity: 1,
    custom: undefined,
  }));
}

describe('resolveRoseStyle', () => {
  it('draws nothing solid until a fill or border is asked for', () => {
    expect(resolveRoseStyle(cfg()).enabled).toBe(false);
  });

  it('enables the solid layer for a fill alone', () => {
    const s = resolveRoseStyle(cfg({ segments: { fill: {} } }));
    expect(s.enabled).toBe(true);
    expect(s.fill.on).toBe(true);
    expect(s.fill.opacity).toBe(1);
  });

  it('treats a border block as show-by-default', () => {
    const s = resolveRoseStyle(cfg({ segments: { border: {} } }));
    expect(s.border.any).toBe(true);
    expect(s.border.width).toBe(1);
  });

  it('honours an explicitly hidden border', () => {
    const s = resolveRoseStyle(cfg({ segments: { border: { show: false } } }));
    expect(s.border.any).toBe(false);
    expect(s.enabled).toBe(false);
  });
});

describe('resolveHighlight', () => {
  it('highlights the single latest reading by default', () => {
    const h = resolveHighlight(cfg());
    expect(h.show).toBe(true);
    expect(h.select).toBe('latest');
    expect(h.mode).toBe('glow');
  });

  it('leaves the recency ramp off for a single mark', () => {
    // A ramp across one mark says nothing.
    expect(resolveHighlight(cfg()).ramp).toBe(false);
  });

  it('turns the ramp on for a trail of several', () => {
    const h = resolveHighlight(cfg({ highlight: { select: 'latestN', count: 3 } }));
    expect(h.ramp).toBe(true);
  });

  it('lets an explicit ramp override the default either way', () => {
    expect(resolveHighlight(cfg({ highlight: { ramp: true } })).ramp).toBe(true);
    expect(
      resolveHighlight(cfg({ highlight: { select: 'latestN', count: 4, ramp: false } })).ramp,
    ).toBe(false);
  });
});

describe('highlightTargets', () => {
  it('returns nothing when the highlight is off', () => {
    expect(highlightTargets(obs(3), resolveHighlight(cfg({ highlight: { show: false } })))).toEqual(
      [],
    );
  });

  it('returns nothing for an empty dataset', () => {
    expect(highlightTargets([], resolveHighlight(cfg()))).toEqual([]);
  });

  it("picks the newest reading under 'latest'", () => {
    const out = highlightTargets(obs(5), resolveHighlight(cfg()));
    expect(out).toEqual([{ id: 4, weight: 1 }]);
  });

  it("picks the newest N, newest first, under 'latestN'", () => {
    const h = resolveHighlight(cfg({ highlight: { select: 'latestN', count: 3, ramp: false } }));
    expect(highlightTargets(obs(5), h).map((t) => t.id)).toEqual([4, 3, 2]);
  });

  it('fades the trail by recency when the ramp is on', () => {
    const h = resolveHighlight(cfg({ highlight: { select: 'latestN', count: 3 } }));
    const out = highlightTargets(obs(5), h);
    expect(out[0]!.weight).toBe(1);
    expect(out[1]!.weight).toBeCloseTo(2 / 3);
    expect(out[2]!.weight).toBeCloseTo(1 / 3);
  });

  it('asks for no more than the data holds', () => {
    const h = resolveHighlight(cfg({ highlight: { select: 'latestN', count: 10 } }));
    expect(highlightTargets(obs(2), h)).toHaveLength(2);
  });

  it("takes every reading sharing the newest time under 'latestTimestamp'", () => {
    // Three readings at t=3000, two older.
    const points = obs(5, (i) => (i >= 2 ? 3000 : 1000 * (i + 1)));
    const h = resolveHighlight(cfg({ highlight: { select: 'latestTimestamp' } }));
    const out = highlightTargets(points, h);
    expect(out.map((t) => t.id).sort()).toEqual([2, 3, 4]);
    expect(out.every((t) => t.weight === 1)).toBe(true);
  });

  it('degenerates to the single latest when timestamps are unique', () => {
    const h = resolveHighlight(cfg({ highlight: { select: 'latestTimestamp' } }));
    expect(highlightTargets(obs(4), h)).toEqual([{ id: 3, weight: 1 }]);
  });
});
