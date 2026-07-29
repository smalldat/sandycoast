import { describe, expect, it } from 'vitest';
import { PanZoomController } from './controller.js';
import { resolvePanZoom } from './types.js';

/** Controller with a full-canvas plot rect and a change counter. */
function make(overrides = {}) {
  const cfg = resolvePanZoom({ enabled: true, maxZoom: 10, ...overrides });
  let changes = 0;
  const pz = new PanZoomController(
    cfg,
    () => [0, 0, 1, 1],
    () => {
      changes++;
    },
  );
  return { pz, changes: () => changes };
}

describe('PanZoomController', () => {
  it('starts at the identity view', () => {
    const { pz } = make();
    expect(pz.getView()).toEqual({ scale: [1, 1], offset: [0, 0] });
  });

  it('zooms about the center by default (view stays centered)', () => {
    const { pz } = make();
    pz.zoomTo(2);
    const v = pz.getView();
    expect(v.scale).toEqual([2, 2]);
    // Center anchor 0.5 stays fixed: 0.5 = 0.5*2 + offset → offset = -0.5.
    expect(v.offset[0]).toBeCloseTo(-0.5);
    expect(v.offset[1]).toBeCloseTo(-0.5);
  });

  it('keeps the anchor point fixed when zooming about it', () => {
    const { pz } = make();
    // Zoom 4× about the right edge (cx = 1); that data point must stay at 1.
    pz.zoomTo(4, 1, 0.5);
    const v = pz.getView();
    // ip = data*scale + offset; at the right edge the visible data is (1-offset)/scale.
    const dataAtRight = (1 - v.offset[0]) / v.scale[0];
    // Screen position of that data point: still the right edge.
    expect(dataAtRight * v.scale[0] + v.offset[0]).toBeCloseTo(1);
  });

  it('clamps zoom to [minZoom, maxZoom]', () => {
    const { pz } = make({ maxZoom: 5 });
    pz.zoomTo(100);
    expect(pz.getView().scale[0]).toBe(5);
    pz.zoomTo(0.1);
    // minZoom defaults to 1.
    expect(pz.getView().scale[0]).toBe(1);
  });

  it('clamps the offset so the data keeps covering the plot', () => {
    const { pz } = make();
    pz.zoomTo(2); // offset range is [1-2, 0] = [-1, 0]
    pz.panBy(5, 0); // way past the right edge
    expect(pz.getView().offset[0]).toBe(0);
    pz.panBy(-50, 0); // way past the left edge
    expect(pz.getView().offset[0]).toBe(-1);
  });

  it('restricts to a single axis when configured', () => {
    const { pz } = make({ axes: 'x' });
    pz.zoomTo(3);
    pz.panBy(-0.2, -0.2);
    const v = pz.getView();
    expect(v.scale[1]).toBe(1); // y locked
    expect(v.offset[1]).toBe(0);
    expect(v.scale[0]).toBe(3); // x free
  });

  it('resetView returns to identity', () => {
    const { pz } = make();
    pz.zoomTo(4, 0.2, 0.8);
    pz.resetView();
    expect(pz.getView()).toEqual({ scale: [1, 1], offset: [0, 0] });
  });

  it('fires onChange for every mutation', () => {
    const { pz, changes } = make();
    pz.zoomBy(1.4);
    pz.panBy(0.1, 0);
    pz.setView({ scale: [2, 2] });
    pz.resetView();
    expect(changes()).toBe(4);
  });
});
