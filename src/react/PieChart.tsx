import { type CSSProperties, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { HoverPayload, SeriesChangePayload } from '../charts/pie/types.js';
import { PieChart as PieChartCore } from '../index.js';
import type { DataSet, PieChartConfig, SeriesFocusPayload } from '../index.js';
import { useChartData, useChartLifecycle } from './useChartLifecycle.js';

export interface PieChartProps {
  /** Chart data; changes morph the existing slices in place. */
  data: DataSet;
  /**
   * Every other {@link PieChartConfig} option (style, animation, chrome,
   * slider, …). Changing this recreates the chart — memoize it (e.g. with
   * `useMemo`) so it doesn't change identity on every render.
   */
  options?: Omit<PieChartConfig, 'data'>;
  className?: string;
  style?: CSSProperties;
  onHover?: (payload: HoverPayload) => void;
  /** Fires when the series slider moves to a different series. */
  onSeriesChange?: (payload: SeriesChangePayload) => void;
  onSeriesFocus?: (payload: SeriesFocusPayload) => void;
}

const applyData = (instance: PieChartCore, data: DataSet): void => instance.update(data);

/**
 * React binding for {@link PieChartCore}. Mount into a sized container (the
 * chart fills it); the ref exposes the underlying chart instance for
 * imperative calls (`focusSeries`, …).
 */
export const PieChart = forwardRef<PieChartCore, PieChartProps>(function PieChart(
  { data, options, className, style, onHover, onSeriesChange, onSeriesFocus },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instance = useChartLifecycle(
    containerRef,
    (el) => new PieChartCore(el, { ...options, data } as PieChartConfig),
    [options],
  );

  useChartData(instance, data, applyData);

  useEffect(() => {
    if (!instance || !onHover) return;
    return instance.on('hover', onHover);
  }, [instance, onHover]);

  useEffect(() => {
    if (!instance || !onSeriesChange) return;
    return instance.on('seriesChange', onSeriesChange);
  }, [instance, onSeriesChange]);

  useEffect(() => {
    if (!instance || !onSeriesFocus) return;
    return instance.on('seriesFocus', onSeriesFocus);
  }, [instance, onSeriesFocus]);

  useImperativeHandle(ref, () => instance as PieChartCore, [instance]);

  return <div ref={containerRef} className={className} style={style} />;
});
