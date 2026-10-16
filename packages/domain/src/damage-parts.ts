/**
 * The typed damage a resolved action owes, shared so the server's apply, the player's proposal and the GM's Apply
 * button all land the number the card shows. A penalty belongs to the damage of its own type (a cursed blade's -2
 * comes off the blade's slashing), so amounts merge by type and each type floors at 0 (SRD "it's possible to deal
 * 0 damage but not negative damage"); a weak roll of one type never eats another type's damage.
 */
export function owedDamageParts(
  resolution: Readonly<{
    damage: ReadonlyArray<Readonly<{ total: number; type: string }>>;
    bonusDamage?: ReadonlyArray<Readonly<{ amount: number; type: string }>>;
  }>
): Array<{ amount: number; type: string }> {
  const byType = new Map<string, number>();
  const add = (type: string, amount: number) => byType.set(type, (byType.get(type) ?? 0) + amount);
  for (const part of resolution.damage) add(part.type, part.total);
  for (const part of resolution.bonusDamage ?? []) add(part.type, part.amount);
  return [...byType.entries()].filter(([, amount]) => amount > 0).map(([type, amount]) => ({ amount, type }));
}

/** The total `owedDamageParts` comes to: what a resolution's card shows and its Apply lands. */
export function owedDamageTotal(resolution: Parameters<typeof owedDamageParts>[0]): number {
  return owedDamageParts(resolution).reduce((sum, part) => sum + part.amount, 0);
}
