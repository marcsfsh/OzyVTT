import { isDead, type GameState } from "@vtt/domain";
import type { ActorDefinition, DamageDrain } from "@vtt/schemas";
import { addActorFromDefinition, importActorDefinition } from "./actor-roster.js";
import { sideOf } from "./creature-sides.js";
import { addEffect, endEffect, makeEffect, type EffectNarration } from "./effects.js";
import { removeCombatant } from "./encounter.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { creatureTypeOf } from "./statblock-facts.js";

/**
 * A creature a rule brings into the fight from a stat block (SRD Finger of Death's Zombie, a wraith's Specter, a
 * troll's severed limb): it joins the roster on its maker's side, stands in `at`'s space, and takes its turn right
 * after `after`'s. A maker on the party's side makes a friendly copy of the stat block, since a monster otherwise
 * fights against the party. The GM runs it.
 */

export type RaiseDeps = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  newId: () => string;
}>;

export function raiseCreature(
  state: GameState,
  input: Readonly<{
    monsterId: string;
    /** The creature whose side it fights on. */
    maker: GameState["actors"][number];
    /** Where it appears: this creature's token's space. */
    at: GameState["actors"][number];
    /** It acts right after this creature's turn. */
    after: string;
    visibility?: "public" | "gm-only";
  }>,
  deps: RaiseDeps
): Readonly<{ actorId: string; name: string }> | null {
  const printed = deps.resolveDefinition(input.monsterId);
  if (!printed || printed.schemaId !== "vtt.actor-monster") return null;
  const id = deps.newId();
  const visibility = input.visibility ?? input.maker.visibility;
  const party = sideOf(input.maker, deps.resolveDefinition) === "party";
  if (party)
    importActorDefinition(
      state,
      { ...printed, token: { ...printed.token, disposition: "friendly" } },
      id,
      visibility,
      deps.catalog
    );
  else addActorFromDefinition(state, printed, id, visibility, deps.catalog);
  const actor = state.actors.find((candidate) => candidate.id === id)!;
  if (state.combat.active) {
    const reference = state.combat.tokens.find((token) => token.actorId === input.at.id);
    const index = state.combat.initiative.findIndex((entry) => entry.actorId === input.after);
    const before = index >= 0 ? state.combat.initiative[index]! : null;
    const entry = {
      actorId: id,
      score: before?.score ?? 0,
      tieBreaker: Math.max(-1000, (before?.tieBreaker ?? 0) - 1)
    };
    const initiative = [...state.combat.initiative];
    initiative.splice(index >= 0 ? index + 1 : initiative.length, 0, entry);
    state.combat = {
      ...state.combat,
      initiative,
      tokens: [
        ...state.combat.tokens,
        {
          actorId: id,
          position: reference?.position ? { ...reference.position } : null,
          sizePx: reference ? (reference.sizePx / reference.sizeCells) * (actor.sizeCells ?? 1) : 48,
          gridSizePx: reference?.gridSizePx ?? null,
          gridRotationRadians: reference?.gridRotationRadians ?? null,
          sizeCells: actor.sizeCells ?? 1
        }
      ]
    };
  }
  // Whose orders it follows, which counts it among what its maker controls.
  addEffect(
    state,
    id,
    makeEffect({
      id: `${id}:${RAISED_TAG}`,
      name: `Under ${input.maker.name}'s control`.slice(0, 120),
      tags: [RAISED_TAG],
      sourceActorId: input.maker.id,
      sourceName: input.maker.name,
      startedRound: state.combat.round,
      duration: { type: "manual" }
    })
  );
  return { actorId: id, name: actor.name };
}

/** The tag on a creature a rule raised, its maker its source. */
export const RAISED_TAG = "raised";

/** How many living creatures raised as `monsterId` follow `makerId`'s orders. */
export function raisedBy(state: GameState, makerId: string, monsterId: string): number {
  return state.actors.filter(
    (actor) =>
      !isDead(actor) &&
      actor.effects.some((effect) => effect.tags.includes(RAISED_TAG) && effect.sourceActorId === makerId) &&
      (actor.definitionId === monsterId ||
        state.definitions.find((entry) => entry.id === actor.definitionId)?.definition.source.externalId === monsterId)
  ).length;
}

/** The tag on a corpse that rises as the monster it names at the start of its killer's next turn. */
const RISING_PREFIX = "rises-as-";

/**
 * Finger of Death: "A Humanoid killed by this spell rises at the start of your next turn as a Zombie ... that follows
 * your verbal orders." A creature of the named types that the damage killed is marked on its corpse, and its killer's
 * next turn raises it (`riseAtTurnStart`).
 */
export function markRising(
  state: GameState,
  corpse: GameState["actors"][number],
  definition: ActorDefinition | undefined,
  rise: NonNullable<DamageDrain["slainRise"]>,
  killerId: string | null | undefined
): EffectNarration[] {
  const killer = killerId ? state.actors.find((candidate) => candidate.id === killerId) : undefined;
  if (!killer || !state.combat.active) return [];
  const type = creatureTypeOf(corpse, definition);
  if (rise.creatureTypes && (type === null || !rise.creatureTypes.includes(type))) return [];
  const monster = rise.monsterId.replace(/-/g, " ");
  addEffect(
    state,
    corpse.id,
    makeEffect({
      id: `${corpse.id}:${RISING_PREFIX}${rise.monsterId}`,
      name: `Rises as a ${monster}`,
      tags: [`${RISING_PREFIX}${rise.monsterId}`],
      sourceActorId: killer.id,
      sourceName: killer.name,
      startedRound: state.combat.round,
      duration: { type: "manual" }
    })
  );
  return [
    {
      kind: "effect",
      text: `${corpse.name} will rise as a ${monster} at the start of ${killer.name}'s next turn.`,
      actorId: corpse.id
    }
  ];
}

/** At the start of `actorId`'s turn, each corpse it marked to rise does: the creature stands in the corpse's space on
 *  its side, and the corpse leaves the fight. */
export function riseAtTurnStart(state: GameState, actorId: string, deps: RaiseDeps): EffectNarration[] {
  const events: EffectNarration[] = [];
  const maker = state.actors.find((candidate) => candidate.id === actorId);
  if (!maker || !state.combat.active) return events;
  for (const corpse of [...state.actors]) {
    const mark = corpse.effects.find(
      (effect) => effect.sourceActorId === actorId && effect.tags.some((tag) => tag.startsWith(RISING_PREFIX))
    );
    if (!mark) continue;
    events.push(...endEffect(state, corpse.id, mark.id));
    if (!isDead(corpse)) continue;
    const monsterId = mark.tags.find((tag) => tag.startsWith(RISING_PREFIX))!.slice(RISING_PREFIX.length);
    let raised: ReturnType<typeof raiseCreature>;
    try {
      raised = raiseCreature(state, { monsterId, maker, at: corpse, after: maker.id }, deps);
    } catch {
      // A full roster leaves it to the GM.
      raised = null;
    }
    if (!raised) {
      events.push({
        kind: "effect",
        text: `${corpse.name} rises as a ${monsterId.replace(/-/g, " ")} under ${maker.name}'s orders. Add it to the fight.`,
        actorId: corpse.id,
        gmOnly: true
      });
      continue;
    }
    events.push({
      kind: "effect",
      text: `${corpse.name} rises as ${raised.name}, which follows ${maker.name}'s orders.`,
      actorId: raised.actorId
    });
    if (state.combat.initiative.some((entry) => entry.actorId === corpse.id) && state.combat.turnActorId !== corpse.id)
      events.push(...removeCombatant(state, corpse.id, deps.resolveDefinition));
  }
  return events;
}
