import { type RefObject, useEffect, useRef, useState } from 'react';

/**
 * Creates a chart instance inside `containerRef`'s element and disposes it
 * on unmount or whenever `deps` changes (disposing the old instance and
 * creating a fresh one). `create` is read lazily via a ref so it can always
 * see the latest render's closure (props) without itself forcing a
 * recreation — only `deps` controls that, matching `useEffect`'s contract.
 */
export function useChartLifecycle<TInstance extends { dispose(): void }>(
  containerRef: RefObject<HTMLDivElement | null>,
  create: (el: HTMLElement) => TInstance,
  deps: readonly unknown[],
): TInstance | null {
  const [instance, setInstance] = useState<TInstance | null>(null);
  const createRef = useRef(create);
  createRef.current = create;

  // biome-ignore lint/correctness/useExhaustiveDependencies: recreation is driven by the caller-supplied `deps`, not `create`.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const inst = createRef.current(el);
    setInstance(inst);
    return () => {
      inst.dispose();
      setInstance(null);
    };
  }, deps);

  return instance;
}

/**
 * Applies `data` to `instance` via `update` whenever it changes by
 * reference — but not right after `instance` itself was (re)created, since
 * the fresh instance was already constructed with that `data`.
 */
export function useChartData<TInstance, TData>(
  instance: TInstance | null,
  data: TData,
  update: (instance: TInstance, data: TData) => void,
): void {
  const seenRef = useRef<{ instance: TInstance | null; data: TData }>({
    instance: null,
    data,
  });

  useEffect(() => {
    if (!instance) return;
    const seen = seenRef.current;
    if (seen.instance === instance && seen.data !== data) {
      update(instance, data);
    }
    seenRef.current = { instance, data };
  }, [instance, data, update]);
}
