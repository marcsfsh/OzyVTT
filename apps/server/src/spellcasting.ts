import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { CommandRejectedError } from "./game-store.js";

type ResolveDefinition = (definitionId: string) => ActorDefinition | undefined;

/**
 * Set the remaining spell slots for one level, clamped to 0..max (the definition's maximum). Covers
 * both spending (remaining-1) and restoring (remaining+1 / Arcane Recovery) - the caller computes the
 * target value. Rejects if the actor has no pool at that level.
 */
export function setSpellSlotRemaining(state: GameState, actorId: string, level: number, remaining: number, resolveDefinition: ResolveDefinition): void {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  const slot = actor.spellSlots?.find((entry) => entry.level === level);
  if (!slot) throw new CommandRejectedError(`${actor.name} has no level-${level} spell slots.`);
  const definition = actor.definitionId ? resolveDefinition(actor.definitionId) : undefined;
  const max = definition?.spellcasting?.slots.find((entry) => entry.level === level)?.max ?? slot.remaining;
  const clamped = Math.max(0, Math.min(max, remaining));
  actor.spellSlots = actor.spellSlots!.map((entry) => entry.level === level ? { ...entry, remaining: clamped } : entry);
}

/**
 * Prepare or un-prepare a known spell on the actor's live prepared set. Validated against the
 * definition's known list; cantrips and always-prepared spells can't be toggled.
 */
export function setPreparedSpell(state: GameState, actorId: string, spellId: string, prepared: boolean, resolveDefinition: ResolveDefinition): void {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  const definition = actor.definitionId ? resolveDefinition(actor.definitionId) : undefined;
  const spell = definition?.spellcasting?.spells.find((entry) => entry.id === spellId);
  if (!spell) throw new CommandRejectedError("That spell is not on this character's list.");
  if (spell.level === 0) throw new CommandRejectedError("Cantrips are always available.");
  if (spell.alwaysPrepared && !prepared) throw new CommandRejectedError(`${spell.name} is always prepared.`);
  const has = actor.preparedSpellIds.includes(spellId);
  if (prepared && !has) actor.preparedSpellIds = [...actor.preparedSpellIds, spellId];
  else if (!prepared && has) actor.preparedSpellIds = actor.preparedSpellIds.filter((id) => id !== spellId);
}
