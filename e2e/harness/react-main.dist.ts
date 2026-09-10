import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { BarChart } from '../../dist/react.js';

// Same smoke test as `react-main.ts`, against `dist/react.js` instead of
// `src/react/index.ts` — the built `exports` map and tsup output. Requires
// `npm run build` first (see harness/charts.dist.ts for the same convention
// on the non-React entries). Only reachable via react-main.dist.html /
// react-packaged.html, so excluded from `tsc -p e2e` (../tsconfig.json).
const data = {
  points: [
    { x: 'Q1', y: 10, z: 'A' },
    { x: 'Q1', y: 20, z: 'B' },
    { x: 'Q2', y: 15, z: 'A' },
    { x: 'Q2', y: 25, z: 'B' },
  ],
};

const host = document.getElementById('host');
if (!host) throw new Error('harness host element missing');

createRoot(host).render(
  createElement(BarChart, {
    data,
    options: { backend: 'canvas2d' },
    ref: (instance) => {
      if (!instance) return;
      instance.whenReady().then(() => {
        window.__scReact = { ready: true, backend: instance.backend };
      });
    },
  }),
);
