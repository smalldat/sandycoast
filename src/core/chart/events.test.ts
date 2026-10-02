import { describe, expect, it, vi } from 'vitest';
import { ChartEventBus } from './events.js';

type Events = {
  click: { meta: string | null };
  hover: { meta: string | null };
};

describe('ChartEventBus', () => {
  it('delivers the payload fields at the top level', () => {
    const bus = new ChartEventBus<Events>();
    const seen = vi.fn();
    bus.on('click', seen);
    bus.emit('click', { meta: 'bar-1' });
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0]![0]).toMatchObject({ meta: 'bar-1', type: 'click' });
  });

  it('reports the originating DOM event, or null when there is none', () => {
    const bus = new ChartEventBus<Events>();
    const native = new Event('pointerup');
    let withNative: Event | null = null;
    let without: Event | null | undefined;
    bus.on('click', (e) => {
      withNative = e.native;
    });
    bus.emit('click', { meta: null }, { native });
    expect(withNative).toBe(native);

    bus.on('hover', (e) => {
      without = e.native;
    });
    bus.emit('hover', { meta: null });
    expect(without).toBeNull();
  });

  it('lets a listener veto the built-in reaction', () => {
    const bus = new ChartEventBus<Events>();
    bus.on('click', (e) => e.preventDefault());
    expect(bus.allows('click', { meta: null })).toBe(false);
  });

  it('allows the reaction when nothing cancels', () => {
    const bus = new ChartEventBus<Events>();
    bus.on('click', () => {});
    expect(bus.allows('click', { meta: null })).toBe(true);
  });

  it('still runs the remaining listeners after one cancels', () => {
    const bus = new ChartEventBus<Events>();
    const later = vi.fn();
    bus.on('click', (e) => e.preventDefault());
    bus.on('click', later);
    expect(bus.allows('click', { meta: null })).toBe(false);
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('ignores preventDefault on a non-cancellable event', () => {
    const bus = new ChartEventBus<Events>();
    bus.on('hover', (e) => e.preventDefault());
    const event = bus.emit('hover', { meta: null }, { cancelable: false });
    expect(event.defaultPrevented).toBe(false);
    expect(event.cancelable).toBe(false);
  });

  it('stops delivering after unsubscribe', () => {
    const bus = new ChartEventBus<Events>();
    const seen = vi.fn();
    const off = bus.on('click', seen);
    bus.emit('click', { meta: null });
    off();
    bus.emit('click', { meta: null });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('survives a listener that unsubscribes itself mid-dispatch', () => {
    const bus = new ChartEventBus<Events>();
    const second = vi.fn();
    const off = bus.on('click', () => off());
    bus.on('click', second);
    expect(() => bus.emit('click', { meta: null })).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('reports whether anything is listening', () => {
    const bus = new ChartEventBus<Events>();
    expect(bus.hasListeners('click')).toBe(false);
    const off = bus.on('click', () => {});
    expect(bus.hasListeners('click')).toBe(true);
    off();
    expect(bus.hasListeners('click')).toBe(false);
  });

  it('drops every listener on clear', () => {
    const bus = new ChartEventBus<Events>();
    const seen = vi.fn();
    bus.on('click', seen);
    bus.clear();
    bus.emit('click', { meta: null });
    expect(seen).not.toHaveBeenCalled();
  });

  it('gives each dispatch its own cancellation state', () => {
    const bus = new ChartEventBus<Events>();
    let cancelNext = true;
    bus.on('click', (e) => {
      if (cancelNext) e.preventDefault();
    });
    expect(bus.allows('click', { meta: null })).toBe(false);
    cancelNext = false;
    expect(bus.allows('click', { meta: null })).toBe(true);
  });
});
