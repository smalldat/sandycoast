// Playground chrome: the theme (light/dark) and layout (top-bottom /
// left-right) switches in the header, plus the drag-to-resize chart box.
//
// Layout is pure presentation — it sets `data-layout` on <html> and lets the
// stylesheet do the rest; charts observe their container with a ResizeObserver,
// so a layout change resizes them for free. Theme also flips `data-theme`, but
// a chart paints from its *config*, so the host has to migrate chart colours
// too — that is what `onThemeChange` is for (see theme.ts).

import { type Chrome, loadChrome, saveChrome } from './persist.js';
import type { ThemeName } from './theme.js';

const root = document.documentElement;

const chrome: Chrome = loadChrome();

function apply(): void {
  root.dataset.theme = chrome.theme;
  root.dataset.layout = chrome.layout;
}

// Applied as early as the module is imported so the page never paints in the
// wrong theme.
apply();

/**
 * A segmented two-option switch. `onPick` fires only when the value actually
 * changes (i.e. from a click, not from `setValue`). Returns the element plus
 * `setValue`, so a caller can sync the visible selection to a value that
 * changed for some other reason (here: switching to a demo with a different
 * `preferredLayout`).
 */
function segmented<T extends string>(
  title: string,
  options: { value: T; label: string; title: string }[],
  initial: T,
  onPick: (value: T) => void,
): { el: HTMLElement; setValue: (value: T) => void } {
  let current = initial;
  const wrap = document.createElement('div');
  wrap.className = 'seg';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', title);

  const buttons = new Map<T, HTMLButtonElement>();
  const select = (value: T): void => {
    current = value;
    for (const [v, b] of buttons) {
      const on = v === value;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    }
  };

  for (const o of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg-btn';
    b.textContent = o.label;
    b.title = o.title;
    b.addEventListener('click', () => {
      if (o.value === current) return;
      select(o.value);
      onPick(current);
    });
    buttons.set(o.value, b);
    wrap.append(b);
  }
  select(current);
  return { el: wrap, setValue: select };
}

export interface ChromeApi {
  /**
   * Apply `defaultLayout` (a demo's `preferredLayout`) unless the user has
   * already touched the layout toggle themselves — at that point their choice
   * is a sticky global preference and per-demo defaults stop applying.
   */
  applyLayoutForDemo(defaultLayout: Chrome['layout']): void;
}

/**
 * Build the theme + layout switches into `mount`. `onThemeChange` is called
 * after `data-theme` has flipped, with the themes switched between, so the host
 * can migrate saved chart colours and remount.
 */
export function initChrome(
  mount: HTMLElement,
  host: HTMLElement,
  onThemeChange: (from: ThemeName, to: ThemeName) => void,
): ChromeApi {
  apply();

  const themeCtl = segmented<Chrome['theme']>(
    'Theme',
    [
      { value: 'light', label: '☀', title: 'Light theme' },
      { value: 'dark', label: '☾', title: 'Dark theme' },
    ],
    chrome.theme,
    (v) => {
      const from = chrome.theme;
      chrome.theme = v;
      apply();
      saveChrome(chrome);
      onThemeChange(from, v);
    },
  );

  const layoutCtl = segmented<Chrome['layout']>(
    'Layout',
    [
      { value: 'tb', label: '▤', title: 'Top–bottom: controls below the chart' },
      { value: 'lr', label: '▥', title: 'Left–right: controls beside the chart' },
    ],
    chrome.layout,
    (v) => {
      chrome.layout = v;
      chrome.layoutTouched = true;
      apply();
      saveChrome(chrome);
    },
  );

  // Escape hatch: a chart dragged small stays small across layout switches and
  // demos, so there has to be a way back to the CSS default.
  const fit = document.createElement('button');
  fit.type = 'button';
  fit.className = 'seg-btn seg';
  fit.textContent = '⤢';
  fit.title = 'Reset chart size';
  fit.addEventListener('click', () => resetChartSize(host));

  // Layout first, then theme, so the theme switch sits right before the links.
  mount.prepend(fit, layoutCtl.el, themeCtl.el);

  return {
    applyLayoutForDemo(defaultLayout) {
      if (chrome.layoutTouched) return;
      chrome.layout = defaultLayout;
      apply();
      layoutCtl.setValue(defaultLayout);
      // Intentionally not persisted: this is a per-demo default standing in
      // until the user picks a layout themselves, not a saved preference.
    },
  };
}

let sizeObserver: ResizeObserver | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/** Parse an inline `"420px"` size, or null if unset / not in px. */
function px(v: string): number | null {
  const n = Number.parseFloat(v);
  return v.endsWith('px') && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * Restore the user's dragged chart size onto the `#chart` box inside `host` and
 * watch it for further drags. Demos build a fresh `#chart` element on every
 * mount, so this must run after each one; the previous observation is dropped.
 *
 * The box carries `resize: both` in CSS — this only persists the result. The
 * chart itself needs no involvement: it already reacts to its container
 * resizing.
 */
export function trackChartSize(host: HTMLElement): void {
  sizeObserver?.disconnect();
  sizeObserver = null;

  const el = host.querySelector<HTMLElement>('#chart');
  if (!el) return;

  if (chrome.chartW != null) el.style.width = `${chrome.chartW}px`;
  if (chrome.chartH != null) el.style.height = `${chrome.chartH}px`;

  sizeObserver = new ResizeObserver(() => {
    // A drag fires this on every frame — coalesce before touching storage.
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      // Read the *inline* size the drag wrote, not the measured box: in the
      // left-right layout `max-width: 100%` clamps the rendered width, and
      // storing that clamped value would shrink the saved size a little on
      // every layout switch. Inline stays empty until the user drags, so an
      // untouched box keeps filling its column.
      chrome.chartW = px(el.style.width) ?? chrome.chartW;
      chrome.chartH = px(el.style.height) ?? chrome.chartH;
      saveChrome(chrome);
    }, 250);
  });
  sizeObserver.observe(el);
}

/** Forget the dragged chart size and let the box fall back to its CSS default. */
export function resetChartSize(host: HTMLElement): void {
  chrome.chartW = null;
  chrome.chartH = null;
  saveChrome(chrome);
  const el = host.querySelector<HTMLElement>('#chart');
  if (el) {
    el.style.width = '';
    el.style.height = '';
  }
}
