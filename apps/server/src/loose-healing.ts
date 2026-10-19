import type { SpellReference } from "@vtt/content-srd-5.2.1";
import { isDead, type ActionResolution, type GameState } from "@vtt/domain";
import { rollDice } from "@vtt/rules-5e";
import type { ActorAction } from "@vtt/schemas";
import { GameAccessDeniedError, type Initiator } from "./authorization.js";
import { CommandRejectedError } from "./game-store.js";
import { endEffect } from "./effects.js";
import { deadCantHealLine, healActor } from "./hit-points.js";
import { healingShares } from "./resolution/heal.js";
import { useCostOf } from "./use-cost.js";

type Actor = GameState["actors"][number];

/**
 * Healing outside a fight (a potion after the battle, Cure Wounds on the road, Second Wind, Lay on Hands): it lands on
 * the creatures the user picks, through the same hit point path a fight's healing takes, so the dead stay dead and an
 * Unconscious creature wakes. Damage outside a fight stays the GM's.
 */

/** Whether a player may heal this creature: their own character, or another member of the party (a player character
 *  the table can see, still on the roster). */
export function partyMember(target: Actor | undefined, sessionId: string): boolean {
  if (!target) return false;
  if (target.ownerSessionId === sessionId) return true;
  return (
    target.kind === "player-character" &&
    target.visibility === "public" &&
    !target.archived &&
    target.replaySceneId === undefined
  );
}

/** How many creatures one use heals: the spell's count at this slot, every creature picked for a pool divided among
 *  them (Preserve Life), else one. */
export function healLimit(
  action: ActorAction,
  spell: SpellReference | undefined,
  castLevel: number | undefined
): number {
  if (action.healing?.divided) return 20;
  const targets = spell?.effect?.targets;
  if (!spell || !targets) return 1;
  return targets.count + (targets.perSlot ?? 0) * Math.max(0, (castLevel ?? spell.level) - spell.level);
}

/**
 * The creatures a heal outside a fight lands on: its user for a self heal (Second Wind), else those picked, its user
 * when none are. Refused before anything is spent when a player picks a creature outside the party, when too many are
 * picked, or when every one is dead (SRD "Dead").
 */
export function looseHealTargets(
  state: GameState,
  user: Actor,
  action: ActorAction,
  requested: readonly string[] | undefined,
  initiator: Initiator,
  spell: SpellReference | undefined,
  castLevel: number | undefined
): Actor[] {
  const ids = action.healing?.self
    ? [user.id]
    : requested && requested.length > 0
      ? [...new Set(requested)]
      : [user.id];
  const limit = action.healing?.self ? 1 : healLimit(action, spell, castLevel);
  if (ids.length > limit)
    throw new CommandRejectedError(
      `${action.name} heals ${limit === 1 ? "one creature" : `up to ${limit} creatures`}; ${ids.length} were picked.`
    );
  const targets = ids.map((id) => {
    const target = state.actors.find((candidate) => candidate.id === id);
    // Never named: a hidden creature's existence isn't a player's to learn.
    if (!target || (initiator.role === "player" && !partyMember(target, initiator.sessionId)))
      throw new GameAccessDeniedError("You can heal your own character or another member of the party.");
    return target;
  });
  if (targets.every((target) => isDead(target)))
    throw new CommandRejectedError(targets.map((target) => deadCantHealLine(target.name)).join(" "));
  return targets;
}

/** A heal outside a fight lands: the roll the tap made (`rolled`), or the formula once for each use spent (Lay on
 *  Hands' points), shared as the action divides it. Returns a line for each creature, for the table's feed. */
export function applyLooseHealing(
  state: GameState,
  action: ActorAction,
  targets: readonly Actor[],
  rolled: number | null,
  rollDie: (sides: number) => number
): Readonly<{ lines: Array<Readonly<{ text: string; actorId: string }>>; healing: ActionResolution["healing"] }> {
  const healing = action.healing;
  if (!healing) return { lines: [], healing: null };
  let total = rolled ?? 0;
  if (rolled === null)
    for (let use = 0; use < (healing.perUse ? useCostOf(action) : 1); use += 1)
      total += rollDice(healing.formula, rollDie).total;
  const shares = healingShares(targets, Math.max(0, total), healing);
  // Who regained what, for the reply to the one who used it: the same lines the table reads in the feed.
  const regainedBy: Array<Readonly<{ targetId: string; targetName: string; regained: number }>> = [];
  const lines = targets.flatMap((target, index) => {
    if (isDead(target)) return [{ text: deadCantHealLine(target.name), actorId: target.id }];
    const before = target.hp.current;
    // The use is already authorized; the heal lands on whoever it was given to.
    const events = healActor(state, target.id, shares[index], { role: "gm" });
    const regained = target.hp.current - before;
    regainedBy.push({ targetId: target.id, targetName: target.name, regained });
    // "The wound closes ... after a spell restores Hit Points to the target," in a fight or out of one.
    if (action.spellId !== undefined && regained > 0)
      for (const effect of target.effects.filter((candidate) => candidate.endsOnSpellHealing))
        events.push(...endEffect(state, target.id, effect.id));
    return [
      {
        text: `${target.name} regains ${regained} ${regained === 1 ? "hit point" : "hit points"} (${action.name}).`,
        actorId: target.id
      },
      ...events.map((event) => ({ text: event.text, actorId: event.actorId }))
    ];
  });
  return { lines, healing: { total: Math.max(0, total), targets: regainedBy } };
}
