import { SegmentedControl } from "../primitives/SegmentedControl";
import { THEMES, type Theme } from "./theme";
import { useTheme } from "./useTheme";
/* No stylesheet of its own: it is a SegmentedControl. */

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

/** Dark / dusk / light switch, built as a `SegmentedControl` so it shares its look and 44px floor. */
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
