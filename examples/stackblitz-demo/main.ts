import { BarChart, type Point } from '@smalldat/sandycoast';

const el = document.getElementById('chart');
if (!el) throw new Error('#chart not found');

// Three series: each point carries a `z` series key (Alpha / Beta / Gamma).
const points: Point[] = [];
for (const x of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) {
  points.push({ x, y: 20 + Math.round(Math.random() * 60), z: 'Alpha' });
  points.push({ x, y: 20 + Math.round(Math.random() * 60), z: 'Beta' });
  points.push({ x, y: 20 + Math.round(Math.random() * 60), z: 'Gamma' });
}

new BarChart(el, {
  data: { points },
  colors: ['#4f9dff', '#ff7a59', '#3ddc84'],

  // Axes + legend so the three series read clearly.
  axes: { x: { show: true }, y: { show: true, ticks: 5 } },
  legend: { show: true, position: 'bottom' },

  // Solid bar, but keep grains partly visible (grainsTo > 0) so the hover
  // jitter has something to move — with grainsTo: 0 the sand vanishes after
  // the pour and the hover animation would be invisible.
  bars: {
    fill: { opacity: 0.85 },
    border: { width: 1 },
    reveal: { start: 'afterPour', duration: 500, ease: 'easeOutCubic', grainsTo: 0.55 },
  },

  // Explicit pour + morph animation timing.
  animation: {
    duration: 900,
    ease: 'easeOutCubic',
    stagger: 500,
    morphDuration: 1400,
    reflow: 'translate',
    enter: 'pour',
    exit: 'fall',
  },

  // Hover: strong, clearly visible grain motion — big jitter amplitude, a
  // highlight boost, and an opacity lift, all eased over fadeMs.
  interaction: {
    hover: {
      effects: ['jitter', 'highlight', 'opacity'],
      jitterAmp: 0.035,
      highlightGain: 2.2,
      opacity: 1,
      fadeMs: 220,
    },
  },

  // Drag to pan, wheel to zoom.
  panZoom: { enabled: true },
});
