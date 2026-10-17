import type {
  CodexCalendar,
  CodexCalendarMove,
  CodexImportCounts,
  CodexInWorldDate,
  CodexJournalEntry,
  CodexMapKind,
  CodexRecordKind,
  CodexSettingsInput
} from "@vtt/domain";
import * as atlas from "./codex/atlas.js";
import { exportBundle, importBundle, type CodexBundle } from "./codex/bundle.js";
import * as calendar from "./codex/calendar.js";
import * as connections from "./codex/connections.js";
import { readRevision, write, type CodexDb } from "./codex/db.js";
import * as journal from "./codex/journal.js";
import * as pages from "./codex/pages.js";
import * as quests from "./codex/quests.js";
import * as receipts from "./codex/receipts.js";
import * as revisions from "./codex/revisions.js";
import { migrateCodex } from "./codex/schema.js";
import { searchAll, searchPlayerMatches, type CodexSearchRef, type CodexSearchRefs } from "./codex/search.js";
import * as sessions from "./codex/sessions.js";
import * as settings from "./codex/settings.js";
import * as standing from "./codex/standing.js";
import { isId } from "./codex/validate.js";
import { mapAssetVisibleToPlayers, mediaVisibleToPlayers } from "./codex/visibility.js";
import { openDatabase } from "./database.js";

/**
 * The worldbuilding Codex's persistence, one module per aggregate under `codex/`. Every write bumps the coarse
 * `revision`, which pings the GM's devices and keys the GM's ETags. Rows hold both layers; only `codex-projections.ts`
 * strips GM data for players. Writes that reach across aggregates (deletes, mostly) are composed here.
 */
export class CodexStore {
  #context: CodexDb | undefined;

  constructor(
    private readonly databasePath: string,
    private readonly now: () => number = Date.now
  ) {}

  get #db(): CodexDb {
    if (!this.#context) throw new Error("CodexStore has not been initialized.");
    return this.#context;
  }

  async initialize() {
    if (this.#context) return;
    const database = openDatabase(this.databasePath);
    try {
      migrateCodex(database, this.databasePath);
    } catch (error) {
      database.close();
      throw error;
    }
    this.#context = { database, now: this.now };
  }

  close() {
    this.#context?.database.close();
    this.#context = undefined;
  }

  /** The coarse counter bumped on every write. */
  get revision(): number {
    return readRevision(this.#db);
  }

  recallCommand(commandId: string) {
    return receipts.recallCommand(this.#db, commandId);
  }
  recordCommand(commandId: string, status: number, responseBody: unknown, fingerprint: string): void {
    receipts.recordCommand(this.#db, commandId, status, responseBody, fingerprint);
  }

  // Pages, folders and revisions

  createPage(input: pages.CodexPageCreateInput) {
    return pages.createPage(this.#db, input);
  }
  updatePage(pageId: string, input: pages.CodexPageUpdateInput, expectedRev: number | undefined, authorTag: string) {
    return pages.updatePage(this.#db, pageId, input, expectedRev, authorTag);
  }
  setPageRevealed(pageId: string, revealed: boolean) {
    return pages.setPageRevealed(this.#db, pageId, revealed);
  }
  /** References to the page elsewhere become label-only and never dangle; its revisions go with it. */
  deletePage(pageId: string): void {
    if (!isId(pageId)) return;
    const db = this.#db;
    write(db, () => {
      atlas.unlinkPageFromMarkers(db, pageId);
      journal.detachPage(db, pageId);
      quests.unlinkPageFromQuests(db, pageId);
      pages.deletePage(db, pageId);
    });
  }
  getPage(pageId: string) {
    return pages.getPage(this.#db, pageId);
  }
  listPages(filter?: Readonly<{ folder?: string | null; tag?: string }>) {
    return pages.listPages(this.#db, filter);
  }
  /** Every page with both bodies. */
  listFullPages() {
    return pages.listFullPages(this.#db);
  }
  listFolders() {
    return pages.listFolders(this.#db);
  }
  createFolder(path: string) {
    return pages.createFolder(this.#db, path);
  }
  moveFolder(fromPath: string, toPath: string) {
    return pages.moveFolder(this.#db, fromPath, toPath);
  }
  deleteFolder(path: string): void {
    pages.deleteFolder(this.#db, path);
  }
  listRevisions(pageId: string) {
    return revisions.listRevisions(this.#db, pageId);
  }
  listAllRevisions() {
    return revisions.listAllRevisions(this.#db);
  }
  restoreRevision(pageId: string, revisionId: number, authorTag: string) {
    return pages.restoreRevision(this.#db, pageId, revisionId, authorTag);
  }
  /** Works with history switched off; touches nothing but the history. */
  deleteRevisionsOlderThan(olderThanDays: number): number {
    const db = this.#db;
    return write(db, () => revisions.deleteRevisionsOlderThan(db, olderThanDays));
  }

  // Backup

  exportBundle(): CodexBundle {
    return exportBundle(this.#db);
  }
  importBundle(bundle: unknown): CodexImportCounts {
    return importBundle(this.#db, bundle);
  }

  // Settings

  getSettings() {
    return settings.getSettings(this.#db);
  }
  setSettings(input: CodexSettingsInput) {
    const db = this.#db;
    write(db, () => settings.writeSettings(db, input));
    return settings.getSettings(db);
  }

  // Connections

  createConnection(
    fromPageId: string,
    input: Readonly<{ toPageId: string; label?: string | null; layer?: "player" | "gm" | null }>
  ) {
    return connections.createConnection(this.#db, fromPageId, input);
  }
  updateConnection(connectionId: string, input: Readonly<{ label?: string | null; layer?: "player" | "gm" }>) {
    return connections.updateConnection(this.#db, connectionId, input);
  }
  deleteConnection(connectionId: string): void {
    connections.deleteConnection(this.#db, connectionId);
  }
  listAllDeclaredConnections() {
    return connections.listAllDeclaredConnections(this.#db);
  }
  connectionsForPage(pageId: string) {
    return connections.connectionsForPage(this.#db, pageId);
  }
  listAllConnections() {
    return connections.listAllConnections(this.#db);
  }

  // Search

  /** The player index holds only player-layer text and its rows are checked against live reveal state. */
  searchAll(audience: "player" | "gm", query: string, kinds?: readonly CodexRecordKind[]): CodexSearchRefs {
    return searchAll(this.#db, audience, query, kinds);
  }
  /** Every match a player may see, ranked and uncapped, for a caller that gates hits and caps what is left. */
  searchPlayerMatches(query: string): CodexSearchRef[] {
    return searchPlayerMatches(this.#db, query);
  }
  searchPages(audience: "player" | "gm", query: string): Array<{ pageId: string }> {
    return this.searchAll(audience, query, ["page"]).hits.map((hit) => ({ pageId: hit.id }));
  }

  // The atlas

  createMap(input: atlas.CodexMapCreateInput) {
    return atlas.createMap(this.#db, input);
  }
  updateMap(mapId: string, input: Readonly<{ name?: string; kind?: CodexMapKind; tags?: readonly string[] }>) {
    return atlas.updateMap(this.#db, mapId, input);
  }
  setMapParent(mapId: string, parentMapId: string | null) {
    return atlas.setMapParent(this.#db, mapId, parentMapId);
  }
  setMapRevealed(mapId: string, revealed: boolean) {
    return atlas.setMapRevealed(this.#db, mapId, revealed);
  }
  /** Journal entries pinned to the map's own pins let go before the pins cascade away. */
  deleteMap(mapId: string): void {
    if (!isId(mapId)) return;
    const db = this.#db;
    write(db, () => {
      journal.detachMarkers(db, atlas.markerIdsOnMap(db, mapId));
      atlas.deleteMap(db, mapId);
    });
  }
  getMap(mapId: string) {
    return atlas.getMap(this.#db, mapId);
  }
  listMaps() {
    return atlas.listMaps(this.#db);
  }
  createMarker(mapId: string, input: atlas.CodexMarkerCreateInput) {
    return atlas.createMarker(this.#db, mapId, input);
  }
  updateMarker(markerId: string, input: atlas.CodexMarkerUpdateInput) {
    return atlas.updateMarker(this.#db, markerId, input);
  }
  moveMarker(markerId: string, x: number, y: number) {
    return atlas.moveMarker(this.#db, markerId, x, y);
  }
  setMarkerRevealed(markerId: string, revealed: boolean) {
    return atlas.setMarkerRevealed(this.#db, markerId, revealed);
  }
  deleteMarker(markerId: string): void {
    if (!isId(markerId)) return;
    const db = this.#db;
    write(db, () => {
      journal.detachMarkers(db, [markerId]);
      atlas.deleteMarker(db, markerId);
    });
  }
  getMarker(markerId: string) {
    return atlas.getMarker(this.#db, markerId);
  }
  listMarkers(mapId: string) {
    return atlas.listMarkers(this.#db, mapId);
  }
  markersForPage(pageId: string) {
    return atlas.markersForPage(this.#db, pageId);
  }
  markerForScene(sceneId: string) {
    return atlas.markerForScene(this.#db, sceneId);
  }
  setPartyMarker(markerId: string | null) {
    return atlas.setPartyMarker(this.#db, markerId);
  }
  partyMarker() {
    return atlas.partyMarker(this.#db);
  }
  /** Whether a player may fetch this map image. */
  isAssetRevealedToPlayers(assetId: string): boolean {
    return mapAssetVisibleToPlayers(this.#db, assetId);
  }
  /** Whether a player may fetch this page image. */
  isMediaVisibleToPlayers(assetId: string): boolean {
    return mediaVisibleToPlayers(this.#db, assetId);
  }

  // The calendar

  getCalendar(): CodexCalendar {
    return calendar.getCalendar(this.#db);
  }
  /** Replaces the calendar and reflows every dated record. Moves only the GM's clock; it never publishes. */
  setCalendar(input: CodexCalendar): CodexCalendar {
    const db = this.#db;
    const next = calendar.normalizeCalendar(input);
    write(db, () => calendar.writeCalendar(db, next));
    return next;
  }
  getPublishedDate(): CodexInWorldDate | null {
    return calendar.getPublishedDate(this.#db);
  }
  /** What saving this calendar would move in front of players; changes nothing. */
  calendarMoves(input: CodexCalendar): CodexCalendarMove[] {
    return calendar.calendarMoves(this.#db, input);
  }
  /** Copies the GM's clock to the players' (clearing it when the GM clock is unset). The only thing that publishes. */
  publishCampaignDate(): CodexCalendar {
    const db = this.#db;
    const current = calendar.getCalendar(db);
    write(db, () => calendar.writePublishedDate(db, current.currentDate ?? null));
    return current;
  }
  /** Moves the GM's date (and the players' when it matched) by whole days of game time; false with no date set. */
  advanceCampaignDate(days: number): boolean {
    const db = this.#db;
    if (!calendar.getCalendar(db).currentDate || days <= 0) return false;
    return write(db, () => calendar.advanceCampaignDate(db, days));
  }
  /** Takes the date away from the players: they see no date until the GM publishes again. */
  unpublishCampaignDate(): CodexCalendar {
    const db = this.#db;
    write(db, () => calendar.writePublishedDate(db, null));
    return calendar.getCalendar(db);
  }
  campaignInstant(): number | null {
    return calendar.campaignInstant(this.#db);
  }
  publishedInstant(): number | null {
    return calendar.publishedInstant(this.#db);
  }
  dateForInstant(instant: number): CodexInWorldDate {
    return calendar.dateForInstant(this.#db, instant);
  }

  // The journal

  createEntry(input: journal.CodexJournalCreateInput) {
    return journal.createEntry(this.#db, input);
  }
  appendCombatEntry(input: journal.CodexCombatEntryInput) {
    return journal.appendCombatEntry(this.#db, input);
  }
  createDeadline(input: journal.CodexJournalCreateInput) {
    return journal.createDeadline(this.#db, input);
  }
  createDowntime(input: journal.CodexDowntimeCreateInput) {
    return journal.createDowntime(this.#db, input);
  }
  createMilestone(input: journal.CodexMilestoneCreateInput) {
    return journal.createMilestone(this.#db, input);
  }
  proposedDateFor(entry: CodexJournalEntry) {
    return journal.proposedDateFor(this.#db, entry);
  }
  applyDowntime(entryId: string) {
    return journal.applyDowntime(this.#db, entryId);
  }
  updateEntry(entryId: string, input: journal.CodexJournalUpdateInput) {
    return journal.updateEntry(this.#db, entryId, input);
  }
  setEntryRevealed(entryId: string, revealed: boolean) {
    return journal.setEntryRevealed(this.#db, entryId, revealed);
  }
  deleteEntry(entryId: string): void {
    if (!isId(entryId)) return;
    const db = this.#db;
    write(db, () => journal.deleteEntry(db, entryId));
  }
  getEntry(entryId: string) {
    return journal.getEntry(this.#db, entryId);
  }
  listTimeline() {
    return journal.listTimeline(this.#db);
  }
  listEntriesFor(attach: Readonly<{ markerId?: string; pageId?: string }>) {
    return journal.listEntriesFor(this.#db, attach);
  }
  downtimeCharacterPageIds() {
    return journal.downtimeCharacterPageIds(this.#db);
  }
  listDatedEventPages() {
    return pages.listDatedEventPages(this.#db);
  }
  /** Entries and dated event pages in order. Ungated by design; a store test keeps it so. */
  listChronicle() {
    return journal.listChronicle(this.#db);
  }

  // Sessions

  createSession(input: sessions.CodexSessionCreateInput) {
    return sessions.createSession(this.#db, input);
  }
  updateSession(sessionId: string, input: sessions.CodexSessionUpdateInput, expectedRev: number | undefined) {
    return sessions.updateSession(this.#db, sessionId, input, expectedRev);
  }
  setSessionRevealed(sessionId: string, revealed: boolean) {
    return sessions.setSessionRevealed(this.#db, sessionId, revealed);
  }
  /**
   * Unfiles the session's entries. A revealed, numbered session leaves its number on them as a label; a hidden
   * one leaves nothing, since a bare label bypasses the session gate.
   */
  deleteSession(sessionId: string): void {
    if (!isId(sessionId)) return;
    const db = this.#db;
    const existing = sessions.getSession(db, sessionId);
    write(db, () => {
      journal.unfileSession(db, sessionId, existing?.revealedToPlayers ? existing.sessionNumber : null);
      sessions.deleteSession(db, sessionId);
    });
  }
  getSession(sessionId: string) {
    return sessions.getSession(this.#db, sessionId);
  }
  listSessions() {
    return sessions.listSessions(this.#db);
  }
  get activeSessionId(): string | null {
    return sessions.activeSessionId(this.#db);
  }
  setActiveSession(sessionId: string | null) {
    return sessions.setActiveSession(this.#db, sessionId);
  }

  // Quests

  createQuest(input: quests.CodexQuestCreateInput) {
    return quests.createQuest(this.#db, input);
  }
  updateQuest(questId: string, input: quests.CodexQuestUpdateInput, expectedRev: number | undefined) {
    return quests.updateQuest(this.#db, questId, input, expectedRev);
  }
  setQuestRevealed(questId: string, revealed: boolean) {
    return quests.setQuestRevealed(this.#db, questId, revealed);
  }
  deleteQuest(questId: string): void {
    if (!isId(questId)) return;
    const db = this.#db;
    write(db, () => quests.deleteQuest(db, questId));
  }
  getQuest(questId: string) {
    return quests.getQuest(this.#db, questId);
  }
  listQuests() {
    return quests.listQuests(this.#db);
  }

  // Faction standing

  listStanding() {
    return standing.listStanding(this.#db);
  }
  getStanding(factionPageId: string) {
    return standing.getStanding(this.#db, factionPageId);
  }
  setStanding(factionPageId: string, value: number, reason: string) {
    return standing.setStanding(this.#db, factionPageId, value, reason);
  }
  setStandingRevealed(factionPageId: string, revealed: boolean) {
    return standing.setStandingRevealed(this.#db, factionPageId, revealed);
  }
}
