import { useEffect } from 'react';
import type {
  ChartClickPayload,
  ChartCoreEvents,
  ChartDataPayload,
  ChartDragPayload,
  ChartDrawPayload,
  ChartElement,
  ChartEvent,
  ChartLayer,
  ChartPanPayload,
  ChartZoomPayload,
} from '../index.js';
import type { Unsubscribe } from './useChartLifecycle.js';

/**
 * The standard events every chart exposes, as React props.
 *
 * Each handler receives the same object the vanilla `on()` listener does — the
 * payload's fields plus `preventDefault()`. Calling it suppresses the chart's
 * built-in reaction, which is worth noting because React's own synthetic
 * `onClick` does not work that way: here the veto is the point.
 *
 * `M` is the chart's mark metadata (`BarMeta`, `CandleMeta`, …), `T` the union
 * of items its data methods accept, and `C` any extra fields that chart adds to
 * its click payload (the candlestick's `candle`/`event`, for instance).
 *
 * Every handler is written `?: F | undefined` rather than `?: F`: React
 * destructuring yields `F | undefined`, and under `exactOptionalPropertyTypes`
 * the shorter form would reject exactly that.
 */
export interface ChartCoreEventProps<M = unknown, T = unknown, C = unknown> {
  /** A mark (or the background) was clicked. Cancel to suppress the built-in reaction. */
  onClick?: ((e: ChartEvent<ChartClickPayload<M> & C>) => void) | undefined;
  onDblClick?: ((e: ChartEvent<ChartClickPayload<M>>) => void) | undefined;
  /** A press-move-release gesture; cancel the `'start'` phase to abandon it. */
  onDrag?: ((e: ChartEvent<ChartDragPayload>) => void) | undefined;
  /** The view is about to translate. Only fires on charts with pan/zoom enabled. */
  onPan?: ((e: ChartEvent<ChartPanPayload>) => void) | undefined;
  /** The view is about to scale. Only fires on charts with pan/zoom enabled. */
  onZoom?: ((e: ChartEvent<ChartZoomPayload>) => void) | undefined;
  /**
   * A mutation is *about to* apply — cancel to reject it. `onDataUpdate` covers
   * both a patch list and a whole-dataset replacement; `action` says which.
   */
  onDataAdd?: ((e: ChartEvent<ChartDataPayload<T>>) => void) | undefined;
  onDataUpdate?: ((e: ChartEvent<ChartDataPayload<T>>) => void) | undefined;
  onDataRemove?: ((e: ChartEvent<ChartDataPayload<T>>) => void) | undefined;
}

/**
 * Per-frame draw notification, kept out of {@link ChartCoreEventProps}
 * deliberately: it fires on every animation frame, so a handler that calls
 * `setState` will re-render ~60 times a second. Opt in only when you need it,
 * and keep the handler free of React state updates — a ref is the right sink.
 */
export interface ChartDrawEventProps {
  onDrawFinished?: ((e: ChartEvent<ChartDrawPayload>) => void) | undefined;
}

/** Everything a chart component accepts for the standard event surface. */
export interface ChartEventProps<M = unknown, T = unknown, C = unknown>
  extends ChartCoreEventProps<M, T, C>,
    ChartDrawEventProps {}

/**
 * The slice of a chart instance this bridge needs. Every chart satisfies it —
 * `click` is called out separately so a chart that enriches that payload
 * (candlestick) is described by `C` rather than forced through a cast.
 */
export interface CoreEventSource<M, T, C = unknown> {
  on(type: 'click', fn: (e: ChartEvent<ChartClickPayload<M> & C>) => void): Unsubscribe;
  on<K extends Exclude<keyof ChartCoreEvents<M, T>, 'click'> & string>(
    type: K,
    fn: (e: ChartEvent<ChartCoreEvents<M, T>[K]>) => void,
  ): Unsubscribe;
}

/**
 * Wire the standard events to their props, returning the unsubscribes for
 * `useChart`'s `subscribe`.
 *
 * `latest` is read at dispatch time rather than captured, so a component can
 * pass fresh handlers every render without re-registering anything — the same
 * contract `subscribe` documents.
 */
export function subscribeCoreEvents<M, T, C = unknown>(
  chart: CoreEventSource<M, T, C>,
  latest: () => ChartEventProps<M, T, C>,
): Unsubscribe[] {
  return [
    chart.on('click', (e) => latest().onClick?.(e)),
    chart.on('dblclick', (e) => latest().onDblClick?.(e)),
    chart.on('drag', (e) => latest().onDrag?.(e)),
    chart.on('pan', (e) => latest().onPan?.(e)),
    chart.on('zoom', (e) => latest().onZoom?.(e)),
    chart.on('drawFinished', (e) => latest().onDrawFinished?.(e)),
    chart.on('dataAdd', (e) => latest().onDataAdd?.(e)),
    chart.on('dataUpdate', (e) => latest().onDataUpdate?.(e)),
    chart.on('dataRemove', (e) => latest().onDataRemove?.(e)),
  ];
}

/** The slice of a chart instance {@link useChartLayers} needs. */
export interface LayerHost {
  addElement(element: ChartElement): ChartLayer;
}

/**
 * Keep a chart's declarative annotations in sync with the `layers` prop.
 *
 * Only the elements this hook added are removed on a change, so layers added
 * imperatively through the ref (`chart.addLayer(…)`) survive untouched.
 * Compared by reference like `data`, so build the array outside render or
 * memoize it — a fresh literal every render re-adds every element.
 */
export function useChartLayers(
  instance: LayerHost | null,
  layers: readonly ChartElement[] | undefined,
): void {
  useEffect(() => {
    if (!instance || !layers?.length) return;
    const added = layers.map((el) => instance.addElement(el));
    return () => {
      for (const layer of added) layer.remove();
    };
  }, [instance, layers]);
}
