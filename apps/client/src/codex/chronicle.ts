/**
 * The chronicle's shared reading rules: what a row says and how the two lenses group. The GM and player
 * Journals are separate implementations, so the meaning of a row lives here once and both import it.
 */

import type { BadgeTone, MeterTone } from "@vtt/ui";
import {
  calendarDaysPerYear,
  calendarYearOf,
  clampToCalendar,
  dateToInstant,
  formatWorldYear,
  instantToDate,
  type CodexCalendar,
  type CodexChronicleKind,
  type CodexDowntimePayload,
  type CodexInWorldDate,
  type CodexJournalKind,
  type CodexJournalPayload,
  type CodexMilestonePayload,
  type CodexQuestStatus,
  type GmCodexCalendar,
  type PlayerCodexDowntimePayload,
  type PlayerCodexJournalPayload,
  type PlayerCodexQuestEventPayload,
  type PlayerCodexStandingPayload
} from "@vtt/domain";

/**
 * How a record says when it happened, in order of preference. Shared by both journals and the dashboard. The last
 * resort is the GM's `createdAt` for a GM row and `firstShownAt` for a player row, which carries no creation time.
 */
export type ChronicleWhen = Readonly<{
  inWorldLabel: string | null;
  sessionNumber: number | null;
  realDate: string | null;
}> &
  (Readonly<{ createdAt: string }> | Readonly<{ firstShownAt: string }>);
export function chronicleWhenLabel(record: ChronicleWhen): string {
  if (record.inWorldLabel) return record.inWorldLabel;
  if (record.sessionNumber !== null) return `Session ${record.sessionNumber}`;
  if (record.realDate) return record.realDate;
  return new Date("firstShownAt" in record ? record.firstShownAt : record.createdAt).toLocaleDateString();
}

/** The Journal filter's kinds, in reading order. Shared so both journals offer the same options. */
export const CHRONICLE_FILTER_KINDS: readonly CodexChronicleKind[] = [
  "entry",
  "combat",
  "event",
  "deadline",
  "downtime",
  "milestone",
  "standing",
  "quest"
];

/**
 * A kind reads by icon plus label, never colour alone. Every `iconId` must exist in `CODEX_ICONS`:
 * `iconChildren` silently falls back to `pin` for an unknown id.
 */
export const CHRONICLE_KIND_META: Readonly<
  Record<CodexChronicleKind, Readonly<{ iconId: string; label: string; tone: "neutral" | "caution" | "info" }>>
> = {
  entry: { iconId: "scroll", label: "Entry", tone: "neutral" },
  combat: { iconId: "battle", label: "Battle", tone: "caution" },
  event: { iconId: "hourglass", label: "Event", tone: "info" },
  deadline: { iconId: "danger", label: "Deadline", tone: "caution" },
  downtime: { iconId: "campfire", label: "Downtime", tone: "info" },
  milestone: { iconId: "star", label: "Milestone", tone: "info" },
  standing: { iconId: "banner", label: "Standing", tone: "info" },
  quest: { iconId: "quest", label: "Quest", tone: "info" }
};

/**
 * How a quest-history row reads, completing "<Quest title> ___". Player-facing copy. The verb states the
 * payload's status only; it never guesses the sequence (e.g. "reopened").
 */
export const QUEST_EVENT_VERB: Readonly<Record<CodexQuestStatus, string>> = {
  "not-started": "has not started",
  active: "started",
  completed: "completed",
  failed: "failed",
  canceled: "was canceled"
};
export function questEventLabel(payload: Readonly<{ status: CodexQuestStatus }>, questTitle: string | null): string {
  return `${questTitle?.trim() || "A quest"} ${QUEST_EVENT_VERB[payload.status]}`;
}
// ----- What a standing number means -----

/** Worst to best. `uninvested` sits at zero: the faction has taken no position yet. */
export type StandingTier = "hunted" | "hostile" | "unfriendly" | "uninvested" | "friendly" | "allied" | "exalted";

/** Standing reads as a word, never bar length or colour. */
export const STANDING_TIERS: ReadonlyArray<Readonly<{ id: StandingTier; label: string; min: number; max: number }>> = [
  { id: "hunted", label: "Hunted", min: -100, max: -75 },
  { id: "hostile", label: "Hostile", min: -74, max: -45 },
  { id: "unfriendly", label: "Unfriendly", min: -44, max: -15 },
  { id: "uninvested", label: "Uninvested", min: -14, max: 14 },
  { id: "friendly", label: "Friendly", min: 15, max: 44 },
  { id: "allied", label: "Allied", min: 45, max: 74 },
  { id: "exalted", label: "Exalted", min: 75, max: 100 }
];

/** Matches the server's clamp in `setStanding`. */
export const STANDING_MIN = -100;
export const STANDING_MAX = 100;

/** The stored value, bounded and integral. A non-finite value lands on 0 and stops there. */
export function clampStanding(value: number): number {
  const whole = Math.trunc(value);
  if (!Number.isFinite(whole)) return 0;
  return Math.max(STANDING_MIN, Math.min(STANDING_MAX, whole));
}

/** A descending ladder, so every value lands in exactly one tier. `standing.test.tsx` checks it agrees with `STANDING_TIERS`. */
export function standingTier(value: number): StandingTier {
  const bounded = clampStanding(value);
  if (bounded >= 75) return "exalted";
  if (bounded >= 45) return "allied";
  if (bounded >= 15) return "friendly";
  if (bounded >= -14) return "uninvested";
  if (bounded >= -44) return "unfriendly";
  if (bounded >= -74) return "hostile";
  return "hunted";
}

export function standingLabel(value: number): string {
  const tier = standingTier(value);
  return STANDING_TIERS.find((entry) => entry.id === tier)!.label;
}

/** Decorative only; `standingLabel` carries the meaning. */
export function standingTone(value: number): BadgeTone {
  switch (standingTier(value)) {
    case "hunted":
    case "hostile":
      return "danger";
    case "unfriendly":
      return "caution";
    case "uninvested":
      return "neutral";
    case "friendly":
      return "info";
    case "allied":
    case "exalted":
      return "success";
  }
}

/** Always signed (`+40`, `-15`, `0`), since a bare `40` beside a centred bar is ambiguous. */
export function standingValueLabel(value: number): string {
  const bounded = clampStanding(value);
  return bounded > 0 ? `+${bounded}` : String(bounded);
}

/**
 * `Meter` is shared with token health and only renders 0..max, so the signed scale is shifted here:
 * -100 -> 0, 0 -> 100, +100 -> 200. Never pass `Meter`'s `label`, which would show these shifted numbers.
 */
export const STANDING_METER_MAX = STANDING_MAX - STANDING_MIN;
export function standingMeterValue(value: number): number {
  return clampStanding(value) - STANDING_MIN;
}
/** Decorative, like `standingTone`. */
export function standingMeterTone(value: number): MeterTone {
  const tier = standingTier(value);
  return tier === "uninvested"
    ? "violet"
    : tier === "friendly" || tier === "allied" || tier === "exalted"
      ? "cyan"
      : "magenta";
}

// ----- Reading a record's payload, gated by its kind -----

/**
 * The only sanctioned way to open a chronicle payload. The `in` check narrows the union and also guards
 * against a row whose kind and payload disagree. The GM's downtime carries `applied` and the player's does not.
 */
export type ChroniclePayloadRef<P> = Readonly<{ kind: CodexChronicleKind; payload: P | null }>;
type AnyPayloadRef = ChroniclePayloadRef<CodexJournalPayload | PlayerCodexJournalPayload>;

export function downtimeOf(record: ChroniclePayloadRef<CodexJournalPayload>): CodexDowntimePayload | null;
export function downtimeOf(record: AnyPayloadRef): PlayerCodexDowntimePayload | null;
export function downtimeOf(record: AnyPayloadRef): PlayerCodexDowntimePayload | null {
  const payload = record.payload;
  return record.kind === "downtime" && payload !== null && "days" in payload ? payload : null;
}
export function milestoneOf(record: AnyPayloadRef): CodexMilestonePayload | null {
  const payload = record.payload;
  return record.kind === "milestone" && payload !== null && "level" in payload ? payload : null;
}
/** Returns the wide shape with a nullable `factionPageId`, since a player's copy nulls an unrevealed faction. */
export function standingOf(record: AnyPayloadRef): PlayerCodexStandingPayload | null {
  const payload = record.payload;
  return record.kind === "standing" && payload !== null && "delta" in payload ? payload : null;
}
/** The wide shape with a nullable `questId`, since a player's copy nulls an unrevealed quest. */
export function questEventOf(record: AnyPayloadRef): PlayerCodexQuestEventPayload | null {
  const payload = record.payload;
  return record.kind === "quest" && payload !== null && "questId" in payload ? payload : null;
}

export function milestoneSummaryLabel(payload: CodexMilestonePayload): string {
  const reached = `Reached level ${payload.level}`;
  const why = payload.reason.trim();
  return why ? `${reached} · ${why}` : reached;
}

/** The caller supplies the faction name, or null if it cannot resolve the page. */
export function standingChangeLabel(payload: PlayerCodexStandingPayload, factionName: string | null): string {
  const delta = Math.trunc(payload.delta);
  const moved = delta === 0 ? "unchanged" : `${delta > 0 ? "up" : "down"} ${Math.abs(delta)}`;
  const who = factionName?.trim() || "A faction";
  const why = payload.reason.trim();
  return why ? `${who} · ${moved} · ${why}` : `${who} · ${moved}`;
}

// ----- Deadlines -----

/** Satisfied by both chronicle projections. */
export type DeadlineRef = Readonly<{ kind: CodexChronicleKind; fired?: boolean | null }>;

/** `fired` is derived by the server against the campaign clock; never recompute it client-side. */
export function deadlineFired(record: DeadlineRef): boolean {
  return record.kind === "deadline" && record.fired === true;
}

export const DEADLINE_STATE_LABEL: Readonly<Record<"fired" | "pending", string>> = {
  fired: "Passed",
  pending: "Approaching"
};
export function deadlineStateLabel(fired: boolean): string {
  return fired ? DEADLINE_STATE_LABEL.fired : DEADLINE_STATE_LABEL.pending;
}
/** Decorative only; `deadlineStateLabel` carries the meaning. */
export function deadlineStateTone(fired: boolean): BadgeTone {
  return fired ? "danger" : "caution";
}

/**
 * Passed first, then approaching, each in server order. Passed deadlines are kept: the clock finishes a
 * deadline without anyone acting, so this card is the GM's notice that it happened.
 */
export function campaignDeadlines<T extends DeadlineRef>(records: readonly T[]): readonly T[] {
  const deadlines = records.filter((record) => record.kind === "deadline");
  return [
    ...deadlines.filter((record) => deadlineFired(record)),
    ...deadlines.filter((record) => !deadlineFired(record))
  ];
}

// ----- Dates the GM is about to move to -----

/** Where applying downtime would move the clock: now plus its days. Null with no current date. */
export function downtimeProposedDate(calendar: CodexCalendar | null, days: number): CodexInWorldDate | null {
  const now = calendar?.currentDate;
  if (!calendar || !now || calendar.months.length === 0 || calendarDaysPerYear(calendar) === 0) return null;
  const advance = Math.max(0, Math.trunc(days));
  return instantToDate(calendar, dateToInstant(calendar, clampToCalendar(calendar, now)) + advance);
}

/** How many not-yet-passed deadlines a clock move to `target` would pass, so the GM is warned before confirming. */
export type DatedDeadlineRef = DeadlineRef & Readonly<{ calendarInstant: number | null }>;
export function deadlinesPassedBy(
  records: readonly DatedDeadlineRef[],
  calendar: CodexCalendar | null,
  target: CodexInWorldDate | null
): number {
  if (!calendar || !target) return 0;
  // `target` is already a valid calendar date (built by `instantToDate`), so no clamping is needed.
  const targetInstant = dateToInstant(calendar, target);
  return records.filter(
    (record) =>
      record.kind === "deadline" &&
      !deadlineFired(record) &&
      record.calendarInstant !== null &&
      record.calendarInstant <= targetInstant
  ).length;
}

/** The journal's `note` is the chronicle's `entry`; every other kind has the same name. */
const JOURNAL_TO_CHRONICLE_KIND: Readonly<Record<CodexJournalKind, CodexChronicleKind>> = {
  note: "entry",
  combat: "combat",
  deadline: "deadline",
  downtime: "downtime",
  milestone: "milestone",
  standing: "standing",
  quest: "quest"
};
export function chronicleKindOfJournal(kind: CodexJournalKind): CodexChronicleKind {
  return JOURNAL_TO_CHRONICLE_KIND[kind];
}

/**
 * Would revealing this record show players a date past their published clock? Records are dated at the
 * GM's prep clock, so this warns at reveal time. Silent for undated records and when nothing has been
 * published yet. Strictly after: a record at the published date is the party's present.
 */
export function revealAheadOfPlayers(
  record: Readonly<{ calendarInstant: number | null }>,
  calendar: GmCodexCalendar | null
): boolean {
  // Falsy checks: a caller with a narrower calendar shape passes `undefined`, which `=== null` misses.
  const published = calendar?.publishedDate;
  if (!calendar || !published || typeof record.calendarInstant !== "number") return false;
  // Snap the published date like the server does before comparing.
  return record.calendarInstant > dateToInstant(calendar, clampToCalendar(calendar, published));
}

/** One row's text on a summary surface. Standing, milestone and quest records carry their meaning in the payload, beyond the prose. */
export function chronicleRowSummary(
  record: AnyPayloadRef & Readonly<{ text: string; gmText?: string | null }>
): string {
  // A quest-history record has no prose; the caller resolves the quest title where it can.
  const questEvent = questEventOf(record);
  if (questEvent) return questEventLabel(questEvent, null);
  const standing = standingOf(record);
  if (standing) return standingChangeLabel(standing, null);
  const milestone = milestoneOf(record);
  if (milestone) return milestoneSummaryLabel(milestone);
  const downtime = downtimeOf(record);
  if (downtime) return record.text.trim() || (record.gmText ?? "").trim() || downtimeSummaryLabel(downtime);
  return record.text.trim() || (record.gmText ?? "").trim();
}

/** Who, what and how long. Blank halves are dropped. */
export function downtimeSummaryLabel(payload: PlayerCodexDowntimePayload): string {
  const span = `${payload.days} ${payload.days === 1 ? "day" : "days"}`;
  const said = [payload.who.trim(), payload.activity.trim()].filter(Boolean).join(" · ");
  return said ? `${said} · ${span}` : span;
}

/** Do the GM's clock and the players' clock agree? Nothing to publish, and nothing to say, when they do. */
export function sameInWorldDate(
  a: CodexInWorldDate | null | undefined,
  b: CodexInWorldDate | null | undefined
): boolean {
  if (!a || !b) return !a && !b;
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/** Both lenses regroup the same loaded records, never refetching. */
export type ChronicleLens = "date" | "session";
export const CHRONICLE_LENSES: ReadonlyArray<Readonly<{ id: ChronicleLens; label: string }>> = [
  { id: "date", label: "By in-world date" },
  { id: "session", label: "By session" }
];

export type ChronicleGroup<R> = Readonly<{ key: string; label: string; records: readonly R[] }>;
type Groupable = Readonly<{ sessionNumber: number | null; calendarInstant: number | null }>;

/**
 * Both lenses read earliest first, with keyless records last. Within a group the server's order is kept.
 * By session, an `event` page always lands in "No session yet". Both journals group this way.
 */
export function groupChronicle<R extends Groupable>(
  records: readonly R[],
  lens: ChronicleLens,
  calendar: CodexCalendar | null
): ChronicleGroup<R>[] {
  const buckets = new Map<number | null, R[]>();
  for (const record of records) {
    const key =
      lens === "session"
        ? record.sessionNumber
        : record.calendarInstant !== null && calendar
          ? calendarYearOf(calendar, record.calendarInstant)
          : null;
    const bucket = buckets.get(key) ?? [];
    bucket.push(record);
    buckets.set(key, bucket);
  }
  return [...buckets.keys()]
    .sort((a, b) => (a === null ? 1 : b === null ? -1 : a - b))
    .map((key) => ({
      key: key === null ? "none" : String(key),
      label:
        key === null
          ? lens === "session"
            ? "No session yet"
            : "Undated"
          : lens === "session"
            ? `Session ${key}`
            : calendar
              ? formatWorldYear(calendar, key)
              : String(key),
      records: buckets.get(key)!
    }));
}
