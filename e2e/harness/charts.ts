import { BarChart, LineChart } from '../../src/index.js';
import type { ChartKind, ProbeEvent } from '../scenarios/types.js';

/** The slice of a chart's API the harness needs. Every visual satisfies it. */
export interface ChartHandle {
  whenReady(): Promise<void>;
  dispose(): void;
  readonly backend: string | null;
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
    return chart;
  },
  line: (host, config, emit) => {
    const chart = new LineChart(host, config as never);
    chart.on('hover', (p) => emit({ type: 'hover', payload: p.point }));
    return chart;
  },
  pie: () => {
    throw new Error('pie scenarios not wired yet');
  },
};
