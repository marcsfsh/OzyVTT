import type { CodexAudience, CodexQuest, CodexQuestObjective, CodexQuestStatus } from "@vtt/domain";
import {
  addBlock,
  applyLayout,
  clampAnchors,
  derivedId,
  editBlock,
  linkSources,
  moveBlock,
  newBlocks,
  parseBlocks,
  rebaseAnchors,
  removeBlock,
  serializeBlocks,
  setBlockAudience,
  toWireBlocks,
  type CodexBlockInput,
  type CodexBlockPlacement,
  type StampReader,
  type StoredBlock
} from "./blocks.js";
import { resolveNow } from "./calendar.js";
import { freshId, stamp, write, type CodexDb } from "./db.js";
import { pendingFlag } from "./first-shown.js";
import { writeEntry } from "./journal.js";
import { rebuildLinksFrom, scrubLinks } from "./links.js";
import { stampReader } from "./pages.js";
import { indexQuest, unindex } from "./search.js";
import { activeSessionId } from "./sessions.js";
import {
  CodexNotFoundError,
  CodexRevisionConflictError,
  CodexValidationError,
  audience,
  body,
  coerceQuestStatus,
  idArray,
  isId,
  objectiveText,
  parseStringArray,
  questObjectiveCount,
  questStatus,
  slot,
  tags,
  title
} from "./validate.js";

/**
 * Quests (`codex_quests`). The player body is what the party was told; hidden blocks hold where it is really going.
 * Each objective has its own audience. Every status change also writes a hidden `quest` history record to the
 * journal in the same transaction.
 */

/** An objective as a write gives it: with the id the server gave it, or none for a new one. */
export type CodexQuestObjectiveInput = Readonly<{
  id?: string;
  text: string;
  done: boolean;
  /** Only on a new objective; an existing one's audience has its own write. */
  audience?: CodexAudience;
  characterIds?: readonly string[];
}>;
export type CodexQuestCreateInput = Readonly<{
  title: string;
  status?: CodexQuestStatus;
  playerBody?: string;
  /** Created hidden. */
  blocks?: readonly CodexBlockInput[];
  objectives?: readonly CodexQuestObjectiveInput[];
  entityIds?: readonly string[];
  revealedToPlayers?: boolean;
  tags?: readonly string[];
}>;
/** No `revealedToPlayers`: reveal has its own route, so an edit cannot publish a quest as a side effect. */
export type CodexQuestUpdateInput = Partial<Omit<CodexQuestCreateInput, "revealedToPlayers" | "blocks">> &
  Readonly<{ layout?: readonly CodexBlockPlacement[] }>;

/** A quest as the store holds it: the wire row with its blocks as stored. */
export type CodexQuestRecord = Omit<CodexQuest, "blocks"> & Readonly<{ blocks: readonly StoredBlock[] }>;

type QuestRowRaw = {
  id: string;
  title: string;
  status: string;
  player_body: string;
  blocks_json: string;
  objectives_json: string;
  entity_ids_json: string;
  revealed: number;
  tags_json: string;
  rev: number;
  created_at: string;
  updated_at: string;
  first_shown_at: string | null;
};
const QUEST_COLUMNS =
  "id, title, status, player_body, blocks_json, objectives_json, entity_ids_json, revealed, tags_json, rev, created_at, updated_at, first_shown_at";

/** Order-preserving, the read side of "order is content". A malformed audience reads as hidden. */
export function parseObjectives(questId: string, raw: string | null | undefined): CodexQuestObjective[] {
  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object" && !Array.isArray(entry))
    .map((entry, index) => {
      const ids = Array.isArray(entry.characterIds)
        ? entry.characterIds.filter((value): value is string => typeof value === "string")
        : [];
      const shown =
        entry.audience === "everyone"
          ? { audience: "everyone" as const, characterIds: [] }
          : entry.audience === "characters" && ids.length > 0
            ? { audience: "characters" as const, characterIds: ids }
            : { audience: "hidden" as const, characterIds: [] };
      return {
        id: typeof entry.id === "string" && isId(entry.id) ? entry.id : derivedId(`${questId}\nobjective\n${index}`),
        text: typeof entry.text === "string" ? entry.text : "",
        done: entry.done === true,
        ...shown
      };
    });
}

/**
 * A written list against the stored one. An objective with an id keeps its audience; a new one is shown to everyone
 * unless its input says otherwise. An id the quest does not hold, an id twice, or an audience on an existing
 * objective is refused.
 */
export function objectivesFromInput(
  existing: readonly CodexQuestObjective[],
  input: readonly CodexQuestObjectiveInput[]
): CodexQuestObjective[] {
  if (!Array.isArray(input)) throw new CodexValidationError("Objectives must be a list.");
  questObjectiveCount(input.length);
  const stored = new Map(existing.map((objective) => [objective.id, objective]));
  const listed = new Set<string>();
  return input.map((item) => {
    const text = objectiveText(item?.text);
    const done = item?.done === true;
    if (item.id === undefined) {
      const shown =
        item.audience === undefined
          ? { audience: "everyone" as const, characterIds: [] }
          : audience(item.audience, item.characterIds);
      return { id: freshId(), text, done, ...shown };
    }
    if (item.audience !== undefined || item.characterIds !== undefined)
      throw new CodexValidationError("Change who sees an existing objective through its own audience route.");
    const found = stored.get(item.id);
    if (!found) throw new CodexValidationError("That objective is not on this quest. Leave out the id for a new one.");
    if (listed.has(item.id)) throw new CodexValidationError("An objective is listed twice.");
    listed.add(item.id);
    return { ...found, text, done };
  });
}

function toRecord(row: QuestRowRaw): CodexQuestRecord {
  return {
    id: row.id,
    title: row.title,
    status: coerceQuestStatus(row.status),
    playerBody: row.player_body,
    blocks: parseBlocks(row.blocks_json),
    objectives: parseObjectives(row.id, row.objectives_json),
    entityIds: parseStringArray(row.entity_ids_json),
    revealedToPlayers: row.revealed === 1,
    tags: parseStringArray(row.tags_json),
    rev: row.rev,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    firstShownAt: row.first_shown_at
  };
}
export function toWireQuest(record: CodexQuestRecord, reader: StampReader): CodexQuest {
  return { ...record, blocks: toWireBlocks(record.blocks, reader) };
}

/** The rows that follow a quest's text and audiences: its mentions and its search rows. */
function derive(db: CodexDb, quest: CodexQuestRecord): void {
  indexQuest(db, quest);
  rebuildLinksFrom(db, "quest", quest.id, linkSources(quest.playerBody, quest.blocks));
}

/** Leaf write of a whole, already-validated quest (create and restore), with its index row and links. */
export function insertQuest(db: CodexDb, quest: CodexQuestRecord): void {
  const blocksJson = serializeBlocks(quest.blocks);
  db.database
    .prepare(
      `INSERT INTO codex_quests (${QUEST_COLUMNS}, blocks_pending) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      quest.id,
      quest.title,
      quest.status,
      quest.playerBody,
      blocksJson,
      JSON.stringify(quest.objectives),
      JSON.stringify(quest.entityIds),
      quest.revealedToPlayers ? 1 : 0,
      JSON.stringify(quest.tags),
      quest.rev,
      quest.createdAt,
      quest.updatedAt,
      quest.firstShownAt,
      pendingFlag(blocksJson)
    );
  derive(db, quest);
}

/** Leaf write: the hidden history record of a status the quest reached, with no player text of its own. */
function writeQuestEvent(db: CodexDb, questId: string, status: CodexQuestStatus): void {
  writeEntry(db, {
    playerText: "",
    gmText: null,
    revealedToPlayers: false,
    attachMarkerId: null,
    attachPageId: null,
    kind: "quest",
    sourceEncounterId: null,
    sessionId: activeSessionId(db),
    realDate: null,
    dated: resolveNow(db),
    payload: { questId, status }
  });
}

export function createQuest(db: CodexDb, input: CodexQuestCreateInput): CodexQuest {
  const now = stamp(db);
  const playerBody = body(input.playerBody);
  const quest: CodexQuestRecord = {
    id: freshId(),
    title: title(input.title),
    status: questStatus(input.status),
    playerBody,
    blocks: newBlocks(input.blocks ?? [], playerBody),
    objectives: objectivesFromInput([], input.objectives ?? []),
    // Linked pages are a set (unlike objectives): validated, deduped and capped.
    entityIds: idArray(input.entityIds),
    revealedToPlayers: input.revealedToPlayers === true,
    tags: tags(input.tags),
    rev: 1,
    createdAt: now,
    updatedAt: now,
    // The write dates it if it is created revealed.
    firstShownAt: null
  };
  write(db, () => {
    insertQuest(db, quest);
    // A quest starts when it is created, so that is its first history record.
    writeQuestEvent(db, quest.id, quest.status);
  });
  return getQuest(db, quest.id)!;
}

function existingQuest(db: CodexDb, questId: string, expectedRev: number | undefined): CodexQuestRecord {
  const existing = readQuest(db, questId);
  if (!existing) throw new CodexNotFoundError("That quest no longer exists.");
  if (expectedRev !== undefined && expectedRev !== existing.rev)
    throw new CodexRevisionConflictError("This quest was changed somewhere else after you opened it.");
  return existing;
}

/** Omitted fields are unchanged; a supplied `objectives` list replaces the old one wholesale. */
export function updateQuest(
  db: CodexDb,
  questId: string,
  input: CodexQuestUpdateInput,
  expectedRev: number | undefined
): CodexQuest {
  const existing = existingQuest(db, questId, expectedRev);
  const playerBody = input.playerBody === undefined ? existing.playerBody : body(input.playerBody);
  const rebased = rebaseAnchors(existing.blocks, existing.playerBody, playerBody);
  const next: CodexQuestRecord = {
    ...existing,
    title: input.title === undefined ? existing.title : title(input.title),
    status: input.status === undefined ? existing.status : questStatus(input.status),
    playerBody,
    blocks: input.layout === undefined ? rebased : applyLayout(rebased, input.layout, playerBody),
    objectives:
      input.objectives === undefined ? existing.objectives : objectivesFromInput(existing.objectives, input.objectives),
    entityIds: input.entityIds === undefined ? existing.entityIds : idArray(input.entityIds),
    tags: input.tags === undefined ? existing.tags : tags(input.tags)
  };
  saveQuest(db, existing, next, true);
  return getQuest(db, questId)!;
}

/**
 * One quest write: the row, its search rows and mentions, and its status history. An edit moves `rev` and
 * `updatedAt` together; an audience change or a reveal moves neither.
 */
function saveQuest(db: CodexDb, existing: CodexQuestRecord, proposed: CodexQuestRecord, edit: boolean): void {
  const next: CodexQuestRecord = {
    ...proposed,
    rev: edit ? existing.rev + 1 : existing.rev,
    updatedAt: edit ? stamp(db) : existing.updatedAt
  };
  const blocksJson = serializeBlocks(next.blocks);
  write(db, () => {
    db.database
      .prepare(
        "UPDATE codex_quests SET title = ?, status = ?, player_body = ?, blocks_json = ?, blocks_pending = ?, objectives_json = ?, entity_ids_json = ?, tags_json = ?, rev = ?, updated_at = ? WHERE id = ?"
      )
      .run(
        next.title,
        next.status,
        next.playerBody,
        blocksJson,
        pendingFlag(blocksJson),
        JSON.stringify(next.objectives),
        JSON.stringify(next.entityIds),
        JSON.stringify(next.tags),
        next.rev,
        next.updatedAt,
        next.id
      );
    derive(db, next);
    // Only a status change is history; prose edits are not.
    if (next.status !== existing.status) writeQuestEvent(db, next.id, next.status);
  });
}

// Hidden blocks, as on a page. Content and place are edits; an audience is not.

export function addQuestBlock(
  db: CodexDb,
  questId: string,
  input: CodexBlockInput & Readonly<{ slot?: number }>,
  expectedRev: number | undefined
): { quest: CodexQuest; blockId: string } {
  const existing = existingQuest(db, questId, expectedRev);
  const added = addBlock(existing.blocks, input, slot(input.slot), existing.playerBody);
  saveQuest(db, existing, { ...existing, blocks: added.blocks }, true);
  return { quest: getQuest(db, questId)!, blockId: added.block.id };
}

export function editQuestBlock(
  db: CodexDb,
  questId: string,
  blockId: string,
  input: Readonly<{ title?: string | null; text?: string }>,
  expectedRev: number | undefined
): CodexQuest {
  const existing = existingQuest(db, questId, expectedRev);
  saveQuest(db, existing, { ...existing, blocks: editBlock(existing.blocks, blockId, input) }, true);
  return getQuest(db, questId)!;
}

export function moveQuestBlock(
  db: CodexDb,
  questId: string,
  blockId: string,
  place: Readonly<{ anchor: number; slot?: number }>,
  expectedRev: number | undefined
): CodexQuest {
  const existing = existingQuest(db, questId, expectedRev);
  const blocks = moveBlock(existing.blocks, blockId, place.anchor, slot(place.slot), existing.playerBody);
  saveQuest(db, existing, { ...existing, blocks }, true);
  return getQuest(db, questId)!;
}

/** Idempotent: a block already gone leaves the quest as it is. */
export function deleteQuestBlock(db: CodexDb, questId: string, blockId: string, expectedRev?: number): CodexQuest {
  const existing = existingQuest(db, questId, expectedRev);
  if (!existing.blocks.some((block) => block.id === blockId)) return getQuest(db, questId)!;
  saveQuest(db, existing, { ...existing, blocks: removeBlock(existing.blocks, blockId) }, true);
  return getQuest(db, questId)!;
}

export function setQuestBlockAudience(
  db: CodexDb,
  questId: string,
  blockId: string,
  value: string,
  characterIds: readonly string[] | undefined
): CodexQuest {
  const existing = existingQuest(db, questId, undefined);
  const blocks = setBlockAudience(existing.blocks, blockId, value, characterIds);
  saveQuest(db, existing, { ...existing, blocks }, false);
  return getQuest(db, questId)!;
}

/** Who sees one objective. Not an edit. */
export function setObjectiveAudience(
  db: CodexDb,
  questId: string,
  objectiveId: string,
  value: string,
  characterIds: readonly string[] | undefined
): CodexQuest {
  const existing = existingQuest(db, questId, undefined);
  if (!existing.objectives.some((objective) => objective.id === objectiveId))
    throw new CodexNotFoundError("That objective no longer exists.");
  const shown = audience(value, characterIds);
  const objectives = existing.objectives.map((objective) =>
    objective.id === objectiveId ? { ...objective, ...shown } : objective
  );
  saveQuest(db, existing, { ...existing, objectives }, false);
  return getQuest(db, questId)!;
}

/** Revealing is not editing, and needs no reindex: reveal is checked when the index is read. */
export function setQuestRevealed(db: CodexDb, questId: string, revealed: boolean): CodexQuest {
  if (!readQuest(db, questId)) throw new CodexNotFoundError("That quest no longer exists.");
  write(db, () => {
    db.database.prepare("UPDATE codex_quests SET revealed = ? WHERE id = ?").run(revealed ? 1 : 0, questId);
  });
  return getQuest(db, questId)!;
}

/** Leaf delete. Its history records stay: they carry the quest id without a foreign key. */
export function deleteQuest(db: CodexDb, questId: string): void {
  db.database.prepare("DELETE FROM codex_quests WHERE id = ?").run(questId);
  unindex(db, "quest", questId);
  scrubLinks(db, "quest", questId);
}

/** Leaf write for a deleted page: quests link pages in a JSON list with no foreign key, so it is removed there. */
export function unlinkPageFromQuests(db: CodexDb, pageId: string): void {
  db.database
    .prepare(
      "UPDATE codex_quests SET entity_ids_json = COALESCE((SELECT json_group_array(value) FROM json_each(codex_quests.entity_ids_json) WHERE value != ?), '[]'), updated_at = ? WHERE EXISTS (SELECT 1 FROM json_each(codex_quests.entity_ids_json) WHERE value = ?)"
    )
    .run(pageId, stamp(db), pageId);
}

export function readQuest(db: CodexDb, questId: string): CodexQuestRecord | null {
  if (!isId(questId)) return null;
  const row = db.database.prepare(`SELECT ${QUEST_COLUMNS} FROM codex_quests WHERE id = ?`).get(questId) as
    QuestRowRaw | undefined;
  return row ? toRecord(row) : null;
}

export function getQuest(db: CodexDb, questId: string): CodexQuest | null {
  const record = readQuest(db, questId);
  return record ? toWireQuest(record, stampReader(db)) : null;
}

/** Every quest as stored, oldest first. */
export function listQuestRecords(db: CodexDb): CodexQuestRecord[] {
  return (
    db.database.prepare(`SELECT ${QUEST_COLUMNS} FROM codex_quests ORDER BY created_at, id`).all() as QuestRowRaw[]
  ).map(toRecord);
}

/** Oldest first; "still open" is a status filter over this. */
export function listQuests(db: CodexDb): CodexQuest[] {
  const reader = stampReader(db);
  return listQuestRecords(db).map((record) => toWireQuest(record, reader));
}

/** A restored quest: its blocks placed in its text. */
export function restoreQuest(db: CodexDb, quest: CodexQuestRecord): void {
  insertQuest(db, { ...quest, blocks: clampAnchors(quest.blocks, quest.playerBody) });
}
