import {
  type CSSProperties,
  type ReactElement,
  type Ref,
  forwardRef,
  useImperativeHandle,
  useRef,
} from 'react';
import type { HighlightPayload, HoverPayload, SelectPayload } from '../charts/windrose/types.js';
import type { SegmentMeta } from '../charts/windrose/types.js';
import { WindRoseChart as WindRoseChartCore } from '../index.js';
import type { WindDataSet, WindRoseChartConfig } from '../index.js';
import type { WindPoint } from '../index.js';
import type { ChartElement } from '../index.js';
import { type ChartEventProps, subscribeCoreEvents, useChartLayers } from './coreEvents.js';
import { useChart, useLatest } from './useChartLifecycle.js';

/** Items this chart's data methods accept, as reported by the `data*` events. */
type RoseItem = WindPoint | number;

export interface WindRoseChartProps<Custom = unknown>
  extends ChartEventProps<SegmentMeta, RoseItem> {
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
  /**
   * Declarative annotations drawn on top of the chart (a threshold rule,
   * a target band, a callout). Compared by reference, so memoize it.
   * Layers added imperatively through the ref are left alone.
   */
  layers?: readonly ChartElement[];
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
  {
    data,
    options,
    layers,
    className,
    style,
    onHover,
    onSelect,
    onHighlight,
    onClick,
    onDblClick,
    onDrag,
    onPan,
    onZoom,
    onDrawFinished,
    onDataAdd,
    onDataUpdate,
    onDataRemove,
  }: WindRoseChartProps<Custom>,
  ref: Ref<WindRoseChartCore<Custom>>,
): ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const handlers = useLatest({
    onHover,
    onSelect,
    onHighlight,
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
      ...subscribeCoreEvents(chart, () => handlers.current),
    ],
    deps: [options],
  });

  useChartLayers(instance, layers);

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
