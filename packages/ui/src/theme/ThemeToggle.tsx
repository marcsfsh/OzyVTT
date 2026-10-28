import type { ReactNode } from "react";
import { IconCheck, IconThemeDawn, IconThemeDusk } from "../primitives/icons";
import { Menu, MenuItem } from "../primitives/Menu";
import { SegmentedControl } from "../primitives/SegmentedControl";
import { THEME_NAMES, THEMES, type Theme } from "./theme";
import { useTheme } from "./useTheme";
import "./ThemeSwitch.css";

const THEME_ICONS: Record<Theme, ReactNode> = {
  dusk: <IconThemeDusk />,
  dawn: <IconThemeDawn />
};

interface ThemeToggleProps {
  /** Icons only, for tight headers. */
  compact?: boolean;
  className?: string;
}

/** The two themes side by side, built as a `SegmentedControl` so it shares its look and 44px floor. */
export function ThemeToggle({ compact = false, className }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme();
  return (
    <SegmentedControl
      ariaLabel="Theme"
      className={`theme-toggle${className ? ` ${className}` : ""}`}
      value={theme}
      onChange={(next) => setTheme(next as Theme)}
      options={THEMES.map((option) => ({
        value: option,
        icon: THEME_ICONS[option],
        label: compact ? undefined : THEME_NAMES[option],
        ariaLabel: compact ? THEME_NAMES[option] : undefined,
        title: THEME_NAMES[option]
      }))}
    />
  );
}

/**
 * The app bar's theme switch: one square showing the current theme's mark, which opens the two choices. It takes
 * the 44px floor as paint, so it needs no hit-area layer in a crowded bar.
 */
export function ThemeSwitch({ className }: Readonly<{ className?: string }>) {
  const { theme, setTheme } = useTheme();
  return (
    <Menu
      align="end"
      hideCaret
      className={`nh-theme-switch${className ? ` ${className}` : ""}`}
      triggerClassName="nh-theme-switch-trigger"
      label={`Theme: ${THEME_NAMES[theme]}`}
      trigger={THEME_ICONS[theme]}
    >
      {THEMES.map((option) => (
        <MenuItem
          key={option}
          role="menuitemradio"
          aria-checked={option === theme}
          icon={THEME_ICONS[option]}
          onClick={() => setTheme(option)}
        >
          <span className="nh-theme-switch-name">{THEME_NAMES[option]}</span>
          {option === theme && <IconCheck className="nh-theme-switch-check" />}
        </MenuItem>
      ))}
    </Menu>
  );
}
