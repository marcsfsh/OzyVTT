/* @vtt/ui: the shared design system (tokens, theme control, accessible primitives), consumed as source by the
   client's Vite build. Import the stylesheet once per app entry:
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
  IconButton,
  type ButtonProps,
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
export { Tabs, type TabsProps } from "./primitives/Tabs";
export { Menu, MenuItem, type MenuProps, type MenuItemProps } from "./primitives/Menu";
export { Modal, type ModalProps } from "./primitives/Modal";
export { Drawer, type DrawerProps } from "./primitives/Drawer";
export {
  ToastProvider,
  useToast,
  useToastMute,
  type ToastApi,
  type ToastOptions,
  type ToastTone
} from "./primitives/Toast";
export { Badge, type BadgeProps, type BadgeTone } from "./primitives/Badge";
export { Avatar, type AvatarProps, type AvatarSize, type AvatarPresence } from "./primitives/Avatar";
export { Meter, type MeterProps, type MeterTone } from "./primitives/Meter";
export { Alert, type AlertProps, type AlertTone } from "./primitives/Alert";
export { Switch, type SwitchProps } from "./primitives/Switch";
export { Stepper, type StepperProps } from "./primitives/Stepper";
/* The reveal family: the one way the product asks "do the players see this?". */
export { RevealSwitch, VisibilityBadge, HiddenFromPlayers, GmOnlyTag } from "./primitives/Reveal";
export { SegmentedControl, type SegmentedControlProps, type SegmentedOption } from "./primitives/SegmentedControl";
export { Steps, type StepsProps, type StepItem } from "./primitives/Steps";
export { Skeleton, type SkeletonProps } from "./primitives/Skeleton";
export { Kbd, type KbdProps } from "./primitives/Kbd";

/* Authoring primitives (Codex + homebrew editors, and any long typed-entity form) */
export { FieldGrid, type FieldGridProps } from "./primitives/FieldGrid";
export { NumberField, type NumberFieldProps } from "./primitives/NumberField";
export { TagInput, slugify, type TagInputProps } from "./primitives/TagInput";
export { RowEditor, type RowEditorProps } from "./primitives/RowEditor";
export { Checklist, type ChecklistProps, type ChecklistItem } from "./primitives/Checklist";
export { SaveState, type SaveStateProps, type SaveStatus } from "./primitives/SaveState";

/* Icons: the design system's own SVG glyphs. The app's richer set lives in apps/client/src/codex/icons.tsx. */
export {
  IconChevron,
  IconChevronLeft,
  IconChevronRight,
  IconSearch,
  IconPencil,
  IconPlus,
  IconDrag,
  IconEye,
  IconEyeOff,
  IconX,
  IconPlay,
  IconArrow,
  IconDownload,
  // Map tools and content marks.
  IconSelect,
  IconPing,
  IconMeasure,
  IconDraw,
  IconFog,
  IconColor,
  IconCleanup,
  IconScene,
  IconStar,
  IconWarning,
  IconTrash,
  IconCopy,
  IconRepeat,
  IconPlug,
  IconDockLeft,
  IconDockRight,
  IconDockSidebar,
  IconSparkle
} from "./primitives/icons";
export { Combobox, type ComboboxProps, type ComboboxOption } from "./primitives/Combobox";
// The editor's two pure rules, exported for direct testing.
export {
  MarkdownEditor,
  applyMarkdownFormat,
  wikiLinkContext,
  type MarkdownEditorProps,
  type MarkdownSuggestion
} from "./primitives/MarkdownEditor";

/* Guided-flow primitives (character builder, and any other long wizard) */
export { WizardShell, type WizardShellProps } from "./primitives/WizardShell";
export { ChoiceCard, type ChoiceCardProps } from "./primitives/ChoiceCard";
export { ChoiceGrid, type ChoiceGridProps, type ChoiceOption } from "./primitives/ChoiceGrid";
export {
  AbilityScoreAllocator,
  type AbilityScoreAllocatorProps,
  type AbilityAllocationMode,
  type AbilityRowData
} from "./primitives/AbilityScoreAllocator";
export { DiceInputRow, type DiceInputRowProps, type DiceEntryMode } from "./primitives/DiceInputRow";
export { NameField, type NameFieldProps } from "./primitives/NameField";
export { FeatureList, type FeatureListProps, type FeatureItem } from "./primitives/FeatureList";
export {
  ReviewSummary,
  type ReviewSummaryProps,
  type ReviewSection,
  type ReviewItem
} from "./primitives/ReviewSummary";
