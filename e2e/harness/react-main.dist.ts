import { BarChart, WindRoseChart } from '../../dist/react.js';
import { mountReactHarness } from './react-app.js';

// Same harness app as `react-main.ts`, against `dist/react.js` instead of
// `src/react/index.ts` — the built `exports` map and tsup output. Requires
// `npm run build` first (see harness/charts.dist.ts for the same convention
// on the non-React entries). Only reachable via react-packaged.html, so
// excluded from `tsc -p e2e` (../tsconfig.json).
const host = document.getElementById('host');
if (!host) throw new Error('harness host element missing');

mountReactHarness(host, { BarChart, WindRoseChart });
