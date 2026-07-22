import { describe, expect, it } from 'vitest';
import { resolveBarStyle, revealFactor } from './barStyle.js';
import type { BarChartConfig } from './types.js';

const base: BarChartConfig = { data: { points: [] } };

describe('revealFactor', () => {
  it('is 0 before the start', () => {
    expect(revealFactor(0, 1, 0.5, 'linear')).toBe(0);
    expect(revealFactor(1, 1, 0.5, 'linear')).toBe(0);
  });

  it('is 1 after the window', () => {
    expect(revealFactor(2, 1, 0.5, 'linear')).toBe(1);
  });

  it('ramps monotonically across the window', () => {
    const a = revealFactor(1.1, 1, 1, 'linear');
    const b = revealFactor(1.5, 1, 1, 'linear');
    const c = revealFactor(1.9, 1, 1, 'linear');
    expect(a).toBeLessThan(b);
    expect(b).toBeLessThan(c);
    expect(b).toBeCloseTo(0.5, 5);
  });

  it('snaps to a step when duration <= 0', () => {
    expect(revealFactor(1, 1, 0, 'linear')).toBe(0);
    expect(revealFactor(1.0001, 1, 0, 'linear')).toBe(1);
  });
});

describe('resolveBarStyle', () => {
  it('is disabled with no bars config', () => {
    const r = resolveBarStyle(base);
    expect(r.enabled).toBe(false);
    expect(r.fill.on).toBe(false);
    expect(r.border.any).toBe(false);
  });

  it('outlines all four sides when a border block sets no sides', () => {
    const r = resolveBarStyle({ ...base, bars: { border: { width: 2 } } });
    expect(r.border.any).toBe(true);
    expect(r.border.left && r.border.top && r.border.right && r.border.bottom).toBe(true);
    expect(r.border.width).toBe(2);
    expect(r.enabled).toBe(true);
  });

  it('draws only the specified sides when any side is set', () => {
    const r = resolveBarStyle({ ...base, bars: { border: { top: true } } });
    expect(r.border.top).toBe(true);
    expect(r.border.bottom).toBe(false);
    expect(r.border.left).toBe(false);
    expect(r.border.right).toBe(false);
  });

  it('resolves fill defaults and enables', () => {
    const r = resolveBarStyle({ ...base, bars: { fill: {} } });
    expect(r.fill.on).toBe(true);
    expect(r.fill.opacity).toBe(1);
    expect(r.enabled).toBe(true);
  });

  it('converts reveal duration ms -> s', () => {
    const r = resolveBarStyle({
      ...base,
      bars: { fill: { opacity: 0.5 }, reveal: { duration: 800, start: 2 } },
    });
    expect(r.fill.opacity).toBe(0.5);
    expect(r.reveal.duration).toBeCloseTo(0.8, 5);
    expect(r.reveal.start).toBe(2);
  });

  it('defaults reveal to afterPour with grainsTo 0', () => {
    const r = resolveBarStyle({ ...base, bars: { fill: {} } });
    expect(r.reveal.start).toBe('afterPour');
    expect(r.reveal.grainsTo).toBe(0);
  });
});
