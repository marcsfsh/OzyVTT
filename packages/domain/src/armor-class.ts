/**
 * The AC an attack meets: the stored AC plus what live reaction effects add (Shield's +5 until the caster's next
 * turn). Stored AC is re-derived only when equipment changes, so a short-lived bonus is added here instead, and the
 * attack roll and every sheet that shows AC read this one sum.
 */
export function armorClassInPlay(
  actor: Readonly<{
    armorClass?: number;
    effects?: ReadonlyArray<Readonly<{ armorClassBonus?: number }>>;
  }>
): number | undefined {
  if (actor.armorClass === undefined) return undefined;
  return actor.armorClass + (actor.effects ?? []).reduce((sum, effect) => sum + (effect.armorClassBonus ?? 0), 0);
}
