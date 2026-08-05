import { describe, expect, it } from 'vitest';
import { evalGrain } from './anim.js';
import { allocGrains } from './grains.js';

/** One grain travelling from `start` to `target`, with a settle delay of `delay`. */
function grain(start: number, target: number, delay: number) {
  const g = allocGrains(1);
  g.startX[0] = start;
  g.startY[0] = start;
  g.targetX[0] = target;
  g.targetY[0] = target;
  g.delay[0] = delay;
  return g;
}

describe('evalGrain', () => {
  it('lands exactly on the target once settled', () => {
    // delay = -10 puts te >= 1 at now = 0: fully settled, no wobble left.
    const g = grain(0.2, 0.6, -10);
    const out = { x: 0, y: 0 };
    evalGrain(g, 0, 0, 1, 'linear', 0.05, out);
    expect(out.x).toBeCloseTo(0.6);
    expect(out.y).toBeCloseTo(0.6);
  });

  it('lerps between start and target mid-flight', () => {
    const g = grain(0, 1, 0);
    const out = { x: 0, y: 0 };
    evalGrain(g, 0, 0.5, 1, 'linear', 0, out);
    expect(out.x).toBeCloseTo(0.5);
    expect(out.y).toBeCloseTo(0.5);
  });

  it('scales the settle wobble down as the grain arrives', () => {
    const g = grain(0, 1, 0);
    const early = { x: 0, y: 0 };
    const late = { x: 0, y: 0 };
    // Same grain, same trajectory — only the wobble term differs with `settle`.
    evalGrain(g, 0, 0.1, 1, 'linear', 0.2, early);
    evalGrain(g, 0, 0.9, 1, 'linear', 0.2, late);
    expect(Math.abs(early.x - 0.1)).toBeGreaterThan(Math.abs(late.x - 0.9));
  });

  it('positions grains in layout space, so zoom magnifies the sand with the chart', () => {
    // Positions carry no view compensation: the renderer's view transform
    // multiplies them, so grain scatter grows with zoom like the bars do.
    const g = grain(0.5, 0.7, -10);
    const out = { x: 0, y: 0 };
    evalGrain(g, 0, 0, 1, 'linear', 0, out);
    for (const view of [1, 2, 4, 8]) {
      expect(out.x * view).toBeCloseTo(0.7 * view);
    }
  });
});
