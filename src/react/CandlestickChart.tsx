import { type CSSProperties, forwardRef, useImperativeHandle, useRef } from 'react';
import type {
  ClickPayload,
  HoverPayload,
  SeriesChangePayload,
} from '../charts/candlestick/types.js';
import type { CandleMeta } from '../charts/candlestick/types.js';
import { CandlestickChart as CandlestickChartCore } from '../index.js';
import type { CandlestickChartConfig, OhlcDataSet, SeriesFocusPayload } from '../index.js';
import type { Candle, CandlePatch, CandleRef } from '../index.js';
import type { ChartElement } from '../index.js';
import type { ChartClickPayload, ChartEvent } from '../index.js';
import { type ChartEventProps, subscribeCoreEvents, useChartLayers } from './coreEvents.js';
import { useChart, useLatest } from './useChartLifecycle.js';

/** Items this chart's data methods accept, as reported by the `data*` events. */
type CandleItem = Candle | CandlePatch | CandleRef;

export interface CandlestickChartProps
  extends ChartEventProps<CandleMeta, CandleItem, ClickPayload> {
  /**
   * OHLC data; changes morph the existing candles in place. Compared by
   * reference, so build it outside render (or memoize it) — a fresh literal
   * on every render restarts the morph.
   */
  data: OhlcDataSet;
  /**
   * Every other {@link CandlestickChartConfig} option (candle style,
   * animation, chrome, pan/zoom, …). Changing this recreates the chart —
   * memoize it (e.g. with `useMemo`) so it doesn't change identity on every
   * render.
   */
  options?: Omit<CandlestickChartConfig, 'data'>;
  /**
   * Declarative annotations drawn on top of the chart (a threshold rule,
   * a target band, a callout). Compared by reference, so memoize it.
   * Layers added imperatively through the ref are left alone.
   */
  layers?: readonly ChartElement[];
  className?: string;
  style?: CSSProperties;
  onHover?: (payload: HoverPayload) => void;
  /** Fires when the series slider moves to a different instrument. */
  onSeriesChange?: (payload: SeriesChangePayload) => void;
  onSeriesFocus?: (payload: SeriesFocusPayload) => void;
}

const applyData = (instance: CandlestickChartCore, data: OhlcDataSet): void =>
  instance.update(data);

/**
 * React binding for {@link CandlestickChartCore}. Mount into a sized
 * container (the chart fills it); the ref exposes the underlying chart
 * instance for imperative calls (`focusSeries`, `getView`, `panBy`, …).
 */
export const CandlestickChart = forwardRef<CandlestickChartCore, CandlestickChartProps>(
  function CandlestickChart(
    {
      data,
      options,
      layers,
      className,
      style,
      onHover,
      onClick,
      onSeriesChange,
      onSeriesFocus,
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
      onClick,
      onSeriesChange,
      onSeriesFocus,
      onDblClick,
      onDrag,
      onPan,
      onZoom,
      onDrawFinished,
      onDataAdd,
      onDataUpdate,
      onDataRemove,
    });

    const instance = useChart<CandlestickChartCore, OhlcDataSet>({
      containerRef,
      data,
      create: (el, initialData) =>
        new CandlestickChartCore(el, { ...options, data: initialData } as CandlestickChartConfig),
      update: applyData,
      subscribe: (chart) => [
        chart.on('hover', (p) => handlers.current.onHover?.(p)),
        chart.on('seriesChange', (p) => handlers.current.onSeriesChange?.(p)),
        chart.on('seriesFocus', (p) => handlers.current.onSeriesFocus?.(p)),
        // `ClickPayload` is this chart's extension of the standard click
        // payload — the bridge's third type argument, not a cast.
        ...subscribeCoreEvents<CandleMeta, CandleItem, ClickPayload>(chart, () => handlers.current),
      ],
      deps: [options],
    });

    useChartLayers(instance, layers);

    useImperativeHandle(ref, () => instance as CandlestickChartCore, [instance]);

    return <div ref={containerRef} className={className} style={style} />;
  },
);
