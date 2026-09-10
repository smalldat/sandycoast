import { describe, expect, it, vi } from 'vitest';
import { IDENTITY_VIEW, type ViewTransform } from '../view/types.js';
import { type ChartDrawContext, LayerStack, drawElement } from './layers.js';

/** Records the 2D calls a draw makes, so assertions read as drawing intent. */
function stubCtx(): CanvasRenderingContext2D & { calls: string[] } {
  const calls: string[] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push(`${name}(${args.map((a) => JSON.stringify(a)).join(',')})`);
    };
  return {
    calls,
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    closePath: record('closePath'),
    rect: record('rect'),
    roundRect: record('roundRect'),
    arc: record('arc'),
    fill: record('fill'),
    stroke: record('stroke'),
    fillText: record('fillText'),
    strokeText: record('strokeText'),
    setLineDash: record('setLineDash'),
  } as unknown as CanvasRenderingContext2D & { calls: string[] };
}

function context(
  ctx: CanvasRenderingContext2D,
  opts: {
    rect?: [number, number, number, number];
    view?: ViewTransform;
    dpr?: number;
  } = {},
): ChartDrawContext {
  const [x0, y0, x1, y1] = opts.rect ?? [0, 0, 1, 1];
  const view = opts.view ?? IDENTITY_VIEW;
  const dpr = opts.dpr ?? 1;
  const deviceW = 200;
  const deviceH = 100;
  return {
    ctx,
    deviceW,
    deviceH,
    dpr,
    plotRect: [x0, y0, x1, y1],
    view,
    now: 0,
    toDevice(x, y, space = 'data') {
      if (space === 'canvas') return { x: x * dpr, y: y * dpr };
      const plx = space === 'data' ? x * view.scale[0] + view.offset[0] : x;
      const ply = space === 'data' ? y * view.scale[1] + view.offset[1] : y;
      const cx = x0 + plx * (x1 - x0);
      const cy = y0 + ply * (y1 - y0);
      return { x: cx * deviceW, y: (1 - cy) * deviceH };
    },
    toSpace(x, y) {
      return { x, y };
    },
  };
}

describe('LayerStack', () => {
  it('paints layers low z first, insertion order breaking ties', () => {
    const stack = new LayerStack();
    const order: string[] = [];
    stack.add(() => order.push('mid'), { z: 5 });
    stack.add(() => order.push('top'), { z: 10 });
    stack.add(() => order.push('bottom'), { z: 0 });
    stack.add(() => order.push('mid-2'), { z: 5 });
    stack.paint(context(stubCtx()));
    expect(order).toEqual(['bottom', 'mid', 'mid-2', 'top']);
  });

  it('skips hidden layers', () => {
    const stack = new LayerStack();
    const draw = vi.fn();
    const layer = stack.add(draw);
    layer.visible = false;
    stack.paint(context(stubCtx()));
    expect(draw).not.toHaveBeenCalled();
    layer.visible = true;
    stack.paint(context(stubCtx()));
    expect(draw).toHaveBeenCalledTimes(1);
  });

  it('replaces a layer that reuses an id rather than stacking a second one', () => {
    const stack = new LayerStack();
    const first = vi.fn();
    const second = vi.fn();
    stack.add(first, { id: 'threshold' });
    stack.add(second, { id: 'threshold' });
    stack.paint(context(stubCtx()));
    expect(stack.size).toBe(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('stops painting a removed layer', () => {
    const stack = new LayerStack();
    const draw = vi.fn();
    stack.add(draw).remove();
    stack.paint(context(stubCtx()));
    expect(draw).not.toHaveBeenCalled();
    expect(stack.size).toBe(0);
  });

  it('swaps the callback through setDraw, keeping order', () => {
    const stack = new LayerStack();
    const next = vi.fn();
    const layer = stack.add(() => {});
    layer.setDraw(next);
    stack.paint(context(stubCtx()));
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe('drawElement projection', () => {
  it('maps data space through the plot rect, flipping y for the canvas', () => {
    const ctx = stubCtx();
    drawElement(context(ctx), {
      kind: 'line',
      from: [0, 0],
      to: [1, 1],
      stroke: '#fff',
    });
    // (0,0) is the plot's bottom-left → canvas (0, height); (1,1) the top-right.
    expect(ctx.calls).toContain('moveTo(0,100)');
    expect(ctx.calls).toContain('lineTo(200,0)');
  });

  it('follows the pan/zoom transform in data space', () => {
    const ctx = stubCtx();
    const view: ViewTransform = { scale: [2, 1], offset: [-0.5, 0] };
    drawElement(context(ctx, { view }), {
      kind: 'line',
      from: [0.5, 0],
      to: [0.5, 1],
      stroke: '#fff',
    });
    // 0.5 * 2 - 0.5 = 0.5 → still centered, but a zoomed-in x.
    expect(ctx.calls).toContain('moveTo(100,100)');
  });

  it('pins plot space against pan/zoom', () => {
    const ctx = stubCtx();
    const view: ViewTransform = { scale: [2, 1], offset: [-0.5, 0] };
    drawElement(context(ctx, { view }), {
      kind: 'line',
      space: 'plot',
      from: [0, 0],
      to: [1, 0],
      stroke: '#fff',
    });
    expect(ctx.calls).toContain('moveTo(0,100)');
    expect(ctx.calls).toContain('lineTo(200,100)');
  });

  it('treats canvas space as CSS px scaled by dpr', () => {
    const ctx = stubCtx();
    drawElement(context(ctx, { dpr: 2 }), {
      kind: 'line',
      space: 'canvas',
      from: [10, 20],
      to: [30, 40],
      stroke: '#fff',
    });
    expect(ctx.calls).toContain('moveTo(20,40)');
    expect(ctx.calls).toContain('lineTo(60,80)');
  });

  it('projects both rect corners rather than scaling the size', () => {
    const ctx = stubCtx();
    drawElement(context(ctx), {
      kind: 'rect',
      at: [0.25, 0],
      width: 0.5,
      height: 0.5,
      fill: '#fff',
    });
    // x: 0.25→50, width 0.5→100. y: the top edge (0.5) is canvas y=50.
    expect(ctx.calls).toContain('rect(50,50,100,50)');
  });

  it('keeps a circle radius in screen px', () => {
    const ctx = stubCtx();
    drawElement(context(ctx, { dpr: 2 }), {
      kind: 'circle',
      center: [0.5, 0.5],
      radius: 4,
      fill: '#fff',
    });
    expect(ctx.calls.some((c) => c.startsWith('arc(100,50,8'))).toBe(true);
  });

  it('closes a path only when asked', () => {
    const open = stubCtx();
    drawElement(context(open), {
      kind: 'path',
      points: [
        [0, 0],
        [1, 1],
      ],
      stroke: '#fff',
    });
    expect(open.calls).not.toContain('closePath()');

    const closed = stubCtx();
    drawElement(context(closed), {
      kind: 'path',
      points: [
        [0, 0],
        [1, 1],
      ],
      closed: true,
      stroke: '#fff',
    });
    expect(closed.calls).toContain('closePath()');
  });

  it('scales the dash pattern and line width to device px', () => {
    const ctx = stubCtx();
    drawElement(context(ctx, { dpr: 2 }), {
      kind: 'line',
      from: [0, 0],
      to: [1, 0],
      stroke: '#fff',
      lineWidth: 2,
      lineDash: [4, 4],
    });
    expect(ctx.calls).toContain('setLineDash([8,8])');
    expect(ctx.lineWidth).toBe(4);
  });

  it('scales a text element font to device px', () => {
    const ctx = stubCtx();
    drawElement(context(ctx, { dpr: 2 }), {
      kind: 'text',
      at: [0, 0],
      text: 'hi',
      font: '12px system-ui',
      fill: '#fff',
    });
    expect(ctx.font).toBe('24px system-ui');
    expect(ctx.calls).toContain('fillText("hi",0,100)');
  });
});
