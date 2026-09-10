import { type CSSProperties, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { HoverPayload } from '../charts/scatter/types.js';
import { ScatterChart as ScatterChartCore } from '../index.js';
import type { MeshDataSet, ScatterChartConfig, SeriesFocusPayload } from '../index.js';
import { useChartData, useChartLifecycle } from './useChartLifecycle.js';

export interface ScatterChartProps {
  /** Chart data; changes morph the existing point cloud in place. */
  data: MeshDataSet;
  /**
   * Every other {@link ScatterChartConfig} option (marker style, animation,
   * approximation, pan/zoom, …). Changing this recreates the chart —
   * memoize it (e.g. with `useMemo`) so it doesn't change identity on every
   * render.
   */
  options?: Omit<ScatterChartConfig, 'data'>;
  className?: string;
  style?: CSSProperties;
  onHover?: (payload: HoverPayload) => void;
  onSeriesFocus?: (payload: SeriesFocusPayload) => void;
}

const applyData = (instance: ScatterChartCore, data: MeshDataSet): void => instance.update(data);

/**
 * React binding for {@link ScatterChartCore}. Mount into a sized container
 * (the chart fills it); the ref exposes the underlying chart instance for
 * imperative calls (`focusSeries`, `getView`, `panBy`, …).
 */
export const ScatterChart = forwardRef<ScatterChartCore, ScatterChartProps>(function ScatterChart(
  { data, options, className, style, onHover, onSeriesFocus },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const instance = useChartLifecycle(
    containerRef,
    (el) => new ScatterChartCore(el, { ...options, data } as ScatterChartConfig),
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

  useImperativeHandle(ref, () => instance as ScatterChartCore, [instance]);

  return <div ref={containerRef} className={className} style={style} />;
});
