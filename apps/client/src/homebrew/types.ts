/** The homebrew content types and the words the UI uses for them. The type union is imported
    from `@vtt/api-contract` and never redeclared, so a contract change is a type error here. */
import { HomebrewContentTypeSchema, type HomebrewContentType } from "@vtt/api-contract";

export type HomebrewType = HomebrewContentType;

/** Render order: class-shaped types, character options, then reference catalogs. Types the
    contract adds that are missing from this list sort to the end, so none disappears. */
const PREFERRED_ORDER: readonly string[] = [
  "class",
  "subclass",
  "species",
  "background",
  "feat",
  "spell",
  "spell-list",
  "equipment",
  "monster"
];

export const HOMEBREW_TYPES: readonly HomebrewType[] = [...HomebrewContentTypeSchema.options].sort((a, b) => {
  const ai = PREFERRED_ORDER.indexOf(a);
  const bi = PREFERRED_ORDER.indexOf(b);
  return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
});

/** Singular for sentences, plural for group headings and placeholders. Both are stored
    because English plurals are irregular. */
export type TypeWords = Readonly<{ label: string; plural: string }>;

export const TYPE_WORDS: Readonly<Record<HomebrewType, TypeWords>> = {
  class: { label: "class", plural: "Classes" },
  subclass: { label: "subclass", plural: "Subclasses" },
  species: { label: "species", plural: "Species" },
  background: { label: "background", plural: "Backgrounds" },
  feat: { label: "feat", plural: "Feats" },
  spell: { label: "spell", plural: "Spells" },
  "spell-list": { label: "spell list", plural: "Spell lists" },
  // Wire name is `equipment`; the GM-facing word is "item".
  equipment: { label: "item", plural: "Items" },
  monster: { label: "monster", plural: "Monsters" }
};

export function typeLabel(type: HomebrewType): string {
  return TYPE_WORDS[type]?.label ?? type;
}
export function typePlural(type: HomebrewType): string {
  return TYPE_WORDS[type]?.plural ?? type;
}
export function isHomebrewType(value: string): value is HomebrewType {
  return HomebrewContentTypeSchema.safeParse(value).success;
}

/** The rail's status filter: a view over `state` and `deletedAt`, with no stored state of its own.
    "Removed" is a soft-deleted row of either state. */
export type StatusFilter = "all" | "draft" | "published" | "removed";

export const STATUS_FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Drafts and published" },
  { value: "draft", label: "Drafts" },
  { value: "published", label: "Published" },
  { value: "removed", label: "Archived" }
];
