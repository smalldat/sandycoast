import { type CSSProperties, forwardRef, useImperativeHandle, useRef } from 'react';
import type { HoverPayload, LineMeta } from '../charts/line/types.js';
import type {
  ChartElement,
  DataSet,
  LineChartConfig,
  Point,
  PointPatch,
  PointRef,
  SeriesFocusPayload,
} from '../index.js';
import { LineChart as LineChartCore } from '../index.js';
import { type ChartEventProps, subscribeCoreEvents, useChartLayers } from './coreEvents.js';
import { useChart, useLatest } from './useChartLifecycle.js';

/** Items this chart's data methods accept, as reported by the `data*` events. */
type LineItem = Point | PointPatch | PointRef;

export interface LineChartProps extends ChartEventProps<LineMeta, LineItem> {
  /**
   * Chart data; changes morph the existing lines in place. Compared by
   * reference, so build it outside render (or memoize it) — a fresh literal
   * on every render restarts the morph.
   */
  data: DataSet;
  /**
   * Every other {@link LineChartConfig} option (style, animation, chrome,
   * pan/zoom, …). Changing this recreates the chart — memoize it (e.g. with
   * `useMemo`) so it doesn't change identity on every render.
   */
  options?: Omit<LineChartConfig, 'data'>;
  /**
   * Declarative annotations drawn on top of the chart (a threshold rule,
   * a target band, a callout). Compared by reference, so memoize it.
   * Layers added imperatively through the ref are left alone.
   */
  layers?: readonly ChartElement[];
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
  {
    data,
    options,
    layers,
    className,
    style,
    onHover,
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

  const instance = useChart<LineChartCore, DataSet>({
    containerRef,
    data,
    create: (el, initialData) =>
      new LineChartCore(el, { ...options, data: initialData } as LineChartConfig),
    update: applyData,
    subscribe: (chart) => [
      chart.on('hover', (p) => handlers.current.onHover?.(p)),
      chart.on('seriesFocus', (p) => handlers.current.onSeriesFocus?.(p)),
      ...subscribeCoreEvents(chart, () => handlers.current),
    ],
    deps: [options],
  });

  useChartLayers(instance, layers);

  useImperativeHandle(ref, () => instance as LineChartCore, [instance]);

  return <div ref={containerRef} className={className} style={style} />;
});
