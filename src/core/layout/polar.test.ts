import { describe, expect, it } from 'vitest';
import {
  CENTER,
  angleInWedge,
  layoutToAngle,
  normalizeAngle,
  polarToLayout,
  squareRect,
} from './polar.js';

const TAU = Math.PI * 2;

describe('squareRect', () => {
  it('is a no-op shape-wise when the rect is already square in pixels', () => {
    const [x0, y0, x1, y1] = squareRect([0, 0, 1, 1], 500, 500);
    expect(x1 - x0).toBeCloseTo(1);
    expect(y1 - y0).toBeCloseTo(1);
  });

  it('narrows the wide axis so the disc renders round, not elliptical', () => {
    // 900x300: the square side is 300px, so the rect keeps 300/900 of the width.
    const [x0, y0, x1, y1] = squareRect([0, 0, 1, 1], 900, 300);
    expect((x1 - x0) * 900).toBeCloseTo(300);
    expect((y1 - y0) * 300).toBeCloseTo(300);
  });

  it('stays centered inside the source rect', () => {
    const [x0, y0, x1, y1] = squareRect([0.2, 0, 1, 1], 900, 300);
    expect((x0 + x1) / 2).toBeCloseTo(0.6);
    expect((y0 + y1) / 2).toBeCloseTo(0.5);
  });

  it('honours chrome gutters already removed from the rect', () => {
    const [, y0, , y1] = squareRect([0, 0.1, 1, 0.9], 400, 400);
    expect((y1 - y0) * 400).toBeCloseTo(320);
  });
});

describe('polarToLayout / layoutToAngle', () => {
  it("puts angle 0 at 12 o'clock", () => {
    const p = polarToLayout(CENTER, CENTER, 0, 0.25);
    expect(p.x).toBeCloseTo(0.5);
    expect(p.y).toBeCloseTo(0.75);
  });

  it('runs clockwise: a quarter turn is due east', () => {
    const p = polarToLayout(CENTER, CENTER, Math.PI / 2, 0.25);
    expect(p.x).toBeCloseTo(0.75);
    expect(p.y).toBeCloseTo(0.5);
  });

  it('round-trips an angle through layout coords', () => {
    for (const a of [0, 0.3, Math.PI / 2, Math.PI, 4.2, TAU - 0.01]) {
      const p = polarToLayout(CENTER, CENTER, a, 0.3);
      expect(layoutToAngle(p.x - CENTER, p.y - CENTER)).toBeCloseTo(a);
    }
  });

  it('reports angles in [0, 2π) rather than signed', () => {
    expect(layoutToAngle(-0.1, 0.1)).toBeGreaterThan(Math.PI);
  });
});

describe('normalizeAngle', () => {
  it('wraps in both directions', () => {
    expect(normalizeAngle(TAU + 0.5)).toBeCloseTo(0.5);
    expect(normalizeAngle(-0.5)).toBeCloseTo(TAU - 0.5);
    expect(normalizeAngle(0.5)).toBeCloseTo(0.5);
  });
});

describe('angleInWedge', () => {
  it('accepts an angle inside an ordinary sweep', () => {
    expect(angleInWedge(1, 0.5, 1.5)).toBe(true);
    expect(angleInWedge(2, 0.5, 1.5)).toBe(false);
  });

  it('includes both seams', () => {
    expect(angleInWedge(0.5, 0.5, 1.5)).toBe(true);
    expect(angleInWedge(1.5, 0.5, 1.5)).toBe(true);
  });

  it('matches a sweep that wraps past a full turn', () => {
    // A sector centered on north spans -0.2 .. 0.2; a heading of 2π-0.1 is in it.
    expect(angleInWedge(TAU - 0.1, -0.2, 0.2)).toBe(true);
  });

  it('matches a sweep expressed beyond one turn', () => {
    expect(angleInWedge(0.1, TAU - 0.2, TAU + 0.2)).toBe(true);
  });
});
