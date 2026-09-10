import { type CSSProperties, forwardRef, useImperativeHandle, useRef } from 'react';
import type { HoverPayload, SeriesChangePayload, SliceMeta } from '../charts/pie/types.js';
import type {
  ChartElement,
  DataSet,
  PieChartConfig,
  Point,
  PointPatch,
  PointRef,
  SeriesFocusPayload,
} from '../index.js';
import { PieChart as PieChartCore } from '../index.js';
import { type ChartEventProps, subscribeCoreEvents, useChartLayers } from './coreEvents.js';
import { useChart, useLatest } from './useChartLifecycle.js';

/** Items this chart's data methods accept, as reported by the `data*` events. */
type PieItem = Point | PointPatch | PointRef;

export interface PieChartProps extends ChartEventProps<SliceMeta, PieItem> {
  /**
   * Chart data; changes morph the existing slices in place. Compared by
   * reference, so build it outside render (or memoize it) — a fresh literal
   * on every render restarts the morph.
   */
  data: DataSet;
  /**
   * Every other {@link PieChartConfig} option (style, animation, chrome,
   * slider, …). Changing this recreates the chart — memoize it (e.g. with
   * `useMemo`) so it doesn't change identity on every render.
   */
  options?: Omit<PieChartConfig, 'data'>;
  /**
   * Declarative annotations drawn on top of the chart (a threshold rule,
   * a target band, a callout). Compared by reference, so memoize it.
   * Layers added imperatively through the ref are left alone.
   */
  layers?: readonly ChartElement[];
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
  {
    data,
    options,
    layers,
    className,
    style,
    onHover,
    onSeriesChange,
    onSeriesFocus,
    onClick,
    onDblClick,
    onDrag,
    onPan,
    onZoom,
    onDrawFinished,
    onDataAdd,
    onDataUpdate,
    onDataRemove,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handlers = useLatest({
    onHover,
    onSeriesChange,
    onSeriesFocus,
    onClick,
    onDblClick,
    onDrag,
    onPan,
    onZoom,
    onDrawFinished,
    onDataAdd,
    onDataUpdate,
    onDataRemove,
  });

  const instance = useChart<PieChartCore, DataSet>({
    containerRef,
    data,
    create: (el, initialData) =>
      new PieChartCore(el, { ...options, data: initialData } as PieChartConfig),
    update: applyData,
    subscribe: (chart) => [
      chart.on('hover', (p) => handlers.current.onHover?.(p)),
      chart.on('seriesChange', (p) => handlers.current.onSeriesChange?.(p)),
      chart.on('seriesFocus', (p) => handlers.current.onSeriesFocus?.(p)),
      ...subscribeCoreEvents(chart, () => handlers.current),
    ],
    deps: [options],
  });

  useChartLayers(instance, layers);

  useImperativeHandle(ref, () => instance as PieChartCore, [instance]);

  return <div ref={containerRef} className={className} style={style} />;
});
