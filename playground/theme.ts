// The chart-side half of the playground theme. The page chrome themes itself
// with CSS variables, but a chart paints into a canvas from its *config* — so
// the theme has to reach it as config values.
//
// Two pieces make that work: `chartPalette()` gives a demo's `defaultConfig()`
// the colours for whatever theme is active right now, and `colorRemap()`
// describes how to rewrite an already-saved config when the theme flips. The
// remap is deliberately conservative — it only replaces values that still equal
// the *other* theme's palette entry, so a colour the user picked by hand in the
// controls panel survives a theme switch untouched.

export type ThemeName = 'dark' | 'light';

export interface ChartPalette {
  /** Canvas background. Matches the chrome's `--sunken`. */
  background: string;
  /** Axis lines, ticks and their labels. */
  axis: string;
  /** Foreground readouts: current-value labels, FPS counter. */
  text: string;
}

export const CHART_PALETTES: Record<ThemeName, ChartPalette> = {
  dark: { background: '#10141c', axis: '#8a93a6', text: '#cdd3de' },
  light: { background: '#ffffff', axis: '#6b7382', text: '#202634' },
};

/** The theme currently applied to the document. */
export function activeTheme(): ThemeName {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/** Chart colours for the active theme. Call inside `defaultConfig()`. */
export function chartPalette(): ChartPalette {
  return CHART_PALETTES[activeTheme()];
}

/**
 * Old-colour → new-colour mapping for a `from` → `to` theme switch, used to
 * migrate saved configs. Only palette values appear as keys, so hand-picked
 * colours are left alone.
 */
export function colorRemap(from: ThemeName, to: ThemeName): Record<string, string> {
  const a = CHART_PALETTES[from];
  const b = CHART_PALETTES[to];
  return {
    [a.background]: b.background,
    [a.axis]: b.axis,
    [a.text]: b.text,
  };
}
