import {
  type CSSProperties,
  type ReactElement,
  type Ref,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import type { HighlightPayload, HoverPayload, SelectPayload } from '../charts/windrose/types.js';
import { WindRoseChart as WindRoseChartCore } from '../index.js';
import type { WindDataSet, WindRoseChartConfig } from '../index.js';
import { useChartData, useChartLifecycle } from './useChartLifecycle.js';

export interface WindRoseChartProps<Custom = unknown> {
  /** Wind observations; changes re-bin and morph the existing petals in place. */
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
  const instance = useChartLifecycle(
    containerRef,
    (el) => new WindRoseChartCore<Custom>(el, { ...options, data } as WindRoseChartConfig<Custom>),
    [options],
  );

  useChartData(instance, data, applyData);

  useEffect(() => {
    if (!instance || !onHover) return;
    return instance.on('hover', onHover);
  }, [instance, onHover]);

  useEffect(() => {
    if (!instance || !onSelect) return;
    return instance.on('select', onSelect);
  }, [instance, onSelect]);

  useEffect(() => {
    if (!instance || !onHighlight) return;
    return instance.on('highlight', onHighlight);
  }, [instance, onHighlight]);

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
