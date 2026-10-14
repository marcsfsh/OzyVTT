/** The dashboard's selection rules, shared by both audiences since `CampaignHome` is role-blind. */

import {
  DASHBOARD_CARDED_KINDS, campaignDeadlines, chronicleRowSummary, chronicleWhenLabel, downtimeOf
} from "./chronicle";
import { formatWorldDate, type CodexChronicleRecord, type CodexDowntimePayload, type CodexInWorldDate, type GmCodexCalendar, type PlayerCodexChronicleRecord } from "./api";
import { pickNextSession, type SessionRef } from "./sessions";
import type { CampaignDeadline, CampaignDowntime, CampaignEntry, CampaignSession } from "./CampaignHome";

type AnyChronicleRecord = CodexChronicleRecord | PlayerCodexChronicleRecord;

/** Downtime awaiting confirmation. GM-only by construction: `applied` isn't on the player payload. */
export function pendingDowntime(records: readonly CodexChronicleRecord[]): readonly CampaignDowntime[] {
  return records
    .map((record) => ({ record, payload: downtimeOf<CodexDowntimePayload>(record) }))
    .filter((row): row is { record: CodexChronicleRecord; payload: CodexDowntimePayload } => row.payload !== null && !row.payload.applied)
    .map(({ record, payload }) => ({
      id: record.id, who: payload.who, activity: payload.activity, days: payload.days,
      when: chronicleWhenLabel(record),
      // Rows naming a record state its reveal state.
      revealed: record.revealedToPlayers
    }));
}

/** Everything the dashboard reads off the chronicle. The shells differ only in which chronicle they pass. */
export function campaignFeedProps(input: Readonly<{ records: readonly CodexChronicleRecord[]; calendar: GmCodexCalendar | null }>) {
  const pending = pendingDowntime(input.records);
  // Pending downtime has its own card, so drop those ids from the feed. Excluded by id, not kind, because
  // `DASHBOARD_CARDED_KINDS` is shared with the player, who has no such card.
  const carded = new Set(pending.map((row) => row.id));
  const entries: readonly CampaignEntry[] = [...input.records]
    .filter((record) => !DASHBOARD_CARDED_KINDS.has(record.kind) && !carded.has(record.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((record) => ({ id: record.id, summary: chronicleRowSummary(record), when: chronicleWhenLabel(record), kind: record.kind, revealed: record.revealedToPlayers }));
  const deadlines: readonly CampaignDeadline[] = campaignDeadlines(input.records)
    .map((record) => ({ id: record.id, summary: chronicleRowSummary(record), when: chronicleWhenLabel(record), fired: record.fired, revealed: record.revealedToPlayers }));
  return {
    entries,
    deadlines,
    downtimePending: pending,
    today: input.calendar?.currentDate ? formatWorldDate(input.calendar, input.calendar.currentDate) : null,
    nextSession: nextSessionCard
  };
}

/** What to call the session card: "Next", "This" or "Last session", chosen from the record itself. */
export function nextSessionCard<T extends SessionRef & { realDate: string | null; recapBody?: string; recap?: string; status?: "planned" | "played"; revealedToPlayers?: boolean }>(
  sessions: readonly T[], activeSessionId: string | null
): (CampaignSession & Readonly<{ heading: string }>) | null {
  const active = activeSessionId ? sessions.find((session) => session.id === activeSessionId) ?? null : null;
  // The active pointer wins; its heading depends on whether it has been played.
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
    recap: chosen.recapBody ?? chosen.recap ?? "", heading,
    // The recap's reveal state, absent on the player projection.
    ...(chosen.revealedToPlayers === undefined ? {} : { revealed: chosen.revealedToPlayers })
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

/** Records on one in-world day. Uses the server's instants only. */
export function recordsOnInstant<T extends { calendarInstant: number | null }>(records: readonly T[], instant: number): readonly T[] {
  return records.filter((record) => record.calendarInstant === instant);
}

/** Year and month match, so a cell can bucket without arithmetic. */
export function sameMonth(a: CodexInWorldDate | null, year: number, month: number): boolean {
  return a !== null && a.year === year && a.month === month;
}

export type { AnyChronicleRecord };
