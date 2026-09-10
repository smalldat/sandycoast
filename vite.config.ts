import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Config for the playground demo site (dev server + production static build).
// The library itself is built with tsup, not Vite — see tsup.config.ts.
export default defineConfig({
  root: 'playground',
  base: '/',
  // Playground imports from ../src, which lives outside the Vite root.
  server: { port: 5199, open: true, fs: { allow: ['..'] }, host: '0.0.0.0' },
  resolve: {
    alias: [
      // The React playground (playground/react/examples/*) imports the
      // package the way a real consumer would — `@smalldat/sandycoast` /
      // `@smalldat/sandycoast/react` — so its copy-pasteable code panel shows
      // genuine import paths. These aliases point that at local source
      // instead of requiring a published release to develop against. The
      // `/react` entry must come first: it's a prefix of the bare package
      // name, and alias matching resolves in array order.
      {
        find: '@smalldat/sandycoast/react',
        replacement: fileURLToPath(new URL('./src/react/index.ts', import.meta.url)),
      },
      {
        find: '@smalldat/sandycoast',
        replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      },
    ],
  },
  build: {
    // Emit outside the Vite root so the deployed dir is unambiguous in CI.
    outDir: '../site-dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
});
