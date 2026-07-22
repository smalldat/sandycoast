import { describe, expect, it } from 'vitest';
import { BandScale } from './band.js';
import { LinearScale } from './linear.js';
import { TimeScale } from './time.js';

describe('LinearScale', () => {
  it('maps domain to [0,1]', () => {
    const s = new LinearScale([0, 100]);
    expect(s.scale(0)).toBe(0);
    expect(s.scale(50)).toBe(0.5);
    expect(s.scale(100)).toBe(1);
  });
  it('fromValues includes zero by default', () => {
    const s = LinearScale.fromValues([10, 20, 30]);
    expect(s.domain()[0]).toBe(0);
  });
  it('handles degenerate domain without NaN', () => {
    const s = new LinearScale([5, 5]);
    expect(Number.isFinite(s.scale(5))).toBe(true);
  });
  it('produces nice ticks', () => {
    const s = new LinearScale([0, 100]);
    const t = s.ticks(5);
    expect(t[0]).toBe(0);
    expect(t).toContain(100);
  });
});

describe('BandScale', () => {
  it('assigns slots and bandwidth', () => {
    const s = new BandScale(['A', 'B', 'C'], 0);
    expect(s.bandwidth()).toBeCloseTo(1 / 3);
    expect(s.scale('A')).toBeCloseTo(0);
    expect(s.scale('B')).toBeCloseTo(1 / 3);
  });
  it('centers with padding', () => {
    const s = new BandScale(['A', 'B'], 0.5);
    expect(s.bandwidth()).toBeCloseTo(0.25);
    expect(s.center('A')).toBeCloseTo(0.25);
  });
  it('unknown key falls back to slot 0', () => {
    const s = new BandScale<string>(['A'], 0);
    expect(s.scale('ZZ')).toBeCloseTo(0);
  });
});

describe('TimeScale', () => {
  it('maps time domain to [0,1]', () => {
    const a = new Date('2020-01-01T00:00:00Z');
    const b = new Date('2020-01-02T00:00:00Z');
    const s = new TimeScale([a, b]);
    expect(s.scale(a)).toBe(0);
    expect(s.scale(b)).toBe(1);
    expect(s.scale(new Date('2020-01-01T12:00:00Z'))).toBeCloseTo(0.5);
  });
  it('generates ticks within domain', () => {
    const s = new TimeScale([new Date('2020-01-01T00:00:00Z'), new Date('2020-01-06T00:00:00Z')]);
    const t = s.ticks(5);
    expect(t.length).toBeGreaterThan(0);
    expect(t[0]!.getTime()).toBeGreaterThanOrEqual(s.domain()[0].getTime());
  });
});
