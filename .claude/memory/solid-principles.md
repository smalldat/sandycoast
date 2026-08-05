---
name: solid-principles
description: SOLID principles are mandatory for all code in the sandycoast project
metadata:
  type: feedback
---

All code written for sandycoast must follow SOLID. Concretely, in this codebase:

- **SRP** — one module, one job: layout (geometry), packing (grains), style resolution, overlay drawing, and the chart orchestrator stay in separate files, as `src/charts/bar/` already splits them.
- **OCP** — new chart kinds are added as new folders under `src/charts/`, not by branching inside an existing chart.
- **LSP** — every chart honours the same lifecycle contract (`whenReady` / `update` / `add` / `remove` / `repour` / `getData` / `dispose`), and shared interfaces like `Renderer` and `PanZoomable` are implemented without narrowing their meaning.
- **ISP** — config surfaces are per-concern blocks (`legend`, `title`, `slider`, `axes`), and helpers take the minimal shape they need (e.g. `ChromeInput`) rather than a whole chart config.
- **DIP** — charts depend on abstractions in `src/core/` (renderer, scales, chrome, particles), never on a concrete sibling chart. See [[component-isolation]].

**Why:** the library ships multiple interchangeable chart components; without these boundaries each new chart bloats the previous one.

**How to apply:** before adding code to an existing file, ask which of the five it belongs to; if it is a new responsibility, it gets its own module — and if two charts need it, it goes to `src/core/`.
