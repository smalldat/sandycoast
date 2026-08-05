import { describe, expect, it } from 'vitest';
import type { ResolvedAxis } from '../../core/chrome/chrome.js';
import {
  fractionAtPx,
  indexAt,
  resolveSlider,
  sliderTicks,
  sliderTrack,
  trackPos,
} from './slider.js';

function axis(over: Partial<ResolvedAxis> = {}): ResolvedAxis {
  return {
    show: true,
    ticks: undefined,
    tickFormat: undefined,
    label: undefined,
    gridLines: false,
    color: '#fff',
    fontPx: 11,
    fontFamily: 'system-ui',
    fontWeight: 'normal',
    titleDirection: 'up',
    ...over,
  };
}

describe('trackPos / indexAt', () => {
  it('spreads indices across the track and inverts back', () => {
    expect(trackPos(0, 5)).toBe(0);
    expect(trackPos(4, 5)).toBe(1);
    expect(trackPos(2, 5)).toBeCloseTo(0.5, 10);
    for (let i = 0; i < 5; i++) expect(indexAt(trackPos(i, 5), 5)).toBe(i);
  });

  it('centers a single series and clamps out-of-range fractions', () => {
    expect(trackPos(0, 1)).toBe(0.5);
    expect(indexAt(0.9, 1)).toBe(0);
    expect(indexAt(-3, 4)).toBe(0);
    expect(indexAt(7, 4)).toBe(3);
  });
});

describe('sliderTicks', () => {
  it('labels every series, thinning to the requested tick count', () => {
    const series = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
    expect(sliderTicks(series, axis()).map((t) => t.label)).toEqual(series);
    const thinned = sliderTicks(series, axis({ ticks: 3 }));
    expect(thinned.map((t) => t.label)).toEqual(['Jan', 'Mar', 'May']);
    expect(thinned[0]!.pos).toBe(0);
  });

  it('honours show / ticks:false and a custom formatter', () => {
    expect(sliderTicks(['a'], axis({ show: false }))).toEqual([]);
    expect(sliderTicks(['a'], axis({ ticks: false }))).toEqual([]);
    const fmt = sliderTicks(['a', 'b'], axis({ tickFormat: (v) => `<${String(v)}>` }));
    expect(fmt.map((t) => t.label)).toEqual(['<a>', '<b>']);
  });

  it('numbers unkeyed series so a single-series dataset still labels', () => {
    expect(sliderTicks([undefined], axis()).map((t) => t.label)).toEqual(['1']);
  });
});

describe('sliderTrack / fractionAtPx', () => {
  const slider = resolveSlider({ handlePx: 10, position: 'bottom' });

  it('spans the plot width and sits below the plot on the bottom edge', () => {
    const t = sliderTrack(slider, [0.1, 0.2, 0.9, 0.95], 1000, 500, 1);
    expect(t.x0).toBeCloseTo(100, 10);
    expect(t.x1).toBeCloseTo(900, 10);
    // Plot bottom is at device y = (1 - 0.2) * 500 = 400, then handle + gap.
    expect(t.y).toBeCloseTo(414, 10);
    expect(t.handle).toBe(10);
  });

  it('flips above the plot when pinned to the top', () => {
    const top = resolveSlider({ handlePx: 10, position: 'top' });
    const t = sliderTrack(top, [0.1, 0.2, 0.9, 0.95], 1000, 500, 1);
    // Plot top is at device y = (1 - 0.95) * 500 = 25, then handle + gap above.
    expect(t.y).toBeCloseTo(11, 10);
  });

  it('maps device x onto a clamped track fraction', () => {
    const t = sliderTrack(slider, [0, 0, 1, 1], 800, 400, 1);
    expect(fractionAtPx(t, 0)).toBe(0);
    expect(fractionAtPx(t, 400)).toBeCloseTo(0.5, 10);
    expect(fractionAtPx(t, 5000)).toBe(1);
    expect(fractionAtPx(t, -50)).toBe(0);
  });
});
