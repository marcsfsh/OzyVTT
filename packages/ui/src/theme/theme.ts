/* Theme model shared by the app and the standalone viewer. The no-flash script in each HTML entry repeats
   the storage key, the ids and the dark default, because HTML can't import TS. */

/**
 * The stored ids, in the order the switches offer them. `dark` is Night and `light` is Day: the ids predate the
 * names people read and stay, so a choice saved on a device survives.
 */
export const THEMES = ["dark", "dusk", "dawn", "light"] as const;
export type Theme = (typeof THEMES)[number];

/** What a person reads for each theme. */
export const THEME_NAMES: Readonly<Record<Theme, string>> = {
  dark: "Night",
  dusk: "Dusk",
  dawn: "Dawn",
  light: "Day"
};

/** localStorage key holding the active theme. */
const THEME_STORAGE_KEY = "vtt.theme";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
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

const listeners = new Set<(theme: Theme) => void>();

/** Hears every theme change on this page, so two switches on one screen never disagree. */
export function onThemeChange(listener: (theme: Theme) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Apply a theme to <html data-theme> and persist it (best-effort). */
export function applyTheme(theme: Theme): void {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* persistence is best-effort */
  }
  for (const listener of [...listeners]) listener(theme);
}
