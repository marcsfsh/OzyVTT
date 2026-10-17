import type { GameState } from "@vtt/domain";
import type { Actor, ActorDefinition } from "@vtt/schemas";
import { pactSlotMaximum, spellSlotMaxima } from "./actor-roster.js";
import { deriveEquipment, type EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError } from "./game-store.js";

type ResolveDefinition = (definitionId: string) => ActorDefinition | undefined;

/** Sets the remaining slots for one level, clamped to 0..max. Covers spending and restoring (Arcane
 *  Recovery); the caller computes the target. Rejects if the actor has no pool at that level. `pact` names the
 *  Pact Magic pool; without it, the spell slots. */
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
      throw new CommandRejectedError(`${actor.name} has no level ${level} Pact Magic slots.`);
    const definition = actor.definitionId ? resolveDefinition(actor.definitionId) : undefined;
    const max = pactSlotMaximum(definition)?.max ?? actor.pactSlots.remaining;
    actor.pactSlots = { ...actor.pactSlots, remaining: Math.max(0, Math.min(max, remaining)) };
    return;
  }
  const slot = actor.spellSlots?.find((entry) => entry.level === level);
  if (!slot) throw new CommandRejectedError(`${actor.name} has no level ${level} spell slots.`);
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

/** SRD Spell Preparation by Class: the classes that change their prepared spells when they finish a Long Rest, and
 *  how many (null: any). Bards, Sorcerers and Warlocks change theirs on gaining a level, through the level flow. */
export const LONG_REST_PREPARATION: Readonly<Record<string, number | null>> = {
  cleric: null,
  druid: null,
  wizard: null,
  paladin: 1,
  ranger: 1
};

/** Opens the prepare step a Long Rest gives a caster that changes its prepared spells then. */
export function openPreparation(actor: Actor, definition: ActorDefinition | undefined): void {
  const classIds = (definition?.spellcasting?.classes ?? []).map((entry) => entry.classId);
  const rules = classIds.filter((id) => id in LONG_REST_PREPARATION).map((id) => LONG_REST_PREPARATION[id]!);
  if (rules.length === 0) return;
  actor.preparation = {
    changesLeft: rules.some((rule) => rule === null) ? null : rules.reduce((sum, rule) => sum + rule!, 0)
  };
}

/** How many level 1+ spells a class may have prepared: the sheet's composed cap, or what the build itself prepared
 *  when that is more (a feature's picks that the build doesn't charge to the cap); null when it states none. */
function preparedCap(definition: ActorDefinition, classId: string | undefined): number | null {
  const classes = definition.spellcasting?.classes ?? [];
  const entry = classes.length === 1 ? classes[0] : classes.find((candidate) => candidate.classId === classId);
  if (entry?.prepared === undefined) return null;
  const built = chargeable(definition, classId).filter((spell) => spell.prepared).length;
  return Math.max(entry.prepared, built);
}

/** The level 1+ spells of a class that count toward its prepared list (always-prepared ones don't). */
const chargeable = (definition: ActorDefinition, classId: string | undefined) =>
  (definition.spellcasting?.spells ?? []).filter(
    (spell) =>
      spell.level > 0 &&
      !spell.alwaysPrepared &&
      (classId === undefined || spell.classId === undefined || spell.classId === classId)
  );

/** Prepare or un-prepare a known spell on the actor's live prepared set. Validated against the definition's known
 *  list and its prepared cap; cantrips and always-prepared spells can't be toggled. A player changes the list only
 *  in the prepare step a Long Rest opens (SRD), by at most what it allows, and never mid-fight; the GM may
 *  change it any time. */
export function setPreparedSpell(
  state: GameState,
  actorId: string,
  spellId: string,
  prepared: boolean,
  resolveDefinition: ResolveDefinition,
  role: "gm" | "player" = "gm"
): void {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  const definition = actor.definitionId ? resolveDefinition(actor.definitionId) : undefined;
  const spell = definition?.spellcasting?.spells.find((entry) => entry.id === spellId);
  if (!definition || !spell) throw new CommandRejectedError("That spell is not on this character's list.");
  if (spell.level === 0) throw new CommandRejectedError("Cantrips are always available.");
  if (spell.alwaysPrepared && !prepared) throw new CommandRejectedError(`${spell.name} is always prepared.`);
  const has = actor.preparedSpellIds.includes(spellId);
  if (prepared === has) return;
  if (role === "player") {
    if (state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actorId))
      throw new CommandRejectedError("Prepared spells change after a Long Rest, outside a fight.");
    if (actor.preparation === null)
      throw new CommandRejectedError("You change your prepared spells when you finish a Long Rest.");
    if (prepared && actor.preparation.changesLeft === 0)
      throw new CommandRejectedError("You've changed as many prepared spells as this Long Rest allows.");
  }
  if (prepared) {
    const cap = preparedCap(definition, spell.classId);
    const charged = chargeable(definition, spell.classId).filter((entry) =>
      actor.preparedSpellIds.includes(entry.id)
    ).length;
    if (cap !== null && charged >= cap)
      throw new CommandRejectedError(`${actor.name} can prepare ${cap} spells. Unprepare one first.`);
    actor.preparedSpellIds = [...actor.preparedSpellIds, spellId];
    if (role === "player" && actor.preparation?.changesLeft != null)
      actor.preparation = { changesLeft: actor.preparation.changesLeft - 1 };
  } else actor.preparedSpellIds = actor.preparedSpellIds.filter((id) => id !== spellId);
}

/** Closes the prepare step: the prepared list stands until the next Long Rest. */
export function finishPreparing(state: GameState, actorId: string): void {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  actor.preparation = null;
}
