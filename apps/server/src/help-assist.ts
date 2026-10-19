import type { Actor, GameState, HeldRoll } from "@vtt/domain";
import type { CheckSubject } from "./ability-checks.js";
import { endEffectIfPresent, makeEffect, type EffectNarration } from "./effects.js";

// SRD Help, Assist an Ability Check: "That ally has Advantage on the next ability check they make with the chosen
// skill or tool. This benefit expires if the ally doesn't use it before the start of your next turn." The effect on
// the ally carries the Advantage as a check rider narrowed to the skill, or a tag naming the tool (no rider narrows to
// a tool); the ally's next check with it uses it up.

/** The tag on the effect Help with a Check leaves on the ally. */
export const HELPED_TAG = "helped";

/** Marks a Help whose check was rolled: a reroll of that check still has it, and the next check ends it. */
const HELP_USED_TAG = "help-used";

/** The tag naming the tool a Help assists. */
const HELP_TOOL_PREFIX = "help-tool-";
export const helpToolTag = (tool: string) => `${HELP_TOOL_PREFIX}${tool}`;

/** The skills and the tool a Help effect assists, read from its rider and its tags. */
function helpedSkills(effect: Actor["effects"][number]): readonly string[] {
  return [
    ...effect.modifiers.flatMap((modifier) =>
      modifier.type === "roll-mode" && modifier.roll === "check"
        ? (modifier.when ?? []).flatMap((when) => (when.type === "skill-is" ? when.skills : []))
        : []
    ),
    ...effect.tags.filter((tag) => tag.startsWith(HELP_TOOL_PREFIX)).map((tag) => tag.slice(HELP_TOOL_PREFIX.length))
  ];
}

/** The Help an ally gave this creature for a check with `tool`, which gives the check Advantage. */
export function toolHelp(actor: Actor, tool: string): Actor["effects"][number] | undefined {
  return actor.effects.find(
    (effect) =>
      effect.tags.includes(HELPED_TAG) &&
      !effect.tags.includes(HELP_USED_TAG) &&
      effect.tags.includes(helpToolTag(tool))
  );
}

/** Before a fresh check: a Help already used on an earlier one ends. */
export function endUsedHelp(state: GameState, actor: Actor): EffectNarration[] {
  return actor.effects
    .filter((effect) => effect.tags.includes(HELPED_TAG) && effect.tags.includes(HELP_USED_TAG))
    .flatMap((effect) => endEffectIfPresent(state, actor.id, effect.id));
}

/** After a fresh check with a skill or a tool: the Help for it is used. With `end`, it ends now (a check nothing
 *  rerolls); otherwise it stays marked until the creature's next check. */
export function useHelp(state: GameState, actor: Actor, subject: CheckSubject, end = false): EffectNarration[] {
  const used = [subject.skill, subject.tool].filter((id): id is string => id !== undefined);
  if (used.length === 0) return [];
  const events: EffectNarration[] = [];
  for (const effect of [...actor.effects]) {
    if (!effect.tags.includes(HELPED_TAG) || effect.tags.includes(HELP_USED_TAG)) continue;
    if (!helpedSkills(effect).some((id) => used.includes(id))) continue;
    if (end) events.push(...endEffectIfPresent(state, actor.id, effect.id));
    else
      actor.effects = actor.effects.map((candidate) =>
        candidate.id === effect.id ? { ...candidate, tags: [...candidate.tags, HELP_USED_TAG].slice(0, 8) } : candidate
      );
  }
  return events;
}

/** The tag on the effect Cobbler's Tools' modified footwear leaves on its wearer. */
export const FOOTWEAR_TAG = "modified-footwear";

/**
 * SRD Cobbler's Tools: "Modify footwear to give Advantage on the wearer's next Dexterity (Acrobatics) check (DC 10)".
 * While the use's check succeeds its wearer holds the Advantage, used up by its next Acrobatics check as Help is; a
 * reroll or an answer that turns the check settles it again.
 */
export function settleUseOutcome(
  state: GameState,
  roller: Actor,
  outcome: NonNullable<NonNullable<HeldRoll["check"]>["onSuccess"]>,
  success: boolean
): EffectNarration[] {
  const wearer = state.actors.find((actor) => actor.id === outcome.actorId);
  if (!wearer) return [];
  const id = `footwear-${roller.id}`;
  const held = wearer.effects.find((effect) => effect.id === id);
  if (held && !success) return endEffectIfPresent(state, wearer.id, id);
  if (held || !success) return [];
  wearer.effects = [
    ...wearer.effects,
    makeEffect({
      id,
      name: "Modified footwear",
      duration: { type: "manual" },
      tags: [HELPED_TAG, FOOTWEAR_TAG],
      sourceActorId: roller.id,
      sourceName: roller.name,
      startedRound: state.combat.round,
      modifiers: [
        {
          type: "roll-mode",
          roll: "check",
          mode: "advantage",
          when: [
            { type: "on-ability-check" },
            { type: "ability-is", abilities: ["dex"] },
            { type: "skill-is", skills: ["acrobatics"] }
          ]
        }
      ]
    })
  ];
  return [
    {
      kind: "effect",
      text: `${wearer.name}'s next Dexterity (Acrobatics) check has Advantage from the footwear ${roller.name} modified.`,
      actorId: wearer.id
    }
  ];
}
