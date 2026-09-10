import { type CSSProperties, forwardRef, useImperativeHandle, useRef } from 'react';
import type { HoverPayload } from '../charts/bar/types.js';
import { BarChart as BarChartCore } from '../index.js';
import type { BarChartConfig, DataSet, SeriesFocusPayload } from '../index.js';
import { useChart, useLatest } from './useChartLifecycle.js';

export interface BarChartProps {
  /**
   * Chart data; changes morph the existing bars in place. Compared by
   * reference, so build it outside render (or memoize it) — a fresh literal
   * on every render restarts the morph.
   */
  data: DataSet;
  /**
   * Every other {@link BarChartConfig} option (style, animation, chrome,
   * pan/zoom, …). Changing this recreates the chart — memoize it (e.g. with
   * `useMemo`) so it doesn't change identity on every render.
   */
  options?: Omit<BarChartConfig, 'data'>;
  className?: string;
  style?: CSSProperties;
  onHover?: (payload: HoverPayload) => void;
  onSeriesFocus?: (payload: SeriesFocusPayload) => void;
}

const applyData = (instance: BarChartCore, data: DataSet): void => instance.update(data);

/**
 * React binding for {@link BarChartCore}. Mount into a sized container (the
 * chart fills it); the ref exposes the underlying chart instance for
 * imperative calls (`focusSeries`, `getView`, `panBy`, …).
 */
export const BarChart = forwardRef<BarChartCore, BarChartProps>(function BarChart(
  { data, options, className, style, onHover, onSeriesFocus },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handlers = useLatest({ onHover, onSeriesFocus });

  const instance = useChart<BarChartCore, DataSet>({
    containerRef,
    data,
    create: (el, initialData) =>
      new BarChartCore(el, { ...options, data: initialData } as BarChartConfig),
    update: applyData,
    subscribe: (chart) => [
      chart.on('hover', (p) => handlers.current.onHover?.(p)),
      chart.on('seriesFocus', (p) => handlers.current.onSeriesFocus?.(p)),
    ],
    deps: [options],
  });

  useImperativeHandle(ref, () => instance as BarChartCore, [instance]);

  return <div ref={containerRef} className={className} style={style} />;
});
