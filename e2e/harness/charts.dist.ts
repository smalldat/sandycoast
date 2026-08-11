import { BarChart, LineChart, PieChart } from '../../dist/index.js';
import type { ChartKind } from '../scenarios/types.js';
import type { ChartFactory } from './charts.js';

// Static import (not dynamic): a dynamic `import()` of this same file was
// unreliable under Vite's dev server — a static import is exactly what Vite's
// import analysis rewrites to `/@fs/<abs path>` correctly and consistently,
// same as `charts.ts` importing `src/index.ts`. Only reachable via
// main.dist.ts / packaged.html, so this file is excluded from `tsc -p e2e`
// (see ../tsconfig.json) rather than requiring a build for every typecheck.
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
};
