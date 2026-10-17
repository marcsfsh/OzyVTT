import type {
  CodexCalendar,
  CodexImportCounts,
  CodexInWorldDate,
  CodexJournalEntry,
  CodexMap,
  CodexMarker,
  CodexPage,
  CodexQuest,
  CodexQuestObjective,
  CodexSession,
  CodexSettingsInput,
  CodexStanding
} from "@vtt/domain";
import {
  DEFAULT_CALENDAR,
  getCalendar,
  getPublishedDate,
  normalizeCalendar,
  resolveDate,
  writeCalendar,
  writePublishedDate
} from "./calendar.js";
import { insertMap, insertMarker, listMaps, listMarkers, partyMarker } from "./atlas.js";
import { insertRelationship, listAllDeclaredConnections, type CodexRelationshipRow } from "./connections.js";
import { stamp, write, type CodexDb } from "./db.js";
import { journalKind, payloadOf } from "./journal-kinds.js";
import { insertEntry, listTimeline } from "./journal.js";
import { listFolders, listFullPages, registerFolderPath, restorePage } from "./pages.js";
import { insertQuest, listQuests } from "./quests.js";
import { insertRevision, listAllRevisions, type CodexPageRevisionExportRow } from "./revisions.js";
import { CODEX_CONTENT_TABLES } from "./schema.js";
import { activeSessionId, insertSession, listSessions, writeActiveSession } from "./sessions.js";
import {
  DEFAULT_AUTOSAVE_SETTINGS,
  DEFAULT_REVISION_SETTINGS,
  autosaveSettings,
  revisionSettings,
  writeSettings
} from "./settings.js";
import { insertStanding, listStanding } from "./standing.js";
import {
  CodexValidationError,
  attendees,
  body,
  connectionLabel,
  connectionLayer,
  coord,
  entityFields,
  entityType,
  entryGmText,
  entryText,
  folder,
  hexColor,
  iconId,
  id,
  idArray,
  mapKind,
  mapName,
  markerLabel,
  optionalId,
  questObjectives,
  questStatus,
  sessionNo,
  sessionSceneIds,
  sessionStatus,
  shortLabel,
  standingValue,
  tags,
  title
} from "./validate.js";

/**
 * The backup: everything that exists nowhere else, so a restore is never quietly wrong (the calendar the
 * instants were computed against, empty folders, every revision and the settings included).
 */

/** The bundle format version. A fact about the file, so the export route stamps it beside `codex`. */
export const CODEX_BUNDLE_VERSION = 1;

export type CodexBundle = Readonly<{
  pages: readonly CodexPage[];
  maps: readonly CodexMap[];
  markers: readonly CodexMarker[];
  journal: readonly CodexJournalEntry[];
  relationships: readonly CodexRelationshipRow[];
  sessions: readonly CodexSession[];
  activeSessionId: string | null;
  quests: readonly CodexQuest[];
  publishedDate: CodexInWorldDate | null;
  standing: readonly CodexStanding[];
  partyMarkerId: string | null;
  calendar: CodexCalendar;
  folders: readonly string[];
  revisions: readonly CodexPageRevisionExportRow[];
  settings?: CodexSettingsInput;
}>;

export function exportBundle(db: CodexDb): CodexBundle {
  const maps = listMaps(db);
  // New keys go last, so an older reader of the file sees the keys it knows in the order it knows them.
  return {
    pages: listFullPages(db),
    maps,
    markers: maps.flatMap((map) => listMarkers(db, map.id)),
    journal: listTimeline(db),
    relationships: listAllDeclaredConnections(db),
    sessions: listSessions(db),
    activeSessionId: activeSessionId(db),
    quests: listQuests(db),
    publishedDate: getPublishedDate(db),
    standing: listStanding(db),
    partyMarkerId: partyMarker(db)?.id ?? null,
    calendar: getCalendar(db),
    folders: listFolders(db),
    revisions: listAllRevisions(db),
    settings: { revisionHistory: revisionSettings(db), autosave: autosaveSettings(db) }
  };
}

/**
 * Replaces the Codex with a validated bundle in one write. Replace, not merge: merging singleton and uniquely
 * indexed state has no defined answer. Rows are written as they are, with no create-time side effects (no
 * quest history, no revision snapshots); dates are re-resolved against the restored calendar.
 */
export function importBundle(db: CodexDb, raw: unknown): CodexImportCounts {
  const bundle = normalizeBundle(raw);
  write(db, () => {
    for (const table of CODEX_CONTENT_TABLES) db.database.prepare(`DELETE FROM ${table}`).run();
    // The calendar first, since every date below is resolved against it.
    writeCalendar(db, normalizeCalendar(bundle.calendar));
    writePublishedDate(db, bundle.publishedDate);
    if (bundle.settings) writeSettings(db, bundle.settings);

    for (const page of bundle.pages) restorePage(db, page);
    for (const path of bundle.folders) registerFolderPath(db, path, stamp(db));
    // Sessions before the journal, so an entry's session id resolves.
    for (const session of bundle.sessions) insertSession(db, session);
    const sessionIds = new Set(bundle.sessions.map((session) => session.id));
    for (const entry of bundle.journal) {
      const sessionId = entry.sessionId !== null && sessionIds.has(entry.sessionId) ? entry.sessionId : null;
      insertEntry(db, {
        ...entry,
        sessionId,
        // An entry that names no restored session keeps its number as a label, as a deleted session leaves it.
        deletedSessionNumber: sessionId === null ? entry.sessionNumber : null,
        dated: resolveDate(db, entry.inWorldDate, entry.inWorldLabel)
      });
    }
    for (const map of bundle.maps) insertMap(db, map);
    for (const marker of bundle.markers) insertMarker(db, marker);
    for (const quest of bundle.quests) insertQuest(db, quest);
    for (const standing of bundle.standing) insertStanding(db, standing);
    for (const relationship of bundle.relationships) insertRelationship(db, relationship);
    // Revisions keep their ids, so `.../revisions/{revisionId}/restore` URLs survive a restore.
    for (const revision of bundle.revisions) insertRevision(db, revision);
    writeActiveSession(
      db,
      bundle.activeSessionId !== null && sessionIds.has(bundle.activeSessionId) ? bundle.activeSessionId : null
    );
  });
  const count = (table: string) => (db.database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  return {
    pages: count("codex_pages"),
    folders: count("codex_folders"),
    maps: count("codex_maps"),
    markers: count("codex_markers"),
    journal: count("codex_journal"),
    connections: count("codex_relationships"),
    sessions: count("codex_sessions"),
    quests: count("codex_quests"),
    standing: count("codex_standing"),
    revisions: count("codex_page_revisions")
  };
}

const BUNDLE_LIST_KEYS = [
  "pages",
  "maps",
  "markers",
  "journal",
  "relationships",
  "sessions",
  "quests",
  "standing",
  "revisions",
  "folders"
] as const;
const BUNDLE_VALUE_KEYS = ["activeSessionId", "publishedDate", "partyMarkerId", "calendar", "settings"] as const;
const BUNDLE_KEYS: ReadonlySet<string> = new Set<string>([...BUNDLE_LIST_KEYS, ...BUNDLE_VALUE_KEYS]);

/**
 * Validates an untrusted bundle before any write, through the same validators as ordinary writes. A restore
 * replaces everything, so a bundle with no or unknown sections is refused: it would silently delete data. A
 * missing key within a record takes its default. Cross-record checks mirror the database's constraints, so a
 * bad file gets a readable error instead of driver text.
 */
function normalizeBundle(raw: unknown): CodexBundle {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new CodexValidationError("That backup file is not a codex bundle.");
  const bundle = raw as Record<string, unknown>;
  const unrecognised = Object.keys(bundle).find((key) => !BUNDLE_KEYS.has(key));
  if (unrecognised !== undefined)
    throw new CodexValidationError(
      `That backup has a section the codex does not recognise: "${unrecognised}". Compare it with a fresh export. With a mistyped section name, those records would be dropped.`
    );
  if (!Object.keys(bundle).some((key) => BUNDLE_KEYS.has(key)))
    throw new CodexValidationError(
      'That backup holds no codex sections at all, so it is truncated or is not a backup file. A campaign with nothing in it still exports every section ("pages": [], and so on), so restoring this would erase the codex.'
    );
  const list = (key: string): unknown[] => {
    const value = bundle[key];
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value))
      throw new CodexValidationError(`That backup's "${key}" section is not a list of records.`);
    return value;
  };
  /** One section, row by row, with the section name and row number added to every validator message. */
  const rows = <T>(key: string, map: (row: Record<string, unknown>) => T): T[] =>
    list(key).map((value, index) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new CodexValidationError(`That backup's "${key}" entry ${index + 1} is not a record.`);
      try {
        return map(value as Record<string, unknown>);
      } catch (error) {
        if (error instanceof CodexValidationError)
          throw new CodexValidationError(`That backup's "${key}" entry ${index + 1} is not valid: ${error.message}`);
        throw error;
      }
    });
  const text = (value: unknown): string => (typeof value === "string" ? value : "");
  const nullableText = (value: unknown): string | null => (typeof value === "string" ? value : null);
  const flag = (value: unknown): boolean => value === true;
  const count = (value: unknown, fallback = 0): number =>
    typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
  // Not truncated: marker coordinates are fractional.
  const real = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  const stringList = (value: unknown): string[] => (Array.isArray(value) ? (value as string[]) : []);
  const date = (value: unknown): CodexInWorldDate | null => {
    if (!value || typeof value !== "object") return null;
    const parts = value as { year?: unknown; month?: unknown; day?: unknown };
    if (typeof parts.year !== "number" || typeof parts.month !== "number" || typeof parts.day !== "number") return null;
    return { year: Math.trunc(parts.year), month: Math.trunc(parts.month), day: Math.trunc(parts.day) };
  };

  const pages = rows("pages", (row): CodexPage => ({
    id: id(text(row.id)),
    title: title(text(row.title)),
    entityType: entityType(typeof row.entityType === "string" ? row.entityType : undefined),
    fields: entityFields(row.fields as Record<string, string> | undefined),
    gmFields: entityFields(row.gmFields as Record<string, string> | undefined),
    folder: folder(nullableText(row.folder)),
    tags: tags(stringList(row.tags)),
    playerBody: body(text(row.playerBody)),
    gmBody: body(text(row.gmBody)),
    revealedToPlayers: flag(row.revealedToPlayers),
    bannerAssetId: optionalId(nullableText(row.bannerAssetId)),
    inWorldLabel: null,
    calendarInstant: null,
    inWorldDate: date(row.inWorldDate),
    rev: Math.max(1, count(row.rev, 1)),
    createdAt: text(row.createdAt),
    updatedAt: text(row.updatedAt)
  }));
  const maps = rows("maps", (row): CodexMap => ({
    id: id(text(row.id)),
    assetId: id(text(row.assetId)),
    name: mapName(text(row.name)),
    kind: mapKind(text(row.kind)),
    parentMapId: optionalId(nullableText(row.parentMapId)),
    revealedToPlayers: flag(row.revealedToPlayers),
    sortKey: count(row.sortKey),
    tags: tags(stringList(row.tags)),
    createdAt: text(row.createdAt),
    updatedAt: text(row.updatedAt)
  }));
  const markers = rows("markers", (row): CodexMarker => ({
    id: id(text(row.id)),
    mapId: id(text(row.mapId)),
    x: coord(real(row.x)),
    y: coord(real(row.y)),
    iconId: iconId(text(row.iconId)),
    iconColor: hexColor(text(row.iconColor)),
    label: markerLabel(nullableText(row.label)),
    revealedToPlayers: flag(row.revealedToPlayers),
    pageIds: idArray(row.pageIds as string[] | undefined),
    subMapId: optionalId(nullableText(row.subMapId)),
    sceneIds: idArray(row.sceneIds as string[] | undefined),
    actorId: optionalId(nullableText(row.actorId)),
    tags: tags(stringList(row.tags)),
    isParty: flag(row.isParty),
    createdAt: text(row.createdAt),
    updatedAt: text(row.updatedAt)
  }));
  const sessions = rows("sessions", (row): CodexSession => ({
    id: id(text(row.id)),
    sessionNumber: sessionNo(typeof row.sessionNumber === "number" ? row.sessionNumber : null),
    realDate: shortLabel(nullableText(row.realDate), 40, "date"),
    attendees: attendees(stringList(row.attendees)),
    prepBody: body(text(row.prepBody)),
    recapBody: body(text(row.recapBody)),
    revealedToPlayers: flag(row.revealedToPlayers),
    status: sessionStatus(typeof row.status === "string" ? row.status : undefined),
    tags: tags(stringList(row.tags)),
    sceneIds: sessionSceneIds(stringList(row.sceneIds)),
    rev: Math.max(1, count(row.rev, 1)),
    createdAt: text(row.createdAt),
    updatedAt: text(row.updatedAt)
  }));
  const journal = rows("journal", (row): CodexJournalEntry => {
    const kind = journalKind(text(row.kind));
    return {
      id: id(text(row.id)),
      playerText: entryText(text(row.playerText)),
      gmText: entryGmText(nullableText(row.gmText)),
      revealedToPlayers: flag(row.revealedToPlayers),
      attachMarkerId: optionalId(nullableText(row.attachMarkerId)),
      attachPageId: optionalId(nullableText(row.attachPageId)),
      kind,
      sourceEncounterId: typeof row.sourceEncounterId === "number" ? Math.trunc(row.sourceEncounterId) : null,
      sessionId: typeof row.sessionId === "string" ? optionalId(row.sessionId) : null,
      sessionNumber: typeof row.sessionNumber === "number" ? sessionNo(row.sessionNumber) : null,
      realDate: shortLabel(nullableText(row.realDate), 40, "date"),
      inWorldLabel: nullableText(row.inWorldLabel),
      calendarInstant: null,
      inWorldDate: date(row.inWorldDate),
      sortKey: count(row.sortKey),
      tags: tags(stringList(row.tags)),
      // The parser a stored row uses, so a hand-edited payload degrades exactly as it would on read.
      payload: payloadOf(kind, row.payload === undefined || row.payload === null ? null : JSON.stringify(row.payload)),
      createdAt: text(row.createdAt),
      updatedAt: text(row.updatedAt)
    };
  });
  const quests = rows("quests", (row): CodexQuest => ({
    id: id(text(row.id)),
    title: title(text(row.title)),
    status: questStatus(typeof row.status === "string" ? row.status : undefined),
    playerBody: body(text(row.playerBody)),
    gmBody: body(text(row.gmBody)),
    objectives: questObjectives(Array.isArray(row.objectives) ? (row.objectives as CodexQuestObjective[]) : []),
    entityIds: idArray(row.entityIds as string[] | undefined),
    revealedToPlayers: flag(row.revealedToPlayers),
    tags: tags(stringList(row.tags)),
    rev: Math.max(1, count(row.rev, 1)),
    createdAt: text(row.createdAt),
    updatedAt: text(row.updatedAt)
  }));
  const standing = rows("standing", (row): CodexStanding => ({
    id: id(text(row.id)),
    factionPageId: id(text(row.factionPageId)),
    value: standingValue(count(row.value)),
    revealedToPlayers: flag(row.revealedToPlayers),
    createdAt: text(row.createdAt),
    updatedAt: text(row.updatedAt)
  }));
  const relationships = rows("relationships", (row): CodexRelationshipRow => ({
    id: id(text(row.id)),
    fromPageId: id(text(row.fromPageId)),
    toPageId: id(text(row.toPageId)),
    label: connectionLabel(nullableText(row.label)) || null,
    layer: connectionLayer(nullableText(row.layer)),
    createdAt: text(row.createdAt)
  }));
  const revisions = rows("revisions", (row): CodexPageRevisionExportRow => ({
    id: count(row.id),
    pageId: id(text(row.pageId)),
    rev: count(row.rev, 1),
    title: title(text(row.title)),
    entityType: entityType(typeof row.entityType === "string" ? row.entityType : undefined),
    fields: entityFields(row.fields as Record<string, string> | undefined),
    gmFields: entityFields(row.gmFields as Record<string, string> | undefined),
    playerBody: body(text(row.playerBody)),
    gmBody: body(text(row.gmBody)),
    bannerAssetId: optionalId(nullableText(row.bannerAssetId)),
    tags: tags(stringList(row.tags)),
    authoredAt: text(row.authoredAt),
    authorTag: text(row.authorTag)
  }));

  for (const [key, records] of [
    ["pages", pages],
    ["maps", maps],
    ["markers", markers],
    ["journal", journal],
    ["sessions", sessions],
    ["quests", quests],
    ["standing", standing],
    ["relationships", relationships],
    ["revisions", revisions]
  ] as const) {
    const seen = new Set<string | number>();
    for (const { id: recordId } of records as ReadonlyArray<{ id: string | number }>) {
      if (seen.has(recordId))
        throw new CodexValidationError(`That backup lists two "${key}" records with the same id (${recordId}).`);
      seen.add(recordId);
    }
  }
  const pageIds = new Set(pages.map((row) => row.id));
  const mapIds = new Set(maps.map((row) => row.id));
  const references: ReadonlyArray<readonly [string, string, readonly (string | null)[], ReadonlySet<string>]> = [
    ["maps", "parent map", maps.map((row) => row.parentMapId), mapIds],
    ["markers", "map", markers.map((row) => row.mapId), mapIds],
    ["relationships", "page", relationships.flatMap((row) => [row.fromPageId, row.toPageId]), pageIds],
    ["standing", "faction page", standing.map((row) => row.factionPageId), pageIds],
    ["revisions", "page", revisions.map((row) => row.pageId), pageIds]
  ];
  for (const [key, what, refs, known] of references)
    for (const ref of refs)
      if (ref !== null && !known.has(ref))
        throw new CodexValidationError(
          `That backup's "${key}" section names a ${what} the file does not contain (${ref}).`
        );
  const factions = standing.map((row) => row.factionPageId);
  if (new Set(factions).size !== factions.length)
    throw new CodexValidationError(
      "That backup has two standing rows for the same faction. A faction holds one standing."
    );
  if (markers.filter((marker) => marker.isParty).length > 1)
    throw new CodexValidationError("That backup marks more than one pin as the party's. Only one pin can be.");
  const numbers = sessions.map((session) => session.sessionNumber).filter((value): value is number => value !== null);
  if (new Set(numbers).size !== numbers.length)
    throw new CodexValidationError("That backup has two sessions with the same number.");

  const settingsRaw = bundle.settings as
    | {
        revisionHistory?: { enabled?: unknown; windowMinutes?: unknown };
        autosave?: { enabled?: unknown; intervalSeconds?: unknown };
      }
    | undefined;
  return {
    pages,
    maps,
    markers,
    journal,
    relationships,
    sessions,
    quests,
    standing,
    revisions,
    settings: settingsRaw
      ? {
          revisionHistory: {
            enabled: settingsRaw.revisionHistory?.enabled !== false,
            windowMinutes: count(settingsRaw.revisionHistory?.windowMinutes, DEFAULT_REVISION_SETTINGS.windowMinutes)
          },
          autosave: {
            enabled: settingsRaw.autosave?.enabled !== false,
            intervalSeconds: count(settingsRaw.autosave?.intervalSeconds, DEFAULT_AUTOSAVE_SETTINGS.intervalSeconds)
          }
        }
      : undefined,
    activeSessionId: typeof bundle.activeSessionId === "string" ? optionalId(bundle.activeSessionId) : null,
    publishedDate: date(bundle.publishedDate),
    partyMarkerId: typeof bundle.partyMarkerId === "string" ? optionalId(bundle.partyMarkerId) : null,
    calendar: normalizeCalendar((bundle.calendar ?? DEFAULT_CALENDAR) as CodexCalendar),
    folders: list("folders")
      .map((path) => folder(text(path)))
      .filter((path): path is string => path !== null)
  };
}
