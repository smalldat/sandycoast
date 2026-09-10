import { type RefObject, useEffect, useRef, useState } from 'react';

/** Removes a listener registered through the chart's `on()`. */
export type Unsubscribe = () => void;

export interface UseChartArgs<TInstance extends { dispose(): void }, TData> {
  /** Container the chart is created into; the chart fills it. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Current data; reference changes are applied via `update`. */
  data: TData;
  /** Constructs the chart with the data it should start with. */
  create: (el: HTMLElement, data: TData) => TInstance;
  /** Applies a later `data` reference to the live instance. */
  update: (instance: TInstance, data: TData) => void;
  /**
   * Registers event listeners on a freshly created instance, returning their
   * unsubscribes. Called synchronously inside `create`'s effect so listeners
   * are in place before the chart can emit anything (some charts emit during
   * their first layout pass). Listeners must read their handler props through
   * a ref — `subscribe` runs once per instance, not once per render.
   */
  subscribe?: (instance: TInstance) => Unsubscribe[];
  /** Changing any entry disposes the instance and creates a fresh one. */
  deps: readonly unknown[];
}

/**
 * Owns a vanilla chart instance for a React binding: creates it inside
 * `containerRef`'s element, wires its event listeners, applies `data`
 * changes in place, and disposes it on unmount or whenever `deps` changes.
 *
 * `create`, `update` and `subscribe` are read lazily through a ref so they
 * always see the latest render's closure (props) without themselves forcing
 * a recreation — only `deps` controls that, matching `useEffect`'s contract.
 */
export function useChart<TInstance extends { dispose(): void }, TData>({
  containerRef,
  data,
  create,
  update,
  subscribe,
  deps,
}: UseChartArgs<TInstance, TData>): TInstance | null {
  const [instance, setInstance] = useState<TInstance | null>(null);
  const latest = useRef({ data, create, update, subscribe });
  latest.current = { data, create, update, subscribe };

  // What the live instance is actually showing. Recorded at construction
  // rather than inferred from an identity check, so a `data` change that
  // lands in the same commit as the instance becoming visible still applies.
  const appliedRef = useRef<{ instance: TInstance | null; data: TData }>({
    instance: null,
    data,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: recreation is driven by the caller-supplied `deps`, not the callbacks (read via `latest`).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const { data: initialData, create: createNow, subscribe: subscribeNow } = latest.current;
    const inst = createNow(el, initialData);
    appliedRef.current = { instance: inst, data: initialData };
    const offs = subscribeNow?.(inst) ?? [];
    setInstance(inst);
    return () => {
      for (const off of offs) off();
      inst.dispose();
      appliedRef.current = { instance: null, data: latest.current.data };
      setInstance(null);
    };
  }, deps);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `instance` is the trigger, not a value read — it re-runs this effect on the commit that publishes a new instance, so a `data` change batched with that commit still lands.
  useEffect(() => {
    const applied = appliedRef.current;
    if (!applied.instance || applied.data === data) return;
    latest.current.update(applied.instance, data);
    appliedRef.current = { instance: applied.instance, data };
  }, [instance, data]);

  return instance;
}

/**
 * Keeps `value` readable from callbacks that outlive the render they were
 * created in (chart event listeners, which are registered once per
 * instance) without re-registering them when a handler's identity changes.
 */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
