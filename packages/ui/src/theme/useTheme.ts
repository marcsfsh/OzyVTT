import { useCallback, useState } from "react";
import { applyTheme, getStoredTheme, THEMES, type Theme } from "./theme";

export interface UseThemeResult {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** Advance dark → dusk → light → dark. */
  cycleTheme: () => void;
}

/** React state bound to the app theme. Initializes from the persisted value,
    which the no-flash <head> script has already applied to <html>. */
export function useTheme(): UseThemeResult {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);

  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
    setThemeState(next);
  }, []);

  const cycleTheme = useCallback(() => {
    setThemeState((current) => {
      const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
      applyTheme(next);
      return next;
    });
  }, []);

  return { theme, setTheme, cycleTheme };
}
