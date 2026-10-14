import { pageLinkKey } from "@vtt/domain";
import type { CodexDb } from "./db.js";

/**
 * `[[wiki link]]` mentions (`codex_links`), re-extracted from a record's text by every write that changes it.
 * A mention takes its layer from the text it sits in, so GM-layer text only ever yields GM-layer edges. The
 * table has no foreign key (its sources live in four tables), so each kind scrubs its rows on delete.
 */

/** Which record a connection comes from. Connections always point into a page. */
export type CodexConnectionSourceKind = "page" | "session" | "quest" | "journal";
export type CodexLinkTargetKind = "page" | "actor" | "monster" | "spell" | "map" | "marker";
export type CodexLinkRow = Readonly<{
  sourceKind: CodexConnectionSourceKind;
  sourceId: string;
  layer: "player" | "gm";
  targetKind: CodexLinkTargetKind;
  targetRef: string;
  section: string | null;
}>;
/** One stored mention of a page. */
export type CodexMentionRow = Readonly<{
  sourceKind: CodexConnectionSourceKind;
  sourceId: string;
  layer: "player" | "gm";
  targetRef: string;
  section: string | null;
}>;

const WIKILINK = /\[\[([^\]]+)\]\]/g;
const TARGET_KINDS = new Set<string>(["page", "actor", "monster", "spell", "map", "marker"]);

/** The `[[...]]` references in one body, deduped within it. A page target is keyed by `pageLinkKey`. */
export function parseWikiLinks(text: string, layer: "player" | "gm"): CodexLinkRow[] {
  const links: CodexLinkRow[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(WIKILINK)) {
    const inner = match[1].trim();
    if (!inner) continue;
    const [targetPart, sectionPart] = inner.split("#", 2);
    const section = sectionPart?.trim() || null;
    let targetKind: CodexLinkTargetKind = "page";
    let ref = targetPart.trim();
    const colon = ref.indexOf(":");
    if (colon > 0) {
      const prefix = ref.slice(0, colon).trim().toLowerCase();
      if (TARGET_KINDS.has(prefix)) {
        targetKind = prefix as CodexLinkTargetKind;
        ref = ref.slice(colon + 1).trim();
      }
    }
    if (!ref) continue;
    const key = targetKind === "page" ? pageLinkKey(ref) : ref;
    const dedupe = `${layer}|${targetKind}|${key}|${section ?? ""}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    links.push({ sourceKind: "page", sourceId: "", layer, targetKind, targetRef: key, section });
  }
  return links;
}

/** Leaf write: replace one record's mentions with those in its two text layers. */
export function rebuildLinks(
  db: CodexDb,
  sourceKind: CodexConnectionSourceKind,
  sourceId: string,
  playerText: string,
  gmText: string
): void {
  scrubLinks(db, sourceKind, sourceId);
  const insert = db.database.prepare(
    "INSERT INTO codex_links (source_kind, source_id, layer, target_kind, target_ref, section) VALUES (?, ?, ?, ?, ?, ?)"
  );
  for (const link of [...parseWikiLinks(playerText, "player"), ...parseWikiLinks(gmText, "gm")])
    insert.run(sourceKind, sourceId, link.layer, link.targetKind, link.targetRef, link.section);
}

/** Leaf delete of one record's mentions. */
export function scrubLinks(db: CodexDb, sourceKind: CodexConnectionSourceKind, sourceId: string): void {
  db.database.prepare("DELETE FROM codex_links WHERE source_kind = ? AND source_id = ?").run(sourceKind, sourceId);
}

type MentionRowRaw = {
  source_kind: CodexConnectionSourceKind;
  source_id: string;
  layer: "player" | "gm";
  target_ref: string;
  section: string | null;
};
function toMention(row: MentionRowRaw): CodexMentionRow {
  return {
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    layer: row.layer,
    targetRef: row.target_ref,
    section: row.section
  };
}

/** Every mention of the page with this link key, except the page's mentions of itself. */
export function mentionsOf(db: CodexDb, linkKey: string, pageId: string): CodexMentionRow[] {
  return (
    db.database
      .prepare(
        "SELECT source_kind, source_id, layer, target_ref, section FROM codex_links WHERE target_kind = 'page' AND target_ref = ? AND NOT (source_kind = 'page' AND source_id = ?)"
      )
      .all(linkKey, pageId) as MentionRowRaw[]
  ).map(toMention);
}

/** The page mentions in one page's own text. */
export function mentionsFrom(db: CodexDb, pageId: string): CodexMentionRow[] {
  return (
    db.database
      .prepare(
        "SELECT source_kind, source_id, layer, target_ref, section FROM codex_links WHERE source_kind = 'page' AND source_id = ? AND target_kind = 'page'"
      )
      .all(pageId) as MentionRowRaw[]
  ).map(toMention);
}

/** Every page mention. `layer` is in the ORDER BY so collapsing duplicates is deterministic ('gm' sorts first). */
export function allPageMentions(db: CodexDb): CodexMentionRow[] {
  return (
    db.database
      .prepare(
        "SELECT source_kind, source_id, layer, target_ref, section FROM codex_links WHERE target_kind = 'page' ORDER BY source_kind, source_id, target_ref, layer"
      )
      .all() as MentionRowRaw[]
  ).map(toMention);
}
