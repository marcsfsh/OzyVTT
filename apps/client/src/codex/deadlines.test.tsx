import { describe, expect, it } from "vitest";

import {
  CHRONICLE_KIND_META,
  campaignDeadlines,
  deadlineFired,
  downtimeProposedDate,
  downtimeSummaryLabel
} from "./chronicle";
import { CODEX_ICONS } from "./icons";
import type { CodexChronicleRecord } from "@vtt/domain";

/** The chronicle's reading rules for deadlines and downtime. How Story shows them is in `story/chronicle.test.tsx`. */

const RECORD = (over: Partial<CodexChronicleRecord> = {}): CodexChronicleRecord => ({
  kind: "entry",
  id: "j1",
  title: null,
  text: "The party crossed the mists.",
  gmText: null,
  revealedToPlayers: false,
  sessionId: null,
  sessionNumber: null,
  realDate: null,
  inWorldLabel: null,
  calendarInstant: null,
  inWorldDate: null,
  tags: [],
  attachPageId: null,
  attachMarkerId: null,
  sourceEncounterId: null,
  payload: null,
  fired: false,
  proposedDate: null,
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
  ...over
});

const DEADLINE = RECORD({
  kind: "deadline",
  id: "d1",
  text: "The duke's ultimatum expires.",
  inWorldLabel: "Hammer 10, 1492 DR",
  calendarInstant: 1492 * 60 + 9,
  inWorldDate: { year: 1492, month: 0, day: 10 }
});
const DOWNTIME = RECORD({
  kind: "downtime",
  id: "w1",
  text: "A quiet tenday in Daggerford.",
  payload: { who: "Aldric", activity: "Forging a blade", days: 7, characterPageId: null, applied: false },
  // The server's landing date (Hammer 3 + 7). One test makes it disagree with local arithmetic on purpose.
  proposedDate: { year: 1492, month: 0, day: 10 },
  inWorldLabel: "Hammer 3, 1492 DR",
  calendarInstant: 1492 * 60 + 2,
  inWorldDate: { year: 1492, month: 0, day: 3 }
});

describe("A new kind reads by icon AND word", () => {
  it("every chronicle kind names an icon the registry actually has", () => {
    // `iconChildren` silently falls back to `pin` for an unknown id.
    for (const [kind, meta] of Object.entries(CHRONICLE_KIND_META)) {
      expect(CODEX_ICONS[meta.iconId], `${kind} names an icon that does not exist: ${meta.iconId}`).toBeDefined();
      expect(meta.label.trim()).not.toBe("");
    }
    // Distinct labels, or colour would be the only difference.
    const labels = Object.values(CHRONICLE_KIND_META).map((meta) => meta.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("The shared reading rules themselves", () => {
  it("only a deadline can be fired, and an absent flag reads as not fired", () => {
    // The kind check, and `=== true` so a row without the key reads as not fired.
    expect(deadlineFired({ kind: "deadline", fired: true })).toBe(true);
    expect(deadlineFired({ kind: "deadline", fired: false })).toBe(false);
    expect(deadlineFired({ kind: "entry", fired: true })).toBe(false);
    expect(deadlineFired({ kind: "downtime", fired: true })).toBe(false);
    expect(deadlineFired({ kind: "deadline" })).toBe(false);
  });

  it("orders deadlines passed-first and leaves every other kind out", () => {
    const records = [RECORD({ id: "j1" }), DEADLINE, RECORD({ ...DEADLINE, id: "d2", fired: true }), DOWNTIME];
    expect(campaignDeadlines(records).map((record) => record.id)).toEqual(["d2", "d1"]);
  });

  it("walks months and years when downtime advances the clock, and never clamps into the wrong day", () => {
    const calendar = {
      yearName: "DR",
      months: [
        { name: "Hammer", days: 30 },
        { name: "Alturiak", days: 30 }
      ],
      weekdays: []
    };
    expect(downtimeProposedDate({ ...calendar, currentDate: { year: 1492, month: 0, day: 3 } }, 7)).toEqual({
      year: 1492,
      month: 0,
      day: 10
    });
    // Rolls into the next month.
    expect(downtimeProposedDate({ ...calendar, currentDate: { year: 1492, month: 0, day: 28 } }, 5)).toEqual({
      year: 1492,
      month: 1,
      day: 3
    });
    // Rolls the year.
    expect(downtimeProposedDate({ ...calendar, currentDate: { year: 1492, month: 1, day: 28 } }, 5)).toEqual({
      year: 1493,
      month: 0,
      day: 3
    });
    // A stored day 31 of a 30-day month counts as day 30, as on the server, so +1 is the next month's day 1.
    expect(downtimeProposedDate({ ...calendar, currentDate: { year: 1492, month: 0, day: 31 } }, 1)).toEqual({
      year: 1492,
      month: 1,
      day: 1
    });
    expect(downtimeProposedDate({ ...calendar, currentDate: null }, 7)).toBeNull();
    expect(downtimeProposedDate(null, 7)).toBeNull();
  });

  it("says a downtime in one line without inventing punctuation for the halves it was not given", () => {
    expect(downtimeSummaryLabel({ who: "Aldric", activity: "Forging a blade", days: 7, characterPageId: null })).toBe(
      "Aldric · Forging a blade · 7 days"
    );
    expect(downtimeSummaryLabel({ who: "", activity: "Carousing", days: 1, characterPageId: null })).toBe(
      "Carousing · 1 day"
    );
    expect(downtimeSummaryLabel({ who: "", activity: "", days: 0, characterPageId: null })).toBe("0 days");
  });
});
