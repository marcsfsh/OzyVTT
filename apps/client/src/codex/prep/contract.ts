import type { CodexEntityType, CodexJournalEntry, CodexJournalKind, CodexQuestStatus, CodexSession } from "@vtt/domain";

/**
 * Session prep, the live board and the recap's sources, typed as the server's prep contract states them. GM-only
 * shapes: nothing here has a player twin.
 */

export const CODEX_PREP_SECTION_TYPES = [
  "text",
  "checklist",
  "pages",
  "scenes",
  "clocks",
  "quests",
  "encounters"
] as const;
export type CodexPrepSectionType = (typeof CODEX_PREP_SECTION_TYPES)[number];

/** The server's bounds, so a full list is a disabled button and never a 400. */
export const CODEX_PREP_LIMITS = {
  templates: 50,
  templateName: 80,
  templateSections: 24,
  sessionSections: 32,
  sectionTitle: 80,
  prompt: 280,
  text: 20_000,
  items: 48,
  itemText: 280,
  pages: 48,
  scenes: 24,
  sceneTitle: 120,
  sceneNotes: 4000,
  deadlines: 24,
  quests: 24,
  encounters: 20
} as const;

/** The built-in starting template: read-only, always in the library. */
export const BUILT_IN_TEMPLATE_ID = "00000000-0000-4000-8000-00000000b001";

export type CodexPrepTemplateSection = Readonly<{
  id: string;
  title: string;
  prompt: string | null;
  type: CodexPrepSectionType;
}>;

export type CodexPrepTemplate = Readonly<{
  id: string;
  name: string;
  builtIn: boolean;
  isDefault: boolean;
  sections: readonly CodexPrepTemplateSection[];
  rev: number;
  createdAt: string | null;
  updatedAt: string | null;
}>;

export type CodexPrepTemplateList = Readonly<{
  templates: readonly CodexPrepTemplate[];
  defaultTemplateId: string;
}>;

export type CodexPrepLink = Readonly<{
  recordKind: "page" | "quest";
  recordId: string;
  /** A hidden block inside the record; null links the record itself. */
  blockId: string | null;
}>;

export type CodexPrepChecklistItem = Readonly<{
  id: string;
  text: string;
  done: boolean;
  doneAt: string | null;
  link: CodexPrepLink | null;
}>;

export type CodexPrepScene = Readonly<{ id: string; title: string; placePageId: string | null; notes: string }>;

type SectionBase = Readonly<{ id: string; templateSectionId: string | null; title: string; prompt: string | null }>;

export type CodexPrepSection =
  | (SectionBase & Readonly<{ type: "text"; text: string }>)
  | (SectionBase & Readonly<{ type: "checklist"; items: readonly CodexPrepChecklistItem[] }>)
  | (SectionBase & Readonly<{ type: "pages"; pageIds: readonly string[] }>)
  | (SectionBase & Readonly<{ type: "scenes"; scenes: readonly CodexPrepScene[] }>)
  | (SectionBase & Readonly<{ type: "clocks"; deadlineIds: readonly string[] }>)
  | (SectionBase & Readonly<{ type: "quests"; questIds: readonly string[] }>)
  | (SectionBase & Readonly<{ type: "encounters"; sceneIds: readonly string[] }>);
export type CodexPrepSectionOf<T extends CodexPrepSectionType> = Extract<CodexPrepSection, { type: T }>;

type InputBase = Readonly<{ id?: string; templateSectionId?: string | null; title: string; prompt?: string | null }>;
export type CodexPrepChecklistItemInput = Readonly<{
  id?: string;
  text: string;
  done?: boolean;
  doneAt?: string | null;
  link?: CodexPrepLink | null;
}>;
export type CodexPrepSceneInput = Readonly<{ id?: string; title: string; placePageId?: string | null; notes?: string }>;
/** A section as a write sends it. A section read back is one, so it can be sent back whole. */
export type CodexPrepSectionInput =
  | (InputBase & Readonly<{ type: "text"; text?: string }>)
  | (InputBase & Readonly<{ type: "checklist"; items?: readonly CodexPrepChecklistItemInput[] }>)
  | (InputBase & Readonly<{ type: "pages"; pageIds?: readonly string[] }>)
  | (InputBase & Readonly<{ type: "scenes"; scenes?: readonly CodexPrepSceneInput[] }>)
  | (InputBase & Readonly<{ type: "clocks"; deadlineIds?: readonly string[] }>)
  | (InputBase & Readonly<{ type: "quests"; questIds?: readonly string[] }>)
  | (InputBase & Readonly<{ type: "encounters"; sceneIds?: readonly string[] }>);
export type CodexPrepTemplateSectionInput = Readonly<{
  id?: string;
  title: string;
  prompt?: string | null;
  type: CodexPrepSectionType;
}>;

/** A GM session with its prep sections. */
export type PrepSession = Omit<CodexSession, "prepBody"> &
  Readonly<{
    prep: readonly CodexPrepSection[];
    /** The template the prep was last copied from; it may name a deleted template. */
    prepTemplateId: string | null;
    currentSceneId: string | null;
  }>;

export type CodexLiveClue = CodexPrepChecklistItem &
  Readonly<{
    linkTitle: string | null;
    blockTitle: string | null;
    /** A record link: whether players can read the record. A block link: whether anyone but the GM can read it. */
    linkRevealed: boolean | null;
  }>;

export type CodexLiveBoard = Readonly<{
  sessionId: string;
  sessionNumber: number | null;
  rev: number;
  currentSceneId: string | null;
  scenes: ReadonlyArray<
    Readonly<{
      sectionId: string;
      id: string;
      title: string;
      placePageId: string | null;
      placeTitle: string | null;
      notes: string;
      current: boolean;
    }>
  >;
  pageGroups: ReadonlyArray<
    Readonly<{
      sectionId: string;
      title: string;
      pages: ReadonlyArray<
        Readonly<{ id: string; title: string; entityType: CodexEntityType; revealedToPlayers: boolean }>
      >;
    }>
  >;
  checklists: ReadonlyArray<Readonly<{ sectionId: string; title: string; items: readonly CodexLiveClue[] }>>;
  clocks: ReadonlyArray<
    Readonly<{
      id: string;
      text: string;
      inWorldLabel: string | null;
      calendarInstant: number | null;
      fired: boolean;
      revealedToPlayers: boolean;
    }>
  >;
  quests: ReadonlyArray<Readonly<{ id: string; title: string; status: CodexQuestStatus; revealedToPlayers: boolean }>>;
  encounterSceneIds: readonly string[];
  logged: ReadonlyArray<
    Readonly<{ id: string; kind: CodexJournalKind; text: string; revealedToPlayers: boolean; createdAt: string }>
  >;
}>;

export type CodexSessionHappened = Readonly<{
  sessionId: string;
  entries: readonly CodexJournalEntry[];
  cluesTicked: ReadonlyArray<CodexLiveClue & Readonly<{ sectionId: string; sectionTitle: string }>>;
  reveals: ReadonlyArray<
    Readonly<{
      recordKind: "page" | "quest";
      recordId: string;
      recordTitle: string;
      blockId: string;
      blockTitle: string | null;
      /** "everyone", or a character's actor id. */
      to: string;
      at: string;
      inWorldLabel: string | null;
    }>
  >;
}>;

/** The audience a block can be given: the GM only, everyone, or chosen party characters. */
export type CodexAudienceInput = Readonly<{
  audience: "hidden" | "everyone" | "characters";
  characterIds?: readonly string[];
}>;

/** A hidden block, as far as a checklist link needs it. */
export type CodexBlockRef = Readonly<{ id: string; title: string | null; text: string; audience: string }>;
