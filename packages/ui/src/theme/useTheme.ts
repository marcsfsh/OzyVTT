import { useCallback, useEffect, useState } from "react";
import { applyTheme, getStoredTheme, onThemeChange, THEMES, type Theme } from "./theme";

interface UseThemeResult {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  /** Advance through the themes in the order the switches list them. */
  cycleTheme: () => void;
}

/** React state bound to the app theme. Initializes from the persisted value,
    which the no-flash <head> script has already applied to <html>. Each switch follows a change made by
    another, so the app bar and Settings always agree. */
export function useTheme(): UseThemeResult {
  const [theme, setThemeState] = useState<Theme>(getStoredTheme);

  useEffect(() => onThemeChange(setThemeState), []);

  const setTheme = useCallback((next: Theme) => {
    applyTheme(next);
    setThemeState(next);
  }, []);

  const cycleTheme = useCallback(
    () => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]),
    [theme, setTheme]
  );

  return { theme, setTheme, cycleTheme };
}
