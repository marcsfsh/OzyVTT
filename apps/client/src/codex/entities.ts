/**
 * The worldbuilding entity model, client side: how each entity TYPE presents, plus the relationship
 * vocabulary (with human labels for each direction).
 *
 * **Which field keys exist, and which are secret, is no longer decided here** — that table lives in
 * `@vtt/domain` (`CODEX_ENTITY_FIELD_KEYS`) because the server prunes and seals from it. This file
 * supplies only presentation: label, placeholder, and input kind. Keys and `secret` flags are read
 * off the shared table by `withKeys` below, so the GM UI cannot render a field the server will drop,
 * and cannot mark a field secret that the server will not seal.
 */

import { CODEX_ENTITY_FIELD_KEYS, CODEX_ENTITY_TYPES, type CodexEntityType } from "@vtt/domain";

export type EntityType = CodexEntityType;

export type FieldDef = Readonly<{ key: string; label: string; kind?: "text" | "textarea"; placeholder?: string; secret?: boolean }>;
/** Presentation for one field key, joined onto the shared key table. */
type FieldPresentation = Readonly<{ label: string; kind?: "text" | "textarea"; placeholder?: string }>;
/**
 * Join presentation onto the shared key list, preserving the shared table's order.
 * Presentation is keyed per *type*, not per key, because the same key reads differently by type —
 * `kind` is "city / dungeon / region" on a location but "weapon / relic / consumable" on an item, and
 * `goals` is "Goals & motives" on a character but "Secret agenda" on a faction.
 */
function withKeys(type: EntityType, present: Readonly<Record<string, FieldPresentation>>): readonly FieldDef[] {
  return CODEX_ENTITY_FIELD_KEYS[type].map(({ key, secret }) => {
    const meta = present[key];
    return { key, secret, label: meta?.label ?? key, kind: meta?.kind, placeholder: meta?.placeholder };
  });
}
/** One source of truth per entity type: its label, glyph id (see icons.tsx CODEX_ICONS), accent color, and structured fields — used by the tree, World cards, graph, badges, and editor alike. */
export type EntityDef = Readonly<{ type: EntityType; label: string; icon: string; color: string; fields: readonly FieldDef[] }>;

export const ENTITY_DEFS: Readonly<Record<EntityType, EntityDef>> = {
  note: { type: "note", label: "Note", icon: "scroll", color: "var(--codex-type-note)", fields: withKeys("note", {}) },
  character: { type: "character", label: "Character", icon: "person", color: "var(--codex-type-character)", fields: withKeys("character", {
    race: { label: "Race / species" }, gender: { label: "Gender" }, age: { label: "Age" },
    role: { label: "Role / occupation" }, status: { label: "Status", placeholder: "alive / dead / missing" },
    location: { label: "Location" }, goals: { label: "Goals & motives", kind: "textarea" }
  }) },
  location: { type: "location", label: "Location", icon: "castle", color: "var(--codex-type-location)", fields: withKeys("location", {
    kind: { label: "Type", placeholder: "city / dungeon / region" }, region: { label: "Region" },
    population: { label: "Population" }, ruler: { label: "Ruler / owner" }, climate: { label: "Climate" }
  }) },
  faction: { type: "faction", label: "Faction", icon: "banner", color: "var(--codex-type-faction)", fields: withKeys("faction", {
    kind: { label: "Type", placeholder: "guild / cult / kingdom" }, leader: { label: "Leader" },
    headquarters: { label: "Headquarters" }, size: { label: "Size" }, goals: { label: "Secret agenda", kind: "textarea" }
  }) },
  item: { type: "item", label: "Item", icon: "sword", color: "var(--codex-type-item)", fields: withKeys("item", {
    kind: { label: "Type", placeholder: "weapon / relic / consumable" }, rarity: { label: "Rarity" },
    owner: { label: "Current owner" }, attunement: { label: "Attunement" }, properties: { label: "Properties", kind: "textarea" }
  }) },
  species: { type: "species", label: "Species", icon: "dragon", color: "var(--codex-type-species)", fields: withKeys("species", {
    category: { label: "Category", placeholder: "beast / humanoid / aberration" }, habitat: { label: "Habitat" },
    diet: { label: "Diet" }, size: { label: "Size" }, traits: { label: "Traits", kind: "textarea" }
  }) },
  religion: { type: "religion", label: "Religion", icon: "sun", color: "var(--codex-type-religion)", fields: withKeys("religion", {
    deity: { label: "Deity / power" }, domains: { label: "Domains" }, alignment: { label: "Alignment" }, followers: { label: "Followers" }
  }) },
  event: { type: "event", label: "Event", icon: "hourglass", color: "var(--codex-type-event)", fields: withKeys("event", {
    when: { label: "When" }, where: { label: "Where" }, participants: { label: "Participants" }, outcome: { label: "Outcome", kind: "textarea" }
  }) }
};

export const ENTITY_TYPE_LIST: readonly EntityType[] = CODEX_ENTITY_TYPES;
export function entityDef(type: EntityType | undefined): EntityDef { return ENTITY_DEFS[type ?? "note"] ?? ENTITY_DEFS.note; }
/** The CODEX_ICONS glyph id for a type (drawn via <EntityIcon>). Replaces the old emoji. */
export function entityIconId(type: EntityType | undefined): string { return entityDef(type).icon; }
export function entityColor(type: EntityType | undefined): string { return entityDef(type).color; }
/** Split a flat field-value map into player-facing `fields` and GM-only `gmFields`, per the type's schema (secret fields ride in gmFields, stripped from players like the GM body). */
export function splitEntityFields(type: EntityType | undefined, values: Readonly<Record<string, string>>): { fields: Record<string, string>; gmFields: Record<string, string> } {
  const secret = new Set(entityDef(type).fields.filter((field) => field.secret).map((field) => field.key));
  const fields: Record<string, string> = {};
  const gmFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) (secret.has(key) ? gmFields : fields)[key] = value;
  return { fields, gmFields };
}

/** Relationship vocabulary: a slug, plus how it reads from each end (Strahd *rules* Barovia / Barovia *ruled by* Strahd). */
export const RELATIONSHIP_TYPES: ReadonlyArray<Readonly<{ type: string; label: string; inverse: string }>> = [
  { type: "ally", label: "ally of", inverse: "ally of" },
  { type: "enemy", label: "enemy of", inverse: "enemy of" },
  { type: "rival", label: "rival of", inverse: "rival of" },
  { type: "rules", label: "rules", inverse: "ruled by" },
  { type: "member", label: "member of", inverse: "has member" },
  { type: "leader", label: "leads", inverse: "led by" },
  { type: "located-in", label: "located in", inverse: "contains" },
  { type: "owns", label: "owns", inverse: "owned by" },
  { type: "parent", label: "parent of", inverse: "child of" },
  { type: "serves", label: "serves", inverse: "served by" },
  { type: "created", label: "created", inverse: "created by" },
  { type: "related", label: "related to", inverse: "related to" }
];
export function relationshipLabel(type: string, direction: "out" | "in"): string {
  const def = RELATIONSHIP_TYPES.find((entry) => entry.type === type);
  return def ? (direction === "out" ? def.label : def.inverse) : type.replace(/-/g, " ");
}
