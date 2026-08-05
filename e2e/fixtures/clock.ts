/**
 * Fake clock, installed as a page init script so it is in place before any
 * chart module runs.
 *
 * The charts drive their animation from `performance.now()` and
 * `requestAnimationFrame` (see `BarChart.loop`). Left alone, no two frames are
 * alike and neither pixels nor hover-fade state are assertable. With the clock
 * frozen, `window.__clock.advance(ms)` runs an exact, reproducible number of
 * frames — the grain RNG is already seeded, so the whole render becomes a pure
 * function of elapsed time.
 *
 * NOTE: this function is serialized into the page. It must not close over
 * anything from the Node side.
 */
export function installFakeClock(): void {
  let now = 0;
  let nextId = 1;
  let queue = new Map<number, FrameRequestCallback>();

  Object.defineProperty(performance, 'now', { value: () => now, configurable: true });

  window.requestAnimationFrame = (cb: FrameRequestCallback): number => {
    const id = nextId++;
    queue.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id: number): void => {
    queue.delete(id);
  };

  window.__clock = {
    now: () => now,
    /** Step time forward in `stepMs` slices, flushing the rAF queue each slice. */
    advance(ms: number, stepMs = 16): void {
      const end = now + ms;
      // Guard against a runaway callback that re-queues without bound.
      let guard = 0;
      while (now < end && guard++ < 10_000) {
        now = Math.min(end, now + stepMs);
        const due = queue;
        queue = new Map();
        for (const cb of due.values()) cb(now);
      }
    },
    /** Frames pending for the next advance — 0 means the chart went idle. */
    pending: () => queue.size,
  };
}

export interface FakeClock {
  now(): number;
  advance(ms: number, stepMs?: number): void;
  pending(): number;
}

declare global {
  interface Window {
    __clock: FakeClock;
  }
}
