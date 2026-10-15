/* Theme model shared by the app and the standalone viewer. The no-flash script in each HTML entry repeats
   the storage key and the dark default, because HTML can't import TS. */

export const THEMES = ["dark", "dusk", "light"] as const;
export type Theme = (typeof THEMES)[number];

/** localStorage key holding the active theme. */
const THEME_STORAGE_KEY = "vtt.theme";

function isTheme(value: unknown): value is Theme {
  return value === "dark" || value === "dusk" || value === "light";
}

/** Read the persisted theme, defaulting to dark. Safe before React mounts. */
export function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    /* localStorage unavailable (private mode); fall through to the default */
  }
  return "dark";
}

/** Apply a theme to <html data-theme> and persist it (best-effort). */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* persistence is best-effort */
  }
}
