import { SegmentedControl } from "../primitives/SegmentedControl";
import { THEMES, type Theme } from "./theme";
import { useTheme } from "./useTheme";
/* No stylesheet of its own on purpose: it looks exactly like every other
   SegmentedControl. The old ThemeToggle.css was a copy of SegmentedControl.css. */

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
    OS accessibility settings are the only knobs, per the design language).
    It IS a `SegmentedControl` ("pick exactly one", icon + label, aria-pressed):
    re-implementing that container and pressed state is how this control ended up
    26px tall while every other pressable option in the app met the 44px floor. */
export function ThemeToggle({ compact = false, className }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();
  return (
    <SegmentedControl
      ariaLabel="Color theme"
      className={`theme-toggle${className ? ` ${className}` : ""}`}
      value={theme}
      onChange={(next) => setTheme(next as Theme)}
      options={THEMES.map((option) => {
        const meta = THEME_META[option];
        return {
          value: option,
          icon: meta.glyph,
          label: compact ? undefined : meta.label,
          ariaLabel: compact ? `${meta.label} theme` : undefined,
          title: `${meta.label} theme`
        };
      })}
    />
  );
}
