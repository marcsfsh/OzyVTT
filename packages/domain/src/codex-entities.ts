/**
 * The Codex entity vocabulary that BOTH sides need: which field keys each entity type carries, and
 * which of those keys are GM-secret.
 *
 * Why it lives here and not in the client's `codex/entities.ts`. Until now this table existed twice —
 * once client-side (`ENTITY_DEFS`, with `secret: true` markers) and once server-side (a hardcoded
 * `SECRET_FIELD_KEYS = new Set(["goals"])`) — with a comment asking the next author to keep them in
 * sync by hand. That is the drift this package exists to prevent (see the header notes on the rider
 * gate vocabulary and `resolveSpellcasting`): the two lists diverge the first time one of them grows,
 * and here divergence is a *viewer-safety* bug, because a field marked secret on the client but
 * missing from the server's set is never sealed and ships to players on reveal.
 *
 * Presentation metadata deliberately does NOT live here. Labels, placeholders, icons, colors and
 * textarea-vs-input are the GM UI's business; the client joins them onto these keys. What is shared is
 * only the part where client and server must agree: the key set and the secret flags.
 */

export const CODEX_ENTITY_TYPES = ["note", "character", "location", "faction", "item", "species", "religion", "event"] as const;
export type CodexEntityType = (typeof CODEX_ENTITY_TYPES)[number];

/** A field key belonging to an entity type. `secret` means the value rests in `gmFields`, never in player-facing `fields`. */
export type CodexFieldKeyDef = Readonly<{ key: string; secret?: boolean }>;

/**
 * One source of truth for the structured fields of each entity type, in display order.
 * Adding a key here is what makes it storable; marking it `secret` is what makes the server seal it.
 */
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

/**
 * Every key marked secret anywhere, as one flat set.
 *
 * Flat, not per-type, because that is the behaviour the server already had: sealing keyed off a global
 * set, so a `goals` value on a *location* was sealed too. Deriving the union preserves that exactly
 * while removing the hand-sync. It is also the safer direction — a key that is secret on any type is
 * never treated as player-facing on another.
 */
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
