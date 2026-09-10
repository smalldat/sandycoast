import { describe, expect, it, vi } from 'vitest';
import type { MouseHook } from '../interaction/mouse.js';
import { PanZoomController } from '../view/controller.js';
import { type ResolvedPanZoom, resolvePanZoom } from '../view/types.js';
import { type ChartFrameInfo, ChartKernel } from './kernel.js';

interface Mark {
  id: number;
}

type ExtraEvents = { hover: { meta: Mark | null } };

/**
 * The smallest thing that can be a chart: enough to exercise the kernel's
 * dispatch and pan/zoom bridge without a renderer or a DOM.
 */
class FakeChart extends ChartKernel<Mark, string, ExtraEvents> {
  frames = 0;
  seeks: string[] = [];
  readonly pz: PanZoomController;

  constructor(cfg: Partial<ResolvedPanZoom> = {}) {
    super();
    this.pz = new PanZoomController(
      { ...resolvePanZoom({ enabled: true }), ...cfg },
      () => [0, 0, 1, 1],
      () => {},
      this.panZoomHooks(),
    );
  }

  protected chartFrame(): ChartFrameInfo {
    this.frames++;
    return {
      host: {} as HTMLElement,
      canvas: { width: 200, height: 100 } as HTMLCanvasElement,
      rect: [0, 0, 1, 1],
      dpr: 1,
      view: this.pz.getView(),
      now: 1.5,
    };
  }

  /** Stands in for a chart's `add()`. */
  addItems(items: string[]): boolean {
    if (!this.allowsData('dataAdd', 'add', items)) return false;
    this.seeks.push(...items);
    return true;
  }

  click(meta: Mark | null, hook: MouseHook<Mark> | undefined, fallback: () => void): void {
    const native = { button: 0 } as PointerEvent;
    this.dispatchClick('click', meta, native, { x: 1, y: 2 }, hook, fallback);
  }

  frame(): void {
    this.afterDraw();
  }
}

describe('ChartKernel data events', () => {
  it('applies a mutation nothing objected to', () => {
    const chart = new FakeChart();
    const seen = vi.fn();
    chart.on('dataAdd', seen);
    expect(chart.addItems(['a'])).toBe(true);
    expect(seen.mock.calls[0]![0]).toMatchObject({ action: 'add', items: ['a'] });
  });

  it('abandons the mutation when a listener cancels', () => {
    const chart = new FakeChart();
    chart.on('dataAdd', (e) => e.preventDefault());
    expect(chart.addItems(['a'])).toBe(false);
    expect(chart.seeks).toEqual([]);
  });
});

describe('ChartKernel click dispatch', () => {
  it('runs listener, then hook, then the built-in behavior', () => {
    const chart = new FakeChart();
    const order: string[] = [];
    chart.on('click', () => order.push('listener'));
    const hook: MouseHook<Mark> = () => {
      order.push('hook');
    };
    chart.click({ id: 1 }, hook, () => order.push('default'));
    expect(order).toEqual(['listener', 'hook', 'default']);
  });

  it('a cancelling listener stops both the hook and the default', () => {
    const chart = new FakeChart();
    const hook = vi.fn();
    const fallback = vi.fn();
    chart.on('click', (e) => e.preventDefault());
    chart.click({ id: 1 }, hook, fallback);
    expect(hook).not.toHaveBeenCalled();
    expect(fallback).not.toHaveBeenCalled();
  });

  it('a hook returning false stops only the default, not the event', () => {
    const chart = new FakeChart();
    const seen = vi.fn();
    const fallback = vi.fn();
    chart.on('click', seen);
    chart.click({ id: 1 }, () => false, fallback);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('carries the mark under the pointer', () => {
    const chart = new FakeChart();
    let meta: Mark | null = null;
    chart.on('click', (e) => {
      meta = e.meta;
    });
    chart.click({ id: 7 }, undefined, () => {});
    expect(meta).toEqual({ id: 7 });
  });
});

describe('ChartKernel pan/zoom bridge', () => {
  it('reports a translation as pan, with the offset it will take', () => {
    const chart = new FakeChart();
    const seen = vi.fn();
    chart.on('pan', seen);
    chart.pz.zoomTo(2); // zoom first: at scale 1 the offset is clamped to 0
    chart.pz.panBy(-0.1, 0);
    expect(seen).toHaveBeenCalledTimes(1);
    // Zooming about the center already put the offset at -0.5.
    expect(seen.mock.calls[0]![0].offset[0]).toBeCloseTo(-0.6);
    expect(seen.mock.calls[0]![0].delta[0]).toBeCloseTo(-0.1);
  });

  it('reports a scale change as zoom, not pan', () => {
    const chart = new FakeChart();
    const pan = vi.fn();
    const zoom = vi.fn();
    chart.on('pan', pan);
    chart.on('zoom', zoom);
    chart.pz.zoomBy(2, 0.5, 0.5);
    expect(zoom).toHaveBeenCalledTimes(1);
    expect(pan).not.toHaveBeenCalled();
    expect(zoom.mock.calls[0]![0]).toMatchObject({ factor: 2, center: [0.5, 0.5] });
  });

  it('leaves the view untouched when pan is cancelled', () => {
    const chart = new FakeChart();
    chart.pz.zoomTo(2);
    const before = chart.pz.getView().offset[0];
    chart.on('pan', (e) => e.preventDefault());
    chart.pz.panBy(-0.2, 0);
    expect(chart.pz.getView().offset[0]).toBe(before);
  });

  it('leaves the scale untouched when zoom is cancelled', () => {
    const chart = new FakeChart();
    chart.on('zoom', (e) => e.preventDefault());
    chart.pz.zoomBy(2);
    expect(chart.pz.getView().scale[0]).toBe(1);
  });

  it('does not fire for a move that lands where the view already is', () => {
    const chart = new FakeChart();
    const seen = vi.fn();
    chart.on('pan', seen);
    chart.pz.panBy(0, 0);
    expect(seen).not.toHaveBeenCalled();
  });
});

describe('ChartKernel drawFinished', () => {
  it('stays out of the frame path when nothing is listening or drawing', () => {
    const chart = new FakeChart();
    chart.frame();
    expect(chart.frames).toBe(0);
  });

  it('fires once per frame with a monotonic counter', () => {
    const chart = new FakeChart();
    const seen = vi.fn();
    chart.on('drawFinished', seen);
    chart.frame();
    chart.frame();
    expect(seen).toHaveBeenCalledTimes(2);
    expect(seen.mock.calls[0]![0]).toMatchObject({ now: 1.5, frame: 1 });
    expect(seen.mock.calls[1]![0].frame).toBe(2);
  });

  it('is a notification, not a decision', () => {
    const chart = new FakeChart();
    let cancelable: boolean | undefined;
    chart.on('drawFinished', (e) => {
      e.preventDefault();
      cancelable = e.cancelable;
    });
    chart.frame();
    expect(cancelable).toBe(false);
  });
});

describe('ChartKernel disposal', () => {
  it('drops listeners and layers', () => {
    const chart = new FakeChart();
    const seen = vi.fn();
    chart.on('dataAdd', seen);
    chart.addLayer(() => {});
    chart.dispose();
    expect(chart.getLayerCount()).toBe(0);
    chart.addItems(['a']);
    expect(seen).not.toHaveBeenCalled();
  });
});
