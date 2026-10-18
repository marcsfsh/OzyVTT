import type { HomebrewRevisionSummary } from "../../homebrew/api";
import { fieldAt } from "../../homebrew/schemas";
import type { Kind } from "../kinds";

/** Where a reader meets a record of this kind, for Card's and Sharing's lists. A monster reaches no player. */
export function placesFor(kind: Kind, character: string | null): readonly string[] {
  const who = character ?? "a character";
  switch (kind) {
    case "class":
      return ["The character builder's classes", "Compendium in the Codex"];
    case "subclass":
      return ["The character builder, at its class's subclass level", "Compendium in the Codex"];
    case "species":
      return ["The character builder's species", "Compendium in the Codex"];
    case "background":
      return ["The character builder's backgrounds", "Compendium in the Codex"];
    case "feat":
      return ["The character builder, where its category fits", "Compendium in the Codex"];
    case "spell":
      return [`Spell choices when ${who} prepares or learns spells`, "Compendium in the Codex"];
    case "spell-list":
      return ["The spell choices of the classes that draw from it"];
    case "equipment":
      return [`The gear picker on ${character ? `${character}'s` : "a character's"} sheet`, "Compendium in the Codex"];
    case "monster":
      return [];
  }
}

const spelled = (key: string) =>
  key
    .replace(/Id$/, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .toLowerCase()
    .replace(/^./, (first) => first.toUpperCase());

/** A top-level field of a record, in the editor's own words. */
export function fieldWord(kind: Kind, key: string): string {
  const found = fieldAt(kind, [key]);
  return found ? found.label.replace(/^./, (first) => first.toUpperCase()) : spelled(key);
}

/** A stored value in a few words, for a table that sets two of them side by side. */
export function valueWords(value: unknown): string {
  if (value === undefined || value === null || value === "") return "None";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    if (value.length === 0) return "None";
    const named = value.map((entry) =>
      entry && typeof entry === "object" && typeof (entry as { name?: unknown }).name === "string"
        ? (entry as { name: string }).name || "Unnamed"
        : typeof entry === "string" || typeof entry === "number"
          ? String(entry)
          : null
    );
    return named.every((entry) => entry !== null) ? named.join(", ") : `${value.length} entries`;
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.name === "string") return record.name;
    const parts = Object.entries(record)
      .filter(([, entry]) => entry !== null && entry !== undefined && typeof entry !== "object")
      .map(([key, entry]) => `${spelled(key)} ${valueWords(entry)}`);
    return parts.length > 0 ? parts.join(" · ") : "Set";
  }
  return "Set";
}

/** One row of a field-by-field comparison: a top-level field, or one named entry of a list that changed. */
export type CompareRow = Readonly<{ key: string; label: string; left: string; right: string; changed: boolean }>;

/** An unset field, an empty text and an empty list all read None, so the editor's filled-in blanks are no change. */
const emptyToNull = (value: unknown): unknown => {
  if (value === undefined || value === null || value === "") return null;
  if (Array.isArray(value)) return value.length === 0 ? null : value.map(emptyToNull);
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => [key, emptyToNull(entry)] as const)
      .filter(([, entry]) => entry !== null)
      .sort(([left], [right]) => left.localeCompare(right));
    return entries.length === 0 ? null : Object.fromEntries(entries);
  }
  return value;
};
const same = (left: unknown, right: unknown) =>
  JSON.stringify(emptyToNull(left)) === JSON.stringify(emptyToNull(right));
const named = (value: unknown): value is ReadonlyArray<Readonly<{ id?: unknown; name?: unknown }>> =>
  Array.isArray(value) && value.every((entry) => entry && typeof entry === "object" && typeof entry.name === "string");

/**
 * Two bodies field by field. A list of named entries (features, actions, traits) that changed is opened one level, so
 * Brine Ward's new dice show as Brine Ward's row and not as "Features changed". Unchanged fields are left out unless
 * `all` asks for them.
 */
export function compareBodies(
  kind: Kind,
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
  all = false
): CompareRow[] {
  const rows: CompareRow[] = [];
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].filter(
    (key) => key !== "id" && key !== "source" && key !== "type"
  );
  for (const key of keys) {
    const a = left[key];
    const b = right[key];
    if (same(a, b)) {
      if (all)
        rows.push({ key, label: fieldWord(kind, key), left: valueWords(a), right: valueWords(b), changed: false });
      continue;
    }
    if (named(a) && named(b)) {
      const byKey = (entry: Readonly<{ id?: unknown; name?: unknown }>) => String(entry.id ?? entry.name);
      const before = new Map(a.map((entry) => [byKey(entry), entry]));
      const after = new Map(b.map((entry) => [byKey(entry), entry]));
      for (const id of new Set([...before.keys(), ...after.keys()])) {
        const was = before.get(id);
        const now = after.get(id);
        if (same(was, now)) continue;
        const text = (entry: typeof was) =>
          !entry
            ? "None"
            : typeof (entry as { description?: unknown }).description === "string"
              ? (entry as { description: string }).description || "No text"
              : valueWords(entry);
        // An entry whose words read the same changed only in what the game reads; a field-by-field table shows words.
        if (text(was) === text(now)) continue;
        rows.push({
          key: `${key}.${id}`,
          label: String((now ?? was)?.name ?? fieldWord(kind, key)) || fieldWord(kind, key),
          left: text(was),
          right: text(now),
          changed: true
        });
      }
      continue;
    }
    rows.push({ key, label: fieldWord(kind, key), left: valueWords(a), right: valueWords(b), changed: true });
  }
  return rows;
}

export const DEVICE_WORDS: Readonly<Record<HomebrewRevisionSummary["device"], string>> = {
  "this-device": "This device",
  "other-device": "Another device",
  server: "The server"
};

/** One side of a two-text comparison, in runs: words both sides share, and words only this side has. */
export type DiffRun = Readonly<{ text: string; changed: boolean }>;

/**
 * Two texts word by word, so a comparison marks only the words that moved ("by 1d6" against "by 1d8"). Texts too long
 * to compare cheaply come back whole and unmarked; the row already says the field changed.
 */
export function diffWords(left: string, right: string): Readonly<{ left: DiffRun[]; right: DiffRun[] }> {
  const a = left.split(/(\s+)/);
  const b = right.split(/(\s+)/);
  if (a.length * b.length > 200_000)
    return { left: [{ text: left, changed: false }], right: [{ text: right, changed: false }] };
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i -= 1)
    for (let j = b.length - 1; j >= 0; j -= 1)
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
  const outLeft: DiffRun[] = [];
  const outRight: DiffRun[] = [];
  const push = (out: DiffRun[], text: string, changed: boolean) => {
    const last = out.at(-1);
    if (last && last.changed === changed) out[out.length - 1] = { text: last.text + text, changed };
    else out.push({ text, changed });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push(outLeft, a[i]!, false);
      push(outRight, b[j]!, false);
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      // Whitespace never counts as a change on its own.
      push(outLeft, a[i]!, /\S/.test(a[i]!));
      i += 1;
    } else {
      push(outRight, b[j]!, /\S/.test(b[j]!));
      j += 1;
    }
  }
  for (; i < a.length; i += 1) push(outLeft, a[i]!, /\S/.test(a[i]!));
  for (; j < b.length; j += 1) push(outRight, b[j]!, /\S/.test(b[j]!));
  return { left: outLeft, right: outRight };
}
