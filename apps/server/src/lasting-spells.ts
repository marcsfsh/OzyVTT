import type { SpellReference } from "@vtt/content-srd-5.2.1";
import type { GameState } from "@vtt/domain";
import type { ActorAction } from "@vtt/schemas";
import { CONCENTRATING_TAG } from "./effects.js";
import { laterRowOf, upcastAction } from "./item-actions.js";

type Actor = GameState["actors"][number];
type LaterRow = NonNullable<NonNullable<SpellReference["effect"]>["laterActions"]>[number];

/**
 * A spell that lasts and lets its caster act again on later turns (Spiritual Weapon's attack, Produce Flame's hurl,
 * Call Lightning's bolt): while it is up, its caster carries an effect naming it and the level it was cast at (its
 * Concentration, or an effect of its own for a spell that needs none), and the later action is offered at that level.
 */

/** The level a spell is up at on its caster, or null when it isn't. A Concentration effect from before effects named
 *  their spell counts at the spell's own level. */
export function spellUpLevel(actor: Pick<Actor, "effects">, spell: Pick<SpellReference, "id" | "name" | "level">) {
  for (const effect of actor.effects) {
    if (effect.spell?.id === spell.id) return effect.spell.level;
    if (
      effect.spell === undefined &&
      effect.tags.includes(CONCENTRATING_TAG) &&
      effect.name === `Concentrating on ${spell.name}`
    )
      return spell.level;
  }
  return null;
}

/** The `turnUses` key a cast leaves on its caster's own turn, so what the spell offers "on your later turns" waits for
 *  the next one (Spiritual Weapon's attack, Heat Metal's heat). */
export const castThisTurnKey = (actorId: string, spellId: string) => `${actorId}:cast:${spellId}`;

/** A later action the caster takes itself (an action or a Bonus Action), which the spell must be up for. Moving a mark
 *  has its own check, and an area's trigger is no action. */
export function takenWhileUp(row: LaterRow): boolean {
  return row.movesGrant !== true && (row.activation === "action" || row.activation === "bonus-action");
}

/** A later action rolled at the level its spell was cast at (Spiritual Weapon from a level 3 spell slot hits for 2d8). */
export function atSpellUpLevel(action: ActorAction, spell: SpellReference, actor: Pick<Actor, "effects">): ActorAction {
  if (!laterRowOf(spell, action.id)) return action;
  const level = spellUpLevel(actor, spell);
  return level !== null && level > spell.level ? upcastAction(action, spell, level) : action;
}
