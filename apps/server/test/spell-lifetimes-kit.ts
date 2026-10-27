import type { GameState } from "@vtt/domain";
import type { ActorAction } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveInput } from "../src/action-resolution.js";
import { endEncounterEffects } from "../src/effects.js";
import { endEncounter } from "../src/encounter.js";
import { laterSpellAction, spellCastMechanics } from "../src/item-actions.js";
import { answerSave, type SaveAnswerDependencies } from "../src/saving-throws.js";
import { build, catalog, fight, FOE, HERO, view, wizardInput, type Fight } from "./spell-casters.js";

/**
 * A Wizard 5 in a fight with two foes and an ally, given a spell slot of every level, who casts any SRD spell by its
 * cast model (the numbers a caster's sheet would carry: attack +7, DC 15, modifier +3), so the tests of what spells
 * leave behind and how long it lasts need no caster of the spell's own level.
 */

const built = build(wizardInput(["hold-person", "mage-armor", "haste"]));

let commands = 0;
export const nextCommand = () => `60000000-0000-4000-8000-${String((commands += 1)).padStart(12, "0")}`;

/** The Wizard in a fight, with three slots of every level. */
export function caster(options: Parameters<typeof fight>[1] = {}): Fight {
  const table = fight(wizard, { ally: true, ...options });
  table.hero.spellSlots = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((level) => ({ level, max: 3, remaining: 3 }));
  return table;
}

const NUMBERS = { attackBonus: 7, saveDc: 15, bearersDc: false, modifier: 3 } as const;

/** The Wizard's sheet, with Faithful Hound's cast on it so its bite is the sheet's to take while the hound is up. */
export const wizard = { ...built, actions: [...built.actions, castAction("faithful-hound")] };

/** A spell's cast action, as a sheet mints it. */
export function castAction(spellId: string): ActorAction {
  const spell = view.spellRecord(spellId)!;
  return {
    id: `spell-${spellId}`,
    name: spell.name,
    activation: "action",
    description: spell.description,
    ...spellCastMechanics(spell, NUMBERS),
    ...(spell.level > 0 ? { spellSlot: { level: spell.level } } : {}),
    spellId
  } as ActorAction;
}

/** A spell's later action (Faithful Hound's bite), as a sheet mints it. */
export function laterAction(spellId: string, rowName: string): ActorAction {
  const spell = view.spellRecord(spellId)!;
  const row = spell.effect!.laterActions!.find((entry) => entry.name === rowName)!;
  return laterSpellAction(spell, row, NUMBERS);
}

const deps = (state: GameState, actorId: string, faces: number[]) => ({
  random: () => faces.shift() ?? 3,
  newRollId: () => crypto.randomUUID(),
  gmSessionId: "30000000-0000-4000-8000-00000000000a",
  now: () => "2026-10-18T00:00:00.000Z",
  ...(actorId === HERO ? { definition: wizard } : {}),
  catalog,
  resolveDefinition: (definitionId: string) => state.definitions.find((entry) => entry.id === definitionId)?.definition
});

/** Resolves `action` for `actorId` (the Wizard by default) against the foe unless the input names targets. */
export function resolveAs(
  table: Fight,
  action: ActorAction,
  input: Partial<ResolveInput> = {},
  faces: number[] = [],
  actorId: string = HERO
) {
  return resolveDefinitionAction(
    table.state,
    action,
    { actorId, targetIds: [FOE], commandId: nextCommand(), ...input },
    deps(table.state, actorId, faces)
  );
}

/** Casts a spell from the Wizard, at `slotLevel` when given. */
export const cast = (
  table: Fight,
  spellId: string,
  input: Partial<ResolveInput> = {},
  faces: number[] = []
): ReturnType<typeof resolveDefinitionAction> => resolveAs(table, castAction(spellId), input, faces);

/** Answers the save `targetId` owes, its d20 showing `face`. */
export function answer(state: GameState, targetId: string, face: number) {
  const pending = state.combat.pendingSaves.find((entry) => entry.targetActorId === targetId)!;
  const saveDeps: SaveAnswerDependencies = {
    random: () => face,
    newRollId: () => crypto.randomUUID(),
    sessionId: "30000000-0000-4000-8000-00000000000a",
    role: "gm",
    now: () => "2026-10-18T00:00:00.000Z",
    resolveDefinition: (definitionId) => state.definitions.find((entry) => entry.id === definitionId)?.definition,
    catalog
  };
  return answerSave(state, nextCommand(), pending.id, "roll", undefined, true, { role: "gm" }, saveDeps);
}

/** Ends the fight as `encounter.end` does: its turn-measured effects first, then the combat. */
export function endFight(state: GameState): void {
  endEncounterEffects(
    state,
    state.combat.initiative.map((entry) => entry.actorId)
  );
  endEncounter(state);
}

export const actorOf = (state: GameState, id: string) => state.actors.find((actor) => actor.id === id)!;
export const effectNames = (state: GameState, id: string) => actorOf(state, id).effects.map((effect) => effect.name);
