import { defineConfig } from 'vite';

// Config for the playground demo site (dev server + production static build).
// The library itself is built with tsup, not Vite — see tsup.config.ts.
export default defineConfig({
  root: 'playground',
  base: '/',
  // Playground imports from ../src, which lives outside the Vite root.
  server: { port: 5199, open: true, fs: { allow: ['..'] } },
  build: {
    // Emit outside the Vite root so the deployed dir is unambiguous in CI.
    outDir: '../site-dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2022',
  },
});
