# Plan 04 — Playground: Persist Control Settings to localStorage

Status: **AS-BUILT**
Package: `@smalldat/sandycoast`
Depends on: Plan 03-demo (component nav & live controls)

> The control panel edits a per-component `cfg` object that was rebuilt from
> `defaultConfig()` on every mount, so a page reload (or nav away and back) threw
> away everything the user tuned. This adds **localStorage persistence**: edits
> are saved as you make them and reloaded on mount, with a **Reset settings**
> action to wipe back to defaults. Dev-only — nothing ships in `dist/`.

---

## 1. Goals

1. **Survive reload** — control values persist across page reloads and
   component switches, per component.
2. **Forward-safe** — a saved blob is a *partial* config deep-merged onto the
   live `defaultConfig()`, so config fields added later still get their default
   for anyone holding an older blob.
3. **Escape hatch** — a **Reset settings** button clears storage, restores
   defaults, and re-renders the panel.
4. **Never break the demo** — storage errors (private mode, quota, corrupt
   JSON) fall back silently to defaults.

Non-goal: no library source changes. Persistence lives entirely in
`playground/`; `BarChartConfig` is untouched.

---

## 2. Storage model

One JSON blob per component `id`, under a **versioned** key:

```
smalldat:playground:<id>:v<VERSION>       e.g. smalldat:playground:bar:v1
```

- The blob is the **full current `cfg`** (written on every edit) but treated as
  a **partial** on read — deep-merged onto `defaultConfig()`.
- Bumping `VERSION` (in `persist.ts`) orphans old blobs, i.e. a clean reset for
  everyone after a breaking config-shape change.

### Deep-merge rules (`deepMerge`)

- Plain objects merge **recursively** (`axes.y.ticks` overrides without dropping
  `axes.x`).
- Arrays and primitives are **replaced wholesale** — `colors` (colorlist) and
  `interaction.hover.effects` (checkgroup) are `string[]`; a saved array wins
  entirely rather than element-merging.
- Pure function: neither `base` nor `patch` is mutated.

---

## 3. Files

| File | Change |
| --- | --- |
| `playground/persist.ts` | **New.** `loadSettings` / `saveSettings` / `clearSettings` + `deepMerge`, all try/catch-guarded. |
| `playground/barchart.demo.ts` | Load-on-mount, save-on-edit, **Reset settings** toolbar button, `renderPanel()` helper. |

### `persist.ts` API

```ts
loadSettings<T>(id: string, defaults: T): T   // defaults ⊕ saved-partial
saveSettings(id: string, cfg: Cfg): void      // write full cfg
clearSettings(id: string): void               // remove blob
deepMerge<T>(base: T, patch: Cfg): T           // exported for reuse/testing
```

All storage access is wrapped in `try/catch`; every failure path returns
`defaults` (load) or no-ops (save/clear).

---

## 4. Wiring (`barchart.demo.ts`)

```
mount():   cfg = loadSettings(id, defaultConfig())   // was: defaultConfig()
           renderPanel(); build()

renderPanel():  renderControls(panel, cfg, GROUPS, onChange)
                onChange = () => { saveSettings(id, cfg); rebuild() }

Reset btn: clearSettings(id); cfg = defaultConfig(); renderPanel(); rebuild()
```

- `renderPanel()` is extracted so **Reset** can rebind the inputs to the fresh
  `cfg` (control DOM reads initial values at build time, so it must be
  regenerated after `cfg` is swapped).
- `data` is **not** persisted — Re-pour / Random data stay ephemeral; only
  construct-time config is saved.
- Save piggybacks on the existing per-edit `onChange`; writes are cheap and
  synchronous, matching the "rebuild is cheap here" model from Plan 03.

---

## 5. Notes / gotchas

- **`cfg` is the source of truth for the save** — `renderControls` mutates `cfg`
  in place, so on `onChange` the object already holds the new value; we persist
  `cfg` directly (no diffing).
- **Reset must re-render the panel**, not just `rebuild()` — otherwise the inputs
  still show the old values while the chart uses defaults.
- **Version key over migrations** — for a dev tool, discarding stale blobs on a
  `VERSION` bump is simpler and safer than writing per-field migrations.

---

## 6. Verification (as-built)

- `npm run typecheck` — clean (playground is in `tsconfig` include).
- `npm run lint` — clean (Biome).
- Runtime: `npm run dev`, edit a control, reload → values persist; **Reset
  settings** → back to defaults and storage key gone (DevTools ▸ Application ▸
  Local Storage). Not driven headless.
