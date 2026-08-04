/**
 * The homebrew content types, and the words the UI is allowed to use for them.
 *
 * **The type union is IMPORTED, never hand-written.** `HomebrewContentTypeSchema` in
 * `packages/api-contract/src/index.ts` is the single source of truth, and three
 * engineers holding three slightly different copies of it is exactly how a picker
 * comes to offer a type every create call rejects with a 400 the GM cannot fix.
 * Re-declaring the union here would compile fine and drift silently; importing it
 * makes the next change a type error instead of a bug report.
 *
 * `type` is a FIELD, not a nav axis (the Codex's own rule): it is a filter in the rail
 * and a select in the create modal, never a tab bar. Nine tab labels is ~810px of
 * content in a 343px viewport.
 */
import { HomebrewContentTypeSchema, type HomebrewContentType } from "@vtt/api-contract";

export type HomebrewType = HomebrewContentType;

/**
 * Render order, everywhere: the two class-shaped types together, then the character
 * options, then the reference catalogs, with `spell-list` beside `spell` because the
 * two are one authoring flow (a caster class needs a list to draw from).
 *
 * Derived from the contract's own `options`, so a type added there can never be
 * missing here — it lands at the end of the list rather than silently disappearing
 * from every picker. The explicit order below is a preference, not the membership.
 */
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

/** Singular for a sentence ("Duplicate an existing class"), plural for a group heading
    and a search placeholder. Both are stored because English pluralisation is not a
    function you can write ("species", "class" → "classes"). */
export type TypeWords = Readonly<{ label: string; plural: string }>;

export const TYPE_WORDS: Readonly<Record<HomebrewType, TypeWords>> = {
  class: { label: "class", plural: "Classes" },
  subclass: { label: "subclass", plural: "Subclasses" },
  species: { label: "species", plural: "Species" },
  background: { label: "background", plural: "Backgrounds" },
  feat: { label: "feat", plural: "Feats" },
  spell: { label: "spell", plural: "Spells" },
  "spell-list": { label: "spell list", plural: "Spell lists" },
  // The wire name is `equipment` (one name per thing — it is what
  // `ContentEquipmentSummary` and `equipmentSummaries` already say). The GM-facing
  // word stays "item", because that is what a GM calls a longsword.
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

/**
 * The rail's status filter. This is a VIEW over two orthogonal server fields
 * (`state` and `deletedAt`), not a fourth stored state — "Removed" is a soft-deleted
 * row of either state, so it cannot be a `state` value.
 *
 * The state vocabulary is fixed and must not gain synonyms:
 * **Draft · Published · Shown to players · GM only · Removed.** Never "hidden"
 * (ambiguous between GM-only and removed), never "live", never "active".
 */
export type StatusFilter = "all" | "draft" | "published" | "removed";

export const STATUS_FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "Drafts and published" },
  { value: "draft", label: "Drafts" },
  { value: "published", label: "Published" },
  { value: "removed", label: "Archived" }
];
