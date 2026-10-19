import { ALIVE_AT_ZERO_TAG, type Actor, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { CANT_SPEAK_TAG, makeEffect, type EffectNarration } from "../effects.js";
import type { EquipmentCatalog } from "../equipment-derivation.js";
import { sightRules } from "../vision/rules.js";
import { takeForm } from "./assume.js";
import { formRecord } from "./options.js";

/** What a form taken at 0 Hit Points reads: stat blocks, the catalog, and the map's light. */
export type AtZeroDeps = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  distanceFeet?: (actorIdA: string, actorIdB: string) => number | null;
}>;

/** The tag a lycanthrope's curse leaves, followed by the stat block the cursed creature becomes. */
const LYCANTHROPY_PREFIX = "lycanthropy-";

/** Whether the creature stands in sunlight, as the map's light says (with dynamic vision off, the GM's call). */
export function inSunlight(state: GameState, actor: Actor, deps: AtZeroDeps): boolean {
  const content = { definition: deps.resolveDefinition, ...(deps.catalog ? { catalog: deps.catalog } : {}) };
  return sightRules(state, content, deps.distanceFeet).lightAt(actor.id)?.sunlight === true;
}

/**
 * The printed form a stat block's Shape-Shift takes at 0 Hit Points (a vampire's Misty Escape: "the vampire uses
 * Shape-Shift to become mist"), taken as its form with the tags the escape gives (alive at 0, no actions, no speech) and
 * for the hours its Shape-Shift says: "it must reach its resting place within 2 hours or be destroyed", so the form's
 * end leaves it dead, and Hit Points regained at its resting place end it first. False when its stat block prints no
 * such form.
 */
export function escapeIntoForm(
  state: GameState,
  actor: Actor,
  definition: ActorDefinition | undefined,
  deps: AtZeroDeps,
  escape: Readonly<{ id: string; name: string; tags: readonly string[] }>,
  events: EffectNarration[]
): boolean {
  const action = (definition?.actions ?? []).find((entry) => entry.shapeShift?.escapesAtZero);
  const shift = action?.shapeShift;
  const printed = shift?.printed?.find((entry) => entry.id === shift.escapesAtZero?.form);
  if (!action || !shift?.escapesAtZero || !printed) return false;
  const form = formRecord(shift, { name: printed.name, printed }, {});
  const effect = makeEffect({
    id: escape.id,
    name: escape.name,
    tags: [...new Set([ALIVE_AT_ZERO_TAG, ...escape.tags, ...(form.noSpeech ? [CANT_SPEAK_TAG] : [])])],
    sourceActorId: actor.id,
    sourceName: actor.name,
    sourceActionId: action.id,
    startedRound: state.combat.round,
    duration: { type: "minutes", remaining: shift.escapesAtZero.hours * 60 },
    form,
    modifiers: structuredClone(printed.modifiers)
  });
  events.push(...takeForm(state, actor.id, effect, deps));
  return true;
}

/**
 * A lycanthrope's curse: "If the cursed target drops to 0 Hit Points, it instead becomes a Werewolf under the DM's
 * control and has 10 Hit Points." The creature takes that stat block as a form with nothing of its own kept, until the
 * GM ends it (Remove Curse, or the story). Who controls it is the GM's to run. True when the curse held it up.
 */
export function lycanthropyAtZero(
  state: GameState,
  actor: Actor,
  deps: AtZeroDeps,
  events: EffectNarration[]
): boolean {
  const curse = actor.effects.find((effect) => effect.tags.some((tag) => tag.startsWith(LYCANTHROPY_PREFIX)));
  const statBlockId = curse?.tags.find((tag) => tag.startsWith(LYCANTHROPY_PREFIX))?.slice(LYCANTHROPY_PREFIX.length);
  const statBlock = statBlockId ? deps.resolveDefinition(statBlockId) : undefined;
  if (!curse || !statBlockId || !statBlock) return false;
  actor.hp = { ...actor.hp, current: Math.min(actor.hp.maximum, 10) };
  const effect = makeEffect({
    id: `${curse.id}:turned`,
    name: `Lycanthropy (${statBlock.name})`.slice(0, 120),
    sourceActorId: curse.sourceActorId,
    sourceName: curse.sourceName,
    sourceActionId: curse.sourceActionId,
    startedRound: state.combat.round,
    duration: { type: "manual" },
    form: { name: statBlock.name, statBlockId, keeps: [], gear: "worn" }
  });
  events.push(...takeForm(state, actor.id, effect, deps));
  events.push({
    kind: "condition",
    text: `${actor.name} doesn't drop: the curse turns it into a ${statBlock.name} with ${actor.hp.current} Hit Points, under the GM's control.`,
    actorId: actor.id
  });
  return true;
}
