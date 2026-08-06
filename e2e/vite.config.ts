import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Dev server for the E2E harness page. Separate from the playground's config
// (vite.config.ts at the repo root) so test runs never depend on demo state:
// no nav, no persisted settings, no control panel.
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL('harness', import.meta.url)),
  // The harness imports scenarios and `src/` from outside its root.
  server: { port: 5299, strictPort: true, fs: { allow: [repoRoot] } },
});
