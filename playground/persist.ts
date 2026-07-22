// Persist playground control settings to localStorage so a page reload keeps
// whatever the user tuned. Dev-only — nothing here ships in `dist/`.
//
// Storage model: one JSON blob per component id under a versioned key. The saved
// blob is a *partial* config that is deep-merged onto the component's live
// `defaultConfig()` at load time, so adding a new config field later still picks
// up its default for anyone with an older blob (and bumping `VERSION` discards
// blobs whose shape we no longer trust).

const VERSION = 1;
const keyFor = (id: string): string => `smalldat:playground:${id}:v${VERSION}`;

type Cfg = Record<string, unknown>;

function isPlainObject(v: unknown): v is Cfg {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Deep-merge `patch` onto `base`, returning a new object. Plain objects merge
 * recursively; everything else (arrays like `colors`/`effects`, primitives) is
 * replaced wholesale by the patch value. `base` and `patch` are not mutated.
 */
export function deepMerge<T extends Cfg>(base: T, patch: Cfg): T {
  const out: Cfg = { ...base };
  for (const [k, pv] of Object.entries(patch)) {
    const bv = out[k];
    out[k] = isPlainObject(bv) && isPlainObject(pv) ? deepMerge(bv, pv) : pv;
  }
  return out as T;
}

/** Read the saved config for `id`, deep-merged onto `defaults`. */
export function loadSettings<T extends Cfg>(id: string, defaults: T): T {
  try {
    const raw = localStorage.getItem(keyFor(id));
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    return isPlainObject(parsed) ? deepMerge(defaults, parsed) : defaults;
  } catch {
    // Storage disabled (private mode), quota, or corrupt JSON — fall back clean.
    return defaults;
  }
}

/** Persist the full `cfg` for `id`. Silently no-ops if storage is unavailable. */
export function saveSettings(id: string, cfg: Cfg): void {
  try {
    localStorage.setItem(keyFor(id), JSON.stringify(cfg));
  } catch {
    // ignore
  }
}

/** Drop the saved config for `id` (used by the Reset control). */
export function clearSettings(id: string): void {
  try {
    localStorage.removeItem(keyFor(id));
  } catch {
    // ignore
  }
}

const ACTIVE_KEY = `smalldat:playground:active:v${VERSION}`;

/** Remember which demo component was last shown. */
export function saveActive(id: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    // ignore
  }
}

/** Read the last-shown demo component id, or null if none/unavailable. */
export function loadActive(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}
