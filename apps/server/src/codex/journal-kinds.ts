import type {
  CodexDowntimePayload,
  CodexJournalKind,
  CodexJournalPayload,
  CodexMilestonePayload,
  CodexQuestEventPayload,
  CodexStandingPayload
} from "@vtt/domain";
import { CodexValidationError, coerceQuestStatus, isId, optionalId, shortLabel } from "./validate.js";

/**
 * The journal's record kinds and the structured payload each carries. A payload is read only for the kind
 * that owns it, through that kind's parser, so a stray blob can never surface on another kind's record.
 */

const JOURNAL_KINDS = new Set<string>(["note", "combat", "deadline", "downtime", "milestone", "standing", "quest"]);
/** Fails closed to `note` and never throws, so one bad row cannot make the Codex unopenable. */
export function journalKind(value: string): CodexJournalKind {
  return JOURNAL_KINDS.has(value) ? (value as CodexJournalKind) : "note";
}

/** 3650 days = ten default years: long enough for a decade in the tower, short enough to catch a typo. */
const MAX_DOWNTIME_DAYS = 3650;
/** 5e's level ceiling, the same as `clampLevel` in `packages/rules-5e`. */
const MAX_LEVEL = 20;

/** Blank `who`/`activity` allowed. `applied` always starts false: only `applyDowntime` sets it. */
export function downtimePayload(
  input: Readonly<{ who: string; activity: string; days: number; characterPageId?: string | null }>
): CodexDowntimePayload {
  const days = input?.days;
  if (!Number.isInteger(days) || days < 0 || days > MAX_DOWNTIME_DAYS)
    throw new CodexValidationError(`Downtime days must be a whole number from 0 to ${MAX_DOWNTIME_DAYS}.`);
  return {
    who: shortLabel(input.who, 120, "downtime participant") ?? "",
    activity: shortLabel(input.activity, 120, "downtime activity") ?? "",
    days,
    applied: false,
    characterPageId: optionalId(input.characterPageId)
  };
}
/** An out-of-range level is rejected and never clamped: it is a stated fact. */
export function milestonePayload(input: Readonly<{ level: number; reason: string }>): CodexMilestonePayload {
  const level = input?.level;
  if (!Number.isInteger(level) || level < 1 || level > MAX_LEVEL)
    throw new CodexValidationError(`A milestone's level must be a whole number from 1 to ${MAX_LEVEL}.`);
  return { level, reason: shortLabel(input.reason, 120, "milestone reason") ?? "" };
}
/** `delta` is the difference of two clamped values, so it needs no clamp. */
export function standingPayload(
  input: Readonly<{ factionPageId: string; delta: number; reason: string }>
): CodexStandingPayload {
  return {
    factionPageId: input.factionPageId,
    delta: Math.trunc(input.delta),
    reason: shortLabel(input.reason, 120, "standing reason") ?? ""
  };
}

/** A stored payload object, or null for anything else. */
function storedObject(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;

/** Exhaustive, no `default`: a new journal kind is a compile error here. */
export function payloadOf(kind: CodexJournalKind, raw: string | null): CodexJournalPayload | null {
  const value = storedObject(raw);
  if (value === null) return null;
  switch (kind) {
    case "downtime":
      return {
        who: text(value.who),
        activity: text(value.activity),
        days: Math.max(0, finite(value.days) ?? 0),
        // Only exactly `true` counts, so a malformed value can never suppress the clock move.
        applied: value.applied === true,
        characterPageId:
          typeof value.characterPageId === "string" && isId(value.characterPageId) ? value.characterPageId : null
      };
    case "milestone":
      // Clamped so a hand-edited row still renders as a plausible level.
      return { level: Math.min(MAX_LEVEL, Math.max(1, finite(value.level) ?? 1)), reason: text(value.reason) };
    case "standing":
      return { factionPageId: text(value.factionPageId), delta: finite(value.delta) ?? 0, reason: text(value.reason) };
    case "quest":
      return { questId: text(value.questId), status: coerceQuestStatus(value.status) };
    case "note":
    case "combat":
    case "deadline":
      return null;
  }
}

/** Narrow an entry's payload by kind, never by shape, so compatible fields cannot be misread. */
type PayloadBearing = Readonly<{ kind: CodexJournalKind; payload: CodexJournalPayload | null }>;
export function downtimePayloadOf(entry: PayloadBearing): CodexDowntimePayload | null {
  return entry.kind === "downtime" ? (entry.payload as CodexDowntimePayload | null) : null;
}
export function questEventPayloadOf(entry: PayloadBearing): CodexQuestEventPayload | null {
  return entry.kind === "quest" ? (entry.payload as CodexQuestEventPayload | null) : null;
}

/**
 * Whether a deadline has fired; the only place this comparison is written. Derived, never stored. `at` is passed
 * in because a player's `fired` must use the published date, or it would leak the GM's prep clock.
 */
export function deadlineFired(
  entry: Readonly<{ kind: CodexJournalKind; calendarInstant: number | null }>,
  at: number | null
): boolean {
  return entry.kind === "deadline" && entry.calendarInstant !== null && at !== null && entry.calendarInstant <= at;
}
