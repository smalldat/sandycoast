# SandyCoast — Hello World (StackBlitz)

Minimal Vite + TypeScript project that pours a single-series sand bar chart with
[`@smalldat/sandycoast`](https://www.npmjs.com/package/@smalldat/sandycoast).

## Open online (StackBlitz)

Once this repo is on GitHub, open the folder directly — no local install:

https://stackblitz.com/github/smalldat/sandycoast/tree/main/examples/stackblitz-demo

StackBlitz runs Vite in-browser (WebContainers) and installs
`@smalldat/sandycoast` from npm automatically.

## Run locally

```bash
npm install
npm run dev
```

Open the printed URL.

## Files

- `main.ts` — creates the `BarChart` and its data
- `index.html` — the `#chart` mount point
- `package.json` / `tsconfig.json` — Vite + TS setup

> ⚠️ SandyCoast prefers WebGPU (falls back to Canvas2D). For the WebGPU path use
> a Chromium browser (Chrome/Edge); Safari support is spotty.
