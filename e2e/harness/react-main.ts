import { BarChart, WindRoseChart } from '../../src/react/index.js';
import { mountReactHarness } from './react-app.js';

// `react-probe.ts`'s `declare global` augments `Window` for the whole e2e
// program (it's part of the tsconfig `include`), so no import is needed here
// to see `window.__scReact`.

// The component tree lives in `react-app.tsx`, shared with the packaged
// variant (`react-main.dist.ts`) so both run identical assertions. This entry
// only picks which module the bindings come from — here `src/react`.
const host = document.getElementById('host');
if (!host) throw new Error('harness host element missing');

mountReactHarness(host, { BarChart, WindRoseChart });
