import { describe, expect, it } from "vitest";
import { projectGmCalendar, projectGmChronicleRecord, projectPlayerCalendar, projectPlayerChronicleRecord } from "../src/codex-projections.js";
import type { CodexCalendar, CodexDowntimePayload, CodexInWorldDate, CodexJournalKind, CodexJournalRow } from "../src/codex-store.js";

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
    attachMarkerId: null, attachPageId: null, sourceEncounterId: null, sessionNumber: null, realDate: null,
    inWorldLabel: "Hammer 10, 1492 DR", calendarInstant: 9, inWorldDate: { year: 1492, month: 0, day: 10 },
    sortKey: 0, tags: [], payload: null, createdAt: "2026-07-29T00:00:00.000Z", updatedAt: "2026-07-29T00:00:00.000Z",
    ...overrides
  };
}
const DOWNTIME: CodexDowntimePayload = { who: "Brannor", activity: "Forging a blade", days: 8, applied: true };
const playerContext = (publishedInstant: number | null = null) => ({ unrevealedSessionNumbers: new Set<number>(), publishedInstant });

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

    expect(player.payload).toEqual({ who: "Brannor", activity: "Forging a blade", days: 8 });
    expect(Object.keys(player.payload!).sort()).toEqual(["activity", "days", "who"]);
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
