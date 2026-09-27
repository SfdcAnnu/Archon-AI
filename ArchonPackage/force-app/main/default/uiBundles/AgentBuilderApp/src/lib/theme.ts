import { useEffect, useState } from 'react';

/**
 * Two looks, one token set.
 *
 * Every colour in the app comes from the custom properties in
 * styles/global.css. `:root` holds the Salesforce-light values; the
 * `[data-theme="hud"]` block holds the dark console values from the
 * approved Archon HUD mock. Switching is one attribute on <html>, and
 * nothing in a component knows or cares which theme is active — which is
 * the only way two themes stay in step as the app grows.
 *
 * The choice is per person, kept in the browser. It is a look-and-feel
 * preference, not org configuration, so it does not need a round trip to
 * Salesforce; move it there later if the HUD look becomes the product's
 * identity rather than a user's taste.
 */
export type ThemeName = 'light' | 'hud';

const KEY = 'archon:theme';
const EVENT = 'archon:theme';

export function getTheme(): ThemeName {
  try {
    return localStorage.getItem(KEY) === 'hud' ? 'hud' : 'light';
  } catch {
    return 'light';
  }
}

/** Stamp the theme on <html>. Called once before first paint so there is
 *  no flash of the wrong palette, and again on every change. */
export function applyTheme(theme: ThemeName): void {
  const root = document.documentElement;
  if (theme === 'hud') root.dataset.theme = 'hud';
  else delete root.dataset.theme;
  root.style.colorScheme = theme === 'hud' ? 'dark' : 'light';
  window.dispatchEvent(new CustomEvent(EVENT, { detail: theme }));
}

export function setTheme(theme: ThemeName): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode — the choice just does not persist */
  }
  applyTheme(theme);
}

/** The active theme, re-rendering the caller when it changes. */
export function useTheme(): [ThemeName, (t: ThemeName) => void] {
  const [theme, set] = useState<ThemeName>(getTheme);
  useEffect(() => {
    const on = (e: Event) => set((e as CustomEvent<ThemeName>).detail);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return [theme, setTheme];
}

/**
 * A token's resolved value, for the few places that cannot take `var()`.
 *
 * React Flow's <Background> pushes its colour through an SVG attribute,
 * which does not reliably read custom properties — so it is handed the
 * computed value instead, and re-read when the theme changes.
 */
export function readToken(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function useThemeToken(name: string, fallback: string): string {
  const [value, set] = useState(() => readToken(name, fallback));
  useEffect(() => {
    const on = () => set(readToken(name, fallback));
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [name, fallback]);
  return value;
}
