/**
 * D18 — the dashboard's reading rules, shared by both audiences.
 *
 * `CampaignHome` is presentational and role-blind (both shells render it), so the *selection* of what
 * each card shows lives here rather than in either shell: two copies of "which downtime is pending" is
 * exactly how a GM's dashboard and a player's come to disagree about the same records.
 *
 * Pure functions, no JSX, on `chronicle.ts`'s terms.
 */

import {
  DASHBOARD_CARDED_KINDS, campaignDeadlines, chronicleRowSummary, chronicleWhenLabel, downtimeOf
} from "./chronicle";
import { formatWorldDate, type CodexChronicleRecord, type CodexDowntimePayload, type CodexInWorldDate, type GmCodexCalendar, type PlayerCodexChronicleRecord } from "./api";
import { pickNextSession, type SessionRef } from "./sessions";
import type { CampaignDeadline, CampaignDowntime, CampaignEntry, CampaignSession } from "./CampaignHome";

type AnyChronicleRecord = CodexChronicleRecord | PlayerCodexChronicleRecord;

/**
 * D18 #5 — the downtime the GM has not confirmed yet, and the card that finally makes it visible.
 *
 * GM rows only, and by construction rather than by a role check: `applied` is on the GM payload and has
 * no field on the player's, so a player caller cannot produce this list at all.
 */
export function pendingDowntime(records: readonly CodexChronicleRecord[]): readonly CampaignDowntime[] {
  return records
    .map((record) => ({ record, payload: downtimeOf<CodexDowntimePayload>(record) }))
    .filter((row): row is { record: CodexChronicleRecord; payload: CodexDowntimePayload } => row.payload !== null && !row.payload.applied)
    .map(({ record, payload }) => ({
      id: record.id, who: payload.who, activity: payload.activity, days: payload.days,
      when: chronicleWhenLabel(record)
    }));
}

/**
 * Everything the dashboard reads off the chronicle, in one memoizable call. The shells differ only in
 * which chronicle they hand over — theirs — which is the whole of the role difference.
 */
export function campaignFeedProps(input: Readonly<{ records: readonly CodexChronicleRecord[]; calendar: GmCodexCalendar | null }>) {
  const entries: readonly CampaignEntry[] = [...input.records]
    .filter((record) => !DASHBOARD_CARDED_KINDS.has(record.kind))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((record) => ({ id: record.id, summary: chronicleRowSummary(record), when: chronicleWhenLabel(record), kind: record.kind, revealed: record.revealedToPlayers }));
  const deadlines: readonly CampaignDeadline[] = campaignDeadlines(input.records)
    .map((record) => ({ id: record.id, summary: chronicleRowSummary(record), when: chronicleWhenLabel(record), fired: record.fired, revealed: record.revealedToPlayers }));
  return {
    entries,
    deadlines,
    downtimePending: pendingDowntime(input.records),
    today: input.calendar?.currentDate ? formatWorldDate(input.calendar, input.calendar.currentDate) : null,
    nextSession: nextSessionCard
  };
}

/**
 * D18 #1 — the "Next session" card, and the fix for its lie.
 *
 * `pickNextSession` answers *which* session; this answers *what to call it*. The old card headed every
 * answer "Next session", so a campaign whose only sessions were played read "Next session — Session 4"
 * about a game already behind them. Three honest headings, chosen from the record itself.
 */
export function nextSessionCard<T extends SessionRef & { realDate: string | null; recapBody?: string; recap?: string; status?: "planned" | "played" }>(
  sessions: readonly T[], activeSessionId: string | null
): (CampaignSession & Readonly<{ heading: string }>) | null {
  const active = activeSessionId ? sessions.find((session) => session.id === activeSessionId) ?? null : null;
  // Pointed-at wins outright. Its heading depends on whether the GM has played it yet.
  const planned = sessions.filter((session) => session.status === "planned");
  const chosen = active
    ?? (planned.length > 0 ? planned.reduce((best, session) => ((session.sessionNumber ?? Infinity) < (best.sessionNumber ?? Infinity) ? session : best)) : null)
    ?? pickNextSession(sessions);
  if (!chosen) return null;
  const heading = chosen.status === "played"
    ? (active && chosen.id === active.id ? "This session" : "Last session")
    : "Next session";
  return {
    id: chosen.id, sessionNumber: chosen.sessionNumber, realDate: chosen.realDate,
    recap: chosen.recapBody ?? chosen.recap ?? "", heading
  };
}

/** Player-side equivalent of `campaignFeedProps`, over the player chronicle's narrower rows. */
export function playerCampaignFeedProps(input: Readonly<{ records: readonly PlayerCodexChronicleRecord[]; today: string | null }>) {
  const entries: readonly CampaignEntry[] = [...input.records]
    .filter((record) => !DASHBOARD_CARDED_KINDS.has(record.kind))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((record) => ({ id: record.id, summary: chronicleRowSummary(record), when: chronicleWhenLabel(record), kind: record.kind }));
  const deadlines: readonly CampaignDeadline[] = campaignDeadlines(input.records)
    .map((record) => ({ id: record.id, summary: chronicleRowSummary(record), when: chronicleWhenLabel(record), fired: record.fired }));
  return { entries, deadlines, today: input.today };
}

/** Records dated on one in-world day, for the Calendar's day panel. Uses the SERVER's instants only. */
export function recordsOnInstant<T extends { calendarInstant: number | null }>(records: readonly T[], instant: number): readonly T[] {
  return records.filter((record) => record.calendarInstant === instant);
}

/** A date's key in the month grid — year and month only, so a cell can bucket without arithmetic. */
export function sameMonth(a: CodexInWorldDate | null, year: number, month: number): boolean {
  return a !== null && a.year === year && a.month === month;
}

export type { AnyChronicleRecord };
