import type { GameState } from "@vtt/domain";
import { addEffect, endEffect, makeEffect } from "../effects.js";
import { CommandRejectedError } from "../game-store.js";
import { COMMANDED_TAG } from "../summons.js";
import { tableLineOf, type ResolveContext } from "./context.js";

/**
 * What a vessel holds (SRD 5.2.1 Iron Flask): "the target must succeed on a DC 17 Wisdom saving throw or be trapped in
 * the flask ... The flask can hold only one creature at a time ... You can take a Magic action to remove the flask's
 * stopper and release the creature in the flask. The creature then obeys your commands for 1 hour". The trapping save's
 * failure is an `off-plane` effect tagged as the vessel's (`holds.tag`), sourced on its user; releasing it ends that
 * effect, brings the creature back beside its user (`off-plane.ts`), and puts it under its user's command.
 */

type Actor = GameState["actors"][number];

/** The creatures `userId` holds by an effect tagged `tag`, with that effect. */
function heldBy(state: GameState, userId: string, tag: string) {
  return state.actors.flatMap((actor: Actor) => {
    const effect = actor.effects.find(
      (candidate) => candidate.tags.includes(tag) && candidate.sourceActorId === userId
    );
    return effect ? [{ actor, effect }] : [];
  });
}

/** A full vessel is refused before anything is spent. */
export function checkHolding(ctx: ResolveContext): void {
  const holds = ctx.action.holds;
  if (!holds || ctx.input.commit === false) return;
  if (heldBy(ctx.state, ctx.attacker.id, holds.tag).length >= holds.capacity)
    throw new CommandRejectedError(
      `${ctx.action.name} already holds ${holds.capacity === 1 ? "a creature" : `${holds.capacity} creatures`}.`
    );
}

/** Frees what its user holds; false when the action releases nothing. */
export function releaseHeld(ctx: ResolveContext): boolean {
  const release = ctx.action.releases;
  if (!release || ctx.input.commit === false) return false;
  const { state, attacker, input } = ctx;
  const held = heldBy(state, attacker.id, release.tag);
  if (held.length === 0) throw new CommandRejectedError(`${ctx.action.name} holds no creature to release.`);
  for (const { actor, effect } of held) {
    // It comes back beside its user, not where it was trapped.
    state.combat = {
      ...state.combat,
      offPlane: state.combat.offPlane.map((entry) =>
        entry.actorId === actor.id
          ? (({ altitudeFeet: _height, airborne: _airborne, ...rest }) => ({ ...rest, besideActorId: attacker.id }))(
              entry
            )
          : entry
      )
    };
    for (const event of endEffect(state, actor.id, effect.id)) ctx.tableNarration.push(tableLineOf(ctx, event));
    if (release.commandMinutes !== undefined)
      addEffect(
        state,
        actor.id,
        makeEffect({
          id: `${input.commandId}:released:${actor.id}`,
          name: `Obeys ${attacker.name}`,
          tags: [COMMANDED_TAG],
          sourceActorId: attacker.id,
          sourceName: attacker.name,
          sourceActionId: ctx.action.id,
          startedRound: state.combat.round,
          duration:
            release.commandMinutes <= 10
              ? { type: "rounds", remaining: release.commandMinutes * 10 }
              : { type: "minutes", remaining: release.commandMinutes }
        })
      );
    ctx.tableNarration.push(
      tableLineOf(ctx, {
        kind: "effect",
        text: `${attacker.name} releases ${actor.name}${release.commandMinutes !== undefined ? `, which obeys ${attacker.name} for ${release.commandMinutes} minutes` : ""}.`,
        actorId: actor.id
      })
    );
  }
  return true;
}
