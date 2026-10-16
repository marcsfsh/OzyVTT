import { isDead, type GmActor, type PlayerActor } from "@vtt/domain";

/** The shared "dead" rule over what this viewer received: the GM's exact hit points, or a player's view, where only
 *  their own character's are exact and anyone else is a health band ("down" is 0). */
export function isDeadOnSheet(actor: GmActor | PlayerActor): boolean {
  const hp = actor.hp;
  const current = "kind" in hp ? (hp.kind === "exact" ? hp.current : hp.band === "down" ? 0 : 1) : hp.current;
  return isDead({ kind: actor.kind, hp: { current }, deathSaves: actor.deathSaves, conditions: actor.conditions });
}
