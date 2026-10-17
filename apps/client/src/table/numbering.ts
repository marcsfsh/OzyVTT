/**
 * Monsters of one kind carry a number on their token and in every list, read from their public names ("Goblin Warrior
 * 2"). An unnumbered one beside numbered kin ("Goblin Warrior") is the first. The names are already public to whoever
 * sees them, so the numbers reveal nothing new.
 */

type Named = Readonly<{ id: string; name: string; kind?: string }>;

const NUMBERED = /^(.*\S)\s+(\d{1,3})$/;

/** The kind and number a name gives: "Goblin Warrior 2" is kind "Goblin Warrior", number 2. */
export function splitNumber(name: string): Readonly<{ base: string; number: number | null }> {
  const match = NUMBERED.exec(name.trim());
  return match ? { base: match[1], number: Number(match[2]) } : { base: name.trim(), number: null };
}

/** Each creature's number among its kind, for those that share a kind with another creature in `creatures`. */
export function creatureNumbers(creatures: readonly Named[]): ReadonlyMap<string, number> {
  const kinds = new Map<string, Array<{ id: string; number: number | null }>>();
  for (const creature of creatures) {
    if (creature.kind === "player-character") continue;
    const { base, number } = splitNumber(creature.name);
    const key = base.toLowerCase();
    kinds.set(key, [...(kinds.get(key) ?? []), { id: creature.id, number }]);
  }
  const numbers = new Map<string, number>();
  for (const members of kinds.values()) {
    if (members.length < 2 && members.every((member) => member.number === null)) continue;
    for (const member of members)
      if (member.number !== null) numbers.set(member.id, member.number);
      else if (members.some((other) => other.number !== null)) numbers.set(member.id, 1);
  }
  return numbers;
}

/** The short label under a token, so neighbours' names don't run together: a character's first name, a monster's
 *  kind and number ("Goblin 2"), or its whole name when that is short. The full name stays in its accessible name. */
export function tokenLabel(creature: Named, number: number | undefined): string {
  const name = creature.name.trim();
  if (creature.kind === "player-character") return name.split(/\s+/)[0] ?? name;
  if (name.length <= 14) return name;
  const first = name.split(/\s+/)[0] ?? name;
  if (number !== undefined) return `${first} ${number}`;
  return `${name.slice(0, 13).trimEnd()}…`;
}
