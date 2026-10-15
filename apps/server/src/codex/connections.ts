import { pageLinkKey, type CodexEntityType } from "@vtt/domain";
import { freshId, stamp, write, type CodexDb } from "./db.js";
import { getEntry } from "./journal.js";
import { allPageMentions, mentionsFrom, mentionsOf, type CodexConnectionSourceKind } from "./links.js";
import { getPage, touchPages } from "./pages.js";
import { getQuest } from "./quests.js";
import { getSession } from "./sessions.js";
import { CodexNotFoundError, CodexValidationError, connectionLabel, connectionLayer, id, isId } from "./validate.js";

/**
 * Connections: one read model over declared edges between pages (`codex_relationships`) and `[[wiki link]]`
 * mentions (`codex_links`, through `links.ts`). Nothing here is gated; the player projections are.
 */

export type { CodexConnectionSourceKind } from "./links.js";
/** One graph edge, declared or a mention (`id` null). `layer` gates players; a mention takes its text's layer. */
export type CodexConnectionRow = Readonly<{
  id: string | null;
  fromKind: CodexConnectionSourceKind;
  fromId: string;
  toPageId: string;
  /** The out-label ("ally of", "located in"); null for an unlabelled connection. */
  label: string | null;
  origin: "declared" | "mention";
  layer: "player" | "gm";
  createdAt: string | null;
}>;
/** One row of a page's Connections panel: the other end resolved, plus the edge's direction. */
export type CodexPageConnectionRow = Readonly<{
  id: string | null;
  direction: "out" | "in";
  otherKind: CodexConnectionSourceKind;
  otherId: string;
  /** A page title, "Session 4", a quest title, or a bounded excerpt of a journal entry's player text. */
  otherTitle: string;
  otherEntityType: CodexEntityType | null;
  /** The other record's own reveal flag. GM-only on the wire; the player projection drops it. */
  otherRevealed: boolean;
  label: string | null;
  origin: "declared" | "mention";
  layer: "player" | "gm";
  /** The heading a mention sits under; null for a declared connection. */
  section: string | null;
}>;
/** One declared connection as stored. */
export type CodexRelationshipRow = Readonly<{
  id: string;
  fromPageId: string;
  toPageId: string;
  label: string | null;
  layer: "player" | "gm";
  createdAt: string;
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
};
const RELATIONSHIP_COLUMNS = "id, from_page_id, to_page_id, label, layer, created_at";

function toRelationship(row: RelationshipRowRaw): CodexRelationshipRow {
  return {
    id: row.id,
    fromPageId: row.from_page_id,
    toPageId: row.to_page_id,
    label: row.label === "" ? null : row.label,
    layer: row.layer === "gm" ? "gm" : "player",
    createdAt: row.created_at
  };
}
function relationshipRow(db: CodexDb, connectionId: string): RelationshipRowRaw | undefined {
  return db.database
    .prepare(`SELECT ${RELATIONSHIP_COLUMNS} FROM codex_relationships WHERE id = ?`)
    .get(connectionId) as RelationshipRowRaw | undefined;
}

/** Leaf write of a declared connection (create and restore). An unlabelled one stores `''`. */
export function insertRelationship(db: CodexDb, relationship: CodexRelationshipRow): void {
  db.database
    .prepare(`INSERT INTO codex_relationships (${RELATIONSHIP_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(
      relationship.id,
      relationship.fromPageId,
      relationship.toPageId,
      relationship.label ?? "",
      relationship.layer,
      relationship.createdAt
    );
}

/** Idempotent on `(from, to, label)`, both directions for a symmetric label. `layer` is not part of the key. */
export function createConnection(
  db: CodexDb,
  fromPageId: string,
  input: Readonly<{ toPageId: string; label?: string | null; layer?: "player" | "gm" | null }>
): CodexRelationshipRow {
  const from = id(fromPageId);
  const to = id(input.toPageId);
  if (from === to) throw new CodexValidationError("A page can't connect to itself.");
  if (!getPage(db, from) || !getPage(db, to)) throw new CodexNotFoundError("One of those pages no longer exists.");
  const label = connectionLabel(input.label);
  const layer = connectionLayer(input.layer);
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
    createdAt: now
  };
  write(db, () => {
    insertRelationship(db, relationship);
    touchPages(db, [from, to], now);
  });
  return toRelationship(relationshipRow(db, relationship.id)!);
}

/** Relabel or re-layer a declared connection; omitted fields are kept. A mention is edited through its text. */
export function updateConnection(
  db: CodexDb,
  connectionId: string,
  input: Readonly<{ label?: string | null; layer?: "player" | "gm" }>
): CodexRelationshipRow {
  const existing = isId(connectionId) ? relationshipRow(db, connectionId) : undefined;
  if (!existing) throw new CodexNotFoundError("That connection no longer exists.");
  const label = input.label === undefined ? existing.label : connectionLabel(input.label);
  const layer = input.layer === undefined ? existing.layer : connectionLayer(input.layer);
  write(db, () => {
    db.database
      .prepare("UPDATE codex_relationships SET label = ?, layer = ? WHERE id = ?")
      .run(label, layer, connectionId);
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
      const page = getPage(db, recordId);
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
      const quest = getQuest(db, recordId);
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
/** Every page by its link key, read in one query rather than once per mention. */
function pagesByLinkKey(db: CodexDb): Map<string, LinkTarget> {
  const byKey = new Map<string, LinkTarget>();
  for (const page of db.database.prepare("SELECT id, title, entity_type, revealed FROM codex_pages").all() as Array<{
    id: string;
    title: string;
    entity_type: string;
    revealed: number;
  }>)
    byKey.set(pageLinkKey(page.title), {
      id: page.id,
      title: page.title,
      entityType: page.entity_type as CodexEntityType,
      revealed: page.revealed === 1
    });
  return byKey;
}

/**
 * One page's Connections panel, raw and ungated. `otherRevealed` is a GM fact, weaker than the player rules;
 * never filter on it. An unlabelled declared edge absorbs a mention over the same pair.
 */
export function connectionsForPage(db: CodexDb, pageId: string): CodexPageConnectionRow[] {
  const page = getPage(db, pageId);
  if (!page) return [];
  const rows: CodexPageConnectionRow[] = [];

  for (const direction of ["out", "in"] as const) {
    const mine = direction === "out" ? "from_page_id" : "to_page_id";
    const theirs = direction === "out" ? "to_page_id" : "from_page_id";
    const declared = db.database
      .prepare(
        `SELECT r.id, r.label, r.layer, r.${theirs} AS other_id, p.title AS other_title, p.entity_type AS other_type, p.revealed AS other_revealed
         FROM codex_relationships r JOIN codex_pages p ON p.id = r.${theirs} WHERE r.${mine} = ? ORDER BY r.label, p.title COLLATE NOCASE`
      )
      .all(pageId) as Array<{
      id: string;
      label: string;
      layer: string;
      other_id: string;
      other_title: string;
      other_type: string;
      other_revealed: number;
    }>;
    for (const row of declared)
      rows.push({
        id: row.id,
        direction,
        otherKind: "page",
        otherId: row.other_id,
        otherTitle: row.other_title,
        otherEntityType: row.other_type as CodexEntityType,
        otherRevealed: row.other_revealed === 1,
        label: row.label === "" ? null : row.label,
        origin: "declared",
        layer: row.layer === "gm" ? "gm" : "player",
        section: null
      });
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
      section: mention.section
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
        section: mention.section
      });
    }
  }

  // An unlabelled declared edge and a mention over the same pair fold into one row, the declared one winning.
  const declaredPairs = new Set(
    rows
      .filter((row) => row.origin === "declared" && row.label === null)
      .map((row) => `${row.direction}|${row.otherKind}|${row.otherId}`)
  );
  return rows.filter(
    (row) => row.origin === "declared" || !declaredPairs.has(`${row.direction}|${row.otherKind}|${row.otherId}`)
  );
}

/** The whole graph. Mentions collapse per `(fromKind, fromId, toPageId)`; one in player text makes a player edge. */
export function listAllConnections(db: CodexDb): CodexConnectionRow[] {
  const edges: CodexConnectionRow[] = listAllDeclaredConnections(db).map((relationship) => ({
    id: relationship.id,
    fromKind: "page",
    fromId: relationship.fromPageId,
    toPageId: relationship.toPageId,
    label: relationship.label,
    origin: "declared",
    layer: relationship.layer,
    createdAt: relationship.createdAt
  }));
  const byKey = pagesByLinkKey(db);
  const mentions = new Map<string, CodexConnectionRow>();
  for (const mention of allPageMentions(db)) {
    const toPageId = byKey.get(mention.targetRef)?.id;
    if (!toPageId || (mention.sourceKind === "page" && toPageId === mention.sourceId)) continue;
    const key = `${mention.sourceKind}|${mention.sourceId}|${toPageId}`;
    const seen = mentions.get(key);
    if (!seen)
      mentions.set(key, {
        id: null,
        fromKind: mention.sourceKind,
        fromId: mention.sourceId,
        toPageId,
        label: null,
        origin: "mention",
        layer: mention.layer,
        createdAt: null
      });
    else if (mention.layer === "player" && seen.layer !== "player") mentions.set(key, { ...seen, layer: "player" });
  }
  return [...edges, ...mentions.values()];
}
