import { resolveNow } from "./calendar.js";
import { freshId, stamp, write, type CodexDb } from "./db.js";
import { writeEntry } from "./journal.js";
import { rebuildLinks, scrubLinks } from "./links.js";
import { indexQuest, unindex } from "./search.js";
import { activeSessionId } from "./sessions.js";
import {
  CodexNotFoundError,
  CodexRevisionConflictError,
  body,
  coerceQuestStatus,
  idArray,
  isId,
  parseObjectives,
  parseStringArray,
  questObjectives,
  questStatus,
  tags,
  title,
  type CodexQuestObjective,
  type CodexQuestStatus
} from "./validate.js";

/**
 * Quests (`codex_quests`). The player body is what the party was told; the GM body is where it is really going.
 * Every status change also writes a hidden `quest` history record to the journal in the same transaction.
 */

export type { CodexQuestObjective, CodexQuestStatus } from "./validate.js";
export type CodexQuestRow = Readonly<{
  id: string;
  title: string;
  status: CodexQuestStatus;
  /** The player half, gated by `revealedToPlayers`: what the party has actually been told. */
  playerBody: string;
  /** GM-only: never projected to a player. */
  gmBody: string;
  /** Ordered: the GM's sequence is the meaning, so nothing sorts, dedupes or re-keys it. */
  objectives: readonly CodexQuestObjective[];
  /** Pages this quest concerns, filtered to revealed pages on the way to a player. */
  entityIds: readonly string[];
  revealedToPlayers: boolean;
  tags: readonly string[];
  rev: number;
  createdAt: string;
  updatedAt: string;
}>;
export type CodexQuestCreateInput = Readonly<{
  title: string;
  status?: CodexQuestStatus;
  playerBody?: string;
  gmBody?: string;
  objectives?: readonly CodexQuestObjective[];
  entityIds?: readonly string[];
  revealedToPlayers?: boolean;
  tags?: readonly string[];
}>;
/** No `revealedToPlayers`: reveal has its own route, so an edit cannot publish a quest as a side effect. */
export type CodexQuestUpdateInput = Partial<Omit<CodexQuestCreateInput, "revealedToPlayers">>;

type QuestRowRaw = {
  id: string;
  title: string;
  status: string;
  player_body: string;
  gm_body: string;
  objectives_json: string;
  entity_ids_json: string;
  revealed: number;
  tags_json: string;
  rev: number;
  created_at: string;
  updated_at: string;
};
const QUEST_COLUMNS =
  "id, title, status, player_body, gm_body, objectives_json, entity_ids_json, revealed, tags_json, rev, created_at, updated_at";

function toQuest(row: QuestRowRaw): CodexQuestRow {
  return {
    id: row.id,
    title: row.title,
    status: coerceQuestStatus(row.status),
    playerBody: row.player_body,
    gmBody: row.gm_body,
    objectives: parseObjectives(row.objectives_json),
    entityIds: parseStringArray(row.entity_ids_json),
    revealedToPlayers: row.revealed === 1,
    tags: parseStringArray(row.tags_json),
    rev: row.rev,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** Leaf write of a whole, already-validated quest (create and restore), with its index row and links. */
export function insertQuest(db: CodexDb, quest: CodexQuestRow): void {
  db.database
    .prepare(`INSERT INTO codex_quests (${QUEST_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      quest.id,
      quest.title,
      quest.status,
      quest.playerBody,
      quest.gmBody,
      JSON.stringify(quest.objectives),
      JSON.stringify(quest.entityIds),
      quest.revealedToPlayers ? 1 : 0,
      JSON.stringify(quest.tags),
      quest.rev,
      quest.createdAt,
      quest.updatedAt
    );
  indexQuest(db, quest);
  rebuildLinks(db, "quest", quest.id, quest.playerBody, quest.gmBody);
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

export function createQuest(db: CodexDb, input: CodexQuestCreateInput): CodexQuestRow {
  const now = stamp(db);
  const quest: CodexQuestRow = {
    id: freshId(),
    title: title(input.title),
    status: questStatus(input.status),
    playerBody: body(input.playerBody),
    gmBody: body(input.gmBody),
    objectives: questObjectives(input.objectives),
    // Linked pages are a set (unlike objectives): validated, deduped and capped.
    entityIds: idArray(input.entityIds),
    revealedToPlayers: input.revealedToPlayers === true,
    tags: tags(input.tags),
    rev: 1,
    createdAt: now,
    updatedAt: now
  };
  write(db, () => {
    insertQuest(db, quest);
    // A quest starts when it is created, so that is its first history record.
    writeQuestEvent(db, quest.id, quest.status);
  });
  return getQuest(db, quest.id)!;
}

/** Omitted fields are unchanged; a supplied `objectives` list replaces the old one wholesale. */
export function updateQuest(
  db: CodexDb,
  questId: string,
  input: CodexQuestUpdateInput,
  expectedRev: number | undefined
): CodexQuestRow {
  const existing = getQuest(db, questId);
  if (!existing) throw new CodexNotFoundError("That quest no longer exists.");
  if (expectedRev !== undefined && expectedRev !== existing.rev)
    throw new CodexRevisionConflictError("This quest was changed somewhere else after you opened it.");
  const next: CodexQuestRow = {
    ...existing,
    title: input.title === undefined ? existing.title : title(input.title),
    status: input.status === undefined ? existing.status : questStatus(input.status),
    playerBody: input.playerBody === undefined ? existing.playerBody : body(input.playerBody),
    gmBody: input.gmBody === undefined ? existing.gmBody : body(input.gmBody),
    objectives: input.objectives === undefined ? existing.objectives : questObjectives(input.objectives),
    entityIds: input.entityIds === undefined ? existing.entityIds : idArray(input.entityIds),
    tags: input.tags === undefined ? existing.tags : tags(input.tags),
    // `rev` and `updatedAt` move together on an edit; a reveal moves neither.
    rev: existing.rev + 1,
    updatedAt: stamp(db)
  };
  write(db, () => {
    db.database
      .prepare(
        "UPDATE codex_quests SET title = ?, status = ?, player_body = ?, gm_body = ?, objectives_json = ?, entity_ids_json = ?, tags_json = ?, rev = ?, updated_at = ? WHERE id = ?"
      )
      .run(
        next.title,
        next.status,
        next.playerBody,
        next.gmBody,
        JSON.stringify(next.objectives),
        JSON.stringify(next.entityIds),
        JSON.stringify(next.tags),
        next.rev,
        next.updatedAt,
        questId
      );
    indexQuest(db, next);
    rebuildLinks(db, "quest", questId, next.playerBody, next.gmBody);
    // Only a status change is history; prose edits are not.
    if (next.status !== existing.status) writeQuestEvent(db, questId, next.status);
  });
  return getQuest(db, questId)!;
}

/** Revealing is not editing, and needs no reindex: reveal is checked when the index is read. */
export function setQuestRevealed(db: CodexDb, questId: string, revealed: boolean): CodexQuestRow {
  if (!getQuest(db, questId)) throw new CodexNotFoundError("That quest no longer exists.");
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

export function getQuest(db: CodexDb, questId: string): CodexQuestRow | null {
  if (!isId(questId)) return null;
  const row = db.database.prepare(`SELECT ${QUEST_COLUMNS} FROM codex_quests WHERE id = ?`).get(questId) as
    QuestRowRaw | undefined;
  return row ? toQuest(row) : null;
}

/** Oldest first; "still open" is a status filter over this. */
export function listQuests(db: CodexDb): CodexQuestRow[] {
  return (
    db.database.prepare(`SELECT ${QUEST_COLUMNS} FROM codex_quests ORDER BY created_at, id`).all() as QuestRowRaw[]
  ).map(toQuest);
}
