/* Theme model shared by the app, the standalone sheet and the viewer. The no-flash script in each HTML entry
   repeats this file's decision (the storage key, the ids, the retired ids and the system default) because HTML
   can't import TS; apps/client/src/shell/theme-startup.test.ts runs each script against `resolveTheme`. */

/** The stored ids, in the order the switches offer them. */
export const THEMES = ["dusk", "dawn"] as const;
export type Theme = (typeof THEMES)[number];

/** What a person reads for each theme. */
export const THEME_NAMES: Readonly<Record<Theme, string>> = {
  dusk: "Dusk",
  dawn: "Dawn"
};

/** The browser chrome's colour for each theme: the top of the app's ground. The HTML entries repeat it. */
export const THEME_COLOURS: Readonly<Record<Theme, string>> = {
  dusk: "#151a2d",
  dawn: "#ebe7ef"
};

/** localStorage key holding the active theme. */
const THEME_STORAGE_KEY = "vtt.theme";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/**
 * The theme a stored value renders as. The retired dark themes (`dark`, Night) map to Dusk and the light ones
 * (`light`, Day) to Dawn, so nobody's choice flips between light and dark. Anything else follows the system.
 */
export function resolveTheme(stored: string | null, prefersLight: boolean): { theme: Theme; writeback: Theme | null } {
  if (isTheme(stored)) return { theme: stored, writeback: null };
  if (stored === "dark") return { theme: "dusk", writeback: "dusk" };
  if (stored === "light") return { theme: "dawn", writeback: "dawn" };
  return { theme: prefersLight ? "dawn" : "dusk", writeback: null };
}

/** Whether the system asks for a light page. False when it can't be read. */
function systemPrefersLight(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches;
  } catch {
    return false;
  }
}

/** Read the persisted theme, rewriting a retired id. Safe before React mounts; storage failures never throw. */
export function getStoredTheme(): Theme {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    /* localStorage unavailable (private mode); the system preference decides */
  }
  const { theme, writeback } = resolveTheme(stored, systemPrefersLight());
  if (writeback) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, writeback);
    } catch {
      /* a failed rewrite leaves the resolved theme as it is */
    }
  }
  return theme;
}

const listeners = new Set<(theme: Theme) => void>();

/** Hears every theme change on this page, so two switches on one screen never disagree. */
export function onThemeChange(listener: (theme: Theme) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Apply a theme to <html data-theme> and the browser chrome, and persist it (best-effort). */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOURS[theme]);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* persistence is best-effort */
  }
  for (const listener of [...listeners]) listener(theme);
}
