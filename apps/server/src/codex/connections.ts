import {
  dateToInstant,
  pageLinkKey,
  type CodexConnection,
  type CodexConnectionSourceKind,
  type CodexEntityType,
  type CodexInWorldDate,
  type CodexPageConnection,
  type CodexRelationshipBegan,
  type CodexRevealStamp
} from "@vtt/domain";
import { stampOf, type StampReader, type StoredReveal } from "./blocks.js";
import { inWorldLabel } from "./calendar.js";
import { freshId, stamp, write, type CodexDb } from "./db.js";
import { getEntry } from "./journal.js";
import { allPageMentions, mentionsFrom, mentionsOf } from "./links.js";
import { readPage, stampReader, touchPages } from "./pages.js";
import { readQuest } from "./quests.js";
import { getSession } from "./sessions.js";
import {
  CodexNotFoundError,
  CodexValidationError,
  connectionLabel,
  connectionLayer,
  id,
  isId,
  relationshipBegan
} from "./validate.js";

/**
 * Connections: one read model over declared edges between pages (`codex_relationships`) and `[[wiki link]]`
 * mentions (`codex_links`, through `links.ts`). Nothing here is gated; the player projections are.
 */

/** When a declared connection began, as the GM gives it. */
export type CodexBeganInput = Readonly<{ inWorldDate: CodexInWorldDate | null; beforeCampaign: boolean }>;
/** One declared connection as stored. `learned` is null until players can read it, and for one they read before stamps. */
export type CodexRelationshipRow = Readonly<{
  id: string;
  fromPageId: string;
  toPageId: string;
  label: string | null;
  layer: "player" | "gm";
  createdAt: string;
  began: CodexBeganInput | null;
  learned: Omit<StoredReveal, "to"> | null;
}>;

/** Labels that read the same from either end; declaring one both ways is one connection. */
const SYMMETRIC_LABELS = new Set(["ally of", "enemy of", "rival of", "related to"]);

type RelationshipRowRaw = {
  id: string;
  from_page_id: string;
  to_page_id: string;
  label: string;
  layer: string;
  created_at: string;
  began_year: number | null;
  began_month: number | null;
  began_day: number | null;
  began_before: number;
  learned_at: string | null;
  learned_session_id: string | null;
  learned_session_number: number | null;
  learned_year: number | null;
  learned_month: number | null;
  learned_day: number | null;
};
const RELATIONSHIP_COLUMNS =
  "id, from_page_id, to_page_id, label, layer, created_at, began_year, began_month, began_day, began_before, learned_at, learned_session_id, learned_session_number, learned_year, learned_month, learned_day";

function dateOf(year: number | null, month: number | null, day: number | null): CodexInWorldDate | null {
  return year !== null && month !== null && day !== null ? { year, month, day } : null;
}
function toRelationship(row: RelationshipRowRaw): CodexRelationshipRow {
  const beganDate = dateOf(row.began_year, row.began_month, row.began_day);
  return {
    id: row.id,
    fromPageId: row.from_page_id,
    toPageId: row.to_page_id,
    label: row.label === "" ? null : row.label,
    layer: row.layer === "gm" ? "gm" : "player",
    createdAt: row.created_at,
    began:
      row.began_before === 1
        ? { inWorldDate: null, beforeCampaign: true }
        : beganDate
          ? { inWorldDate: beganDate, beforeCampaign: false }
          : null,
    // The empty mark is "players read it before stamps existed": known, but with no date to give.
    learned: row.learned_at
      ? {
          at: row.learned_at,
          sessionId: row.learned_session_id,
          sessionNumber: row.learned_session_number,
          inWorldDate: dateOf(row.learned_year, row.learned_month, row.learned_day)
        }
      : null
  };
}

/** A tie's start as the wire carries it, labelled and placed by the live calendar. */
export function beganOf(began: CodexBeganInput | null, reader: StampReader): CodexRelationshipBegan | null {
  if (!began) return null;
  const date = began.inWorldDate;
  return {
    inWorldDate: date,
    beforeCampaign: began.beforeCampaign,
    inWorldLabel: date ? inWorldLabel(reader.calendar, date) : null,
    calendarInstant: date ? dateToInstant(reader.calendar, date) : null
  };
}
export function learnedOf(relationship: CodexRelationshipRow, reader: StampReader): CodexRevealStamp | null {
  if (!relationship.learned) return null;
  const { to: _to, ...learned } = stampOf({ to: "everyone", ...relationship.learned }, reader);
  return learned;
}
function relationshipRow(db: CodexDb, connectionId: string): RelationshipRowRaw | undefined {
  return db.database
    .prepare(`SELECT ${RELATIONSHIP_COLUMNS} FROM codex_relationships WHERE id = ?`)
    .get(connectionId) as RelationshipRowRaw | undefined;
}

/** Leaf write of a declared connection (create and restore). An unlabelled one stores `''`. */
export function insertRelationship(db: CodexDb, relationship: CodexRelationshipRow): void {
  const began = relationship.began;
  const learned = relationship.learned;
  db.database
    .prepare(
      `INSERT INTO codex_relationships (${RELATIONSHIP_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      relationship.id,
      relationship.fromPageId,
      relationship.toPageId,
      relationship.label ?? "",
      relationship.layer,
      relationship.createdAt,
      began?.inWorldDate?.year ?? null,
      began?.inWorldDate?.month ?? null,
      began?.inWorldDate?.day ?? null,
      began?.beforeCampaign ? 1 : 0,
      learned?.at ?? null,
      learned?.sessionId ?? null,
      learned?.sessionNumber ?? null,
      learned?.inWorldDate?.year ?? null,
      learned?.inWorldDate?.month ?? null,
      learned?.inWorldDate?.day ?? null
    );
}

/** Idempotent on `(from, to, label)`, both directions for a symmetric label. `layer` is not part of the key. */
export function createConnection(
  db: CodexDb,
  fromPageId: string,
  input: Readonly<{
    toPageId: string;
    label?: string | null;
    layer?: "player" | "gm" | null;
    began?: CodexBeganInput | null;
  }>
): CodexRelationshipRow {
  const from = id(fromPageId);
  const to = id(input.toPageId);
  if (from === to) throw new CodexValidationError("A page can't connect to itself.");
  if (!readPage(db, from) || !readPage(db, to)) throw new CodexNotFoundError("One of those pages no longer exists.");
  const label = connectionLabel(input.label);
  const layer = connectionLayer(input.layer);
  const began = relationshipBegan(input.began);
  const existing = (
    SYMMETRIC_LABELS.has(label)
      ? db.database
          .prepare(
            `SELECT ${RELATIONSHIP_COLUMNS} FROM codex_relationships WHERE ((from_page_id = ? AND to_page_id = ?) OR (from_page_id = ? AND to_page_id = ?)) AND label = ?`
          )
          .get(from, to, to, from, label)
      : db.database
          .prepare(
            `SELECT ${RELATIONSHIP_COLUMNS} FROM codex_relationships WHERE from_page_id = ? AND to_page_id = ? AND label = ?`
          )
          .get(from, to, label)
  ) as RelationshipRowRaw | undefined;
  // An idempotent repeat is not an edit, so page recency is left alone.
  if (existing) return toRelationship(existing);
  const now = stamp(db);
  const relationship: CodexRelationshipRow = {
    id: freshId(),
    fromPageId: from,
    toPageId: to,
    label: label || null,
    layer,
    createdAt: now,
    began,
    // The write stamps it if players can read it at once.
    learned: null
  };
  write(db, () => {
    insertRelationship(db, relationship);
    touchPages(db, [from, to], now);
  });
  return toRelationship(relationshipRow(db, relationship.id)!);
}

/**
 * Relabel, re-layer or re-date a declared connection; omitted fields are kept. A mention is edited through its text.
 * Moving it to the player layer is how the party learns it: the write stamps `learned` once players can read it.
 */
export function updateConnection(
  db: CodexDb,
  connectionId: string,
  input: Readonly<{ label?: string | null; layer?: "player" | "gm"; began?: CodexBeganInput | null }>
): CodexRelationshipRow {
  const existing = isId(connectionId) ? relationshipRow(db, connectionId) : undefined;
  if (!existing) throw new CodexNotFoundError("That connection no longer exists.");
  const label = input.label === undefined ? existing.label : connectionLabel(input.label);
  const layer = input.layer === undefined ? existing.layer : connectionLayer(input.layer);
  const began = input.began === undefined ? toRelationship(existing).began : relationshipBegan(input.began);
  write(db, () => {
    db.database
      .prepare(
        "UPDATE codex_relationships SET label = ?, layer = ?, began_year = ?, began_month = ?, began_day = ?, began_before = ? WHERE id = ?"
      )
      .run(
        label,
        layer,
        began?.inWorldDate?.year ?? null,
        began?.inWorldDate?.month ?? null,
        began?.inWorldDate?.day ?? null,
        began?.beforeCampaign ? 1 : 0,
        connectionId
      );
    touchPages(db, [existing.from_page_id, existing.to_page_id], stamp(db));
  });
  return toRelationship(relationshipRow(db, connectionId)!);
}

/** Removes one declared connection; idempotent. */
export function deleteConnection(db: CodexDb, connectionId: string): void {
  if (!isId(connectionId)) return;
  // Read first so both pages' recency moves.
  const existing = relationshipRow(db, connectionId);
  write(db, () => {
    db.database.prepare("DELETE FROM codex_relationships WHERE id = ?").run(connectionId);
    if (existing) touchPages(db, [existing.from_page_id, existing.to_page_id], stamp(db));
  });
}

/** Every declared connection, for the backup. Mentions are derived from text and rebuilt on restore. */
export function listAllDeclaredConnections(db: CodexDb): CodexRelationshipRow[] {
  return (
    db.database.prepare(`SELECT ${RELATIONSHIP_COLUMNS} FROM codex_relationships`).all() as RelationshipRowRaw[]
  ).map(toRelationship);
}

/** Title and reveal flag of a connection's other end; null when the record is gone, which drops the edge. */
function endpoint(
  db: CodexDb,
  kind: CodexConnectionSourceKind,
  recordId: string
): Readonly<{ title: string; entityType: CodexEntityType | null; revealed: boolean }> | null {
  switch (kind) {
    case "page": {
      const page = readPage(db, recordId);
      return page ? { title: page.title, entityType: page.entityType, revealed: page.revealedToPlayers } : null;
    }
    case "session": {
      const session = getSession(db, recordId);
      if (!session) return null;
      const title =
        session.sessionNumber !== null
          ? `Session ${session.sessionNumber}`
          : session.recapBody.trim().slice(0, 80) || "Untitled session";
      return { title, entityType: null, revealed: session.revealedToPlayers };
    }
    case "quest": {
      const quest = readQuest(db, recordId);
      return quest ? { title: quest.title, entityType: null, revealed: quest.revealedToPlayers } : null;
    }
    case "journal": {
      const entry = getEntry(db, recordId);
      // The player text for both audiences: this is a row title, and the GM can open the record for the rest.
      return entry
        ? {
            title: entry.playerText.trim().slice(0, 80) || "Journal entry",
            entityType: null,
            revealed: entry.revealedToPlayers
          }
        : null;
    }
  }
}

type LinkTarget = Readonly<{ id: string; title: string; entityType: CodexEntityType; revealed: boolean }>;
/**
 * Every page by its link key, read in one query with no query per mention. Where titles collide, a revealed page
 * wins, then the oldest, so a hidden page never takes a revealed page's connections away from players.
 */
export function pagesByLinkKey(db: CodexDb): Map<string, LinkTarget> {
  const byKey = new Map<string, LinkTarget>();
  for (const page of db.database
    .prepare("SELECT id, title, entity_type, revealed FROM codex_pages ORDER BY revealed DESC, created_at, id")
    .all() as Array<{
    id: string;
    title: string;
    entity_type: string;
    revealed: number;
  }>) {
    const key = pageLinkKey(page.title);
    if (byKey.has(key)) continue;
    byKey.set(key, {
      id: page.id,
      title: page.title,
      entityType: page.entity_type as CodexEntityType,
      revealed: page.revealed === 1
    });
  }
  return byKey;
}

/** What a mention row carries that a declared one does not, and the reverse. */
const MENTION_DATES = { began: null, learned: null } as const;

/**
 * One page's Connections panel, raw and ungated. `otherRevealed` is a GM fact, weaker than the player rules;
 * never filter on it. An unlabelled declared edge absorbs a mention over the same pair.
 */
export function connectionsForPage(db: CodexDb, pageId: string): CodexPageConnection[] {
  const page = readPage(db, pageId);
  if (!page) return [];
  const reader = stampReader(db);
  const rows: CodexPageConnection[] = [];

  for (const direction of ["out", "in"] as const) {
    const mine = direction === "out" ? "from_page_id" : "to_page_id";
    const theirs = direction === "out" ? "to_page_id" : "from_page_id";
    const declared = db.database
      .prepare(
        `SELECT ${RELATIONSHIP_COLUMNS.split(", ")
          .map((column) => `r.${column}`)
          .join(
            ", "
          )}, r.${theirs} AS other_id, p.title AS other_title, p.entity_type AS other_type, p.revealed AS other_revealed
         FROM codex_relationships r JOIN codex_pages p ON p.id = r.${theirs} WHERE r.${mine} = ? ORDER BY r.label, p.title COLLATE NOCASE`
      )
      .all(pageId) as Array<
      RelationshipRowRaw & { other_id: string; other_title: string; other_type: string; other_revealed: number }
    >;
    for (const row of declared) {
      const relationship = toRelationship(row);
      rows.push({
        id: row.id,
        direction,
        otherKind: "page",
        otherId: row.other_id,
        otherTitle: row.other_title,
        otherEntityType: row.other_type as CodexEntityType,
        otherRevealed: row.other_revealed === 1,
        label: relationship.label,
        origin: "declared",
        layer: relationship.layer,
        characterIds: [],
        section: null,
        began: beganOf(relationship.began, reader),
        learned: learnedOf(relationship, reader)
      });
    }
  }

  // Incoming mentions: every record whose text names this page's title.
  for (const mention of mentionsOf(db, pageLinkKey(page.title), pageId)) {
    const other = endpoint(db, mention.sourceKind, mention.sourceId);
    if (!other) continue;
    rows.push({
      id: null,
      direction: "in",
      otherKind: mention.sourceKind,
      otherId: mention.sourceId,
      otherTitle: other.title,
      otherEntityType: other.entityType,
      otherRevealed: other.revealed,
      label: null,
      origin: "mention",
      layer: mention.layer,
      characterIds: [...mention.characterIds],
      section: mention.section,
      ...MENTION_DATES
    });
  }

  // Outgoing mentions, resolved by title key; a link to an unknown title is dropped.
  const outgoing = mentionsFrom(db, pageId);
  if (outgoing.length > 0) {
    const byKey = pagesByLinkKey(db);
    for (const mention of outgoing) {
      const target = byKey.get(mention.targetRef);
      if (!target || target.id === pageId) continue;
      rows.push({
        id: null,
        direction: "out",
        otherKind: "page",
        otherId: target.id,
        otherTitle: target.title,
        otherEntityType: target.entityType,
        otherRevealed: target.revealed,
        label: null,
        origin: "mention",
        layer: mention.layer,
        characterIds: [...mention.characterIds],
        section: mention.section,
        ...MENTION_DATES
      });
    }
  }

  // An unlabelled declared edge and a mention over the same pair fold into one row, the declared one winning. A
  // GM-layer edge folds only a mention no player reads, or adding it would take a mention away from players.
  const pairOf = (row: CodexPageConnection) => `${row.direction}|${row.otherKind}|${row.otherId}`;
  const declared = rows.filter((row) => row.origin === "declared" && row.label === null);
  const playerPairs = new Set(declared.filter((row) => row.layer === "player").map(pairOf));
  const gmPairs = new Set(declared.filter((row) => row.layer === "gm").map(pairOf));
  return rows.filter(
    (row) =>
      row.origin === "declared" ||
      !(
        playerPairs.has(pairOf(row)) ||
        (row.layer === "gm" && row.characterIds.length === 0 && gmPairs.has(pairOf(row)))
      )
  );
}

/**
 * The whole graph. Mentions collapse per `(fromKind, fromId, toPageId)`: one in text everyone reads makes a player
 * edge; otherwise the edge is GM layer and names every character a block with the mention is shown to.
 */
export function listAllConnections(db: CodexDb): CodexConnection[] {
  const reader = stampReader(db);
  const edges: CodexConnection[] = listAllDeclaredConnections(db).map((relationship) => ({
    id: relationship.id,
    fromKind: "page",
    fromId: relationship.fromPageId,
    toPageId: relationship.toPageId,
    label: relationship.label,
    origin: "declared",
    layer: relationship.layer,
    characterIds: [],
    began: beganOf(relationship.began, reader),
    learned: learnedOf(relationship, reader),
    createdAt: relationship.createdAt
  }));
  const byKey = pagesByLinkKey(db);
  const mentions = new Map<string, CodexConnection>();
  for (const mention of allPageMentions(db)) {
    const toPageId = byKey.get(mention.targetRef)?.id;
    if (!toPageId || (mention.sourceKind === "page" && toPageId === mention.sourceId)) continue;
    const key = `${mention.sourceKind}|${mention.sourceId}|${toPageId}`;
    const seen = mentions.get(key);
    const characterIds = mention.layer === "player" ? [] : [...mention.characterIds];
    if (!seen)
      mentions.set(key, {
        id: null,
        fromKind: mention.sourceKind,
        fromId: mention.sourceId,
        toPageId,
        label: null,
        origin: "mention",
        layer: mention.layer,
        characterIds,
        ...MENTION_DATES,
        createdAt: null
      });
    else if (seen.layer === "player") continue;
    else if (mention.layer === "player") mentions.set(key, { ...seen, layer: "player", characterIds: [] });
    else mentions.set(key, { ...seen, characterIds: [...new Set([...seen.characterIds, ...characterIds])].sort() });
  }
  return [...edges, ...mentions.values()];
}
