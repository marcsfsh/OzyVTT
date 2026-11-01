/**
 * The Codex's tools as a group of Settings' side list (F time spec 2.6): each tool is its own address,
 * `/settings/codex/<tool>`, built from the Codex's Backup and Settings views. GM-only, like every section but Device.
 */

import type { SettingEntry } from "./sections";

export type CodexToolId = "backup" | "restore" | "notes" | "autosave" | "history";

export type CodexTool = Readonly<{ id: CodexToolId; label: string; hint: string; iconId: string; words: string }>;

export const CODEX_TOOLS: readonly CodexTool[] = [
  {
    id: "backup",
    label: "Backup",
    hint: "One file with everything in the Codex, to keep somewhere safe.",
    iconId: "archive",
    words: "download export save file json"
  },
  {
    id: "restore",
    label: "Restore",
    hint: "Replaces everything in the Codex with a backup file.",
    iconId: "hourglass",
    words: "restore import replace backup file"
  },
  {
    id: "notes",
    label: "Bring in notes",
    hint: "Adds Markdown or text files as pages, hidden at first.",
    iconId: "scroll",
    words: "import notes markdown text files pages"
  },
  {
    id: "autosave",
    label: "Autosave",
    hint: "Whether the Codex saves your edits as you type, and how soon.",
    iconId: "gear",
    words: "autosave save typing interval pause"
  },
  {
    id: "history",
    label: "Version history",
    hint: "The earlier versions the Codex keeps of each page.",
    iconId: "book",
    words: "versions history revisions delete old"
  }
];

export const isCodexTool = (value: string | undefined): value is CodexToolId =>
  CODEX_TOOLS.some((tool) => tool.id === value);

export const codexToolPath = (id: CodexToolId) => `/settings/codex/${id}`;

/** Each tool as the search finds it; a pick opens the tool's page. */
export const CODEX_TOOL_ENTRIES: readonly SettingEntry[] = CODEX_TOOLS.map((tool) => ({
  id: `codex-${tool.id}`,
  section: "codex",
  label: tool.label,
  hint: tool.hint,
  words: `codex ${tool.words}`,
  tool: tool.id
}));
