/** Home's selection rules: which session the GM's card names, and the clocks a player's Home lists. */

import type { CodexChronicleRecord, PlayerCodexChronicleRecord } from "@vtt/domain";
import { campaignDeadlines, chronicleRowSummary, chronicleWhenLabel } from "../chronicle";
import { pickNextSession, type SessionRef } from "../sessions";

export type HomeSession = Readonly<{
  id: string;
  sessionNumber: number | null;
  realDate: string | null;
  /** "Next session", "This session" or "Last session", chosen from the record itself. */
  heading: string;
}>;

/** The session the GM's Home names. The active pointer wins, then the lowest-numbered planned session. */
export function nextSessionCard<
  T extends SessionRef & Readonly<{ realDate: string | null; status?: "planned" | "played" }>
>(sessions: readonly T[], activeSessionId: string | null): HomeSession | null {
  const active = activeSessionId ? (sessions.find((session) => session.id === activeSessionId) ?? null) : null;
  const planned = sessions.filter((session) => session.status === "planned");
  const chosen =
    active ??
    (planned.length > 0
      ? planned.reduce((best, session) =>
          (session.sessionNumber ?? Infinity) < (best.sessionNumber ?? Infinity) ? session : best
        )
      : null) ??
    pickNextSession(sessions);
  if (!chosen) return null;
  const heading =
    chosen.status === "played" ? (active && chosen.id === active.id ? "This session" : "Last session") : "Next session";
  return { id: chosen.id, sessionNumber: chosen.sessionNumber, realDate: chosen.realDate, heading };
}

export type HomeClock = Readonly<{ id: string; summary: string; when: string; fired: boolean }>;

/** The deadlines in a chronicle, passed first and then those still coming, each in one line. */
export function clocksOf(records: readonly (CodexChronicleRecord | PlayerCodexChronicleRecord)[]): HomeClock[] {
  return campaignDeadlines(records).map((record) => ({
    id: record.id,
    summary: chronicleRowSummary(record),
    when: chronicleWhenLabel(record),
    fired: record.fired
  }));
}

/** A session's real date as the GM wrote it, or "Saturday, October 24" when it is a calendar day. */
export function realDateLabel(realDate: string | null): string | null {
  if (!realDate?.trim()) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(realDate.trim())) return realDate.trim();
  const day = new Date(`${realDate.trim()}T00:00:00`);
  return Number.isNaN(day.getTime())
    ? realDate.trim()
    : day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}
