import { randomUUID } from "node:crypto";
import type { HomebrewContentType } from "@vtt/api-contract";

/**
 * Homebrew id minting. Ids must be slug-legal, at most 60 characters (`ActorDefinitionSchema`'s cap: longer ids
 * break the next boot), and for monsters opaque (`hb-m-<12 hex>`), since `Actor.definitionId` reaches every
 * player. The `hb-` prefix is reserved, so a minted id never shadows SRD content.
 */

/** Every minted id starts with this. Reserved: no SRD bundle id may ever use it. */
export const HOMEBREW_ID_PREFIX = "hb-";
/** The persisted id budget (constraint 2 above). */
export const HOMEBREW_ID_MAX_LENGTH = 60;
/** Monsters get no slug (constraint 3); this is the whole non-random part of their id. */
const MONSTER_PREFIX = `${HOMEBREW_ID_PREFIX}m-`;

const SLUG_LEGAL = /^[a-z0-9-]+$/;
const HEX = /^[0-9a-f]+$/;
/** Combining marks, stripped after NFKD so an accented letter slugs to its plain form. */
const COMBINING_MARKS = new RegExp("[\\u0300-\\u036f]", "g");

/** `resolveCatalogChoice` dispatches on these suffixes and words, so a minted id must not end in or equal one. */
const RESERVED_SUFFIXES = ["-spells", "-subclasses", "-feats", "-lineages"] as const;
const RESERVED_WORDS = ["skills", "weapons"] as const;

/** Random hex from a v4 UUID's fully-random leading 12 nibbles (positions 12+ carry version/variant bits). */
function hex(length: number): string {
  return randomUUID().replace(/-/g, "").slice(0, length);
}

/** Lowercase, de-accent, hyphenate and truncate at a hyphen. Returns "" for a purely non-Latin name. */
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

/** Why an id is unmintable (completing `Homebrew id "x" ...`), or null. Shared by the minter and the publish gate. */
export function homebrewIdProblem(id: string, type: HomebrewContentType): string | null {
  if (!id.startsWith(HOMEBREW_ID_PREFIX)) return `must start with "${HOMEBREW_ID_PREFIX}"`;
  // Re-checked here: an imported pack could carry a name-derived monster id that passes the generic rules.
  if (type === "monster" && !isOpaqueMonsterId(id))
    return "must be an opaque monster id, because a name-derived one reaches players through definitionId before the creature is revealed";
  if (id.length > HOMEBREW_ID_MAX_LENGTH)
    return `is ${id.length} characters; the persisted budget is ${HOMEBREW_ID_MAX_LENGTH}`;
  if (!SLUG_LEGAL.test(id)) return `must match ${SLUG_LEGAL}: lowercase letters, digits and hyphens only`;
  for (const suffix of RESERVED_SUFFIXES) {
    if (id.endsWith(suffix)) return `ends with the reserved catalog-choice family suffix "${suffix}"`;
  }
  if ((RESERVED_WORDS as readonly string[]).includes(id)) return "is a reserved catalog-choice slug";
  return null;
}

/** Throws, since an id that escapes this is a campaign that will not load on restart. */
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

/** Whether this id has the shape minted for this type, so pack import can re-mint foreign or misshapen ids. */
export function isMintedHomebrewId(id: string, type: HomebrewContentType): boolean {
  if (!id.startsWith(HOMEBREW_ID_PREFIX) || id.length > HOMEBREW_ID_MAX_LENGTH || !SLUG_LEGAL.test(id)) return false;
  if (type === "monster") return isOpaqueMonsterId(id);
  // Test the whole opaque shape. The `hb-m-` prefix alone would match a class named "M" (`hb-m-copy-60a055`).
  if (isOpaqueMonsterId(id)) return false;
  const suffix = id.slice(id.lastIndexOf("-") + 1);
  return (
    id.lastIndexOf("-") > HOMEBREW_ID_PREFIX.length - 1 &&
    HEX.test(suffix) &&
    (suffix.length === 6 || suffix.length === 8)
  );
}

/** `isTaken` must include soft-deleted rows, or a dead record's identity could be reused. Slug length fits the suffix. */
export function mintHomebrewId(type: HomebrewContentType, name: string, isTaken: (id: string) => boolean): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    // Widen the random suffix after five collisions, so a wedged generator can't loop forever.
    const suffixLength = type === "monster" ? 12 : attempt < 5 ? 6 : 8;
    const candidate =
      type === "monster"
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
