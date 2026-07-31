import { describe, expect, it } from "vitest";
import { campaignFeedProps, nextSessionCard, pendingDowntime, recordsOnInstant } from "./dashboard";
import type { CodexChronicleRecord } from "./api";

/**
 * D18's dashboard arithmetic, tested where it lives — as pure functions over rows.
 *
 * The heading branch is the reason this file exists. `nextSessionCard` computes "Next session" /
 * "This session" / "Last session" from the record itself, and D18 exists because the old card said
 * "Next session — Session 4" about a game already behind the table. Every fixture in the client suite
 * was `status: "planned"`, and the one heading assertion anywhere asserted the constant a mutant would
 * produce — so replacing the whole branch with `const heading = "Next session";` kept the suite green
 * and reinstated the exact lie. That mutation now fails here.
 */

const SESSION = (over: Partial<{ id: string; sessionNumber: number | null; realDate: string | null; recapBody: string; status: "planned" | "played"; revealedToPlayers: boolean }> = {}) => ({
  id: "s1", sessionNumber: 1, realDate: null, recapBody: "", status: "planned" as const, ...over
});

describe("Which session the dashboard names, and what it calls it (D18)", () => {
  it("says 'Next session' about one that has not been played", () => {
    const card = nextSessionCard([SESSION({ id: "s4", sessionNumber: 4 })], null);
    expect(card?.heading).toBe("Next session");
    expect(card?.id).toBe("s4");
  });

  it("says 'Last session' about a played one — the lie D18 was raised to kill", () => {
    const card = nextSessionCard([SESSION({ id: "s3", sessionNumber: 3, status: "played" })], null);
    expect(card?.heading).toBe("Last session");
  });

  it("says 'This session' about the played one the GM has pointed at", () => {
    // "Active" and "played" together is a game in progress, which is neither next nor last.
    const card = nextSessionCard([SESSION({ id: "s3", sessionNumber: 3, status: "played" })], "s3");
    expect(card?.heading).toBe("This session");
  });

  it("prefers the active session outright, whatever else is planned", () => {
    const card = nextSessionCard([SESSION({ id: "s3", sessionNumber: 3, status: "played" }), SESSION({ id: "s4", sessionNumber: 4 })], "s3");
    expect(card?.id).toBe("s3");
  });

  it("picks the LOWEST-numbered planned session when nothing is active", () => {
    const card = nextSessionCard([SESSION({ id: "s9", sessionNumber: 9 }), SESSION({ id: "s5", sessionNumber: 5 })], null);
    expect(card?.id).toBe("s5");
    expect(card?.heading).toBe("Next session");
  });

  it("has no card at all when there are no sessions", () => {
    expect(nextSessionCard([], null)).toBeNull();
  });

  it("carries the recap's reveal state when the caller has one, and omits it when they do not", () => {
    // The capability flag: a GM row carries `revealedToPlayers`, the player projection has no such
    // field, and the card renders a badge only for the caller who can answer the question.
    expect(nextSessionCard([SESSION({ revealedToPlayers: false })], null)?.revealed).toBe(false);
    expect(nextSessionCard([SESSION()], null)?.revealed).toBeUndefined();
  });
});

// ---- Downtime ----

const RECORD = (over: Partial<CodexChronicleRecord> = {}): CodexChronicleRecord => ({
  kind: "entry", id: "e1", title: null, text: "An entry.", gmText: null, revealedToPlayers: false,
  sessionId: null, sessionNumber: null, realDate: null, inWorldLabel: null, calendarInstant: null,
  inWorldDate: null, tags: [], payload: null, fired: false, createdAt: "2026-07-01T00:00:00.000Z",
  ...over
} as CodexChronicleRecord);

const DOWNTIME = (id: string, applied: boolean, who = "Ana", revealed = false) =>
  RECORD({ kind: "downtime", id, text: `${who} took time.`, revealedToPlayers: revealed, payload: { who, activity: "Forging", days: 7, characterPageId: null, applied } } as Partial<CodexChronicleRecord>);

describe("Downtime waiting on the GM (D18 #5)", () => {
  it("lists only the unconfirmed rows", () => {
    const rows = pendingDowntime([DOWNTIME("w1", false), DOWNTIME("w2", true), RECORD()]);
    expect(rows.map((row) => row.id)).toEqual(["w1"]);
  });

  it("states each row's reveal state, like every other dashboard row that names a record", () => {
    expect(pendingDowntime([DOWNTIME("w1", false, "Ana", true)])[0].revealed).toBe(true);
    expect(pendingDowntime([DOWNTIME("w2", false, "Bo", false)])[0].revealed).toBe(false);
  });

  it("does not also leave a pending row in the feed — one record, one place on the dashboard", () => {
    // It has a card of its own WITH the Confirm affordance on it; the feed copy could only be pressed
    // to open the entry, so the duplicate was pure noise on the surface D18 exists to declutter.
    const feed = campaignFeedProps({ records: [DOWNTIME("w1", false), DOWNTIME("w2", true), RECORD({ id: "e9" })], calendar: null });
    expect(feed.downtimePending.map((row) => row.id)).toEqual(["w1"]);
    expect(feed.entries.map((entry) => entry.id)).toEqual(["w2", "e9"]);
  });

  it("keeps CONFIRMED downtime in the feed, because nothing else on the dashboard carries it", () => {
    const feed = campaignFeedProps({ records: [DOWNTIME("w2", true)], calendar: null });
    expect(feed.entries.map((entry) => entry.id)).toEqual(["w2"]);
  });
});

describe("Records on one in-world day (the Calendar's day panel)", () => {
  it("matches the server's instant exactly, and never re-derives a date", () => {
    const rows = [RECORD({ id: "a", calendarInstant: 100 }), RECORD({ id: "b", calendarInstant: 101 }), RECORD({ id: "c", calendarInstant: null })];
    expect(recordsOnInstant(rows, 100).map((row) => row.id)).toEqual(["a"]);
    expect(recordsOnInstant(rows, 999)).toEqual([]);
  });
});
