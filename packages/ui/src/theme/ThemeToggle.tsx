import { THEMES, type Theme } from "./theme";
import { useTheme } from "./useTheme";
import "./ThemeToggle.css";

const THEME_META: Record<Theme, { label: string; glyph: string }> = {
  dark: { label: "Dark", glyph: "◑" },
  dusk: { label: "Dusk", glyph: "◐" },
  light: { label: "Light", glyph: "○" }
};

export interface ThemeToggleProps {
  /** Glyphs only, for tight headers. */
  compact?: boolean;
  className?: string;
}

/** Dark / dusk / light switch — the app's one look-and-feel control (theme and
    OS accessibility settings are the only knobs, per the design language). */
export function ThemeToggle({ compact = false, className }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();
  return (
    <div
      className={`theme-toggle${compact ? " theme-toggle-compact" : ""}${className ? ` ${className}` : ""}`}
      role="group"
      aria-label="Color theme"
    >
      {THEMES.map((option) => {
        const meta = THEME_META[option];
        return (
          <button
            key={option}
            type="button"
            className="theme-toggle-option interactive"
            aria-pressed={theme === option}
            title={`${meta.label} theme`}
            onClick={() => setTheme(option)}
          >
            <span aria-hidden="true" className="theme-toggle-glyph">{meta.glyph}</span>
            {!compact && <span className="theme-toggle-label">{meta.label}</span>}
          </button>
        );
      })}
    </div>
  );
}
