import { describe, expect, it } from "vitest";
import { projectGmChronicleRecord, projectGmCalendar, projectGmMarker, projectGmStanding, projectPlayerCalendar, projectPlayerChronicleRecord, projectPlayerMarker, projectPlayerPageMarker, projectPlayerStanding, projectRevealAudit } from "../src/codex-projections.js";
import type { CodexCalendar, CodexDowntimePayload, CodexInWorldDate, CodexJournalKind, CodexJournalRow, CodexMarkerRow, CodexStandingRow } from "../src/codex-store.js";

/**
 * M11's two new gates, each tested AT ITS OWN LAYER - which is the whole point of this file existing.
 *
 * The lesson these tests are paying off is recorded in `codex-store.test.ts`: a weakened SQL viewer-safety
 * predicate once passed the entire suite because a projection quietly caught it. Every gate therefore needs
 * a test that can only be satisfied by that gate. So nothing here goes near a store, a database or an HTTP
 * request: the rows are built as literals so that a projection bug cannot hide behind a store that never
 * handed it a dangerous row in the first place. The end-to-end half lives in `codex-http.test.ts`, and the
 * store half in `codex-store.test.ts`; all three are needed and none of them is redundant.
 */

const CALENDAR: CodexCalendar = {
  yearName: "DR",
  months: [{ name: "Hammer", days: 30 }, { name: "Alturiak", days: 30 }],
  weekdays: ["First", "Second"],
  currentDate: { year: 1492, month: 1, day: 20 }
};

/** A journal row as the store hands one over. Every field explicit - a projection test must not inherit defaults. */
function entryRow(overrides: Partial<CodexJournalRow> & { kind: CodexJournalKind }): CodexJournalRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    playerText: "The tax is due.", gmText: "The duke will send the guard.", revealedToPlayers: false,
    attachMarkerId: null, attachPageId: null, sourceEncounterId: null, sessionId: null, sessionNumber: null, realDate: null,
    inWorldLabel: "Hammer 10, 1492 DR", calendarInstant: 9, inWorldDate: { year: 1492, month: 0, day: 10 },
    sortKey: 0, tags: [], payload: null, createdAt: "2026-07-29T00:00:00.000Z", updatedAt: "2026-07-29T00:00:00.000Z",
    ...overrides
  };
}
const DOWNTIME: CodexDowntimePayload = { who: "Brannor", activity: "Forging a blade", days: 8, applied: true, characterPageId: null };
const playerContext = (publishedInstant: number | null = null) => ({ unrevealedSessionIds: new Set<string>(), publishedInstant });

describe("M11 calendar projection - the GM's prep clock never reaches a player (O-1 / D11-G)", () => {
  /**
   * T-9, point-blank. The two clocks are set to DIFFERENT values on purpose: with them equal, a projection
   * that returned the GM's clock would pass every assertion here and the test would prove nothing at all.
   */
  it("emits the PUBLISHED date as a player's currentDate, and the GM clock is not reachable from the payload", () => {
    const published: CodexInWorldDate = { year: 1492, month: 0, day: 10 };
    const player = projectPlayerCalendar(CALENDAR, published);

    // The VALUE, not merely the absence of a key: `currentDate` is present and means what it always meant.
    expect(player.currentDate).toEqual({ year: 1492, month: 0, day: 10 });
    expect(player.currentDate).not.toEqual(CALENDAR.currentDate);
    // ...and the GM's clock is nowhere in the serialized payload, under any key, at any depth. `month: 1`
    // and `day: 20` are the GM clock's own parts, and neither appears.
    expect(JSON.stringify(player)).toBe(JSON.stringify({ yearName: "DR", months: CALENDAR.months, weekdays: CALENDAR.weekdays, currentDate: published }));
    expect(Object.keys(player).sort()).toEqual(["currentDate", "months", "weekdays", "yearName"]);
    // The world's own months/weekdays/era are not secrets and still travel unchanged.
    expect(player.months).toEqual(CALENDAR.months);
    expect(player.weekdays).toEqual(CALENDAR.weekdays);
  });

  it("gives the GM both clocks, so they can see that the table is behind them", () => {
    const published: CodexInWorldDate = { year: 1492, month: 0, day: 10 };
    const gm = projectGmCalendar(CALENDAR, published);
    expect(gm.currentDate).toEqual({ year: 1492, month: 1, day: 20 });
    expect(gm.publishedDate).toEqual(published);
  });

  /**
   * The unpublished-yet case, and the reason the player projection must not fall back to the calendar: a
   * codex whose GM has a clock but has published nothing shows the party NO date, not the GM's.
   */
  it("shows a player no date at all when nothing has been published, rather than falling back to the GM clock", () => {
    const player = projectPlayerCalendar(CALENDAR, null);
    expect(player.currentDate).toBeNull();
    expect(JSON.stringify(player)).not.toContain("1492");
  });
});

describe("M11 chronicle projection - deadlines and downtime are gated by reveal and nothing else (O-2 / D11-E)", () => {
  /**
   * T-10, point-blank, and it asserts BOTH halves of O-2: unrevealed records are absent, and revealed ones
   * are present. The second half is not filler - the failure mode the owner explicitly ruled out is a
   * kind-based filter that hides a deadline from players forever, and only a positive assertion catches it.
   */
  it("hides an unrevealed deadline and an unrevealed downtime from a player, and shows them once revealed", () => {
    const deadline = entryRow({ kind: "deadline" });
    const downtime = entryRow({ kind: "downtime", payload: DOWNTIME });

    expect(projectPlayerChronicleRecord({ kind: "entry", entry: deadline }, playerContext())).toBeNull();
    expect(projectPlayerChronicleRecord({ kind: "entry", entry: downtime }, playerContext())).toBeNull();

    const shownDeadline = projectPlayerChronicleRecord({ kind: "entry", entry: { ...deadline, revealedToPlayers: true } }, playerContext());
    const shownDowntime = projectPlayerChronicleRecord({ kind: "entry", entry: { ...downtime, revealedToPlayers: true } }, playerContext());
    expect(shownDeadline).not.toBeNull();
    expect(shownDowntime).not.toBeNull();
    // The kind survives the trip: a revealed deadline reads as a deadline, not as a stray note (F-5).
    expect(shownDeadline!.kind).toBe("deadline");
    expect(shownDowntime!.kind).toBe("downtime");
    // ...and it is exactly as visible as a revealed NOTE, which is what "revealable like anything else" means.
    expect(projectPlayerChronicleRecord({ kind: "entry", entry: entryRow({ kind: "note", revealedToPlayers: true }) }, playerContext())).not.toBeNull();
  });

  it("carries a revealed downtime's who/activity/days to a player but never `applied`", () => {
    const row = entryRow({ kind: "downtime", revealedToPlayers: true, payload: DOWNTIME });
    const player = projectPlayerChronicleRecord({ kind: "entry", entry: row }, playerContext())!;

    expect(player.payload).toEqual({ who: "Brannor", activity: "Forging a blade", days: 8, characterPageId: null });
    expect(Object.keys(player.payload!).sort()).toEqual(["activity", "characterPageId", "days", "who"]);
    // On the VALUE as well as the key set: `applied` is `true` on the stored payload, so a spread-and-delete
    // that missed it, or a passthrough, would put `true` into the serialized player row.
    expect(JSON.stringify(player)).not.toContain("applied");
    // The GM's own row keeps it - otherwise the Confirm affordance has nothing to switch on.
    expect(projectGmChronicleRecord({ kind: "entry", entry: row }).payload).toEqual(DOWNTIME);
  });

  it("gives a non-downtime record a null payload rather than an absent key, so no reader branches on presence", () => {
    for (const kind of ["note", "combat", "deadline"] as const) {
      const player = projectPlayerChronicleRecord({ kind: "entry", entry: entryRow({ kind, revealedToPlayers: true }) }, playerContext())!;
      expect(player, `${kind} payload`).toHaveProperty("payload", null);
    }
  });

  /**
   * The other half of D11-G, at the projection layer: `fired` is a one-bit channel, and measuring a player's
   * copy against the GM's clock would leak through it that a date the party has not been shown has gone by.
   * The deadline sits on instant 9; the published clock is at 5 and the GM's at 30.
   */
  it("derives a player's `fired` from the published clock, so the boolean cannot leak the GM's prep clock", () => {
    const row = entryRow({ kind: "deadline", revealedToPlayers: true, calendarInstant: 9 });
    expect(projectPlayerChronicleRecord({ kind: "entry", entry: row }, playerContext(5))!.fired).toBe(false);
    expect(projectGmChronicleRecord({ kind: "entry", entry: row }, { campaignInstant: 30 }).fired).toBe(true);
    // Published catches up, and only then does the party's copy read as passed.
    expect(projectPlayerChronicleRecord({ kind: "entry", entry: row }, playerContext(9))!.fired).toBe(true);
  });

  /** O-3: the proposal is prep. It rides on the GM's row and must never appear on the party's. */
  it("keeps a downtime's proposed date off the player row entirely", () => {
    const row = entryRow({ kind: "downtime", revealedToPlayers: true, payload: { ...DOWNTIME, applied: false } });
    const proposedDate: CodexInWorldDate = { year: 1492, month: 1, day: 28 };
    expect(projectGmChronicleRecord({ kind: "entry", entry: row }, { proposedDate }).proposedDate).toEqual(proposedDate);
    const player = projectPlayerChronicleRecord({ kind: "entry", entry: row }, playerContext())!;
    expect(player).not.toHaveProperty("proposedDate");
    expect(JSON.stringify(player)).not.toContain("28");
  });
});

// ----- M12 -----

const FACTION_ID = "22222222-2222-4222-8222-222222222222";
const SECRET_FACTION_ID = "33333333-3333-4333-8333-333333333333";

/** A standing row as the store hands one over. Every field explicit - a projection test must not inherit defaults. */
function standingRow(overrides: Partial<CodexStandingRow> = {}): CodexStandingRow {
  return {
    id: "44444444-4444-4444-8444-444444444444", factionPageId: FACTION_ID, value: -40, revealedToPlayers: false,
    createdAt: "2026-07-29T00:00:00.000Z", updatedAt: "2026-07-29T00:00:00.000Z",
    ...overrides
  };
}
/** A marker row as the store hands one over, GM-only links included so a leak has something to leak. */
function markerRow(overrides: Partial<CodexMarkerRow> = {}): CodexMarkerRow {
  return {
    id: "55555555-5555-4555-8555-555555555555", mapId: "66666666-6666-4666-8666-666666666666",
    x: 0.5, y: 0.25, iconId: "pin", iconColor: "#aabbcc", label: "Camp", revealedToPlayers: false, tags: ["travel"],
    pageIds: [], subMapId: null, sceneIds: ["77777777-7777-4777-8777-777777777777"], actorId: "88888888-8888-4888-8888-888888888888",
    isParty: false, createdAt: "2026-07-29T00:00:00.000Z", updatedAt: "2026-07-29T00:00:00.000Z",
    ...overrides
  };
}
const markerContext = { revealedPageIds: new Set<string>(), subMapRevealed: false };

/**
 * T-6, point-blank. Nothing here goes near a store or an HTTP request: the rows are literals so a
 * projection bug cannot hide behind a store that never handed it a dangerous row.
 */
describe("M12 standing projection - CT-6, two gates and a signed value", () => {
  it("hides an unrevealed standing from a player and carries the VALUE once revealed", () => {
    const hidden = standingRow({ value: -40 });
    expect(projectPlayerStanding(hidden, { factionRevealed: true })).toBeNull();

    const shown = projectPlayerStanding({ ...hidden, revealedToPlayers: true }, { factionRevealed: true });
    expect(shown).not.toBeNull();
    // On the VALUE, not merely on key presence: a projection that emitted `0`, or the absolute of a
    // negative standing, would pass an "is the key there" test and would be wrong in the way that matters.
    expect(shown!.value).toBe(-40);
    expect(shown!.factionPageId).toBe(FACTION_ID);
    // The EXACT projected key set: this fails if any new field ever enters the player standing projection.
    expect(Object.keys(shown!).sort()).toEqual(["factionPageId", "value"]);
    // ...and the GM keeps the whole row, so the assertions above are the gate working, not an empty record.
    expect(projectGmStanding(hidden)).toEqual(hidden);
    expect(projectGmStanding(hidden).revealedToPlayers).toBe(false);
  });

  it("hides a REVEALED standing whose faction page is still secret, so a bar never names a faction the party has not met", () => {
    const row = standingRow({ factionPageId: SECRET_FACTION_ID, revealedToPlayers: true, value: 75 });
    expect(projectPlayerStanding(row, { factionRevealed: false })).toBeNull();
    // The same row with its faction revealed travels - so this is the faction gate, not the record's own.
    expect(projectPlayerStanding(row, { factionRevealed: true })).toEqual({ factionPageId: SECRET_FACTION_ID, value: 75 });
  });
});

/**
 * T-7, point-blank. The party marker is an ORDINARY marker with a flag, and the two claims that makes are
 * both asserted here: its projected key set is the ordinary one plus `isParty`, and `isParty` grants no
 * visibility of its own.
 */
describe("M12 party marker projection - CT-7, a flag and nothing else", () => {
  it("gives a party pin exactly an ordinary pin's key set plus isParty, and no GM-only field", () => {
    const ordinary = projectPlayerMarker(markerRow({ revealedToPlayers: true }), markerContext);
    const party = projectPlayerMarker(markerRow({ revealedToPlayers: true, isParty: true }), markerContext);
    expect(ordinary).not.toBeNull();
    expect(party).not.toBeNull();

    // The whole key set, enumerated. This fails if ANY new field enters the player marker projection, not
    // just if a known GM-only one does - which is the point: `isParty` is the only key M12 may add here.
    expect(Object.keys(party!).sort()).toEqual(["iconColor", "iconId", "id", "isParty", "label", "mapId", "pageIds", "subMapId", "tags", "x", "y"]);
    expect(Object.keys(party!).sort()).toEqual(Object.keys(ordinary!).sort());
    expect(party!.isParty).toBe(true);
    expect(ordinary!.isParty).toBe(false);

    // The GM-only linkage the row is deliberately carrying is nowhere in the serialized party pin.
    const payload = JSON.stringify(party);
    expect(payload).not.toContain("77777777-7777-4777-8777-777777777777");   // sceneIds
    expect(payload).not.toContain("88888888-8888-4888-8888-888888888888");   // actorId
    expect(payload).not.toContain("revealedToPlayers");
    expect(payload).not.toContain("createdAt");
    // ...and the GM's own row still has them, so the absence above is the projection and not an empty row.
    expect(projectGmMarker(markerRow({ isParty: true })).sceneIds).toHaveLength(1);
  });

  it("keeps a HIDDEN party pin hidden, and a party pin on a hidden MAP hidden", () => {
    // `isParty` is checked by no reveal predicate anywhere: the ordinary gate runs first and is unchanged.
    expect(projectPlayerMarker(markerRow({ isParty: true }), markerContext)).toBeNull();
    // CD-6, through the projection that owns the map gate: revealed pin, secret map, still invisible.
    const revealedPartyPin = markerRow({ isParty: true, revealedToPlayers: true });
    expect(projectPlayerPageMarker({ marker: revealedPartyPin, mapRevealed: false, ...markerContext })).toBeNull();
    expect(projectPlayerPageMarker({ marker: revealedPartyPin, mapRevealed: true, ...markerContext })).not.toBeNull();
  });
});

/**
 * The two new chronicle payloads (CT-8 / CT-6), allow-listed per kind and per audience. The `delta`
 * decision M12 asked to be stated explicitly is asserted here rather than left to prose: a player DOES
 * receive a revealed standing record's delta and reason - the store writes that record with an EMPTY
 * `playerText`, so a revealed row without them would be a dated line saying nothing at all.
 */
describe("M12 chronicle payloads - milestone and standing (CT-8 / CT-6)", () => {
  const milestone = entryRow({ kind: "milestone", payload: { level: 5, reason: "Cleared the crypt" } });
  const standing = entryRow({ kind: "standing", payload: { factionPageId: FACTION_ID, delta: -15, reason: "Killed their envoy" } });

  it("carries a revealed milestone's level and reason to a player, and hides an unrevealed one", () => {
    expect(projectPlayerChronicleRecord({ kind: "entry", entry: milestone }, playerContext())).toBeNull();
    const shown = projectPlayerChronicleRecord({ kind: "entry", entry: { ...milestone, revealedToPlayers: true } }, playerContext())!;
    expect(shown.kind).toBe("milestone");
    expect(shown.payload).toEqual({ level: 5, reason: "Cleared the crypt" });
    expect(projectGmChronicleRecord({ kind: "entry", entry: milestone }).payload).toEqual({ level: 5, reason: "Cleared the crypt" });
  });

  it("carries a revealed standing record's DELTA and reason, and HIDES it whole when the faction is secret", () => {
    expect(projectPlayerChronicleRecord({ kind: "entry", entry: standing }, playerContext())).toBeNull();
    const revealed = { ...standing, revealedToPlayers: true };

    /**
     * Faction page secret: the record is hidden WHOLE, not merely stripped of its id.
     *
     * This assertion is the inverse of what it first said. The original nulled `factionPageId` and let
     * `delta` and `reason` travel, justified by "the row still stands on its own prose" — but `setStanding`
     * writes `playerText: ""`, so there is no prose, and what actually shipped to a player was
     * "A faction - up 70 · The party paid the toll" for a faction they had never heard of. Found by an
     * adversarial review and reproduced through the real HTTP routes before this changed.
     *
     * Asking "is the thing this record is ABOUT visible?" is not O-2's forbidden kind filter — it is the
     * question `projectPlayerMarker` asks about a pin's map and `projectPlayerStanding` asks about this very
     * faction page. The two standing surfaces now give the same answer.
     */
    expect(projectPlayerChronicleRecord({ kind: "entry", entry: revealed }, playerContext())).toBeNull();

    // Faction page revealed: the id travels too, so the client can name the faction.
    const withFaction = projectPlayerChronicleRecord({ kind: "entry", entry: revealed }, { ...playerContext(), revealedPageIds: new Set([FACTION_ID]) })!;
    expect(withFaction.payload).toEqual({ factionPageId: FACTION_ID, delta: -15, reason: "Killed their envoy" });
    // The GM always has the id.
    expect(projectGmChronicleRecord({ kind: "entry", entry: standing }).payload).toEqual({ factionPageId: FACTION_ID, delta: -15, reason: "Killed their envoy" });
  });

  it("never lets one kind's payload ride out on another kind's row", () => {
    // A row whose stored blob does not match its kind projects `null`, never a half-filled object: the
    // dispatch is on the ENTRY's kind, not on the shape of the blob.
    const mislabelled = entryRow({ kind: "milestone", revealedToPlayers: true, payload: { who: "Brannor", activity: "Forging", days: 8, applied: true, characterPageId: null } });
    expect(projectPlayerChronicleRecord({ kind: "entry", entry: mislabelled }, playerContext())!.payload).toBeNull();
    expect(projectGmChronicleRecord({ kind: "entry", entry: mislabelled }).payload).toBeNull();
  });
});

/**
 * CT-9 at the projection layer. The end-to-end proof that the audit agrees with the real player endpoints
 * is the HTTP test; what this asserts is the property that makes that possible - the audit's membership
 * test is the PLAYER projection, so a record whose reveal flag is set but which no player can actually see
 * is absent from it.
 */
describe("M12 reveal audit projection - CT-9, an aggregation and not a second opinion", () => {
  it("counts a revealed pin on a HIDDEN map as not visible, and reports every section even when empty", () => {
    const onShownMap = markerRow({ id: "99999999-9999-4999-8999-999999999999", revealedToPlayers: true });
    const onSecretMap = markerRow({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", revealedToPlayers: true, isParty: true });
    const audit = projectRevealAudit([
      { kind: "marker", marker: onShownMap, mapRevealed: true, ...markerContext },
      { kind: "marker", marker: onSecretMap, mapRevealed: false, ...markerContext },
      { kind: "standing", standing: standingRow({ revealedToPlayers: true }), factionRevealed: true, factionTitle: "The Harpers" }
    ]);

    const section = (kind: string) => audit.sections.find((entry) => entry.kind === kind)!;
    // BOTH markers carry `revealed = 1`. An audit written against that flag would say 2; the party can see 1.
    expect(section("marker").total).toBe(2);
    expect(section("marker").revealed).toBe(1);
    expect(section("marker").rows.map((row) => row.id)).toEqual([onShownMap.id]);
    expect(section("standing").rows).toEqual([{ kind: "standing", id: FACTION_ID, title: "The Harpers", journalKind: null }]);

    // Every surface is reported, empty ones included: "nothing revealed" and "did not load" must not look
    // the same on the GM's screen, and an omitted section is exactly how they would.
    expect(audit.sections.map((entry) => entry.kind)).toEqual(["page", "map", "marker", "journal", "session", "quest", "standing"]);
    expect(section("page")).toEqual({ kind: "page", revealed: 0, total: 0, rows: [] });
    expect(audit.revealed).toBe(2);
    expect(audit.total).toBe(3);
  });

  /**
   * A journal row must NAME ITS KIND (2026-07-30).
   *
   * `AUDIT_JOURNAL_FALLBACK` named the kind only when the record had no player prose, so a revealed
   * DEADLINE with prose and a revealed NOTE with prose rendered as the same row - on the one surface whose
   * entire job is answering "is that deadline visible?". The kind now travels as `journalKind`, its own
   * field, because the client badges it: a kind reads by icon AND label here, and a prefix glued onto
   * `title` can be neither badged nor told apart from prose that happens to start with the same word.
   */
  it("names a journal row's KIND in its own field, so a deadline with prose is not a note with prose", () => {
    const deadline = entryRow({ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", kind: "deadline", revealedToPlayers: true, playerText: "The tax is due." });
    const note = entryRow({ id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", kind: "note", revealedToPlayers: true, playerText: "The tax is due." });
    const sessionContext = { unrevealedSessionIds: new Set<string>() };
    const rows = projectRevealAudit([
      { kind: "journal", entry: deadline, sessionContext },
      { kind: "journal", entry: note, sessionContext }
    ]).sections.find((entry) => entry.kind === "journal")!.rows;

    // Identical prose on purpose: with different text a title-only audit would still LOOK informative, and
    // this test would prove nothing about the kind travelling.
    expect(rows.map((row) => row.title)).toEqual(["The tax is due.", "The tax is due."]);
    expect(rows.map((row) => row.journalKind)).toEqual(["deadline", "note"]);
    // A FIELD, not a prefix: the title is still the record's own prose, unornamented.
    expect(rows[0].title).not.toContain("Deadline");

    /**
     * The fallback is untouched and still names a silent record - `setStanding` writes an EMPTY player text,
     * which is the case it was added for. A revealed standing record additionally needs its faction page
     * revealed to reach a player at all (the CT-6 gate above), so the context says so here.
     */
    const silentStanding = entryRow({ kind: "standing", revealedToPlayers: true, playerText: "", payload: { factionPageId: FACTION_ID, delta: 40, reason: "Saved the caravan." } });
    const silent = projectRevealAudit([{ kind: "journal", entry: silentStanding, sessionContext: { ...sessionContext, revealedPageIds: new Set([FACTION_ID]) } }])
      .sections.find((entry) => entry.kind === "journal")!.rows;
    expect(silent).toEqual([{ kind: "journal", id: silentStanding.id, title: "Faction standing changed", journalKind: "standing" }]);
  });
});
