import { ALIVE_AT_ZERO_TAG, type Actor, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { CANT_SPEAK_TAG, makeEffect, type EffectNarration } from "../effects.js";
import { effectNameOf } from "../effect-names.js";
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

/** An id one per creature per turn, as the troll's hold at 0 Hit Points has. */
const turnKey = (state: GameState, actor: Actor) =>
  `${actor.id}:${state.combat.round}:${state.combat.turnActorId ?? "none"}`;

/**
 * A vampire's Misty Escape: "If the vampire drops to 0 Hit Points outside its resting place, the vampire uses
 * Shape-Shift to become mist (no action required). If it can't use Shape-Shift, it is destroyed. While it has 0 Hit
 * Points in mist form, it can't return to its vampire form, and it must reach its resting place within 2 hours or be
 * destroyed." The mist form's effect keeps it alive at 0 Hit Points while it lasts; when it ends, the creature is
 * dead. Reaching the resting place, its Paralyzed condition and the Hit Point it regains are the GM's. True when it
 * escaped.
 */
export function escapeAtZero(
  state: GameState,
  actor: Actor,
  definition: ActorDefinition | undefined,
  deps: AtZeroDeps,
  events: EffectNarration[]
): boolean {
  const action = (definition?.actions ?? []).find((entry) => entry.shapeShift?.escapesAtZero);
  const shift = action?.shapeShift;
  const escape = shift?.escapesAtZero;
  const printed = shift?.printed?.find((entry) => entry.id === escape?.form);
  if (!action || !shift || !escape || !printed) return false;
  if (shift.notInSunlight && inSunlight(state, actor, deps)) {
    events.push({
      kind: "condition",
      text: `${actor.name} can't shape-shift in sunlight, so it is destroyed.`,
      actorId: actor.id
    });
    return false;
  }
  const form = formRecord(shift, { name: printed.name, printed }, {});
  const effect = makeEffect({
    id: `${turnKey(state, actor)}:escape-at-zero`,
    name: `${effectNameOf(action.name)} (${printed.name})`.slice(0, 120),
    tags: [ALIVE_AT_ZERO_TAG, ...(form.noSpeech ? [CANT_SPEAK_TAG] : [])],
    sourceActorId: actor.id,
    sourceName: actor.name,
    sourceActionId: action.id,
    startedRound: state.combat.round,
    duration: { type: "minutes", remaining: escape.hours * 60 },
    form,
    modifiers: structuredClone(printed.modifiers)
  });
  events.push(...takeForm(state, actor.id, effect, deps));
  events.push({
    kind: "condition",
    text: `${actor.name} drops to 0 HP and turns to ${printed.name.toLowerCase()} with no action. It can't change form at 0 HP, and it is destroyed unless it reaches its resting place within ${escape.hours} hours.`,
    actorId: actor.id
  });
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
