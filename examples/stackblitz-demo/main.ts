import { BarChart } from '@smalldat/sandycoast';

const el = document.getElementById('chart');
if (!el) throw new Error('#chart not found');

// A single-series bar chart: each point is { x: category, y: value }.
new BarChart(el, {
  data: {
    points: [
      { x: 'Mon', y: 42 },
      { x: 'Tue', y: 61 },
      { x: 'Wed', y: 28 },
      { x: 'Thu', y: 75 },
      { x: 'Fri', y: 53 },
    ],
  },
  // Show axes + a fill/border so it reads as a chart, not just loose grains.
  axes: { x: { show: true }, y: { show: true, ticks: 5 } },
  bars: { fill: { opacity: 0.9 }, border: { width: 1 } },
  // Drag to pan, wheel to zoom.
  panZoom: { enabled: true },
});
