import { describe, expect, it, vi } from 'vitest';
import { type MouseHook, runMouseHook } from './mouse.js';

const EV = {} as PointerEvent;
const PX = { x: 0, y: 0 };

function run(hook: MouseHook<string> | undefined, fallback: () => void): void {
  runMouseHook(hook, 'mark', EV, PX, fallback);
}

describe('runMouseHook', () => {
  it('runs the built-in behavior when no hook is installed', () => {
    const fallback = vi.fn();
    run(undefined, fallback);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('runs the built-in behavior after a hook that returns nothing', () => {
    const fallback = vi.fn();
    const hook = vi.fn();
    run(hook, fallback);
    expect(hook).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('runs the built-in behavior after a hook that returns true', () => {
    const fallback = vi.fn();
    run(() => true, fallback);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('suppresses the built-in behavior when the hook returns false', () => {
    const fallback = vi.fn();
    run(() => false, fallback);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('latches defaultAction so an early call is not applied twice', () => {
    const fallback = vi.fn();
    run((ctx) => {
      ctx.defaultAction();
    }, fallback);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('latches defaultAction even when the hook also asks for it by return value', () => {
    const fallback = vi.fn();
    run((ctx) => {
      ctx.defaultAction();
      return true;
    }, fallback);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('honours an explicit cancel after the hook already ran the default', () => {
    // Contradictory, but it must not double-apply: the latch wins.
    const fallback = vi.fn();
    run((ctx) => {
      ctx.defaultAction();
      return false;
    }, fallback);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('ignores repeated defaultAction calls inside one hook', () => {
    const fallback = vi.fn();
    run((ctx) => {
      ctx.defaultAction();
      ctx.defaultAction();
      ctx.defaultAction();
      return false;
    }, fallback);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('hands the hook the mark, the raw event and the pointer position', () => {
    const hook = vi.fn();
    runMouseHook(hook, 'mark', EV, { x: 12, y: 34 }, () => {});
    expect(hook).toHaveBeenCalledWith(
      expect.objectContaining({ meta: 'mark', native: EV, px: { x: 12, y: 34 } }),
    );
  });

  it('passes a null mark through for background events', () => {
    const hook = vi.fn();
    runMouseHook<string, PointerEvent>(hook, null, EV, PX, () => {});
    expect(hook).toHaveBeenCalledWith(expect.objectContaining({ meta: null }));
  });
});
