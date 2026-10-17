import type { GmActor, GmView, PendingDamage, PendingReaction, PendingRuleAsk, PendingSave } from "@vtt/domain";

/**
 * Every decision the GM owes, in one queue: a held attack waiting on a reaction, a saving throw, a player's hit to
 * apply, a dying creature, a rules question, initiative still to roll and a rest someone asked for. A prompt a
 * player answers on their own device is listed as waiting on them, with a way for the GM to answer it instead.
 */
export type NeedsItem =
  | Readonly<{ kind: "reaction"; key: string; reaction: PendingReaction; actor: GmActor; waiting: boolean }>
  | Readonly<{ kind: "save"; key: string; save: PendingSave; actor: GmActor; waiting: boolean }>
  | Readonly<{ kind: "damage"; key: string; proposal: PendingDamage }>
  | Readonly<{ kind: "dying"; key: string; actor: GmActor; ownTurn: boolean }>
  | Readonly<{ kind: "ask"; key: string; ask: PendingRuleAsk; actor: GmActor | undefined }>
  | Readonly<{ kind: "initiative"; key: string; actors: readonly GmActor[] }>
  | Readonly<{ kind: "rest"; key: string; actor: GmActor }>;

/** A player at the table answers for this character on their own device. */
export const answeredByPlayer = (actor: GmActor) => actor.kind === "player-character" && actor.ownerSessionId !== null;

/** A monster or NPC at 0 HP: out of the fight, and out of the next one unless the GM adds it back. */
export const isDefeatedMonster = (actor: Readonly<{ kind: string; hp: Readonly<{ current: number }> }>) =>
  actor.kind !== "player-character" && actor.hp.current <= 0;

/** Dying and still rolling: at 0 HP with death saves to make. */
export const isDying = (actor: GmActor) =>
  actor.hp.current <= 0 &&
  actor.deathSaves !== undefined &&
  actor.deathSaves !== null &&
  !actor.deathSaves.stable &&
  actor.deathSaves.failures < 3;

export function needsItems(state: GmView): NeedsItem[] {
  const byId = new Map(state.actors.map((actor) => [actor.id, actor]));
  const inFight = new Set(state.combat.initiative.map((entry) => entry.actorId));
  const items: NeedsItem[] = [];
  for (const reaction of state.combat.pendingReactions) {
    const actor = byId.get(reaction.actorId);
    if (actor) items.push({ kind: "reaction", key: reaction.id, reaction, actor, waiting: answeredByPlayer(actor) });
  }
  // A save the GM called for is answered from the call, on the Dice tab.
  for (const save of state.combat.pendingSaves) {
    const actor = byId.get(save.targetActorId);
    if (actor && save.callId === undefined)
      items.push({ kind: "save", key: save.id, save, actor, waiting: answeredByPlayer(actor) });
  }
  for (const proposal of state.combat.pendingDamage ?? []) items.push({ kind: "damage", key: proposal.id, proposal });
  if (state.combat.active)
    for (const actor of state.actors)
      if (inFight.has(actor.id) && isDying(actor))
        items.push({ kind: "dying", key: `dying:${actor.id}`, actor, ownTurn: state.combat.turnActorId === actor.id });
  for (const ask of state.combat.pendingRuleAsks ?? [])
    items.push({ kind: "ask", key: ask.id, ask, actor: byId.get(ask.actorId) });
  const rolling = (state.combat.pendingInitiative ?? []).flatMap((id) => byId.get(id) ?? []);
  if (state.combat.active && rolling.length > 0) items.push({ kind: "initiative", key: "initiative", actors: rolling });
  for (const id of state.rest?.requests ?? []) {
    const actor = byId.get(id);
    if (actor) items.push({ kind: "rest", key: `rest:${id}`, actor });
  }
  return items;
}

const ABILITIES: Readonly<Record<string, string>> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma"
};
export const abilityName = (ability: string) => ABILITIES[ability] ?? ability.toUpperCase();

/** The damage owed in words with its numbers: "9 fire", "12 slashing and 3 fire". */
export function damageWords(parts: ReadonlyArray<Readonly<{ amount: number; type: string }>>, total: number) {
  const typed = parts.filter((part) => part.amount > 0);
  if (typed.length === 0) return `${total}`;
  return typed.map((part) => `${part.amount} ${part.type.toLowerCase()}`).join(" and ");
}

/** The one line that names an item, for its card title and for announcing it. */
export function needsTitle(item: NeedsItem, state: GmView): string {
  switch (item.kind) {
    case "reaction":
      return item.waiting
        ? `Waiting on ${item.actor.name} · ${item.reaction.actionName}`
        : `${item.actor.name} may use ${item.reaction.actionName}`;
    case "save": {
      const what = `DC ${item.save.dc} ${abilityName(item.save.ability)} saving throw`;
      return item.waiting ? `Waiting on ${item.actor.name} · ${what}` : `${item.actor.name} makes a ${what}`;
    }
    case "damage":
      return `${item.proposal.sourceName}'s ${item.proposal.actionName} hit ${item.proposal.targetName}`;
    case "dying": {
      const saves = item.actor.deathSaves!;
      return `${item.actor.name} is dying · ${saves.successes} ${saves.successes === 1 ? "success" : "successes"} · ${saves.failures} ${saves.failures === 1 ? "failure" : "failures"}`;
    }
    case "ask":
      return `${item.actor?.name ?? "A player"} asks for your ruling`;
    case "initiative":
      return item.actors.length === 1
        ? `${item.actors[0].name} still rolls initiative`
        : `${item.actors.length} characters still roll initiative`;
    case "rest":
      return `${item.actor.name} asks for a Long Rest`;
  }
  void state;
}
