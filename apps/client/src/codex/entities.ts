/**
 * The worldbuilding entity model, client side: what each entity TYPE is and the structured fields it
 * carries, plus the relationship vocabulary (with human labels for each direction). The server stores
 * types + fields + relationship slugs opaquely; this file is the schema the GM UI renders from.
 */

export type EntityType = "note" | "character" | "location" | "faction" | "item" | "species" | "religion" | "event";

export type FieldDef = Readonly<{ key: string; label: string; kind?: "text" | "textarea"; placeholder?: string }>;
export type EntityDef = Readonly<{ type: EntityType; label: string; icon: string; fields: readonly FieldDef[] }>;

export const ENTITY_DEFS: Readonly<Record<EntityType, EntityDef>> = {
  note: { type: "note", label: "Note", icon: "📄", fields: [] },
  character: { type: "character", label: "Character", icon: "🧑", fields: [
    { key: "race", label: "Race / species" }, { key: "gender", label: "Gender" }, { key: "age", label: "Age" },
    { key: "role", label: "Role / occupation" }, { key: "status", label: "Status", placeholder: "alive / dead / missing" },
    { key: "location", label: "Location" }, { key: "goals", label: "Goals & motives", kind: "textarea" }
  ] },
  location: { type: "location", label: "Location", icon: "🏰", fields: [
    { key: "kind", label: "Type", placeholder: "city / dungeon / region" }, { key: "region", label: "Region" },
    { key: "population", label: "Population" }, { key: "ruler", label: "Ruler / owner" }, { key: "climate", label: "Climate" }
  ] },
  faction: { type: "faction", label: "Faction", icon: "⚔️", fields: [
    { key: "kind", label: "Type", placeholder: "guild / cult / kingdom" }, { key: "leader", label: "Leader" },
    { key: "headquarters", label: "Headquarters" }, { key: "size", label: "Size" }, { key: "goals", label: "Goals", kind: "textarea" }
  ] },
  item: { type: "item", label: "Item", icon: "🗡️", fields: [
    { key: "kind", label: "Type", placeholder: "weapon / relic / consumable" }, { key: "rarity", label: "Rarity" },
    { key: "owner", label: "Current owner" }, { key: "attunement", label: "Attunement" }, { key: "properties", label: "Properties", kind: "textarea" }
  ] },
  species: { type: "species", label: "Species", icon: "🐉", fields: [
    { key: "category", label: "Category", placeholder: "beast / humanoid / aberration" }, { key: "habitat", label: "Habitat" },
    { key: "diet", label: "Diet" }, { key: "size", label: "Size" }, { key: "traits", label: "Traits", kind: "textarea" }
  ] },
  religion: { type: "religion", label: "Religion", icon: "🕯️", fields: [
    { key: "deity", label: "Deity / power" }, { key: "domains", label: "Domains" }, { key: "alignment", label: "Alignment" }, { key: "followers", label: "Followers" }
  ] },
  event: { type: "event", label: "Event", icon: "⏳", fields: [
    { key: "when", label: "When" }, { key: "where", label: "Where" }, { key: "participants", label: "Participants" }, { key: "outcome", label: "Outcome", kind: "textarea" }
  ] }
};

export const ENTITY_TYPE_LIST: readonly EntityType[] = ["note", "character", "location", "faction", "item", "species", "religion", "event"];
export function entityDef(type: EntityType | undefined): EntityDef { return ENTITY_DEFS[type ?? "note"] ?? ENTITY_DEFS.note; }
export function entityIcon(type: EntityType | undefined): string { return entityDef(type).icon; }

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
