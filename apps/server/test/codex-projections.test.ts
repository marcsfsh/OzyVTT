import { describe, expect, it } from "vitest";
import {
  projectGmChronicleRecord,
  projectGmCalendar,
  projectGmMarker,
  projectGmStanding,
  projectPlayerCalendar,
  projectPlayerChronicleRecord,
  projectPlayerMarker,
  projectPlayerPageMarker,
  projectPlayerStanding,
  projectRevealAudit
} from "../src/codex-projections.js";
import type {
  CodexCalendar,
  CodexDowntimePayload,
  CodexInWorldDate,
  CodexJournalEntry,
  CodexJournalKind,
  CodexMarker,
  CodexStanding
} from "@vtt/domain";

// Codex projection gates on literal rows, so a bug cannot hide behind a store that never returned a
// dangerous row. SQL and HTTP layers are covered in `codex-store.test.ts` and `codex-http.test.ts`.

const CALENDAR: CodexCalendar = {
  yearName: "DR",
  months: [
    { name: "Hammer", days: 30 },
    { name: "Alturiak", days: 30 }
  ],
  weekdays: ["First", "Second"],
  currentDate: { year: 1492, month: 1, day: 20 }
};

/** A journal row as the store returns one. Every field explicit so the test inherits no defaults. */
function entryRow(overrides: Partial<CodexJournalEntry> & { kind: CodexJournalKind }): CodexJournalEntry {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    playerText: "The tax is due.",
    gmText: "The duke will send the guard.",
    revealedToPlayers: false,
    attachMarkerId: null,
    attachPageId: null,
    sourceEncounterId: null,
    sessionId: null,
    sessionNumber: null,
    realDate: null,
    inWorldLabel: "Hammer 10, 1492 DR",
    calendarInstant: 9,
    inWorldDate: { year: 1492, month: 0, day: 10 },
    sortKey: 0,
    tags: [],
    payload: null,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    ...overrides
  };
}
const DOWNTIME: CodexDowntimePayload = {
  who: "Brannor",
  activity: "Forging a blade",
  days: 8,
  applied: true,
  characterPageId: null
};
const playerContext = (publishedInstant: number | null = null) => ({
  unrevealedSessionIds: new Set<string>(),
  publishedInstant
});

describe("M11 calendar projection - the GM's prep clock never reaches a player (O-1 / D11-G)", () => {
  /** The two clocks differ, so a projection that returned the GM's clock cannot pass. */
  it("emits the PUBLISHED date as a player's currentDate, and the GM clock is not reachable from the payload", () => {
    const published: CodexInWorldDate = { year: 1492, month: 0, day: 10 };
    const player = projectPlayerCalendar(CALENDAR, published);

    // The value, not merely the key: `currentDate` is present and is the published date.
    expect(player.currentDate).toEqual({ year: 1492, month: 0, day: 10 });
    expect(player.currentDate).not.toEqual(CALENDAR.currentDate);
    // ...and the GM's clock (`month: 1`, `day: 20`) is nowhere in the serialized payload.
    expect(JSON.stringify(player)).toBe(
      JSON.stringify({
        yearName: "DR",
        eras: [],
        months: CALENDAR.months,
        weekdays: CALENDAR.weekdays,
        currentDate: published
      })
    );
    expect(Object.keys(player).sort()).toEqual(["currentDate", "eras", "months", "weekdays", "yearName"]);
    // The world's own months/weekdays/eras are not secrets and still travel unchanged.
    expect(player.months).toEqual(CALENDAR.months);
    expect(player.weekdays).toEqual(CALENDAR.weekdays);
  });

  // `eras` is added key by key to both projections, as `months` is: a player-side spread would carry
  // the next GM-only field out with it. Eras carry no dates; `currentDate` is still the only clock.
  it("gives BOTH audiences the world's eras, and gives the player no extra key with them", () => {
    const eras = [
      { name: "Age of Ruin", startYear: 1000 },
      { name: "Third Age", startYear: 1400 }
    ];
    const withEras = { ...CALENDAR, eras };
    const published: CodexInWorldDate = { year: 1492, month: 0, day: 10 };

    expect(projectGmCalendar(withEras, published).eras).toEqual(eras);
    const player = projectPlayerCalendar(withEras, published);
    expect(player.eras).toEqual(eras);
    expect(Object.keys(player).sort()).toEqual(["currentDate", "eras", "months", "weekdays", "yearName"]);
    expect(JSON.stringify(player)).not.toContain('"day":20');
  });

  it("gives the GM both clocks, so they can see that the table is behind them", () => {
    const published: CodexInWorldDate = { year: 1492, month: 0, day: 10 };
    const gm = projectGmCalendar(CALENDAR, published);
    expect(gm.currentDate).toEqual({ year: 1492, month: 1, day: 20 });
    expect(gm.publishedDate).toEqual(published);
  });

  /** With nothing published, a player sees no date at all, never a fallback to the GM clock. */
  it("shows a player no date at all when nothing has been published, rather than falling back to the GM clock", () => {
    const player = projectPlayerCalendar(CALENDAR, null);
    expect(player.currentDate).toBeNull();
    expect(JSON.stringify(player)).not.toContain("1492");
  });
});

describe("M11 chronicle projection - deadlines and downtime are gated by reveal and nothing else (O-2 / D11-E)", () => {
  // Unrevealed records are absent and revealed ones are present. The positive half guards against a
  // kind-based filter that would hide deadlines from players forever.
  it("hides an unrevealed deadline and an unrevealed downtime from a player, and shows them once revealed", () => {
    const deadline = entryRow({ kind: "deadline" });
    const downtime = entryRow({ kind: "downtime", payload: DOWNTIME });

    expect(projectPlayerChronicleRecord({ kind: "entry", entry: deadline }, playerContext())).toBeNull();
    expect(projectPlayerChronicleRecord({ kind: "entry", entry: downtime }, playerContext())).toBeNull();

    const shownDeadline = projectPlayerChronicleRecord(
      { kind: "entry", entry: { ...deadline, revealedToPlayers: true } },
      playerContext()
    );
    const shownDowntime = projectPlayerChronicleRecord(
      { kind: "entry", entry: { ...downtime, revealedToPlayers: true } },
      playerContext()
    );
    expect(shownDeadline).not.toBeNull();
    expect(shownDowntime).not.toBeNull();
    // A revealed deadline keeps its kind.
    expect(shownDeadline!.kind).toBe("deadline");
    expect(shownDowntime!.kind).toBe("downtime");
    expect(
      projectPlayerChronicleRecord(
        { kind: "entry", entry: entryRow({ kind: "note", revealedToPlayers: true }) },
        playerContext()
      )
    ).not.toBeNull();
  });

  it("carries a revealed downtime's who/activity/days to a player but never `applied`", () => {
    const row = entryRow({ kind: "downtime", revealedToPlayers: true, payload: DOWNTIME });
    const player = projectPlayerChronicleRecord({ kind: "entry", entry: row }, playerContext())!;

    expect(player.payload).toEqual({ who: "Brannor", activity: "Forging a blade", days: 8, characterPageId: null });
    expect(Object.keys(player.payload!).sort()).toEqual(["activity", "characterPageId", "days", "who"]);
    // On the value as well as the key set: `applied` is `true` in the stored payload, so a passthrough
    // would put `true` into the serialized player row.
    expect(JSON.stringify(player)).not.toContain("applied");
    expect(projectGmChronicleRecord({ kind: "entry", entry: row }).payload).toEqual(DOWNTIME);
  });

  it("gives a non-downtime record a null payload rather than an absent key, so no reader branches on presence", () => {
    for (const kind of ["note", "combat", "deadline"] as const) {
      const player = projectPlayerChronicleRecord(
        { kind: "entry", entry: entryRow({ kind, revealedToPlayers: true }) },
        playerContext()
      )!;
      expect(player, `${kind} payload`).toHaveProperty("payload", null);
    }
  });

  // `fired` is a one-bit channel: measured against the GM's clock it would reveal that an unshown date
  // has passed. The deadline sits on instant 9; the published clock is at 5 and the GM's at 30.
  it("derives a player's `fired` from the published clock, so the boolean cannot leak the GM's prep clock", () => {
    const row = entryRow({ kind: "deadline", revealedToPlayers: true, calendarInstant: 9 });
    expect(projectPlayerChronicleRecord({ kind: "entry", entry: row }, playerContext(5))!.fired).toBe(false);
    expect(projectGmChronicleRecord({ kind: "entry", entry: row }, { campaignInstant: 30 }).fired).toBe(true);
    expect(projectPlayerChronicleRecord({ kind: "entry", entry: row }, playerContext(9))!.fired).toBe(true);
  });

  /** A downtime's proposed date is GM prep and must never appear on the party's row. */
  it("keeps a downtime's proposed date off the player row entirely", () => {
    const row = entryRow({ kind: "downtime", revealedToPlayers: true, payload: { ...DOWNTIME, applied: false } });
    const proposedDate: CodexInWorldDate = { year: 1492, month: 1, day: 28 };
    expect(projectGmChronicleRecord({ kind: "entry", entry: row }, { proposedDate }).proposedDate).toEqual(
      proposedDate
    );
    const player = projectPlayerChronicleRecord({ kind: "entry", entry: row }, playerContext())!;
    expect(player).not.toHaveProperty("proposedDate");
    expect(JSON.stringify(player)).not.toContain("28");
  });
});

const FACTION_ID = "22222222-2222-4222-8222-222222222222";
const SECRET_FACTION_ID = "33333333-3333-4333-8333-333333333333";

/** A standing row as the store returns one. Every field explicit so the test inherits no defaults. */
function standingRow(overrides: Partial<CodexStanding> = {}): CodexStanding {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    factionPageId: FACTION_ID,
    value: -40,
    revealedToPlayers: false,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    ...overrides
  };
}
/** A marker row as the store returns one, GM-only links included so a leak has something to leak. */
function markerRow(overrides: Partial<CodexMarker> = {}): CodexMarker {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    mapId: "66666666-6666-4666-8666-666666666666",
    x: 0.5,
    y: 0.25,
    iconId: "pin",
    iconColor: "#aabbcc",
    label: "Camp",
    revealedToPlayers: false,
    tags: ["travel"],
    pageIds: [],
    subMapId: null,
    sceneIds: ["77777777-7777-4777-8777-777777777777"],
    actorId: "88888888-8888-4888-8888-888888888888",
    isParty: false,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    ...overrides
  };
}
const markerContext = { revealedPageIds: new Set<string>(), subMapRevealed: false };

describe("M12 standing projection - CT-6, two gates and a signed value", () => {
  it("hides an unrevealed standing from a player and carries the VALUE once revealed", () => {
    const hidden = standingRow({ value: -40 });
    expect(projectPlayerStanding(hidden, { factionRevealed: true })).toBeNull();

    const shown = projectPlayerStanding({ ...hidden, revealedToPlayers: true }, { factionRevealed: true });
    expect(shown).not.toBeNull();
    // On the value: emitting `0`, or the absolute value of a negative standing, would be wrong.
    expect(shown!.value).toBe(-40);
    expect(shown!.factionPageId).toBe(FACTION_ID);
    // The exact projected key set, so any new field in the player standing projection fails here.
    expect(Object.keys(shown!).sort()).toEqual(["factionPageId", "value"]);
    expect(projectGmStanding(hidden)).toEqual(hidden);
    expect(projectGmStanding(hidden).revealedToPlayers).toBe(false);
  });

  it("hides a REVEALED standing whose faction page is still secret, so a bar never names a faction the party has not met", () => {
    const row = standingRow({ factionPageId: SECRET_FACTION_ID, revealedToPlayers: true, value: 75 });
    expect(projectPlayerStanding(row, { factionRevealed: false })).toBeNull();
    // The same row with its faction revealed travels, so this is the faction gate.
    expect(projectPlayerStanding(row, { factionRevealed: true })).toEqual({
      factionPageId: SECRET_FACTION_ID,
      value: 75
    });
  });
});

// The party marker is an ordinary marker with a flag: its projected key set is the ordinary one plus
// `isParty`, and `isParty` grants no visibility of its own.
describe("M12 party marker projection - CT-7, a flag and nothing else", () => {
  it("gives a party pin exactly an ordinary pin's key set plus isParty, and no GM-only field", () => {
    const ordinary = projectPlayerMarker(markerRow({ revealedToPlayers: true }), markerContext);
    const party = projectPlayerMarker(markerRow({ revealedToPlayers: true, isParty: true }), markerContext);
    expect(ordinary).not.toBeNull();
    expect(party).not.toBeNull();

    // The whole key set, so any new field in the player marker projection fails here.
    expect(Object.keys(party!).sort()).toEqual([
      "iconColor",
      "iconId",
      "id",
      "isParty",
      "label",
      "mapId",
      "pageIds",
      "subMapId",
      "tags",
      "x",
      "y"
    ]);
    expect(Object.keys(party!).sort()).toEqual(Object.keys(ordinary!).sort());
    expect(party!.isParty).toBe(true);
    expect(ordinary!.isParty).toBe(false);

    // The GM-only links the row carries are nowhere in the serialized party pin.
    const payload = JSON.stringify(party);
    expect(payload).not.toContain("77777777-7777-4777-8777-777777777777"); // sceneIds
    expect(payload).not.toContain("88888888-8888-4888-8888-888888888888"); // actorId
    expect(payload).not.toContain("revealedToPlayers");
    expect(payload).not.toContain("createdAt");
    expect(projectGmMarker(markerRow({ isParty: true })).sceneIds).toHaveLength(1);
  });

  it("keeps a HIDDEN party pin hidden, and a party pin on a hidden MAP hidden", () => {
    // No reveal predicate reads `isParty`; the ordinary gate is unchanged.
    expect(projectPlayerMarker(markerRow({ isParty: true }), markerContext)).toBeNull();
    // Revealed pin on a secret map: still invisible.
    const revealedPartyPin = markerRow({ isParty: true, revealedToPlayers: true });
    expect(projectPlayerPageMarker({ marker: revealedPartyPin, mapRevealed: false, ...markerContext })).toBeNull();
    expect(projectPlayerPageMarker({ marker: revealedPartyPin, mapRevealed: true, ...markerContext })).not.toBeNull();
  });
});

// Milestone and standing payloads, allow-listed per kind and audience. A player gets a revealed standing
// record's delta and reason, since its `playerText` is empty.
describe("M12 chronicle payloads - milestone and standing (CT-8 / CT-6)", () => {
  const milestone = entryRow({ kind: "milestone", payload: { level: 5, reason: "Cleared the crypt" } });
  const standing = entryRow({
    kind: "standing",
    payload: { factionPageId: FACTION_ID, delta: -15, reason: "Killed their envoy" }
  });

  it("carries a revealed milestone's level and reason to a player, and hides an unrevealed one", () => {
    expect(projectPlayerChronicleRecord({ kind: "entry", entry: milestone }, playerContext())).toBeNull();
    const shown = projectPlayerChronicleRecord(
      { kind: "entry", entry: { ...milestone, revealedToPlayers: true } },
      playerContext()
    )!;
    expect(shown.kind).toBe("milestone");
    expect(shown.payload).toEqual({ level: 5, reason: "Cleared the crypt" });
    expect(projectGmChronicleRecord({ kind: "entry", entry: milestone }).payload).toEqual({
      level: 5,
      reason: "Cleared the crypt"
    });
  });

  it("carries a revealed standing record's DELTA and reason, and HIDES it whole when the faction is secret", () => {
    expect(projectPlayerChronicleRecord({ kind: "entry", entry: standing }, playerContext())).toBeNull();
    const revealed = { ...standing, revealedToPlayers: true };

    // Faction page secret: the whole record is hidden, since delta and reason alone would describe a faction
    // the party has never heard of (as `projectPlayerStanding` decides).
    expect(projectPlayerChronicleRecord({ kind: "entry", entry: revealed }, playerContext())).toBeNull();

    // Faction page revealed: the id travels too, so the client can name the faction.
    const withFaction = projectPlayerChronicleRecord(
      { kind: "entry", entry: revealed },
      { ...playerContext(), revealedPageIds: new Set([FACTION_ID]) }
    )!;
    expect(withFaction.payload).toEqual({ factionPageId: FACTION_ID, delta: -15, reason: "Killed their envoy" });
    expect(projectGmChronicleRecord({ kind: "entry", entry: standing }).payload).toEqual({
      factionPageId: FACTION_ID,
      delta: -15,
      reason: "Killed their envoy"
    });
  });

  it("never lets one kind's payload ride out on another kind's row", () => {
    // A row whose stored blob does not match its kind projects `null`: dispatch is on the entry's kind.
    const mislabelled = entryRow({
      kind: "milestone",
      revealedToPlayers: true,
      payload: { who: "Brannor", activity: "Forging", days: 8, applied: true, characterPageId: null }
    });
    expect(projectPlayerChronicleRecord({ kind: "entry", entry: mislabelled }, playerContext())!.payload).toBeNull();
    expect(projectGmChronicleRecord({ kind: "entry", entry: mislabelled }).payload).toBeNull();
  });
});

// The reveal audit's membership test is the player projection, so a record whose reveal flag is set
// but which no player can see is absent from it.
describe("M12 reveal audit projection - CT-9, an aggregation and not a second opinion", () => {
  it("counts a revealed pin on a HIDDEN map as not visible, and reports every section even when empty", () => {
    const onShownMap = markerRow({ id: "99999999-9999-4999-8999-999999999999", revealedToPlayers: true });
    const onSecretMap = markerRow({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      revealedToPlayers: true,
      isParty: true
    });
    const audit = projectRevealAudit([
      { kind: "marker", marker: onShownMap, mapRevealed: true, ...markerContext },
      { kind: "marker", marker: onSecretMap, mapRevealed: false, ...markerContext },
      {
        kind: "standing",
        standing: standingRow({ revealedToPlayers: true }),
        factionRevealed: true,
        factionTitle: "The Harpers"
      }
    ]);

    const section = (kind: string) => audit.sections.find((entry) => entry.kind === kind)!;
    // Both markers carry `revealed = 1`, but the party can see only one.
    expect(section("marker").total).toBe(2);
    expect(section("marker").revealed).toBe(1);
    expect(section("marker").rows.map((row) => row.id)).toEqual([onShownMap.id]);
    expect(section("standing").rows).toEqual([
      { kind: "standing", id: FACTION_ID, title: "The Harpers", journalKind: null }
    ]);

    // Every surface is reported, empty ones included, so "nothing revealed" and "did not load" differ.
    expect(audit.sections.map((entry) => entry.kind)).toEqual([
      "page",
      "map",
      "marker",
      "journal",
      "session",
      "quest",
      "standing"
    ]);
    expect(section("page")).toEqual({ kind: "page", revealed: 0, total: 0, rows: [] });
    expect(audit.revealed).toBe(2);
    expect(audit.total).toBe(3);
  });

  // A journal row carries its kind as `journalKind`, its own field, so a deadline with prose is not
  // indistinguishable from a note with prose and the client can badge it.
  it("names a journal row's KIND in its own field, so a deadline with prose is not a note with prose", () => {
    const deadline = entryRow({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      kind: "deadline",
      revealedToPlayers: true,
      playerText: "The tax is due."
    });
    const note = entryRow({
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      kind: "note",
      revealedToPlayers: true,
      playerText: "The tax is due."
    });
    const sessionContext = { unrevealedSessionIds: new Set<string>() };
    const rows = projectRevealAudit([
      { kind: "journal", entry: deadline, sessionContext },
      { kind: "journal", entry: note, sessionContext }
    ]).sections.find((entry) => entry.kind === "journal")!.rows;

    expect(rows.map((row) => row.title)).toEqual(["The tax is due.", "The tax is due."]);
    expect(rows.map((row) => row.journalKind)).toEqual(["deadline", "note"]);
    expect(rows[0].title).not.toContain("Deadline");

    // The fallback still names a silent record (`setStanding` writes an empty player text). A revealed
    // standing record also needs its faction page revealed to reach a player.
    const silentStanding = entryRow({
      kind: "standing",
      revealedToPlayers: true,
      playerText: "",
      payload: { factionPageId: FACTION_ID, delta: 40, reason: "Saved the caravan." }
    });
    const silent = projectRevealAudit([
      {
        kind: "journal",
        entry: silentStanding,
        sessionContext: { ...sessionContext, revealedPageIds: new Set([FACTION_ID]) }
      }
    ]).sections.find((entry) => entry.kind === "journal")!.rows;
    expect(silent).toEqual([
      { kind: "journal", id: silentStanding.id, title: "Faction standing changed", journalKind: "standing" }
    ]);
  });
});
