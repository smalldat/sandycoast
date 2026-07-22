import { defineConfig } from 'vite';

// Dev-only config for the playground. Library build uses tsup, not Vite.
export default defineConfig({
  root: 'playground',
  // Playground imports from ../src, which lives outside the Vite root.
  server: { port: 5199, open: true, fs: { allow: ['..'] } },
});
