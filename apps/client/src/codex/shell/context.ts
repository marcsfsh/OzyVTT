import { createContext, useContext } from "react";
import type { CodexAutosaveSettings } from "@vtt/domain";
import type { QuickCreateRequest } from "../QuickCreate";
import type { CodexSection } from "../routes";
import type { useGmFeeds } from "../useGmFeeds";
import type { PlayerFeeds } from "./usePlayerFeeds";

/** The phone layout: the tab bar under the thumb, and views in one column. The breakpoint ladder's 760. */
export const CODEX_PHONE_QUERY = "(max-width: 760px)";

/**
 * What every Codex view reads from the shell: who is reading, where they are and how to move. A section view is a
 * component with no props (`shell/sections.tsx`); it takes everything from here, so the GM and player shells, the
 * GM's embedded preview and a test all mount the same view the same way.
 */
export type CodexShellValue = Readonly<{
  role: "gm" | "player";
  /** The GM token, or the player token (a preview's included). Every read the view makes uses it. */
  token: string;
  /** The player Codex inside the GM's preview: navigation stays local and the browser address never moves. */
  embedded: boolean;
  section: CodexSection;
  segments: readonly string[];
  /** The record id in a record section's address (`/codex/pages/:id`), or null on the list. */
  recordId: string | null;
  query: URLSearchParams;
  /** 760px and narrower: the phone's tab bar under the thumb, and views lay out in one column. */
  phone: boolean;
  go: (path: string, options?: Readonly<{ replace?: boolean }>) => void;
  /** Rewrites the query without a history entry: a list's filters, a view switch, a focus. */
  setQuery: (mutate: (query: URLSearchParams) => void) => void;
  /** Sets or clears query keys in one write; an empty value clears its key. */
  setFilter: (next: Readonly<Record<string, string | null>>) => void;
  /** Opens the command palette (Ctrl K). */
  openPalette: () => void;
}>;

export type CodexCharacter = Readonly<{ id: string; name: string }>;
type WorkspaceScene = Readonly<{ id: string; name: string }>;
/** `archived` and `kind` are optional; the character pickers read them (see `characters.ts`). */
export type WorkspaceActor = Readonly<{ id: string; name: string; archived?: boolean; kind?: string }>;

/** What only the GM's views have: the game's scenes and actors, the shared feeds and the shell's dialogs. */
export type GmCodexValue = Readonly<{
  scenes: readonly WorkspaceScene[];
  actors: readonly WorkspaceActor[];
  /** The party's player characters, for every Who sees it control. */
  party: readonly CodexCharacter[];
  activeEncounterId: string | null;
  onActivateScene: (encounterId: string) => void;
  onOpenReplay?: (archiveId: number) => void;
  /** The game clock (`rest.clockHours`), whose hour goes with the calendar's date. */
  gameHours: number | null;
  /** The minutes past that hour (`rest.clockMinutes`). */
  gameMinutes?: number;
  autosave: CodexAutosaveSettings;
  /** The feeds the shell owns, so two views never disagree about, say, which session is active. */
  feeds: ReturnType<typeof useGmFeeds>;
  quickCreate: (request: QuickCreateRequest) => void;
  /** A failed create or move, shown in the shell's notice row until fresh data clears it. */
  reportError: (message: string | null) => void;
  /** Opens the player Codex as Everyone (null) or as one character, in a full-screen dialog. */
  openPreview: (characterId: string | null) => void;
}>;

/** What only the player's views have: the feeds read on the player's token. */
export type PlayerCodexValue = Readonly<{ feeds: PlayerFeeds }>;

export const CodexShellContext = createContext<CodexShellValue | null>(null);
export const GmCodexContext = createContext<GmCodexValue | null>(null);
export const PlayerCodexContext = createContext<PlayerCodexValue | null>(null);

export function useCodexShell(): CodexShellValue {
  const value = useContext(CodexShellContext);
  if (!value) throw new Error("A Codex view rendered outside the Codex shell.");
  return value;
}

/** The GM's extras. A view that a player also mounts reads `useOptionalGmCodex` and branches on null. */
export function useGmCodex(): GmCodexValue {
  const value = useContext(GmCodexContext);
  if (!value) throw new Error("A GM Codex view rendered outside the GM's Codex shell.");
  return value;
}

export function useOptionalGmCodex(): GmCodexValue | null {
  return useContext(GmCodexContext);
}

export function usePlayerCodex(): PlayerCodexValue {
  const value = useContext(PlayerCodexContext);
  if (!value) throw new Error("A player Codex view rendered outside the player's Codex shell.");
  return value;
}
