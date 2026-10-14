// Codex entity vocabulary shared by client and server: the field keys of each entity type and which are
// GM-secret. One copy, because a key marked secret on the client but missing on the server is never sealed
// and ships to players. Presentation (labels, icons, input kinds) stays in the client.

export const CODEX_ENTITY_TYPES = ["note", "character", "location", "faction", "item", "species", "religion", "event"] as const;
export type CodexEntityType = (typeof CODEX_ENTITY_TYPES)[number];

/** A field key belonging to an entity type. `secret` means the value rests in `gmFields`, never in player-facing `fields`. */
export type CodexFieldKeyDef = Readonly<{ key: string; secret?: boolean }>;

/** Structured fields of each entity type, in display order. A key here is storable; `secret` makes the server seal it. */
export const CODEX_ENTITY_FIELD_KEYS: Readonly<Record<CodexEntityType, readonly CodexFieldKeyDef[]>> = {
  note: [],
  character: [
    { key: "race" }, { key: "gender" }, { key: "age" },
    { key: "role" }, { key: "status" }, { key: "location" }, { key: "goals", secret: true }
  ],
  location: [{ key: "kind" }, { key: "region" }, { key: "population" }, { key: "ruler" }, { key: "climate" }],
  faction: [{ key: "kind" }, { key: "leader" }, { key: "headquarters" }, { key: "size" }, { key: "goals", secret: true }],
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

/** Every key marked secret on any type, as one flat set: a key secret anywhere is never player-facing elsewhere. */
export const CODEX_SECRET_FIELD_KEYS: ReadonlySet<string> = new Set(
  Object.values(CODEX_ENTITY_FIELD_KEYS).flatMap((fields) => fields.filter((field) => field.secret).map((field) => field.key))
);

/** Drop any key that does not belong to `type`. Used server-side so a type switch cannot strand unreachable values. */
export function pruneCodexFields(type: CodexEntityType | undefined, values: Readonly<Record<string, string>>): Record<string, string> {
  const allowed = codexFieldKeys(type);
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) if (allowed.has(key)) out[key] = value;
  return out;
}
