// Codex entity vocabulary shared by client and server: the field keys of each entity type, which start Hidden on a
// new page, and how a page title becomes a link key. One copy, because a key the client treats as Hidden by default
// but the server does not would ship to players. Presentation stays in the client.

export const CODEX_ENTITY_TYPES = [
  "note",
  "character",
  "location",
  "faction",
  "item",
  "species",
  "religion",
  "event"
] as const;
export type CodexEntityType = (typeof CODEX_ENTITY_TYPES)[number];

/** A field key belonging to an entity type. `secret` means the field starts Hidden on a new page; the GM can show it. */
export type CodexFieldKeyDef = Readonly<{ key: string; secret?: boolean }>;

/** Structured fields of each entity type, in display order. A key here is storable; `secret` makes it start Hidden. */
export const CODEX_ENTITY_FIELD_KEYS: Readonly<Record<CodexEntityType, readonly CodexFieldKeyDef[]>> = {
  note: [],
  character: [
    { key: "race" },
    { key: "gender" },
    { key: "age" },
    { key: "role" },
    { key: "status" },
    { key: "location" },
    { key: "goals", secret: true }
  ],
  location: [{ key: "kind" }, { key: "region" }, { key: "population" }, { key: "ruler" }, { key: "climate" }],
  faction: [
    { key: "kind" },
    { key: "leader" },
    { key: "headquarters" },
    { key: "size" },
    { key: "goals", secret: true }
  ],
  item: [{ key: "kind" }, { key: "rarity" }, { key: "owner" }, { key: "attunement" }, { key: "properties" }],
  species: [{ key: "category" }, { key: "habitat" }, { key: "diet" }, { key: "size" }, { key: "traits" }],
  religion: [{ key: "deity" }, { key: "domains" }, { key: "alignment" }, { key: "followers" }],
  event: [{ key: "when" }, { key: "where" }, { key: "participants" }, { key: "outcome" }]
};

export function isCodexEntityType(value: unknown): value is CodexEntityType {
  return typeof value === "string" && (CODEX_ENTITY_TYPES as readonly string[]).includes(value);
}

/** The keys a page of this type may carry. Unknown/absent types fall back to `note` (which carries none). */
export function codexFieldKeys(type: CodexEntityType | undefined): ReadonlySet<string> {
  return new Set((CODEX_ENTITY_FIELD_KEYS[type ?? "note"] ?? CODEX_ENTITY_FIELD_KEYS.note).map((field) => field.key));
}

/** The field keys a page of this type starts with Hidden: Motives on a character, Secret agenda on a faction. */
export function codexDefaultHiddenFields(type: CodexEntityType | undefined): string[] {
  return (CODEX_ENTITY_FIELD_KEYS[type ?? "note"] ?? CODEX_ENTITY_FIELD_KEYS.note)
    .filter((field) => field.secret)
    .map((field) => field.key);
}

/** Drop any key that does not belong to `type`. Used server-side so a type switch cannot strand unreachable values. */
export function pruneCodexFields(
  type: CodexEntityType | undefined,
  values: Readonly<Record<string, string>>
): Record<string, string> {
  const allowed = codexFieldKeys(type);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) if (allowed.has(key)) out[key] = value;
  return out;
}

/** A page title reduced to its `[[wiki link]]` key: trimmed, lowercased, whitespace collapsed. */
export function pageLinkKey(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}
