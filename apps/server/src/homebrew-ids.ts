import { randomUUID } from "node:crypto";
import type { HomebrewContentType } from "@vtt/api-contract";

/**
 * Minting for homebrew content ids. Three constraints have to hold TOGETHER, and two of them are
 * silent failures rather than loud ones, which is why this is its own module with its own assertion
 * backstop rather than a one-liner at the call site.
 *
 * 1. **Slug-legal.** `ContentIdSchema` (`packages/content-srd-5.2.1/src/character-content.ts`) and
 *    ~30 sibling regexes are `^[a-z0-9-]+$`. No `:`, no `.`, no `_`.
 * 2. **<= 60 characters.** `ActorDefinitionSchema` (`packages/schemas/src/index.ts`) caps the
 *    persisted class/subclass/species/background/feat ids at 60 while `ContentIdSchema` allows 80.
 *    A 65-character id passes creation and interpretation, gets written into a definition, and then
 *    fails `GameStateSchema.parse` on the next boot - which BRICKS CAMPAIGN LOAD. `assertMintable`
 *    throws rather than logs for exactly this reason.
 * 3. **A monster id must not leak a name.** `Actor.definitionId` is not in `PlayerActor`'s `Omit`
 *    (`packages/domain/src/index.ts`), so it reaches every player for every public token. A
 *    name-derived id would spell out a secret boss's name in the payload before the GM reveals it.
 *    Hence two shapes: readable for the builder types (whose exposure is a player's OWN sheet), and
 *    opaque `hb-m-<12 hex>` for monsters.
 *
 * `hb-` is a RESERVED PREFIX: no SRD bundle id starts with it (asserted in
 * `apps/server/test/homebrew-ids.test.ts`), so a minted id can never shadow bundled content and an
 * SRD-collision check is unnecessary by construction.
 */

/** Every minted id starts with this. Reserved: no SRD bundle id may ever use it. */
export const HOMEBREW_ID_PREFIX = "hb-";
/** The hard budget. See constraint 2 above - this number is load-bearing, not stylistic. */
export const HOMEBREW_ID_MAX_LENGTH = 60;
/** Monsters get no slug at all (constraint 3); this is the whole non-random part of their id. */
const MONSTER_PREFIX = `${HOMEBREW_ID_PREFIX}m-`;

const SLUG_LEGAL = /^[a-z0-9-]+$/;
const HEX = /^[0-9a-f]+$/;
/** Unicode combining marks, stripped after NFKD so an accented name slugs to its plain letters rather than losing the letter. */
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

/**
 * `resolveCatalogChoice` (`packages/domain/src/catalog-choice.ts`) dispatches on these suffixes and
 * on the exact words below, deriving a family slug from a record id (`<classId>-subclasses`). Every
 * minted id ends in `-<hex>`, so none of them can be produced - but that is a property of the
 * suffix, so it is asserted here to stop anyone "simplifying" the hex away.
 */
const RESERVED_SUFFIXES = ["-spells", "-subclasses", "-feats", "-lineages"] as const;
const RESERVED_WORDS = ["skills", "weapons"] as const;

/** Random hex from a v4 UUID's fully-random leading 12 nibbles (positions 12+ carry version/variant bits). */
function hex(length: number): string {
  return randomUUID().replace(/-/g, "").slice(0, length);
}

/**
 * Lowercase, de-accent, collapse to hyphens, and truncate at a hyphen boundary so a cut id still
 * reads as words. Returns "" when nothing survives (a purely non-Latin name), which the caller
 * replaces with the type name.
 */
export function slugify(raw: string, maxLength: number): string {
  const collapsed = raw
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  if (collapsed.length <= maxLength) return collapsed;
  const cut = collapsed.slice(0, maxLength + 1);
  const boundary = cut.lastIndexOf("-");
  const trimmed = boundary > 0 ? cut.slice(0, boundary) : collapsed.slice(0, maxLength);
  return trimmed.replace(/-+$/, "");
}

/**
 * Why an id is unmintable, as a sentence completing `Homebrew id "x" ...`, or null when it is fine.
 *
 * Split out of `assertMintable` so the PUBLISH GATE can report exactly the rule the MINTER enforces
 * rather than restating it. Two copies of these four rules is how they drift, and the drift that
 * matters is silent: a 61-character id written by an importer or a hand-edited body passes every
 * content schema (`ContentIdSchema` allows 80) and only fails on the next boot, inside
 * `GameStateSchema.parse`, as a campaign that will not load.
 */
export function homebrewIdProblem(id: string, type: HomebrewContentType): string | null {
  if (!id.startsWith(HOMEBREW_ID_PREFIX)) return `must start with "${HOMEBREW_ID_PREFIX}"`;
  // Constraint 3 is TYPE-SPECIFIC and has to be re-applied here, not only at mint time. A monster's
  // id reaches every player through `Actor.definitionId` (not stripped by `PlayerActor`'s Omit), so
  // it must be opaque - a name-derived one announces a creature before anyone meets it. Without this
  // branch a hand-written pack could import `hb-acererak-the-devourer-9f9f9f` for a monster, and
  // because that shape is a legal BUILDER id the generic rule below would wave it through.
  if (type === "monster" && !isOpaqueMonsterId(id)) return "must be an opaque monster id - a name-derived one reaches players through definitionId before the creature is revealed";
  if (id.length > HOMEBREW_ID_MAX_LENGTH) return `is ${id.length} characters; the persisted budget is ${HOMEBREW_ID_MAX_LENGTH}`;
  if (!SLUG_LEGAL.test(id)) return `must match ${SLUG_LEGAL} - lowercase letters, digits and hyphens only`;
  for (const suffix of RESERVED_SUFFIXES) {
    if (id.endsWith(suffix)) return `ends with the reserved catalog-choice family suffix "${suffix}"`;
  }
  if ((RESERVED_WORDS as readonly string[]).includes(id)) return "is a reserved catalog-choice slug";
  return null;
}

/**
 * The backstop for the campaign-bricking failure in constraint 2. A THROW, never a log: an id that
 * escapes this function is a corrupted campaign on the next restart, so failing the write is the
 * strictly better outcome.
 */
export function assertMintable(id: string, type: HomebrewContentType): string {
  const problem = homebrewIdProblem(id, type);
  if (problem) throw new Error(`Homebrew id "${id}" ${problem}.`);
  return id;
}

/** `hb-m-<12hex>` exactly - the opaque shape a monster id must have. */
function isOpaqueMonsterId(id: string): boolean {
  if (!id.startsWith(MONSTER_PREFIX)) return false;
  const rest = id.slice(MONSTER_PREFIX.length);
  return rest.length === 12 && HEX.test(rest);
}

/**
 * Does this id have the shape this module mints FOR THIS TYPE? Used by pack import to spot a foreign
 * `hb-` id that must be re-minted.
 *
 * The type is required rather than optional on purpose. This was type-blind, and a monster id that
 * merely looked like a builder id (`hb-<slug>-<6hex>`) was accepted as ours - so an imported pack
 * kept a name-derived monster id, publish never re-checked it, and `normalizeBody` then forced it
 * onto `source.externalId`, which reaches every player as `definitionId`. Making the argument
 * required means the compiler names every call site rather than leaving one silently wrong.
 */
export function isMintedHomebrewId(id: string, type: HomebrewContentType): boolean {
  if (!id.startsWith(HOMEBREW_ID_PREFIX) || id.length > HOMEBREW_ID_MAX_LENGTH || !SLUG_LEGAL.test(id)) return false;
  if (type === "monster") return isOpaqueMonsterId(id);
  // A builder id must not be a MONSTER ID either - one shape per type, both directions. The test is
  // the whole opaque shape, never the `hb-m-` prefix alone: a class named "M" mints
  // `hb-m-copy-60a055`, which wears the prefix and is perfectly ours. Reading the prefix as proof of
  // monsterhood made pack import call that id foreign, re-mint it into a fresh empty row, and leave
  // every subclass pointing at the id it just abandoned - reported as a collision that never
  // happened. The two shapes cannot overlap (a builder suffix is 6 or 8 hex, a monster's is 12), so
  // this is exact rather than a heuristic.
  if (isOpaqueMonsterId(id)) return false;
  const suffix = id.slice(id.lastIndexOf("-") + 1);
  return id.lastIndexOf("-") > HOMEBREW_ID_PREFIX.length - 1 && HEX.test(suffix) && (suffix.length === 6 || suffix.length === 8);
}

/**
 * Mint an id for a new record. `isTaken` must answer for EVERY homebrew row including soft-deleted
 * ones - re-minting into a soft-deleted id would resurrect a dead record's identity on any actor
 * that still names it.
 *
 * The budget arithmetic derives the slug length from the suffix length rather than hardcoding 50,
 * because the widened 8-hex retry would otherwise produce a 62-character id and trip constraint 2.
 */
export function mintHomebrewId(type: HomebrewContentType, name: string, isTaken: (id: string) => boolean): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    // Widen the random suffix after five collisions rather than looping forever on a wedged generator.
    const suffixLength = type === "monster" ? 12 : attempt < 5 ? 6 : 8;
    const candidate = type === "monster"
      ? `${MONSTER_PREFIX}${hex(suffixLength)}`
      : `${HOMEBREW_ID_PREFIX}${slugFor(type, name, HOMEBREW_ID_MAX_LENGTH - HOMEBREW_ID_PREFIX.length - 1 - suffixLength)}-${hex(suffixLength)}`;
    if (!isTaken(candidate)) return assertMintable(candidate, type);
  }
  throw new Error("Could not mint a unique homebrew id.");
}

/** The readable half of a builder-type id, with the type name as the fallback for an unsluggable name. */
function slugFor(type: HomebrewContentType, name: string, maxLength: number): string {
  return slugify(name, maxLength) || slugify(type, maxLength) || "record";
}
