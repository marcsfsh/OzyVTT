import type { PlayerActor, PlayerPendingReaction, PlayerPendingSave, PlayerView } from "@vtt/domain";

/**
 * What a player must answer, in the order it matters: their dying character's death save at the start of its turn,
 * a reaction an attack is waiting on (never one of a character that can't react), a saving throw, and initiative to
 * roll. The GM's calls for a roll join them
 * from `useRollCallCards`. Each one takes the table's single prompt slot in turn.
 */
export type PlayerPrompt =
  | Readonly<{ kind: "reaction"; key: string; reaction: PlayerPendingReaction; actor: PlayerActor }>
  | Readonly<{ kind: "death-save"; key: string; actor: PlayerActor }>
  | Readonly<{ kind: "save"; key: string; save: PlayerPendingSave; actor: PlayerActor }>
  | Readonly<{ kind: "initiative"; key: string; actor: PlayerActor }>;

export const ownCharacters = (state: PlayerView) =>
  state.actors.filter((actor) => actor.claimStatus === "mine" && actor.kind === "player-character");

/** A character at 0 HP still making death saves. */
export const isDying = (actor: PlayerActor) =>
  actor.hp.kind === "exact" &&
  actor.hp.current <= 0 &&
  actor.deathSaves !== undefined &&
  actor.deathSaves !== null &&
  !actor.deathSaves.stable &&
  actor.deathSaves.failures < 3;

/** The death save this turn still owes: the player's dying character's own turn, before its save is made. */
export const owesDeathSave = (state: PlayerView, actor: PlayerActor) =>
  state.combat.active &&
  state.combat.turnActorId === actor.id &&
  isDying(actor) &&
  state.combat.turn.deathSaveRolled !== true;

export function playerPrompts(state: PlayerView): PlayerPrompt[] {
  const mine = ownCharacters(state);
  const byId = new Map(mine.map((actor) => [actor.id, actor]));
  // A save the GM called for is answered on the call's card.
  const called = new Set(
    state.rollCalls.flatMap((call) => call.entries.flatMap((entry) => (entry.saveId ? [entry.saveId] : [])))
  );
  const prompts: PlayerPrompt[] = [];
  for (const actor of mine)
    if (owesDeathSave(state, actor)) prompts.push({ kind: "death-save", key: `death:${actor.id}`, actor });
  // A character at 0 HP can't take a reaction; the server withdraws such a prompt, and the slot never shows one.
  for (const reaction of state.combat.pendingReactions) {
    const actor = byId.get(reaction.actorId);
    if (actor && !(actor.hp.kind === "exact" && actor.hp.current <= 0))
      prompts.push({ kind: "reaction", key: reaction.id, reaction, actor });
  }
  for (const save of state.combat.pendingSaves) {
    const actor = byId.get(save.targetActorId);
    if (actor && !called.has(save.id)) prompts.push({ kind: "save", key: save.id, save, actor });
  }
  for (const actorId of state.combat.pendingInitiative ?? []) {
    const actor = byId.get(actorId);
    if (actor) prompts.push({ kind: "initiative", key: `initiative:${actorId}`, actor });
  }
  return prompts;
}
