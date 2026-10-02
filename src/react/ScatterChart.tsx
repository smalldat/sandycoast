import { type CSSProperties, forwardRef, useImperativeHandle, useRef } from 'react';
import type { HoverPayload, ScatterMeta } from '../charts/scatter/types.js';
import type {
  ChartElement,
  MeshDataSet,
  MeshPoint,
  ScatterChartConfig,
  SeriesFocusPayload,
} from '../index.js';
import { ScatterChart as ScatterChartCore } from '../index.js';
import { type ChartEventProps, subscribeCoreEvents, useChartLayers } from './coreEvents.js';
import { useChart, useLatest } from './useChartLifecycle.js';

/** Items this chart's data methods accept, as reported by the `data*` events. */
type ScatterItem = MeshPoint | number;

export interface ScatterChartProps extends ChartEventProps<ScatterMeta, ScatterItem> {
  /**
   * Chart data; changes morph the existing point cloud in place. Compared by
   * reference, so build it outside render (or memoize it) — a fresh literal
   * on every render restarts the morph.
   */
  data: MeshDataSet;
  /**
   * Every other {@link ScatterChartConfig} option (marker style, animation,
   * approximation, pan/zoom, …). Changing this recreates the chart —
   * memoize it (e.g. with `useMemo`) so it doesn't change identity on every
   * render.
   */
  options?: Omit<ScatterChartConfig, 'data'>;
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

const applyData = (instance: ScatterChartCore, data: MeshDataSet): void => instance.update(data);

/**
 * React binding for {@link ScatterChartCore}. Mount into a sized container
 * (the chart fills it); the ref exposes the underlying chart instance for
 * imperative calls (`focusSeries`, `getView`, `panBy`, …).
 */
export const ScatterChart = forwardRef<ScatterChartCore, ScatterChartProps>(function ScatterChart(
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

  const instance = useChart<ScatterChartCore, MeshDataSet>({
    containerRef,
    data,
    create: (el, initialData) =>
      new ScatterChartCore(el, { ...options, data: initialData } as ScatterChartConfig),
    update: applyData,
    subscribe: (chart) => [
      chart.on('hover', (p) => handlers.current.onHover?.(p)),
      chart.on('seriesFocus', (p) => handlers.current.onSeriesFocus?.(p)),
      ...subscribeCoreEvents(chart, () => handlers.current),
    ],
    deps: [options],
  });

  useChartLayers(instance, layers);

  useImperativeHandle(ref, () => instance as ScatterChartCore, [instance]);

  return <div ref={containerRef} className={className} style={style} />;
});
