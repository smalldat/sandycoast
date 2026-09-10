import { type CSSProperties, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { HoverPayload } from '../charts/line/types.js';
import { LineChart as LineChartCore } from '../index.js';
import type { DataSet, LineChartConfig, SeriesFocusPayload } from '../index.js';
import { useChartData, useChartLifecycle } from './useChartLifecycle.js';

export interface LineChartProps {
  /** Chart data; changes morph the existing lines in place. */
  data: DataSet;
  /**
   * Every other {@link LineChartConfig} option (style, animation, chrome,
   * pan/zoom, …). Changing this recreates the chart — memoize it (e.g. with
   * `useMemo`) so it doesn't change identity on every render.
   */
  options?: Omit<LineChartConfig, 'data'>;
  className?: string;
  style?: CSSProperties;
  onHover?: (payload: HoverPayload) => void;
  onSeriesFocus?: (payload: SeriesFocusPayload) => void;
}

const applyData = (instance: LineChartCore, data: DataSet): void => instance.update(data);

/**
 * React binding for {@link LineChartCore}. Mount into a sized container (the
 * chart fills it); the ref exposes the underlying chart instance for
 * imperative calls (`focusSeries`, `getView`, `panBy`, …).
 */
export const LineChart = forwardRef<LineChartCore, LineChartProps>(function LineChart(
  { data, options, className, style, onHover, onSeriesFocus },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instance = useChartLifecycle(
    containerRef,
    (el) => new LineChartCore(el, { ...options, data } as LineChartConfig),
    [options],
  );

  useChartData(instance, data, applyData);

  useEffect(() => {
    if (!instance || !onHover) return;
    return instance.on('hover', onHover);
  }, [instance, onHover]);

  useEffect(() => {
    if (!instance || !onSeriesFocus) return;
    return instance.on('seriesFocus', onSeriesFocus);
  }, [instance, onSeriesFocus]);

  useImperativeHandle(ref, () => instance as LineChartCore, [instance]);

  return <div ref={containerRef} className={className} style={style} />;
});
