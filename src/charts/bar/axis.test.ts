import { describe, expect, it } from 'vitest';
import { parseColor } from '../../core/util/color.js';
import { buildAxes, formatNumber } from './axis.js';
import type { ResolvedAxis } from './chrome.js';
import { PLOT_HEIGHT, layoutBars } from './layout.js';

const palette = ['#ff0000', '#00ff00'].map(parseColor);

function axis(over: Partial<ResolvedAxis> = {}): ResolvedAxis {
  return {
    show: true,
    ticks: undefined,
    tickFormat: undefined,
    label: undefined,
    gridLines: false,
    color: '#fff',
    fontPx: 11,
    fontFamily: 'system-ui, sans-serif',
    fontWeight: 'normal',
    titleDirection: 'up',
    ...over,
  };
}

const layout = layoutBars(
  {
    points: [
      { x: 'Q1', y: 0 },
      { x: 'Q2', y: 50 },
      { x: 'Q3', y: 100 },
    ],
  },
  palette,
);

describe('buildAxes', () => {
  it('returns no ticks when an axis is off', () => {
    const { x, y } = buildAxes(layout, axis({ show: false }), axis({ show: false }));
    expect(x).toHaveLength(0);
    expect(y).toHaveLength(0);
  });

  it('ticks:false draws the axis with no tick marks', () => {
    const { y } = buildAxes(layout, axis({ show: false }), axis({ ticks: false }));
    expect(y).toHaveLength(0);
  });

  it('y tick positions fold in PLOT_HEIGHT and stay within [0, PLOT_HEIGHT]', () => {
    const { y } = buildAxes(layout, axis({ show: false }), axis());
    expect(y.length).toBeGreaterThan(0);
    for (const t of y) {
      expect(t.pos).toBeGreaterThanOrEqual(0);
      expect(t.pos).toBeLessThanOrEqual(PLOT_HEIGHT + 1e-9);
    }
    // Domain max (100) maps to the top of the plot band.
    const top = y.find((t) => t.value === 100)!;
    expect(top.pos).toBeCloseTo(PLOT_HEIGHT, 5);
  });

  it('x emits one tick per slot at slot center', () => {
    const { x } = buildAxes(layout, axis(), axis({ show: false }));
    expect(x.map((t) => t.label)).toEqual(['Q1', 'Q2', 'Q3']);
    expect(x[0]!.pos).toBeCloseTo(1 / 6, 5); // center of first of three slots
  });

  it('x tick count thins slots by an even stride', () => {
    const many = layoutBars(
      { points: Array.from({ length: 10 }, (_, i) => ({ x: `C${i}`, y: i })) },
      palette,
    );
    const { x } = buildAxes(many, axis({ ticks: 3 }), axis({ show: false }));
    expect(x.length).toBeLessThanOrEqual(4);
    expect(x.length).toBeGreaterThan(0);
  });

  it('honors a custom tickFormat', () => {
    const { y } = buildAxes(layout, axis({ show: false }), axis({ tickFormat: (v) => `<${v}>` }));
    expect(y[0]!.label.startsWith('<')).toBe(true);
  });
});

describe('formatNumber', () => {
  it('formats compactly', () => {
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber(1234)).toBe('1,234');
    expect(formatNumber(2.5)).toBe('2.5');
  });
});
