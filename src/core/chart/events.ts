/**
 * Cancellable chart events — the standard event surface every visual inherits.
 *
 * The contract is deliberately DOM-shaped: a listener receives one object that
 * carries both the payload fields *and* `preventDefault()`. Payload fields sit
 * at the top level rather than under a `detail` wrapper, so a listener written
 * against the old non-cancellable payloads (`e.bar`, `e.index`) keeps working
 * unchanged and simply gains the ability to veto the built-in reaction.
 *
 * Cancellation and the config-level {@link MouseHook}s in
 * `core/interaction/mouse.ts` are two layers of the same idea, applied in a
 * fixed order for every chart:
 *
 * 1. **Event listeners** (`chart.on('click', …)`) — observe, and may veto.
 * 2. **Mouse hooks** (`interaction.mouse.onCandleClick`, …) — replace or wrap.
 * 3. **Built-in behavior** — selection, focus, seek, pan.
 *
 * An observer that cancels stops 2 and 3; the remaining listeners still run,
 * because cancelling a default is not the same as silencing your peers.
 */

/** Fields merged into every payload dispatched through a chart's `on()`. */
export interface ChartEventBase {
  /** Event name, so one handler can serve several `on()` registrations. */
  readonly type: string;
  /** Originating DOM event, or `null` for programmatic and internal causes. */
  readonly native: Event | null;
  /** Whether {@link preventDefault} does anything for this event. */
  readonly cancelable: boolean;
  /** True once a listener has cancelled the built-in reaction. */
  readonly defaultPrevented: boolean;
  /**
   * Suppress the chart's built-in reaction to this event. A no-op on an event
   * whose `cancelable` is false — notifications like `drawFinished` describe
   * work that has already happened, so there is nothing left to veto.
   */
  preventDefault(): void;
}

/**
 * What a listener receives: the payload's own fields plus the cancellation
 * members. Intersecting rather than nesting is what keeps the pre-existing
 * payload shape (`{ bar }`, `{ index }`) source-compatible.
 */
export type ChartEvent<P> = P & ChartEventBase;

/** Pointer position in CSS px, relative to the chart element. */
export interface ChartPointerPx {
  x: number;
  y: number;
}

/** `click` / `dblclick`: the mark under the pointer, or `null` for background. */
export interface ChartClickPayload<M = unknown> {
  /** Mark under the pointer (bar, candle, slice, petal, point), else `null`. */
  meta: M | null;
  /** Pointer position in CSS px, relative to the chart element. */
  px: ChartPointerPx;
  /** Mouse button, mirroring `PointerEvent.button` (0 = primary). */
  button: number;
}

/** Which gesture a `drag` belongs to. Charts name their own drag targets. */
export type ChartDragTarget = 'view' | 'slider';

/** `drag`: one phase of a press-move-release gesture. */
export interface ChartDragPayload {
  /** `'start'` is the cancellable one — vetoing it abandons the gesture. */
  phase: 'start' | 'move' | 'end';
  /** What is being dragged: the view (pan) or a chrome control. */
  target: ChartDragTarget;
  /** Movement since the previous phase, in CSS px. Zero on `'start'`. */
  dx: number;
  dy: number;
  /** Pointer position in CSS px, relative to the chart element. */
  px: ChartPointerPx;
}

/** `pan`: the view is about to translate. Cancelling leaves it where it was. */
export interface ChartPanPayload {
  /** Offset the view will take, in data fractions. */
  offset: [number, number];
  /** Change from the current offset. */
  delta: [number, number];
}

/** `zoom`: the view is about to scale. Cancelling leaves it where it was. */
export interface ChartZoomPayload {
  /** Scale the view will take, per axis. */
  scale: [number, number];
  /** Multiplier against the current scale (1 = no change). */
  factor: number;
  /** Plot-local anchor the zoom pivots around, in `[0,1]` fractions. */
  center: [number, number];
}

/** `drawFinished`: a frame has been rendered. Never cancellable. */
export interface ChartDrawPayload {
  /** Seconds since the current animation started. */
  now: number;
  /** Monotonic frame counter for this chart instance. */
  frame: number;
}

/**
 * `dataAdd` / `dataUpdate` / `dataRemove`: a mutation is *about to* apply.
 *
 * These fire before the dataset changes, which is the only point where a veto
 * can mean anything — a listener that returns the chart to its prior state
 * after the fact would still have paid for a rebuild and a visible frame.
 */
export interface ChartDataPayload<T = unknown> {
  /** Which call is running: `add()`, `update()` (patches or whole set), `remove()`. */
  action: 'add' | 'update' | 'replace' | 'remove';
  /**
   * Points, candles, patches or refs named by the call. Empty for `'replace'`,
   * where the caller handed over a whole dataset rather than a list of items.
   */
  items: readonly T[];
}

/**
 * The events every chart exposes, whatever it draws.
 *
 * `M` is the chart's mark metadata (`BarMeta`, `SliceMeta`, …) and `T` the
 * union of item types its data methods accept, so `click` and the data events
 * stay precisely typed per chart while the names stay uniform across all of them.
 */
export interface ChartCoreEvents<M = unknown, T = unknown> {
  click: ChartClickPayload<M>;
  dblclick: ChartClickPayload<M>;
  drag: ChartDragPayload;
  pan: ChartPanPayload;
  zoom: ChartZoomPayload;
  drawFinished: ChartDrawPayload;
  dataAdd: ChartDataPayload<T>;
  dataUpdate: ChartDataPayload<T>;
  dataRemove: ChartDataPayload<T>;
}

/** Options for a single dispatch. */
export interface EmitOptions {
  /** DOM event that caused this, when there is one. */
  native?: Event | null;
  /** Whether listeners may veto the built-in reaction. Default `true`. */
  cancelable?: boolean;
}

/**
 * Typed listener registry with cancellable dispatch.
 *
 * Wraps each payload in an event object and reports back whether the built-in
 * reaction may proceed, which a plain fire-and-forget emitter cannot do.
 */
export class ChartEventBus<E extends Record<string, object>> {
  private handlers = new Map<keyof E, Set<(e: never) => void>>();

  /** Register `fn` for `type`; the returned function removes it. */
  on<K extends keyof E>(type: K, fn: (e: ChartEvent<E[K]>) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const entry = fn as unknown as (e: never) => void;
    set.add(entry);
    return () => {
      set.delete(entry);
    };
  }

  /** Whether anything is listening — lets callers skip building a payload. */
  hasListeners(type: keyof E): boolean {
    const set = this.handlers.get(type);
    return set !== undefined && set.size > 0;
  }

  /**
   * Dispatch `payload` to every listener and return the event, so the caller
   * can read {@link ChartEventBase.defaultPrevented}. Prefer {@link allows} at
   * call sites that only need the verdict.
   */
  emit<K extends keyof E & string>(
    type: K,
    payload: E[K],
    opts: EmitOptions = {},
  ): ChartEvent<E[K]> {
    const cancelable = opts.cancelable ?? true;
    // `defaultPrevented` is a plain data property, not an accessor: `Object.assign`
    // copies a getter's *value*, so an accessor here would freeze the flag at
    // `false` and silently make every `preventDefault()` a no-op.
    const event: ChartEvent<E[K]> = Object.assign({}, payload, {
      type,
      native: opts.native ?? null,
      cancelable,
      defaultPrevented: false,
      preventDefault(): void {
        if (cancelable) (event as { defaultPrevented: boolean }).defaultPrevented = true;
      },
    }) as ChartEvent<E[K]>;
    const set = this.handlers.get(type);
    // Iterate a copy: a listener that unsubscribes itself (a one-shot) would
    // otherwise mutate the set mid-iteration.
    if (set) for (const fn of [...set]) (fn as (e: ChartEvent<E[K]>) => void)(event);
    return event;
  }

  /**
   * Dispatch and report whether the built-in reaction should run — `false` once
   * any listener cancelled. Reads at the call site as
   * `if (!this.allows('click', …)) return;`.
   */
  allows<K extends keyof E & string>(type: K, payload: E[K], opts: EmitOptions = {}): boolean {
    return !this.emit(type, payload, opts).defaultPrevented;
  }

  clear(): void {
    this.handlers.clear();
  }
}
