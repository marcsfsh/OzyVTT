import type { GameState } from "@vtt/domain";

/** Notes Fire damage landing on a creature, for each flammable area (Web) to see as the command settles whether it
 *  stood in it (`zone-fire.ts`). Kept apart so the damage path needs nothing of the zones. */
export function noteFire(
  state: GameState,
  actorId: string,
  parts: ReadonlyArray<Readonly<{ amount: number; type: string }>>
): void {
  if (!state.combat.spellZones.some((zone) => zone.flammable)) return;
  if (!parts.some((part) => part.amount > 0 && part.type.trim().toLowerCase() === "fire")) return;
  const token = state.combat.tokens.find((candidate) => candidate.actorId === actorId && candidate.position !== null);
  if (!token) return;
  for (const zone of state.combat.spellZones)
    if (zone.flammable)
      zone.fireAt = [...(zone.fireAt ?? []), { ...token.position!, sizeCells: token.sizeCells }].slice(-50);
}
