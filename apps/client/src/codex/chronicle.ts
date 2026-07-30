/**
 * The chronicle's shared reading rules (CT-11 / CT-12, and M11's CT-5 / CT-10) — what a row SAYS and how
 * the two lenses group.
 *
 * Pure functions, no JSX, on purpose. The GM Journal and the player Journal are deliberately separate
 * implementations (D-2), and the accepted consequence is drift; what must not drift is the *meaning* of
 * a row — when it happened and what kind of record it is. So the meaning lives here once and both
 * readers import it, while each keeps its own markup.
 */

import type { BadgeTone, MeterTone } from "@vtt/ui";
import { calendarDaysPerYear, calendarYearOf, dateToInstant, formatWorldYear, instantToDate, type CodexCalendar, type CodexChronicleKind, type CodexChronicleRecord, type CodexDowntimeSummary, type CodexInWorldDate, type CodexJournalPayload, type CodexMilestonePayload, type CodexPlayerChroniclePayload, type CodexStandingChange } from "./api";

/**
 * How a record says *when* it happened, in the chronicle's own order of preference.
 *
 * Structurally typed rather than tied to one record type: a GM chronicle row, a player chronicle row and
 * a raw journal entry all answer this question the same way, and the Campaign dashboard asks it too. Two
 * implementations is exactly how a dashboard ends up disagreeing with the timeline it links into.
 */
export type ChronicleWhen = Readonly<{ inWorldLabel: string | null; sessionNumber: number | null; realDate: string | null; createdAt: string }>;
export function chronicleWhenLabel(record: ChronicleWhen): string {
  if (record.inWorldLabel) return record.inWorldLabel;
  if (record.sessionNumber !== null) return `Session ${record.sessionNumber}`;
  if (record.realDate) return record.realDate;
  return new Date(record.createdAt).toLocaleDateString();
}

/**
 * R2: a record's kind reads by **icon plus label**, never by colour alone. The glyphs are the ones the
 * entity vocabulary already uses — `scroll` is a note, `hourglass` is an `event` page (`ENTITY_DEFS`), so
 * an event row on the chronicle looks like the same record it is in the tree, the graph and search.
 *
 * M11's two: `danger` for a deadline — the warning triangle the atlas already uses for a threat, which is
 * exactly what a deadline is (a thing that will happen whether or not the party acts) — and `campfire`
 * for downtime, the between-adventures image, deliberately NOT the `camp` tent, because a tent triangle
 * beside the deadline's warning triangle would be two triangles telling two different stories.
 *
 * Every `iconId` here must exist in `CODEX_ICONS` (`icons.tsx`). `iconChildren` falls back to `pin` for
 * an unknown id, so a typo would not throw — it would silently render the wrong glyph on every row of
 * that kind. `deadlines.test.tsx` and `standing.test.tsx` assert each one resolves.
 */
export const CHRONICLE_KIND_META: Readonly<Record<CodexChronicleKind, Readonly<{ iconId: string; label: string; tone: "neutral" | "caution" | "info" }>>> = {
  entry: { iconId: "scroll", label: "Entry", tone: "neutral" },
  combat: { iconId: "battle", label: "Battle", tone: "caution" },
  event: { iconId: "hourglass", label: "Event", tone: "info" },
  // `caution`, as the contract fixes it: a deadline is the one row on the chronicle that is a warning.
  deadline: { iconId: "danger", label: "Deadline", tone: "caution" },
  // `info`, not `neutral`. `neutral` is the ordinary entry's tone, so a neutral downtime badge would be
  // indistinguishable from a note's at a glance and the tone would buy nothing; `info` groups it with the
  // other "a dated thing happened" row (`event`), which is what downtime is. R2 is satisfied either way —
  // the WORD carries the meaning and the tone is only a scanning aid.
  downtime: { iconId: "campfire", label: "Downtime", tone: "info" },
  /**
   * M12's two. `star` for a milestone: the registry's own achievement glyph, and the one marker icon
   * that already reads as "this mattered" without belonging to any entity type — so it cannot be
   * confused with the tree's vocabulary the way a second `scroll` or `person` would be.
   *
   * `banner` for standing, and deliberately the FACTION glyph (`ENTITY_DEFS.faction.icon`), on exactly
   * the reasoning that made `hourglass` the event row: a standing record is a record ABOUT a faction, so
   * it should look like the faction it concerns in the tree, the graph and search. Neither is `pin` —
   * which is what `iconChildren` silently falls back to for an unknown id, and is why
   * `standing.test.tsx` asserts both of these resolve in `CODEX_ICONS`.
   */
  milestone: { iconId: "star", label: "Milestone", tone: "info" },
  standing: { iconId: "banner", label: "Standing", tone: "info" }
};

// ----- M12 / CT-6: what a standing NUMBER means -----

/**
 * The seven tiers, worst to best. **Owner-specified**, and the middle five verbatim: a faction can be
 * actively against the party, which is why the scale is signed at all (M12-B). `Hunted` is below
 * Hostile — the faction is not merely against the party, it is coming for them — and `Exalted` is above
 * Allied — the party are honoured within the faction, not merely useful to it.
 *
 * `Uninvested`, not "Neutral": a faction that has taken no position is not the same as one that has
 * weighed the party and landed in the middle, and it sits at the centre of the scale so the zero state
 * is genuinely "no opinion yet".
 */
export type StandingTier = "hunted" | "hostile" | "unfriendly" | "uninvested" | "friendly" | "allied" | "exalted";

/**
 * R2: standing reads as a **WORD**, never as bar length or colour. One table, imported by every surface
 * that renders standing, for the same reason `chronicleWhenLabel` is one function — two implementations
 * of one reading rule is how a dashboard ends up disagreeing with the record it is showing.
 */
export const STANDING_TIERS: ReadonlyArray<Readonly<{ id: StandingTier; label: string; min: number; max: number }>> = [
  { id: "hunted", label: "Hunted", min: -100, max: -75 },
  { id: "hostile", label: "Hostile", min: -74, max: -45 },
  { id: "unfriendly", label: "Unfriendly", min: -44, max: -15 },
  { id: "uninvested", label: "Uninvested", min: -14, max: 14 },
  { id: "friendly", label: "Friendly", min: 15, max: 44 },
  { id: "allied", label: "Allied", min: 45, max: 74 },
  { id: "exalted", label: "Exalted", min: 75, max: 100 }
];

/**
 * M12-B: the scale is signed, −100…+100. The server clamps to the same pair (`setStanding`); the bounds
 * are restated here so a control can refuse an out-of-range value rather than hand the GM a generic 400
 * for something the field could have prevented.
 */
export const STANDING_MIN = -100;
export const STANDING_MAX = 100;

/** The stored value, bounded and integral. A non-finite value lands on 0 rather than propagating. */
export function clampStanding(value: number): number {
  const whole = Math.trunc(value);
  if (!Number.isFinite(whole)) return 0;
  return Math.max(STANDING_MIN, Math.min(STANDING_MAX, whole));
}

/**
 * Which tier a value reads as. Written as a descending ladder rather than a table lookup so the bands are
 * **exhaustive by construction** — there is no value that falls through, and no pair of bands that can
 * drift into overlapping when one edge is edited. `STANDING_TIERS` above states the same ranges for
 * display; `standing.test.tsx` walks every integer in −100…100 and asserts the two agree.
 */
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

/**
 * Decorative only; `standingLabel` is what carries the meaning (design-language R2). Two pairs share a
 * tone — Hunted with Hostile, Allied with Exalted — and that is fine precisely because the tone is a
 * scanning aid: `BadgeTone` has six values and the ladder has seven, so making them one-to-one would
 * mean inventing a distinction the palette does not own to carry information the word already carries.
 */
export function standingTone(value: number): BadgeTone {
  switch (standingTier(value)) {
    case "hunted": case "hostile": return "danger";
    case "unfriendly": return "caution";
    case "uninvested": return "neutral";
    case "friendly": return "info";
    case "allied": case "exalted": return "success";
  }
}

/**
 * The signed number itself, said out loud: `+40`, `-15`, `0`. The sign is the whole point of a signed
 * scale, so a bare `40` beside a bar that starts in the middle would be the one readout that could be
 * read as "40 in your favour" when it might be the opposite.
 */
export function standingValueLabel(value: number): string {
  const bounded = clampStanding(value);
  return bounded > 0 ? `+${bounded}` : String(bounded);
}

/**
 * F-6, the whole of it: **`Meter` clamps `value/max` to 0…1 and cannot render a negative**, and it is
 * shared with token health — so it is not changed to suit this one call site (R9, prohibition 5). The
 * signed scale is mapped onto its unsigned range HERE, in the call site's own reading rule:
 *
 *   −100 → 0 · 0 → 100 (half the track) · +100 → 200
 *
 * `Meter`'s optional `label` is deliberately never passed by a standing call site: it renders
 * `value/max` as text, which on this mapping would read "140/200" — a pair of numbers that exist only
 * inside this transform and mean nothing to a GM. The signed value and the tier word are rendered beside
 * the bar instead (`standingValueLabel`, `standingLabel`).
 */
export const STANDING_METER_MAX = STANDING_MAX - STANDING_MIN;
export function standingMeterValue(value: number): number { return clampStanding(value) - STANDING_MIN; }
/** The bar's fill colour. Decorative, exactly like `standingTone`; the word is what says where you stand. */
export function standingMeterTone(value: number): MeterTone {
  const tier = standingTier(value);
  return tier === "uninvested" ? "violet" : tier === "friendly" || tier === "allied" || tier === "exalted" ? "cyan" : "magenta";
}

// ----- M12: reading a record's PAYLOAD, gated by its kind -----

/**
 * The kind gate, applied once. A chronicle record's `payload` is a union discriminated by `kind`, and
 * these three are the only sanctioned way to open it — so a surface that wants a milestone's level has
 * to say which kind it is asking about, and cannot render a standing record's `delta` as a level.
 *
 * The `in` check beside each kind test is what narrows the union for TypeScript; it is also a runtime
 * belt-and-braces against a row whose kind and payload disagree, which would otherwise render as a
 * `NaN` or an `undefined` in the middle of a sentence.
 *
 * `downtimeOf` is generic over its payload because the two projections carry two different downtime
 * shapes — the GM's has `applied`, the player's does not — and a helper that demanded the GM's would be
 * one the player's timeline could not use.
 */
export type ChroniclePayloadRef<P> = Readonly<{ kind: CodexChronicleKind; payload: P | null }>;

export function downtimeOf<P extends CodexDowntimeSummary>(record: ChroniclePayloadRef<P | CodexMilestonePayload | CodexStandingChange>): P | null {
  const payload = record.payload;
  return record.kind === "downtime" && payload !== null && "days" in payload ? payload : null;
}
export function milestoneOf(record: ChroniclePayloadRef<CodexJournalPayload | CodexPlayerChroniclePayload>): CodexMilestonePayload | null {
  const payload = record.payload;
  return record.kind === "milestone" && payload !== null && "level" in payload ? payload : null;
}
/**
 * Returns the WIDE shape (`CodexStandingChange`), whose `factionPageId` is nullable, because a player's
 * copy of the record carries null when the faction's own page is unrevealed. A GM surface never receives
 * null — but typing this as the GM's shape would let a player surface compile against an id that is not
 * there, and the failure would be a link to a page the party cannot open.
 */
export function standingOf(record: ChroniclePayloadRef<CodexJournalPayload | CodexPlayerChroniclePayload>): CodexStandingChange | null {
  const payload = record.payload;
  return record.kind === "standing" && payload !== null && "delta" in payload ? payload : null;
}

/**
 * What a milestone record SAYS it was, in one line. CT-8 is level history and explicitly **no XP
 * arithmetic**, so this says the level and the reason and nothing else — there is no total to show and
 * no "N to go" to compute.
 */
export function milestoneSummaryLabel(payload: CodexMilestonePayload): string {
  const reached = `Reached level ${payload.level}`;
  const why = payload.reason.trim();
  return why ? `${reached} — ${why}` : reached;
}

/**
 * What a standing record SAYS it was: which way it moved, by how much, and why. The faction's NAME is
 * deliberately not resolved here — a payload carries a page id and this module has no page list, so the
 * caller supplies whatever name it can honestly produce (and a caller that cannot resolve the id must
 * not invent one).
 */
export function standingChangeLabel(payload: CodexStandingChange, factionName: string | null): string {
  const delta = Math.trunc(payload.delta);
  const moved = delta === 0 ? "unchanged" : `${delta > 0 ? "up" : "down"} ${Math.abs(delta)}`;
  const who = factionName?.trim() || "A faction";
  const why = payload.reason.trim();
  return why ? `${who} — ${moved} · ${why}` : `${who} — ${moved}`;
}

// ----- M11 / CT-5: what a deadline SAYS -----

/** The minimum needed to say whether a deadline has fired. Satisfied by BOTH chronicle projections. */
export type DeadlineRef = Readonly<{ kind: CodexChronicleKind; fired?: boolean | null }>;

/**
 * Has this deadline passed? **One reader, on purpose** — two copies of this question is how a dashboard
 * card ends up disagreeing with the timeline it links into.
 *
 * `fired` is derived by the SERVER against the campaign clock and is never stored (a stored flag would be
 * a second cache the calendar's reflow had to maintain). This client never recomputes it: a client-side
 * comparison would be a second authority on "has the campaign passed this", and it would be the one that
 * was wrong. All this adds is the kind gate — `fired` means nothing on a note — and a falsy-safe read, so
 * a row that arrives without the key reads as "not fired" rather than as `undefined`.
 */
export function deadlineFired(record: DeadlineRef): boolean {
  return record.kind === "deadline" && record.fired === true;
}

/** R2: the state reads as a WORD. The badge tone below is a scanning aid only. */
export const DEADLINE_STATE_LABEL: Readonly<Record<"fired" | "pending", string>> = { fired: "Passed", pending: "Approaching" };
export function deadlineStateLabel(fired: boolean): string { return fired ? DEADLINE_STATE_LABEL.fired : DEADLINE_STATE_LABEL.pending; }
/** Decorative only; `deadlineStateLabel` is what carries the meaning (design-language R2). */
export function deadlineStateTone(fired: boolean): BadgeTone { return fired ? "danger" : "caution"; }

/**
 * The deadlines for the Campaign dashboard's card, in the order it should read them.
 *
 * **Passed first, then approaching**, each half keeping the order it arrived in — which is the server's
 * one canonical chronology, never re-sorted here (`groupChronicle` below holds the same line).
 *
 * The passed ones are NOT dropped, and that is where this deliberately parts company with `openQuests`.
 * A completed quest is one the GM marked done, so a card headed "Open quests" must stop offering it. A
 * deadline is finished by the *clock*, with nobody deciding anything — this card is the only notice the
 * GM gets that something happened whether or not the party acted, so dropping it the moment it mattered
 * most would be exactly backwards.
 */
export function campaignDeadlines<T extends DeadlineRef>(records: readonly T[]): readonly T[] {
  const deadlines = records.filter((record) => record.kind === "deadline");
  return [...deadlines.filter((record) => deadlineFired(record)), ...deadlines.filter((record) => !deadlineFired(record))];
}

// ----- M11 / CT-10 + O-1: dates the GM is about to move to -----

/**
 * A raw date snapped the way the SERVER snaps it before turning it into an instant
 * (`calendarInstantOf`): the month index clamped into the calendar, then the day clamped into that
 * month. The client's own `dateToInstant` clamps the day only at the bottom (`>= 1`), so a stored
 * "day 31 of a 30-day month" — the one lossy date the calendar admits — would otherwise place a day
 * later here than it does on the server, and the confirm below would promise a date the clock will not
 * actually land on.
 */
function clampToCalendar(calendar: CodexCalendar, date: CodexInWorldDate): CodexInWorldDate {
  const month = Math.max(0, Math.min(Math.trunc(date.month), calendar.months.length - 1));
  const days = calendar.months[month]?.days ?? 1;
  return { year: Math.trunc(date.year), month, day: Math.min(Math.max(1, Math.trunc(date.day)), days) };
}

/**
 * O-3: the date applying this downtime would move the campaign clock to — "now, plus its days".
 *
 * No new date maths: this is `instantToDate(dateToInstant(now) + days)`, the same pair of helpers the
 * timeline's Today marker and its year grouping already run on, which are themselves the mirror of the
 * server's `calendarInstantOf` / `dateForInstant`. Walking months is their job, so a downtime that runs
 * off the end of a month rolls into the next one and off the end of a year rolls the year.
 *
 * `null` when there is nothing to advance FROM (no campaign date set) or nothing to advance BY.
 */
export function downtimeProposedDate(calendar: CodexCalendar | null, days: number): CodexInWorldDate | null {
  const now = calendar?.currentDate;
  if (!calendar || !now || calendar.months.length === 0 || calendarDaysPerYear(calendar) === 0) return null;
  const advance = Math.max(0, Math.trunc(days));
  return instantToDate(calendar, dateToInstant(calendar, clampToCalendar(calendar, now)) + advance);
}

/**
 * What a downtime record SAYS it was, in one line — who, what, and how long.
 *
 * Structurally typed on the payload alone so BOTH projections satisfy it: the GM's carries `applied` as
 * well, and this deliberately does not read it. Whether the GM has confirmed the clock move is workflow
 * state, not part of what happened, so it is said separately on the GM's row and never here — which is
 * also what lets the player's chronicle render this exact line from a payload that has no such field.
 *
 * Blank halves are dropped rather than rendered as stray punctuation: `who` and `activity` are free text
 * and the composer requires only one of them, so "— forging a blade · 7 days" must not be a thing a row
 * can say.
 */
/**
 * What ONE chronicle row says on a summary surface — the dashboard's activity feed and its Deadlines card.
 *
 * A record's prose is the right answer for most kinds, but `standing` and `milestone` carry their meaning in
 * the PAYLOAD: `setStanding` writes an empty player text on purpose, so five end-of-session standing
 * adjustments turned the dashboard's feed into five identical rows reading "Untitled entry · Standing",
 * pushing every real entry out of a list sliced to 5. The Journal rendered those same records correctly the
 * whole time, from these same helpers — the dashboard simply never called them. Found by the final QA pass.
 *
 * Lives here beside the other reading rules so the dashboard and the timeline cannot describe one record two
 * different ways, which is the pathology this overhaul exists to remove.
 */
export function chronicleRowSummary(record: ChroniclePayloadRef<CodexJournalPayload | CodexPlayerChroniclePayload> & Readonly<{ text: string; gmText?: string | null }>): string {
  const standing = standingOf(record);
  if (standing) return standingChangeLabel(standing, null);
  const milestone = milestoneOf(record);
  if (milestone) return milestoneSummaryLabel(milestone);
  const downtime = downtimeOf(record);
  if (downtime) return record.text.trim() || (record.gmText ?? "").trim() || downtimeSummaryLabel(downtime);
  return record.text.trim() || (record.gmText ?? "").trim();
}

export function downtimeSummaryLabel(payload: CodexDowntimeSummary): string {
  const span = `${payload.days} ${payload.days === 1 ? "day" : "days"}`;
  const said = [payload.who.trim(), payload.activity.trim()].filter(Boolean).join(" — ");
  return said ? `${said} · ${span}` : span;
}

/** Do the GM's clock and the players' clock agree? Nothing to publish, and nothing to say, when they do. */
export function sameInWorldDate(a: CodexInWorldDate | null | undefined, b: CodexInWorldDate | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.year === b.year && a.month === b.month && a.day === b.day;
}

/**
 * CT-12's two lenses. **Same records, two orderings** — the toggle regroups what is already loaded and
 * never refetches, so the lenses cannot disagree about what exists, and switching cannot mutate anything.
 */
export type ChronicleLens = "date" | "session";
export const CHRONICLE_LENSES: ReadonlyArray<Readonly<{ id: ChronicleLens; label: string }>> = [
  { id: "date", label: "By in-world date" },
  { id: "session", label: "By session" }
];

export type ChronicleGroup = Readonly<{ key: string; label: string; records: readonly CodexChronicleRecord[] }>;

/**
 * Group the chronicle for one lens.
 *
 * Both lenses read ascending — earliest first — because that is how the timeline has always read and two
 * lenses running in opposite directions would make the toggle feel like a different screen rather than a
 * different question. Records with no key sort last in both ("Undated" / "No session yet").
 *
 * `records` is expected in the server's chronological order and is never re-sorted here beyond the group
 * key: within a group, order is the order the server sent, which is the one canonical chronology.
 *
 * By session, an `event` page always lands in "No session yet": sessions become real records in M9, and
 * inventing a session for a dated wiki page would be guessing.
 */
export function groupChronicle(records: readonly CodexChronicleRecord[], lens: ChronicleLens, calendar: CodexCalendar | null): ChronicleGroup[] {
  const buckets = new Map<number | null, CodexChronicleRecord[]>();
  for (const record of records) {
    const key = lens === "session"
      ? record.sessionNumber
      : (record.calendarInstant !== null && calendar ? calendarYearOf(calendar, record.calendarInstant) : null);
    const bucket = buckets.get(key) ?? [];
    bucket.push(record);
    buckets.set(key, bucket);
  }
  return [...buckets.keys()]
    .sort((a, b) => (a === null ? 1 : b === null ? -1 : a - b))
    .map((key) => ({
      key: key === null ? "none" : String(key),
      label: key === null
        ? (lens === "session" ? "No session yet" : "Undated")
        : (lens === "session" ? `Session ${key}` : (calendar ? formatWorldYear(calendar, key) : String(key))),
      records: buckets.get(key)!
    }));
}
