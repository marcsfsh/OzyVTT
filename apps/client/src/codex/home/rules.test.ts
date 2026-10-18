import { describe, expect, it } from "vitest";
import { clocksOf, nextSessionCard, realDateLabel } from "./rules";
import type { CodexChronicleRecord } from "@vtt/domain";

/** Home's pure selection rules. The session card's heading must reflect the record, never a constant. */

const SESSION = (
  over: Partial<{
    id: string;
    sessionNumber: number | null;
    realDate: string | null;
    status: "planned" | "played";
  }> = {}
) => ({
  id: "s1",
  sessionNumber: 1,
  realDate: null,
  status: "planned" as const,
  ...over
});

describe("Which session Home names, and what it calls it", () => {
  it("says 'Next session' about one that has not been played", () => {
    const card = nextSessionCard([SESSION({ id: "s4", sessionNumber: 4 })], null);
    expect(card?.heading).toBe("Next session");
    expect(card?.id).toBe("s4");
  });

  it("says 'Last session' about a played one: the lie D18 was raised to kill", () => {
    const card = nextSessionCard([SESSION({ id: "s3", sessionNumber: 3, status: "played" })], null);
    expect(card?.heading).toBe("Last session");
  });

  it("says 'This session' about the played one the GM has pointed at", () => {
    // Active and played together is a game in progress: "This session".
    const card = nextSessionCard([SESSION({ id: "s3", sessionNumber: 3, status: "played" })], "s3");
    expect(card?.heading).toBe("This session");
  });

  it("prefers the active session outright, whatever else is planned", () => {
    const card = nextSessionCard(
      [SESSION({ id: "s3", sessionNumber: 3, status: "played" }), SESSION({ id: "s4", sessionNumber: 4 })],
      "s3"
    );
    expect(card?.id).toBe("s3");
  });

  it("picks the LOWEST-numbered planned session when nothing is active", () => {
    const card = nextSessionCard(
      [SESSION({ id: "s9", sessionNumber: 9 }), SESSION({ id: "s5", sessionNumber: 5 })],
      null
    );
    expect(card?.id).toBe("s5");
    expect(card?.heading).toBe("Next session");
  });

  it("has no card at all when there are no sessions", () => {
    expect(nextSessionCard([], null)).toBeNull();
  });
});

// ----- Clocks -----

const RECORD = (over: Partial<CodexChronicleRecord> = {}): CodexChronicleRecord =>
  ({
    kind: "entry",
    id: "e1",
    title: null,
    text: "An entry.",
    gmText: null,
    revealedToPlayers: false,
    sessionId: null,
    sessionNumber: null,
    realDate: null,
    inWorldLabel: null,
    calendarInstant: null,
    inWorldDate: null,
    tags: [],
    payload: null,
    fired: false,
    createdAt: "2026-07-01T00:00:00.000Z",
    ...over
  }) as CodexChronicleRecord;

describe("The clocks a player's Home lists", () => {
  it("puts passed deadlines first, says each in one line, and leaves every other kind out", () => {
    const clocks = clocksOf([
      RECORD({ kind: "deadline", id: "d1", text: "The duke's ultimatum expires.", fired: false }),
      RECORD({ id: "e9" }),
      RECORD({ kind: "deadline", id: "d2", text: "The tide turns.", fired: true })
    ]);
    expect(clocks.map((clock) => [clock.id, clock.fired])).toEqual([
      ["d2", true],
      ["d1", false]
    ]);
    expect(clocks[1].summary).toBe("The duke's ultimatum expires.");
  });
});

describe("A session's real date", () => {
  it("reads a calendar day in words, and keeps whatever else the GM wrote as it is", () => {
    expect(realDateLabel("2026-10-24")).toBe(
      new Date("2026-10-24T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })
    );
    expect(realDateLabel("next Saturday")).toBe("next Saturday");
    expect(realDateLabel(null)).toBeNull();
    expect(realDateLabel("  ")).toBeNull();
  });
});
