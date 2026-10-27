import { headingOf, headingWords } from "../compelled-moves.js";
import { CommandRejectedError } from "../game-store.js";
import type { ResolveContext } from "./context.js";

/**
 * SRD 5.2.1 Compulsion: "For the duration, you can take a Bonus Action to designate a direction that is horizontal to
 * you. Each Charmed target must use as much of its movement as possible to move in that direction on its next turn".
 * The direction picked (`optionId`, a compass point) binds each creature the caster's spell compels, for its next turn
 * (`compelled-moves.ts`), after which it repeats the save.
 */
export function designateHeading(ctx: ResolveContext): void {
  const { action, attacker, input, state } = ctx;
  if (!action.setsHeading || input.commit === false) return;
  const heading = headingOf(input.optionId ?? "north");
  if (heading === null) throw new CommandRejectedError(`${action.name} names a compass direction.`);
  const bound: string[] = [];
  for (const actor of state.actors) {
    let named = false;
    actor.effects = actor.effects.map((effect) => {
      if (
        effect.sourceActorId !== attacker.id ||
        effect.spell?.id !== action.spellId ||
        effect.compelled?.way !== "heading"
      )
        return effect;
      named = true;
      return { ...effect, compelled: { ...effect.compelled, heading } };
    });
    if (named) bound.push(actor.id);
  }
  ctx.tableNarration.push({
    kind: "effect",
    text:
      bound.length > 0
        ? `${attacker.name} names ${headingWords(heading)}: each creature ${action.name.replace(/:.*$/, "")} holds must use as much of its movement as possible to move ${headingWords(heading)} on its next turn, then saves again.`
        : `${attacker.name} names ${headingWords(heading)}, but no creature is held by the spell.`,
    actorIds: [attacker.id, ...bound]
  });
}
