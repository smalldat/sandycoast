import { describe, expect, it } from 'vitest';
import { evalGrain } from './anim.js';
import { allocGrains } from './grains.js';

/** A single settled grain whose target sits `off` from its ideal position. */
function settledGrain(ideal: number, off: number) {
  const g = allocGrains(1);
  g.startX[0] = ideal + off;
  g.startY[0] = ideal + off;
  g.targetX[0] = ideal + off;
  g.targetY[0] = ideal + off;
  g.offX[0] = off;
  g.offY[0] = off;
  g.delay[0] = -10; // te >= 1 at now=0: fully settled, no wobble
  return g;
}

describe('evalGrain scatter compensation', () => {
  it('leaves the scatter untouched at identity zoom', () => {
    const g = settledGrain(0.5, 0.1);
    const out = { x: 0, y: 0 };
    evalGrain(g, 0, 0, 1, 'linear', 0, out);
    expect(out.x).toBeCloseTo(0.6);
    expect(out.y).toBeCloseTo(0.6);
  });

  it('keeps the on-screen scatter constant under zoom', () => {
    const ideal = 0.5;
    const off = 0.1;
    const g = settledGrain(ideal, off);
    const out = { x: 0, y: 0 };
    for (const view of [1, 2, 4, 8]) {
      evalGrain(g, 0, 0, 1, 'linear', 0, out, view, view);
      // Layout offset from the ideal shrinks as 1/view, so offset × view — the
      // on-screen spread — stays equal to the original `off`.
      expect((out.x - ideal) * view).toBeCloseTo(off);
      expect((out.y - ideal) * view).toBeCloseTo(off);
    }
  });
});
