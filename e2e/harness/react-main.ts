import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { BarChart } from '../../src/react/index.js';

// `react-probe.ts`'s `declare global` augments `Window` for the whole e2e
// program (it's part of the tsconfig `include`), so no import is needed here
// to see `window.__scReact`.

// Smoke test only: confirms `@smalldat/sandycoast/react` actually resolves
// and mounts a working chart — not a scenario/probe replica of `boot.ts`.
// `backend: 'canvas2d'` pins it deterministic, same as every other harness
// entry. See `react-main.dist.ts` for the packaged (dist/react.js) variant.
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
