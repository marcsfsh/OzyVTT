import { CommandRejectedError } from "../game-store.js";
import { makeEffect } from "../effects.js";
import { rollSaveAtOnce } from "../saving-throws.js";
import type { ResolveContext } from "./context.js";

/** The tag on the marker a failed save against a ward leaves on the creature it turned away, for the rest of its turn. */
const TURNED_AWAY_TAG = "turned-away";

/**
 * SRD Sanctuary: "Any creature who targets the warded creature with an attack roll or a damaging spell must succeed on
 * a Wisdom saving throw or either choose a new target or lose the attack or spell. This spell doesn't protect the
 * warded creature from areas of effect." The server rolls the save before anything else of the action; a failure spends
 * nothing and turns the creature away, so it picks another target or lets the attack go, and that creature is refused
 * against the warded one for the rest of the turn. Returns true when the action stops here.
 */
export function turnedAwayByWard(ctx: ResolveContext): boolean {
  const { state, action, attacker, targets, input, deps } = ctx;
  const harmful = action.attack !== undefined || (action.spellId !== undefined && action.damage.length > 0);
  if (!harmful || input.areaPlaced === true || action.area !== undefined || !deps.resolveDefinition) return false;
  for (const target of targets) {
    if (target.id === attacker.id) continue;
    const warding = target.effects.find((effect) => effect.ward !== undefined);
    if (!warding) continue;
    if (attacker.effects.some((effect) => effect.tags.includes(TURNED_AWAY_TAG) && effect.sourceActorId === target.id))
      throw new CommandRejectedError(
        `${attacker.name} was turned away from ${target.name} by ${warding.name} this turn. Choose another target.`
      );
    const ward = warding.ward!;
    const save = rollSaveAtOnce(state, attacker, ward.ability, {
      resolveDefinition: deps.resolveDefinition,
      ...(deps.catalog ? { catalog: deps.catalog } : {}),
      rollDie: deps.random,
      magical: true
    });
    const line = `${attacker.name} targets ${target.name}, warded by ${warding.name}: DC ${ward.dc} ${ward.ability.toUpperCase()} save, ${save.total} (d20 ${save.natural})`;
    if (save.total >= ward.dc) {
      ctx.tableNarration.push({ kind: "effect", text: `${line}, a success.`, actorIds: [attacker.id, target.id] });
      continue;
    }
    ctx.tableNarration.push({
      kind: "effect",
      text: `${line}, a failure: it chooses a new target or loses the ${action.spellId !== undefined ? "spell" : "attack"}.`,
      actorIds: [attacker.id, target.id]
    });
    attacker.effects = [
      ...attacker.effects,
      makeEffect({
        id: `${input.commandId}:turned-away:${target.id}`,
        name: `Turned away from ${target.name}`.slice(0, 120),
        tags: [TURNED_AWAY_TAG],
        sourceActorId: target.id,
        sourceName: target.name,
        startedRound: state.combat.round,
        duration: { type: "until-bearer-turn-end", skipsCurrentTurn: false }
      })
    ].slice(0, 20);
    return true;
  }
  return false;
}
