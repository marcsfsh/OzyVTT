/**
 * Client-side entity presentation: label, glyph, colour and per-field presentation. Which field keys exist
 * and which are secret comes from `@vtt/domain` (`CODEX_ENTITY_FIELD_KEYS`), the same table the server
 * prunes and seals from, so the UI can't render a field the server drops.
 */

import { CODEX_ENTITY_FIELD_KEYS, CODEX_ENTITY_TYPES, type CodexEntityType } from "@vtt/domain";

export type EntityType = CodexEntityType;

export type FieldDef = Readonly<{ key: string; label: string; kind?: "text" | "textarea"; placeholder?: string; secret?: boolean }>;
/** Presentation for one field key, joined onto the shared key table. */
type FieldPresentation = Readonly<{ label: string; kind?: "text" | "textarea"; placeholder?: string }>;
/**
 * Join presentation onto the shared key list, keeping its order. Keyed per type because the same key
 * reads differently by type (`goals` is "Secret agenda" on a faction).
 */
function withKeys(type: EntityType, present: Readonly<Record<string, FieldPresentation>>): readonly FieldDef[] {
  return CODEX_ENTITY_FIELD_KEYS[type].map(({ key, secret }) => {
    const meta = present[key];
    return { key, secret, label: meta?.label ?? key, kind: meta?.kind, placeholder: meta?.placeholder };
  });
}
/** One definition per entity type, used by the tree, dashboard, graph, badges and editor. */
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
  /**
   * An event's real date is edited above the fields and places it on the chronicle; `when` stays as free
   * prose (removing the key would make the server prune existing text).
   */
  event: { type: "event", label: "Event", icon: "hourglass", color: "var(--codex-type-event)", fields: withKeys("event", {
    when: { label: "When, in prose", placeholder: "the third winter of the siege" }, where: { label: "Where" }, participants: { label: "Participants" }, outcome: { label: "Outcome", kind: "textarea" }
  }) }
};

export const ENTITY_TYPE_LIST: readonly EntityType[] = CODEX_ENTITY_TYPES;
export function entityDef(type: EntityType | undefined): EntityDef { return ENTITY_DEFS[type ?? "note"] ?? ENTITY_DEFS.note; }
/** The CODEX_ICONS glyph id for a type (drawn via <EntityIcon>). */
export function entityIconId(type: EntityType | undefined): string { return entityDef(type).icon; }
export function entityColor(type: EntityType | undefined): string { return entityDef(type).color; }
/** Split field values into player-facing `fields` and GM-only `gmFields` (secret fields), per the type's schema. */
export function splitEntityFields(type: EntityType | undefined, values: Readonly<Record<string, string>>): { fields: Record<string, string>; gmFields: Record<string, string> } {
  const secret = new Set(entityDef(type).fields.filter((field) => field.secret).map((field) => field.key));
  const fields: Record<string, string> = {};
  const gmFields: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) (secret.has(key) ? gmFields : fields)[key] = value;
  return { fields, gmFields };
}

/**
 * Connection label suggestions for a datalist; labels are free text. "ally of", "enemy of", "rival of" and
 * "related to" are symmetric, which the server uses so declaring one from both ends makes one edge.
 */
export const CONNECTION_LABEL_SUGGESTIONS: readonly string[] = [
  "ally of", "enemy of", "rival of", "rules", "member of", "leads",
  "located in", "owns", "parent of", "serves", "created", "related to"
];
