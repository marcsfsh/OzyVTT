import type { SpellReference } from "@vtt/content-srd-5.2.1";
import type { GameState } from "@vtt/domain";
import type { ActorAction } from "@vtt/schemas";
import { altitudeOf, setAltitude } from "./altitude.js";
import { CONCENTRATING_TAG } from "./effects.js";
import { laterRowOf, upcastAction } from "./item-actions.js";

type Actor = GameState["actors"][number];
type LaterRow = NonNullable<NonNullable<SpellReference["effect"]>["laterActions"]>[number];

/**
 * A spell that lasts and lets its caster act again on later turns (Spiritual Weapon's attack, Produce Flame's hurl,
 * Call Lightning's bolt): while it is up, its caster carries an effect naming it and the level it was cast at (its
 * Concentration, or an effect of its own for a spell that needs none), and the later action is offered at that level.
 */

/** The level a spell is up at on its caster, or null when it isn't: an effect of the spell the actor itself is the
 *  source of (another caster's spell on it is that caster's). A Concentration effect from before effects named their
 *  spell counts at the spell's own level. */
export function spellUpLevel(
  actor: Pick<Actor, "id" | "effects">,
  spell: Pick<SpellReference, "id" | "name" | "level">
) {
  for (const effect of actor.effects) {
    if (effect.spell?.id === spell.id && (effect.sourceActorId ?? actor.id) === actor.id) return effect.spell.level;
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

/** A later action that is there only while the spell is up: the caster's own (an action or a Bonus Action), and what
 *  the spell does by itself (Faithful Hound's bite, a zone's save), which the GM may also run by hand. Moving a mark has
 *  its own check. */
export function takenWhileUp(row: LaterRow): boolean {
  return row.movesGrant !== true;
}

/** A later action rolled at the level its spell was cast at (Spiritual Weapon from a level 3 spell slot hits for 2d8). */
export function atSpellUpLevel(
  action: ActorAction,
  spell: SpellReference,
  actor: Pick<Actor, "id" | "effects">
): ActorAction {
  if (!laterRowOf(spell, action.id)) return action;
  const level = spellUpLevel(actor, spell);
  return level !== null && level > spell.level ? upcastAction(action, spell, level) : action;
}

/** The `turnUses` key the cast's own free use of a later action spends (Arcane Hand: "When you cast the spell ... you
 *  can move the hand up to 60 feet and then cause one of the following effects"). */
export const withCastKey = (actorId: string, spellId: string) => `${actorId}:with-cast:${spellId}`;

/** Whether this later action comes with the cast at no further cost: a `withCast` row, on its caster's turn, the turn it
 *  cast the spell, before the cast's free use is spent. */
export function takenWithCast(
  state: Pick<GameState, "combat">,
  actorId: string,
  spell: SpellReference,
  actionId: string
): boolean {
  if (!laterRowOf(spell, actionId)?.withCast || state.combat.turnActorId !== actorId) return false;
  const uses = state.combat.turn.turnUses;
  return (uses[castThisTurnKey(actorId, spell.id)] ?? 0) > 0 && (uses[withCastKey(actorId, spell.id)] ?? 0) === 0;
}

/** Whether a creature bears an effect of this caster's spell, for a later action that takes only such a creature
 *  (`bearerOnly`: Arcane Hand's crush, Phantasmal Force's harm). */
export function bearsCastOf(target: Pick<Actor, "effects">, casterId: string, spellId: string): boolean {
  return target.effects.some((effect) => effect.spell?.id === spellId && effect.sourceActorId === casterId);
}

/** The tag a levitation's effect carries (`falling.ts` lowers its creature gently when it ends). */
const LEVITATING = "levitating";

/** The creature this caster's levitation holds up (Levitate's target), if any. */
export function levitatedBy(state: Pick<GameState, "actors">, casterId: string): Actor | undefined {
  return state.actors.find((actor) =>
    actor.effects.some((effect) => effect.tags.includes(LEVITATING) && effect.sourceActorId === casterId)
  );
}

/** SRD 5.2.1 Levitate: "You can change the target's altitude by up to 20 feet in either direction on your turn." The
 *  creature the caster's levitation holds rises or sinks, never below the ground, still held by the levitation. Null
 *  when no levitation of the caster's holds a creature on the map. */
export function liftLevitated(
  state: GameState,
  casterId: string,
  feet: number
): Readonly<{ actorId: string; name: string; from: number; to: number }> | null {
  const held = levitatedBy(state, casterId);
  const token = held ? state.combat.tokens.find((candidate) => candidate.actorId === held.id) : undefined;
  if (!held || !token?.position) return null;
  const from = altitudeOf(token);
  const to = Math.max(0, from + feet);
  setAltitude(state, held.id, to, "levitate");
  return { actorId: held.id, name: held.name, from, to };
}
