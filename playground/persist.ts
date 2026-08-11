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

/**
 * Rewrite colour-valued fields of the saved config for `id` through `map`.
 * Only `background` and `color` keys are considered, and only when their
 * current value is a key of `map` — so palette colours migrate on a theme
 * switch while anything the user picked by hand is preserved. No-ops when
 * nothing is saved for `id`.
 */
export function remapSavedColors(id: string, map: Record<string, string>): void {
  try {
    const raw = localStorage.getItem(keyFor(id));
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) return;
    localStorage.setItem(keyFor(id), JSON.stringify(remapColors(parsed, map)));
  } catch {
    // ignore
  }
}

const COLOR_KEYS = new Set(['background', 'color']);

function remapColors(node: Cfg, map: Record<string, string>): Cfg {
  const out: Cfg = {};
  for (const [k, v] of Object.entries(node)) {
    if (isPlainObject(v)) out[k] = remapColors(v, map);
    else if (typeof v === 'string' && COLOR_KEYS.has(k)) out[k] = map[v] ?? v;
    else out[k] = v;
  }
  return out;
}

const ACTIVE_KEY = `smalldat:playground:active:v${VERSION}`;
const CHROME_KEY = `smalldat:playground:chrome:v${VERSION}`;

/** Playground chrome preferences — not part of any component's config. */
export interface Chrome {
  theme: 'dark' | 'light';
  layout: 'tb' | 'lr';
  /**
   * Whether the user has ever clicked the layout toggle. Until they do, each
   * demo opens in its own `preferredLayout` instead of this saved `layout`
   * value — see `chrome.ts`'s `applyLayoutForDemo`.
   */
  layoutTouched: boolean;
  /** User-dragged chart size in px, shared by every demo. `null` = auto. */
  chartW: number | null;
  chartH: number | null;
}

export const DEFAULT_CHROME: Chrome = {
  theme: 'dark',
  layout: 'tb',
  layoutTouched: false,
  chartW: null,
  chartH: null,
};

function finitePx(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : null;
}

/** Read the saved chrome preferences, falling back per-field to the defaults. */
export function loadChrome(): Chrome {
  try {
    const raw = localStorage.getItem(CHROME_KEY);
    if (!raw) return { ...DEFAULT_CHROME };
    const parsed: unknown = JSON.parse(raw);
    if (!isPlainObject(parsed)) return { ...DEFAULT_CHROME };
    return {
      theme: parsed.theme === 'light' ? 'light' : 'dark',
      layout: parsed.layout === 'lr' ? 'lr' : 'tb',
      layoutTouched: parsed.layoutTouched === true,
      chartW: finitePx(parsed.chartW),
      chartH: finitePx(parsed.chartH),
    };
  } catch {
    return { ...DEFAULT_CHROME };
  }
}

/** Persist the chrome preferences. Silently no-ops if storage is unavailable. */
export function saveChrome(chrome: Chrome): void {
  try {
    localStorage.setItem(CHROME_KEY, JSON.stringify(chrome));
  } catch {
    // ignore
  }
}

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
