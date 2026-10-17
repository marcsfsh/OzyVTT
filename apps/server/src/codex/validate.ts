import {
  CODEX_SECRET_FIELD_KEYS,
  isCodexEntityType,
  type CodexEntityType,
  type CodexMapKind,
  type CodexQuestObjective,
  type CodexQuestStatus,
  type CodexSessionStatus
} from "@vtt/domain";

/**
 * Every Codex input check. The router's Zod schemas reject malformed requests; these run again inside the store
 * so a backup import and any non-HTTP writer meet the same rules.
 */

/** Thrown when an update's `expectedRev` does not match the stored row: the caller's copy is stale. */
export class CodexRevisionConflictError extends Error {}
/** Thrown when a referenced record does not exist. */
export class CodexNotFoundError extends Error {}
/** A refusal of caller input. The only store error whose message is forwarded; others become a sanitized 500. */
export class CodexValidationError extends Error {}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARS = /\p{Cc}/u;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const MAX_BODY = 100_000;
const MAX_ENTRY = 20_000;
const MAX_TAGS = 24;
const MAX_IDS = 24;

export function isId(value: string): boolean {
  return ID.test(value);
}
export function id(value: string): string {
  if (!ID.test(value)) throw new CodexValidationError("Codex id is malformed.");
  return value;
}
export function optionalId(value: string | null | undefined): string | null {
  return value === null || value === undefined ? null : id(value);
}
/** A set of ids (a marker's pages and scenes, a quest's entities): validated, deduped, capped at 24. */
export function idArray(value: readonly string[] | null | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];
  for (const raw of value) {
    const valid = id(raw);
    if (!out.includes(valid)) out.push(valid);
    if (out.length >= MAX_IDS) break;
  }
  return out;
}

/** A trimmed one-line label, or null when blank. */
export function shortLabel(value: string | null | undefined, max: number, what: string): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (trimmed.length > max || CONTROL_CHARS.test(trimmed))
    throw new CodexValidationError(`A ${what} is up to ${max} printable characters.`);
  return trimmed;
}
/** A page's or quest's display title. */
export function title(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 160 || CONTROL_CHARS.test(trimmed))
    throw new CodexValidationError("A title must be 1 to 160 printable characters.");
  return trimmed;
}
export function body(value: string | undefined): string {
  const text = value ?? "";
  if (text.length > MAX_BODY) throw new CodexValidationError("A page body is limited to 100000 characters.");
  return text;
}
/** A nested notebook folder path ("NPCs/Villains"): "/"-separated segments, normalized and bounded. */
export function folder(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const segments = value
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) return null;
  if (segments.length > 6) throw new CodexValidationError("A folder path can be at most 6 levels deep.");
  for (const segment of segments)
    if (segment.length > 40 || CONTROL_CHARS.test(segment))
      throw new CodexValidationError("Each folder name is up to 40 printable characters.");
  const path = segments.join("/");
  if (path.length > 160) throw new CodexValidationError("That folder path is too long.");
  return path;
}
export function tags(value: readonly string[] | undefined): string[] {
  if (!value) return [];
  const cleaned = [...new Set(value.map((tag) => tag.trim().toLowerCase()).filter(Boolean))];
  if (cleaned.length > MAX_TAGS) throw new CodexValidationError(`A record may carry at most ${MAX_TAGS} tags.`);
  for (const tag of cleaned)
    if (tag.length > 40 || !SLUG.test(tag))
      throw new CodexValidationError("Tags use lowercase letters, numbers, and hyphens.");
  return cleaned;
}

// Pages

export function entityType(value: string | undefined): CodexEntityType {
  if (value === undefined) return "note";
  if (!isCodexEntityType(value)) throw new CodexValidationError("Unknown entity type.");
  return value;
}
/** Structured entity attributes: a flat {slug: string} map, empties dropped, bounded in size. */
export function entityFields(value: Readonly<Record<string, string>> | undefined): Record<string, string> {
  if (value === undefined) return {};
  const entries = Object.entries(value);
  if (entries.length > 40) throw new CodexValidationError("An entity may carry at most 40 fields.");
  const out: Record<string, string> = {};
  for (const [key, raw] of entries) {
    if (!SLUG.test(key) || key.length > 40) throw new CodexValidationError("A field key must be a lowercase slug.");
    if (typeof raw !== "string" || raw.length > 2000 || CONTROL_CHARS.test(raw.replace(/[\n\r\t]/g, "")))
      throw new CodexValidationError("A field value is up to 2000 printable characters.");
    if (raw.trim() !== "") out[key] = raw;
  }
  if (JSON.stringify(out).length > 10_000) throw new CodexValidationError("Entity fields are too large.");
  return out;
}
/** Moves any secret-keyed value out of player-facing `fields` into `gmFields`, so a secret can never ship. */
export function sealSecretFields(
  fields: Record<string, string>,
  gmFields: Record<string, string>
): { fields: Record<string, string>; gmFields: Record<string, string> } {
  const outFields = { ...fields };
  const outGm = { ...gmFields };
  for (const key of CODEX_SECRET_FIELD_KEYS) {
    if (key in outFields) {
      outGm[key] = outFields[key];
      delete outFields[key];
    }
  }
  return { fields: outFields, gmFields: outGm };
}

// Connections

const MAX_CONNECTION_LABEL = 40;
/** Unlabelled stores `''` (read as null): the dedupe key includes the label, and NULLs never compare equal. */
export function connectionLabel(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length > MAX_CONNECTION_LABEL || CONTROL_CHARS.test(trimmed))
    throw new CodexValidationError(`A connection label is up to ${MAX_CONNECTION_LABEL} printable characters.`);
  return trimmed;
}
export function connectionLayer(value: string | null | undefined): "player" | "gm" {
  if (value === null || value === undefined) return "player";
  if (value !== "player" && value !== "gm")
    throw new CodexValidationError("A connection sits on the player layer or the GM layer.");
  return value;
}

// Atlas

const MAP_KINDS = new Set<string>(["battlemap", "regional", "world"]);
export function mapName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 120 || CONTROL_CHARS.test(trimmed))
    throw new CodexValidationError("A map name must be 1 to 120 printable characters.");
  return trimmed;
}
export function mapKind(value: string): CodexMapKind {
  if (!MAP_KINDS.has(value)) throw new CodexValidationError("Map kind must be battlemap, regional, or world.");
  return value as CodexMapKind;
}
export function iconId(value: string): string {
  if (!SLUG.test(value) || value.length > 60) throw new CodexValidationError("An icon id must be a lowercase slug.");
  return value;
}
export function hexColor(value: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(value)) throw new CodexValidationError("A color must be a #rrggbb hex value.");
  return value;
}
export function coord(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000)
    throw new CodexValidationError("A marker position must sit within the map.");
  return value;
}
export function markerLabel(value: string | null | undefined): string | null {
  return shortLabel(value, 120, "marker label");
}

// Journal

export function entryText(value: string | undefined): string {
  const text = value ?? "";
  if (text.length > MAX_ENTRY) throw new CodexValidationError("A journal entry is limited to 20000 characters.");
  return text;
}
export function entryGmText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value.length > MAX_ENTRY) throw new CodexValidationError("A journal entry is limited to 20000 characters.");
  return value === "" ? null : value;
}

// Sessions

const MAX_ATTENDEES = 24;
/** The table's scene cap. */
const MAX_SESSION_SCENES = 20;
export function sessionNo(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 0 || value > 100_000)
    throw new CodexValidationError("A session number must be a non-negative integer.");
  return value;
}
/** Free-text names, deduped and bounded; unlike tags they keep case and spaces. */
export function attendees(value: readonly string[] | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];
  for (const raw of value) {
    const name = shortLabel(raw, 40, "attendee name");
    if (name && !out.includes(name)) out.push(name);
  }
  if (out.length > MAX_ATTENDEES)
    throw new CodexValidationError(`A session may list at most ${MAX_ATTENDEES} attendees.`);
  return out;
}
export function sessionStatus(value: string | undefined): CodexSessionStatus {
  if (value === undefined) return "planned";
  if (value !== "planned" && value !== "played")
    throw new CodexValidationError("A session is either planned or played.");
  return value;
}
export function sessionSceneIds(value: readonly string[] | null | undefined): string[] {
  return idArray(value).slice(0, MAX_SESSION_SCENES);
}

// Quests

const QUEST_STATUSES = new Set<string>(["not-started", "active", "completed", "failed", "canceled"]);
const MAX_OBJECTIVES = 24;
/** The one-line display bound a marker label and an in-world label share. */
const MAX_OBJECTIVE_TEXT = 120;
export function questStatus(value: string | undefined): CodexQuestStatus {
  if (value === undefined) return "not-started";
  if (!QUEST_STATUSES.has(value))
    throw new CodexValidationError("A quest is not started, active, completed, failed, or canceled.");
  return value as CodexQuestStatus;
}
/** Fails closed to `active` so an unclassifiable stored quest stays prominent. */
export function coerceQuestStatus(value: unknown): CodexQuestStatus {
  return typeof value === "string" && QUEST_STATUSES.has(value) ? (value as CodexQuestStatus) : "active";
}
/** Order is content (never sorted or deduped); blank text is allowed (add-then-type); only `done === true` counts. */
export function questObjectives(value: readonly CodexQuestObjective[] | undefined): CodexQuestObjective[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new CodexValidationError("Objectives must be a list.");
  if (value.length > MAX_OBJECTIVES)
    throw new CodexValidationError(`A quest may carry at most ${MAX_OBJECTIVES} objectives.`);
  return value.map((objective) => {
    const text = typeof objective?.text === "string" ? objective.text.trim() : "";
    if (text.length > MAX_OBJECTIVE_TEXT || CONTROL_CHARS.test(text))
      throw new CodexValidationError(`An objective is up to ${MAX_OBJECTIVE_TEXT} printable characters.`);
    return { text, done: objective?.done === true };
  });
}

// Standing

export const MIN_STANDING = -100;
export const MAX_STANDING = 100;
/** Clamped and never rejected (the ends of the scale are real answers). Non-finite is an error. */
export function standingValue(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new CodexValidationError("A standing value must be a number from -100 to 100.");
  return Math.min(MAX_STANDING, Math.max(MIN_STANDING, Math.trunc(value)));
}

// Settings

/** `0` checkpoints every save, distinct from switching history off. The max is one week. */
export const MIN_REVISION_WINDOW_MINUTES = 0;
export const MAX_REVISION_WINDOW_MINUTES = 10_080;
/** Seconds. 1 is the floor; autosave is switched off with `enabled: false`, and 0 is out of range. */
export const MIN_AUTOSAVE_INTERVAL_SECONDS = 1;
export const MAX_AUTOSAVE_INTERVAL_SECONDS = 600;
/** Larger values push the cutoff out of `toISOString()`'s range. */
export const MAX_PRUNE_DAYS = 36_500;
/** Clamped and truncated for non-HTTP writers; the router rejects out-of-range values. */
export function revisionWindowMinutes(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new CodexValidationError(
      `A revision window must be a number of minutes from ${MIN_REVISION_WINDOW_MINUTES} to ${MAX_REVISION_WINDOW_MINUTES}.`
    );
  return Math.min(MAX_REVISION_WINDOW_MINUTES, Math.max(MIN_REVISION_WINDOW_MINUTES, Math.trunc(value)));
}
export function autosaveIntervalSeconds(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new CodexValidationError(
      `An autosave interval must be a number of seconds from ${MIN_AUTOSAVE_INTERVAL_SECONDS} to ${MAX_AUTOSAVE_INTERVAL_SECONDS}.`
    );
  return Math.min(MAX_AUTOSAVE_INTERVAL_SECONDS, Math.max(MIN_AUTOSAVE_INTERVAL_SECONDS, Math.trunc(value)));
}

// Stored JSON, read defensively: a malformed value degrades to empty, so it can't make the Codex unopenable.

export function parseStringArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}
export function parseFields(raw: string | null | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}
/** Order-preserving, the read side of "order is content". */
export function parseObjectives(raw: string | null | undefined): CodexQuestObjective[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (entry): entry is { text?: unknown; done?: unknown } =>
          !!entry && typeof entry === "object" && !Array.isArray(entry)
      )
      .map((entry) => ({ text: typeof entry.text === "string" ? entry.text : "", done: entry.done === true }));
  } catch {
    return [];
  }
}
