import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { pactSlotMaximum, spellSlotMaxima } from "./actor-roster.js";
import { deriveEquipment, type EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError } from "./game-store.js";

type ResolveDefinition = (definitionId: string) => ActorDefinition | undefined;

/** Sets the remaining slots for one level, clamped to 0..max. Covers spending and restoring (Arcane
 *  Recovery); the caller computes the target. Rejects if the actor has no pool at that level. `pact` names the
 *  Pact Magic pool instead of the spell slots. */
export function setSpellSlotRemaining(
  state: GameState,
  actorId: string,
  level: number,
  remaining: number,
  resolveDefinition: ResolveDefinition,
  catalog?: EquipmentCatalog,
  pact = false
): void {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  if (pact) {
    if (actor.pactSlots?.level !== level)
      throw new CommandRejectedError(`${actor.name} has no level-${level} Pact Magic slots.`);
    const definition = actor.definitionId ? resolveDefinition(actor.definitionId) : undefined;
    const max = pactSlotMaximum(definition)?.max ?? actor.pactSlots.remaining;
    actor.pactSlots = { ...actor.pactSlots, remaining: Math.max(0, Math.min(max, remaining)) };
    return;
  }
  const slot = actor.spellSlots?.find((entry) => entry.level === level);
  if (!slot) throw new CommandRejectedError(`${actor.name} has no level-${level} spell slots.`);
  const definition = actor.definitionId ? resolveDefinition(actor.definitionId) : undefined;
  // The same maxima seeding and the long rest use, so derived multiclass tables aren't clamped down.
  const max =
    spellSlotMaxima(definition, deriveEquipment(actor, definition, catalog).spellSlots).find(
      (entry) => entry.level === level
    )?.max ?? slot.remaining;
  const clamped = Math.max(0, Math.min(max, remaining));
  actor.spellSlots = actor.spellSlots!.map((entry) =>
    entry.level === level ? { ...entry, remaining: clamped } : entry
  );
}

/** Prepare or un-prepare a known spell on the actor's live prepared set. Validated against the
 *  definition's known list; cantrips and always-prepared spells can't be toggled. */
export function setPreparedSpell(
  state: GameState,
  actorId: string,
  spellId: string,
  prepared: boolean,
  resolveDefinition: ResolveDefinition
): void {
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
