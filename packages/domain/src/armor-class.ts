/**
 * The AC an attack meets: the stored AC plus what live effects add (Shield's +5 until the caster's next turn, Shield of
 * Faith's +2), and never below a floor an effect sets (Barkskin: "an Armor Class of 17 if its AC is lower than that").
 * Stored AC is re-derived only when equipment changes, so a short-lived bonus is added here instead, and the attack roll
 * and every sheet that shows AC read this one sum. Effects sharing a `stackKey` are one game effect (SRD Combining Game
 * Effects), so they add their largest bonus once.
 */
export function armorClassInPlay(
  actor: Readonly<{
    armorClass?: number;
    effects?: ReadonlyArray<
      Readonly<{
        armorClassBonus?: number;
        armorClassFloor?: number;
        stackKey?: string;
        spell?: unknown;
        tags?: readonly string[];
      }>
    >;
  }>
): number | undefined {
  if (actor.armorClass === undefined) return undefined;
  let bonus = 0;
  let floor = 0;
  const stacked = new Map<string, number>();
  // In an Antimagic Field an ongoing spell's bonus is suppressed (Shield of Faith, Barkskin).
  const antimagic = (actor.effects ?? []).some((effect) => effect.tags?.includes("antimagic"));
  for (const effect of actor.effects ?? []) {
    if (antimagic && effect.spell !== undefined && !effect.tags?.includes("antimagic")) continue;
    floor = Math.max(floor, effect.armorClassFloor ?? 0);
    const amount = effect.armorClassBonus ?? 0;
    if (effect.stackKey === undefined) bonus += amount;
    else stacked.set(effect.stackKey, Math.max(stacked.get(effect.stackKey) ?? amount, amount));
  }
  for (const amount of stacked.values()) bonus += amount;
  return Math.max(floor, actor.armorClass + bonus);
}
