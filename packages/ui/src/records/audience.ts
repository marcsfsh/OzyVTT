/**
 * Who sees a record or a part of one, in the record surfaces' words: Hidden (the GM only), Everyone, or chosen
 * party characters. One copy of the words, so a Codex block, a field, an objective, a homebrew record and a list
 * row all say the same thing.
 */

export type AudienceKind = "hidden" | "everyone" | "characters";

/** A block's or an objective's audience. `characterIds` is non-empty exactly when `audience` is `characters`. */
export type Audience = Readonly<{ audience: AudienceKind; characterIds: readonly string[] }>;

export type PartyCharacter = Readonly<{ id: string; name: string }>;

export const HIDDEN: Audience = { audience: "hidden", characterIds: [] };
export const EVERYONE: Audience = { audience: "everyone", characterIds: [] };

/** The names of the chosen characters, in the party's order; an id the party no longer has is left out. */
export function characterNames(characterIds: readonly string[], party: readonly PartyCharacter[]): string[] {
  return party.filter((character) => characterIds.includes(character.id)).map((character) => character.name);
}

/** "Lyra Emberwise", "Lyra Emberwise and Borin Stoneguard", or "3 characters". */
export function namesLabel(names: readonly string[]): string {
  if (names.length === 0) return "No character";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.length} characters`;
}

/** The short word an audience control shows: Everyone, Hidden, or who it is shown to. */
export function audienceLabel(value: Audience, party: readonly PartyCharacter[]): string {
  if (value.audience === "everyone") return "Everyone";
  if (value.audience === "hidden") return "Hidden";
  return namesLabel(characterNames(value.characterIds, party));
}

/** What a revealed thing says: "Revealed to everyone" or "Revealed to Lyra Emberwise". Hidden says "Hidden". */
export function revealedLabel(value: Audience, party: readonly PartyCharacter[]): string {
  if (value.audience === "hidden") return "Hidden";
  if (value.audience === "everyone") return "Revealed to everyone";
  return `Revealed to ${namesLabel(characterNames(value.characterIds, party))}`;
}

/** Toggles one character in an audience: adding the first makes it theirs, removing the last hides it again. */
export function toggleCharacter(value: Audience, characterId: string): Audience {
  const current = value.audience === "characters" ? value.characterIds : [];
  const next = current.includes(characterId) ? current.filter((id) => id !== characterId) : [...current, characterId];
  return next.length === 0 ? HIDDEN : { audience: "characters", characterIds: next };
}

/** A reveal stamp as a line: "Since Emberfall 14, session 6". Parts the stamp lacks are left out. */
export function sinceLabel(
  stamp: Readonly<{ inWorldLabel: string | null; sessionNumber: number | null; at: string }> | null | undefined
): string | null {
  if (!stamp) return null;
  const parts = [stamp.inWorldLabel, stamp.sessionNumber !== null ? `session ${stamp.sessionNumber}` : null].filter(
    (part): part is string => Boolean(part)
  );
  if (parts.length === 0) {
    const day = new Date(stamp.at);
    if (Number.isNaN(day.getTime())) return null;
    return `Since ${day.toLocaleDateString(undefined, { month: "long", day: "numeric" })}`;
  }
  return `Since ${parts.join(", ")}`;
}
