/**
 * The server contract's new Codex shapes, written out for the client until the server branches reach this one.
 * Each type has the name and the keys `@vtt/domain` gives it (`codex-wire.ts`, `codex-blocks.ts`); once those land,
 * every import from here moves to `@vtt/domain` and this file goes.
 */

import type {
  CodexConnectionLayer,
  CodexConnectionOrigin,
  CodexEntityType,
  CodexInWorldDate,
  CodexQuestStatus,
  CodexRecordKind
} from "@vtt/domain";

export type CodexAudience = "hidden" | "everyone" | "characters";
export type CodexFieldAudience = "hidden" | "everyone";

export type CodexRevealStamp = Readonly<{
  at: string;
  sessionId: string | null;
  sessionNumber: number | null;
  inWorldDate: CodexInWorldDate | null;
  inWorldLabel: string | null;
}>;
export type PlayerCodexRevealStamp = Readonly<{
  at: string;
  sessionNumber: number | null;
  inWorldDate: CodexInWorldDate | null;
  inWorldLabel: string | null;
}>;
export type CodexBlockReveal = CodexRevealStamp & Readonly<{ to: "everyone" | string }>;

export type CodexBlock = Readonly<{
  id: string;
  anchor: number;
  title: string | null;
  text: string;
  audience: CodexAudience;
  characterIds: readonly string[];
  reveals: readonly CodexBlockReveal[];
}>;
export type PlayerCodexBlock = Readonly<{
  title: string | null;
  start: number;
  end: number;
  characterIds: readonly string[];
  revealed: PlayerCodexRevealStamp;
}>;

export type CodexPageSummary = Readonly<{
  id: string;
  title: string;
  entityType: CodexEntityType;
  fields: Readonly<Record<string, string>>;
  hiddenFields: readonly string[];
  folder: string | null;
  tags: readonly string[];
  revealedToPlayers: boolean;
  bannerAssetId: string | null;
  inWorldLabel: string | null;
  calendarInstant: number | null;
  inWorldDate: CodexInWorldDate | null;
  rev: number;
  createdAt: string;
  updatedAt: string;
  playerUpdatedAt: string;
  characterUpdatedAt: Readonly<Record<string, string>>;
  firstShownAt: string | null;
}>;
export type CodexPage = CodexPageSummary & Readonly<{ playerBody: string; blocks: readonly CodexBlock[] }>;

export type PlayerCodexPage = Readonly<{
  id: string;
  title: string;
  entityType: CodexEntityType;
  tags: readonly string[];
  bannerAssetId: string | null;
  playerUpdatedAt: string;
  fields: Readonly<Record<string, string>>;
  body: string;
  firstShownAt: string;
  blocks: readonly PlayerCodexBlock[];
}>;

export type CodexRelationshipBegan = Readonly<{
  inWorldDate: CodexInWorldDate | null;
  beforeCampaign: boolean;
  inWorldLabel: string | null;
  calendarInstant: number | null;
}>;

type ConnectionSourceKind = "page" | "session" | "quest" | "journal";
export type CodexPageConnection = Readonly<{
  id: string | null;
  direction: "out" | "in";
  otherKind: ConnectionSourceKind;
  otherId: string;
  otherTitle: string;
  otherEntityType: CodexEntityType | null;
  otherRevealed: boolean;
  label: string | null;
  origin: CodexConnectionOrigin;
  layer: CodexConnectionLayer;
  characterIds: readonly string[];
  section: string | null;
  began: CodexRelationshipBegan | null;
  learned: CodexRevealStamp | null;
}>;
export type PlayerCodexPageConnection = Readonly<{
  direction: "out" | "in";
  otherKind: ConnectionSourceKind;
  otherId: string;
  otherTitle: string;
  otherEntityType: CodexEntityType | null;
  label: string | null;
  origin: CodexConnectionOrigin;
  section: string | null;
  began: CodexRelationshipBegan | null;
  learned: PlayerCodexRevealStamp | null;
}>;
export type CodexConnection = Readonly<{
  id: string | null;
  fromKind: ConnectionSourceKind;
  fromId: string;
  toPageId: string;
  label: string | null;
  origin: CodexConnectionOrigin;
  layer: CodexConnectionLayer;
  characterIds: readonly string[];
  began: CodexRelationshipBegan | null;
  learned: CodexRevealStamp | null;
  createdAt: string | null;
}>;
export type PlayerCodexConnection = Readonly<{
  fromKind: ConnectionSourceKind;
  fromId: string;
  toPageId: string;
  label: string | null;
  origin: CodexConnectionOrigin;
  began: CodexRelationshipBegan | null;
  learned: PlayerCodexRevealStamp | null;
}>;

export type CodexQuestObjective = Readonly<{
  id: string;
  text: string;
  done: boolean;
  audience: CodexAudience;
  characterIds: readonly string[];
}>;
export type CodexQuest = Readonly<{
  id: string;
  title: string;
  status: CodexQuestStatus;
  playerBody: string;
  blocks: readonly CodexBlock[];
  objectives: readonly CodexQuestObjective[];
  entityIds: readonly string[];
  revealedToPlayers: boolean;
  tags: readonly string[];
  rev: number;
  createdAt: string;
  updatedAt: string;
  firstShownAt: string | null;
}>;
export type PlayerCodexQuest = Readonly<{
  id: string;
  title: string;
  status: CodexQuestStatus;
  body: string;
  blocks: readonly PlayerCodexBlock[];
  objectives: ReadonlyArray<Readonly<{ text: string; done: boolean }>>;
  entityIds: readonly string[];
  tags: readonly string[];
}>;

// ----- Search and home -----

export const CODEX_SEARCH_TYPES = [
  "note",
  "character",
  "location",
  "faction",
  "item",
  "species",
  "religion",
  "event",
  "journal",
  "map",
  "marker",
  "quest",
  "session"
] as const;
export type CodexSearchType = (typeof CODEX_SEARCH_TYPES)[number];
export type CodexSearchVisibility = "all" | "revealed" | "hidden";

type HitBase = Readonly<{
  kind: CodexRecordKind;
  id: string;
  title: string;
  tags: readonly string[];
  entityType: CodexEntityType | null;
  mapId: string | null;
  type: CodexSearchType;
}>;
export type CodexSearchHit = HitBase &
  Readonly<{
    revealedToPlayers: boolean;
    modifiedAt: string;
    columns: Readonly<Record<string, string>>;
    match: Readonly<{ line: string; hidden: boolean }> | null;
  }>;
export type PlayerCodexSearchHit = HitBase &
  Readonly<{
    modifiedAt: string | null;
    columns: Readonly<Record<string, string>>;
    match: Readonly<{ line: string }> | null;
  }>;
export type CodexSearchResult = Readonly<{ hits: readonly CodexSearchHit[]; truncated: boolean; total: number }>;
export type PlayerCodexSearchResult = Readonly<{
  hits: readonly PlayerCodexSearchHit[];
  truncated: boolean;
  total: number;
}>;

export type CodexRevealCheckRow = Readonly<{
  reason: "link" | "placeholder" | "hidden-pin";
  kind: CodexRecordKind;
  id: string;
  title: string;
  mapId: string | null;
  targetKind: "page" | "map" | "marker" | null;
  targetId: string | null;
  targetTitle: string | null;
  fieldKey: string | null;
}>;
export type CodexHome = Readonly<{
  collections: ReadonlyArray<Readonly<{ type: CodexSearchType; revealed: number; hidden: number }>>;
  recent: ReadonlyArray<
    Readonly<{
      kind: CodexRecordKind;
      id: string;
      title: string;
      type: CodexSearchType;
      mapId: string | null;
      changedAt: string;
      change: "created" | "edited" | "revealed" | "hidden";
      audience: CodexAudience;
      characterIds: readonly string[];
    }>
  >;
  revealCheck: Readonly<{ rows: readonly CodexRevealCheckRow[]; total: number }>;
}>;
export type PlayerCodexHome = Readonly<{
  newSince: ReadonlyArray<
    Readonly<{
      kind: CodexRecordKind;
      id: string;
      title: string;
      type: CodexSearchType;
      mapId: string | null;
      at: string;
      change: "new" | "updated";
    }>
  >;
  truncated: boolean;
}>;

// ----- `codex-blocks.ts`: where a block sits in the text -----

/** A span of text, `end` exclusive. */
export type CodexTextSpan = Readonly<{ start: number; end: number }>;
const BLANK_LINE = /^[ \t\r]*$/;

/** The paragraphs of a text, split at blank lines. Leading and trailing blank lines belong to no paragraph. */
export function codexParagraphs(text: string): CodexTextSpan[] {
  const spans: CodexTextSpan[] = [];
  let open: number | null = null;
  let lastEnd = 0;
  let lineStart = 0;
  for (;;) {
    const newline = text.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    const line = text.slice(lineStart, lineEnd);
    if (BLANK_LINE.test(line)) {
      if (open !== null) spans.push({ start: open, end: lastEnd });
      open = null;
    } else {
      open ??= lineStart;
      lastEnd = line.endsWith("\r") ? lineEnd - 1 : lineEnd;
    }
    if (newline === -1) break;
    lineStart = newline + 1;
  }
  if (open !== null) spans.push({ start: open, end: lastEnd });
  return spans;
}
