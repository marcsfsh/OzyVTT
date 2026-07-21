/* @vtt/ui — the shared Neon Horizon design system: tokens (see styles/), theme
   control, and accessible UI primitives. Consumed as source by the client's Vite
   build (mirrors @vtt/domain). Import the stylesheet once per app entry:
     import "@vtt/ui/styles.css";
*/

/* Theme */
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

/* Primitives */
export { cx } from "./primitives/util";
export {
  Button,
  LinkButton,
  IconButton,
  type ButtonProps,
  type LinkButtonProps,
  type IconButtonProps,
  type ButtonVariant,
  type ButtonSize
} from "./primitives/Button";
export {
  Field,
  Input,
  Select,
  Textarea,
  type FieldProps,
  type InputProps,
  type SelectProps,
  type TextareaProps
} from "./primitives/forms";
export { Panel, PanelHeader, type PanelProps, type PanelHeaderProps, type PanelAccent } from "./primitives/Panel";
export { Wordmark, Eyebrow, type WordmarkProps, type EyebrowProps } from "./primitives/Wordmark";
export { Chip, type ChipProps, type ChipTone } from "./primitives/Chip";
export { Tabs, type TabsProps, type TabItem } from "./primitives/Tabs";
export { Menu, MenuItem, type MenuProps, type MenuItemProps } from "./primitives/Menu";
export { Tooltip, type TooltipProps } from "./primitives/Tooltip";
export { Modal, type ModalProps } from "./primitives/Modal";
export { ToastProvider, useToast, type ToastApi, type ToastOptions, type ToastTone } from "./primitives/Toast";
