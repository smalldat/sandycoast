import { type CSSProperties, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type {
  ClickPayload,
  HoverPayload,
  SeriesChangePayload,
} from '../charts/candlestick/types.js';
import { CandlestickChart as CandlestickChartCore } from '../index.js';
import type { CandlestickChartConfig, OhlcDataSet, SeriesFocusPayload } from '../index.js';
import { useChartData, useChartLifecycle } from './useChartLifecycle.js';

export interface CandlestickChartProps {
  /** OHLC data; changes morph the existing candles in place. */
  data: OhlcDataSet;
  /**
   * Every other {@link CandlestickChartConfig} option (candle style,
   * animation, chrome, pan/zoom, …). Changing this recreates the chart —
   * memoize it (e.g. with `useMemo`) so it doesn't change identity on every
   * render.
   */
  options?: Omit<CandlestickChartConfig, 'data'>;
  className?: string;
  style?: CSSProperties;
  onHover?: (payload: HoverPayload) => void;
  onClick?: (payload: ClickPayload) => void;
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
    { data, options, className, style, onHover, onClick, onSeriesChange, onSeriesFocus },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const instance = useChartLifecycle(
      containerRef,
      (el) => new CandlestickChartCore(el, { ...options, data } as CandlestickChartConfig),
      [options],
    );

    useChartData(instance, data, applyData);

    useEffect(() => {
      if (!instance || !onHover) return;
      return instance.on('hover', onHover);
    }, [instance, onHover]);

    useEffect(() => {
      if (!instance || !onClick) return;
      return instance.on('click', onClick);
    }, [instance, onClick]);

    useEffect(() => {
      if (!instance || !onSeriesChange) return;
      return instance.on('seriesChange', onSeriesChange);
    }, [instance, onSeriesChange]);

    useEffect(() => {
      if (!instance || !onSeriesFocus) return;
      return instance.on('seriesFocus', onSeriesFocus);
    }, [instance, onSeriesFocus]);

    useImperativeHandle(ref, () => instance as CandlestickChartCore, [instance]);

    return <div ref={containerRef} className={className} style={style} />;
  },
);
