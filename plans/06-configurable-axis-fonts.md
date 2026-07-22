# Plan 06 — Configurable Axis Fonts & Y-Title Direction

Status: **AS-BUILT**
Package: `@smalldat/visual`
Depends on: Plan 02 (axes/legend/current-value chrome)

> Makes axis tick + title typography configurable per axis (family, weight —
> size `fontPx` already existed), and adds a **reading-direction** option for the
> rotated Y-axis title. All fields optional; defaults reproduce prior output
> (backward compatible).

---

## 1. Goals

1. **Per-axis font family** — `fontFamily` CSS stack for ticks + title.
2. **Per-axis font weight** — `fontWeight` (`'bold'`, `600`, …).
3. **Y-title direction** — `titleDirection: 'up' | 'down'`; `up` reads
   bottom-to-top (prior behavior), `down` reads top-to-bottom. Ignored on X.

Defaults: family `'system-ui, sans-serif'`, weight `'normal'`, direction `'up'`
→ identical to pre-change rendering.

Out of scope: legend font ([legend.ts:33](../src/charts/bar/legend.ts#L33)) and
current-value readout ([overlay.ts:300](../src/charts/bar/overlay.ts#L300)) —
neither is an axis; left hardcoded.

---

## 2. Changes

| File | Change |
|------|--------|
| `types.ts` `AxisConfig` | + `fontFamily?`, `fontWeight?`, `titleDirection?` (Y-only) |
| `chrome.ts` `ResolvedAxis` | + same 3 fields (non-optional) |
| `chrome.ts` `resolveAxis` | defaults: `'system-ui, sans-serif'` / `'normal'` / `'up'` |
| `overlay.ts` | `axisFont(cfg, dpr)` helper `${weight} ${px}px ${family}`; used for X+Y ticks. Y title rotates `-90°` (`up`) or `+90°` (`down`) |
| `axis.test.ts` | test `axis()` helper carries the 3 new resolved defaults |

`axisMargins` unchanged — still keys off `fontPx` only (weight/family do not
shift the coarse gutter estimate materially).

---

## 3. Verification

- `npm run typecheck` — clean.
- `npm run test` — 55/55 pass (axis.test resolved-defaults updated).

---

## 4. Config example

```ts
axes: {
  y: {
    show: true,
    fontFamily: 'Georgia, serif',
    fontWeight: 600,
    titleDirection: 'down',
    label: 'Revenue',
  },
  x: { show: true, fontFamily: 'monospace' },
}
```
