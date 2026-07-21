/* @vtt/ui — the shared Neon Horizon design system: tokens (see styles/), theme
   control, and accessible UI primitives. Consumed as source by the client's Vite
   build (mirrors @vtt/domain). Import the stylesheet once per app entry:
     import "@vtt/ui/styles.css";
*/

export {
  THEMES,
  THEME_STORAGE_KEY,
  NO_FLASH_THEME_SCRIPT,
  isTheme,
  getStoredTheme,
  applyTheme,
  type Theme
} from "./theme/theme";
export { useTheme, type UseThemeResult } from "./theme/useTheme";
export { ThemeToggle, type ThemeToggleProps } from "./theme/ThemeToggle";
