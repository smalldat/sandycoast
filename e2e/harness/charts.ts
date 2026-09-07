import { BarChart, LineChart, PieChart, WindRoseChart } from '../../src/index.js';
import type { ChartKind, ProbeEvent } from '../scenarios/types.js';

/** The slice of a chart's API the harness needs. Every visual satisfies it. */
export interface ChartHandle {
  whenReady(): Promise<void>;
  dispose(): void;
  readonly backend: string | null;
  focusSeries?(index: number | null): void;
  getFocusedSeries?(): number | null;
}

export type ChartFactory = (
  host: HTMLElement,
  config: Record<string, unknown>,
  emit: (event: ProbeEvent) => void,
) => ChartHandle;

/**
 * Chart constructors, keyed by {@link ChartKind}. Each factory also wires that
 * chart's events into the probe — payload shapes differ per visual, so this is
 * the one place that knows about them.
 */
export const CHARTS: Record<ChartKind, ChartFactory> = {
  bar: (host, config, emit) => {
    const chart = new BarChart(host, config as never);
    chart.on('hover', (p) => emit({ type: 'hover', payload: p.bar }));
    chart.on('seriesFocus', (p) => emit({ type: 'seriesFocus', payload: p }));
    return chart;
  },
  line: (host, config, emit) => {
    const chart = new LineChart(host, config as never);
    chart.on('hover', (p) => emit({ type: 'hover', payload: p.point }));
    chart.on('seriesFocus', (p) => emit({ type: 'seriesFocus', payload: p }));
    return chart;
  },
  pie: (host, config, emit) => {
    const chart = new PieChart(host, config as never);
    chart.on('hover', (p) => emit({ type: 'hover', payload: p.slice }));
    chart.on('seriesChange', (p) => emit({ type: 'seriesChange', payload: p }));
    chart.on('seriesFocus', (p) => emit({ type: 'seriesFocus', payload: p }));
    return chart;
  },
  windrose: (host, config, emit) => {
    const chart = new WindRoseChart(host, config as never);
    chart.on('hover', (p) => emit({ type: 'hover', payload: p.segment }));
    chart.on('select', (p) => emit({ type: 'select', payload: p }));
    chart.on('highlight', (p) => emit({ type: 'highlight', payload: p }));
    return chart;
  },
};
