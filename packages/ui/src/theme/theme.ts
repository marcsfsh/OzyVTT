/* Theme model shared across the app and the standalone viewer. Framework-free so
   it can run in the no-flash <head> script and inside React alike. The look is
   fixed per the design language — theme (dark/dusk/light) and OS accessibility
   settings are the only user-facing switches. */

export const THEMES = ["dark", "dusk", "light"] as const;
export type Theme = (typeof THEMES)[number];

/** localStorage key holding the active theme. */
export const THEME_STORAGE_KEY = "vtt.theme";

export function isTheme(value: unknown): value is Theme {
  return value === "dark" || value === "dusk" || value === "light";
}

/** Read the persisted theme, defaulting to dark. Safe before React mounts. */
export function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isTheme(stored)) return stored;
  } catch {
    /* localStorage unavailable (private mode) — fall through to the default */
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

/** Inline <head> script that sets data-theme before first paint (prevents a
    theme flash). Kept here as the single source of truth; index.html and
    viewer.html embed an equivalent literal because HTML can't import TS. */
export const NO_FLASH_THEME_SCRIPT =
  `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");` +
  `document.documentElement.setAttribute("data-theme",t==="dusk"||t==="light"?t:"dark")}` +
  `catch(e){document.documentElement.setAttribute("data-theme","dark")}`;
