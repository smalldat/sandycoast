import {
  type CSSProperties,
  type ReactElement,
  type Ref,
  forwardRef,
  useImperativeHandle,
  useRef,
} from 'react';
import type { HighlightPayload, HoverPayload, SelectPayload } from '../charts/windrose/types.js';
import { WindRoseChart as WindRoseChartCore } from '../index.js';
import type { WindDataSet, WindRoseChartConfig } from '../index.js';
import { useChart, useLatest } from './useChartLifecycle.js';

export interface WindRoseChartProps<Custom = unknown> {
  /**
   * Wind observations; changes re-bin and morph the existing petals in
   * place. Compared by reference, so build it outside render (or memoize
   * it) — a fresh literal on every render restarts the morph.
   */
  data: WindDataSet<Custom>;
  /**
   * Every other {@link WindRoseChartConfig} option (sectors, bands, style,
   * animation, …). Changing this recreates the chart — memoize it (e.g.
   * with `useMemo`) so it doesn't change identity on every render.
   */
  options?: Omit<WindRoseChartConfig<Custom>, 'data'>;
  className?: string;
  style?: CSSProperties;
  onHover?: (payload: HoverPayload) => void;
  onSelect?: (payload: SelectPayload) => void;
  /** Fires with the highlighted segment, including once for the initial data. */
  onHighlight?: (payload: HighlightPayload) => void;
}

function applyData<Custom>(instance: WindRoseChartCore<Custom>, data: WindDataSet<Custom>): void {
  instance.setData(data);
}

function WindRoseChartInner<Custom = unknown>(
  { data, options, className, style, onHover, onSelect, onHighlight }: WindRoseChartProps<Custom>,
  ref: Ref<WindRoseChartCore<Custom>>,
): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const handlers = useLatest({ onHover, onSelect, onHighlight });

  const instance = useChart<WindRoseChartCore<Custom>, WindDataSet<Custom>>({
    containerRef,
    data,
    create: (el, initialData) =>
      new WindRoseChartCore<Custom>(el, {
        ...options,
        data: initialData,
      } as WindRoseChartConfig<Custom>),
    update: applyData,
    subscribe: (chart) => [
      chart.on('hover', (p) => handlers.current.onHover?.(p)),
      chart.on('select', (p) => handlers.current.onSelect?.(p)),
      chart.on('highlight', (p) => handlers.current.onHighlight?.(p)),
    ],
    deps: [options],
  });

  useImperativeHandle(ref, () => instance as WindRoseChartCore<Custom>, [instance]);

  return <div ref={containerRef} className={className} style={style} />;
}

/**
 * React binding for {@link WindRoseChartCore}. Mount into a sized container
 * (the chart fills it); the ref exposes the underlying chart instance for
 * imperative calls (`selectObservation`, `selectSegment`, …). Generic over
 * the same `Custom` per-observation payload type as the underlying chart.
 */
export const WindRoseChart = forwardRef(WindRoseChartInner) as <Custom = unknown>(
  props: WindRoseChartProps<Custom> & { ref?: Ref<WindRoseChartCore<Custom>> },
) => ReactElement | null;
