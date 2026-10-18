/* @vtt/ui: the shared design system (tokens, theme control, accessible primitives), consumed as source by the
   client's Vite build. Import the stylesheet once per app entry:
     import "@vtt/ui/styles.css";
*/

/* Theme */
export { type Theme, THEMES, THEME_NAMES } from "./theme/theme";
export { ThemeSwitch, ThemeToggle } from "./theme/ThemeToggle";
export { colourDistance, contrastRatio, parseColour, type Rgb } from "./theme/colour";

/* Primitives */
export { cx } from "./primitives/util";
export { Button, IconButton } from "./primitives/Button";
export { Field, Input, Select, Textarea } from "./primitives/forms";
export { Panel, PanelHeader } from "./primitives/Panel";
export { Wordmark, Eyebrow, SunMark } from "./primitives/Wordmark";
export { Chip, type ChipTone } from "./primitives/Chip";
export { Tabs } from "./primitives/Tabs";
export { Menu, MenuItem } from "./primitives/Menu";
export { Modal } from "./primitives/Modal";
export { Drawer } from "./primitives/Drawer";
export { ToastProvider, ToastOutlet, useToast, useToastMute, type ToastTone } from "./primitives/Toast";
export { Badge, type BadgeTone } from "./primitives/Badge";
export { Avatar, type AvatarPresence } from "./primitives/Avatar";
export { Meter, type MeterTone } from "./primitives/Meter";
export { Alert } from "./primitives/Alert";
export { Switch } from "./primitives/Switch";
export { Stepper } from "./primitives/Stepper";
export { Slider } from "./primitives/Slider";
/* The reveal family: the one way the product asks "do the players see this?". */
export { RevealSwitch, VisibilityBadge, HiddenFromPlayers, GmOnlyTag } from "./primitives/Reveal";
export { SegmentedControl, type SegmentedOption } from "./primitives/SegmentedControl";
export { Steps, type StepItem } from "./primitives/Steps";
export { Skeleton } from "./primitives/Skeleton";
export { Kbd } from "./primitives/Kbd";
export { QrCode } from "./primitives/QrCode";
export { encodeQr, type QrMatrix } from "./primitives/qr-encode";

/* Authoring primitives (Codex + homebrew editors, and any long typed-entity form) */
export { FieldGrid } from "./primitives/FieldGrid";
export { NumberField } from "./primitives/NumberField";
export { TagInput, slugify, type TagInputProps } from "./primitives/TagInput";
export { RowEditor } from "./primitives/RowEditor";
export { useDragSurface } from "./primitives/dragSurface";
export { Checklist, type ChecklistItem } from "./primitives/Checklist";
export { SaveState, type SaveStatus } from "./primitives/SaveState";

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
  IconPause,
  IconStop,
  IconSkip,
  IconShuffle,
  IconVolume,
  IconVolumeOff,
  IconMusic,
  IconArrow,
  IconDownload,
  // Map tools and content marks.
  IconSelect,
  IconPing,
  IconMeasure,
  IconDraw,
  IconFog,
  IconTerrain,
  IconWall,
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
  IconSparkle,
  IconBell,
  IconGrip,
  IconTv,
  IconTarget,
  IconLocate,
  IconWait,
  IconLog,
  IconMore,
  IconCheck,
  IconDie,
  IconInfo,
  // The character sheet's tabs, menu and live states.
  IconBolt,
  IconBag,
  IconPage,
  IconMoon,
  IconLevelUp,
  IconUser,
  IconCog,
  IconKey,
  IconCode,
  IconPin,
  IconList,
  IconSkull,
  IconConcentration
} from "./primitives/icons";
export { Combobox } from "./primitives/Combobox";
export { MarkdownEditor, applyMarkdownFormat } from "./primitives/MarkdownEditor";

/* Guided-flow primitives (character builder, and any other long wizard) */
export { WizardShell } from "./primitives/WizardShell";
export { ChoiceCard } from "./primitives/ChoiceCard";
export { ChoiceGrid, type ChoiceOption } from "./primitives/ChoiceGrid";
export { AbilityScoreAllocator } from "./primitives/AbilityScoreAllocator";
export { DiceInputRow, type DiceEntryMode } from "./primitives/DiceInputRow";
export { NameField } from "./primitives/NameField";
export { FeatureList, type FeatureItem } from "./primitives/FeatureList";
export { ReviewSummary, type ReviewSection } from "./primitives/ReviewSummary";
