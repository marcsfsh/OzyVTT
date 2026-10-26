import type { GameState } from "@vtt/domain";
import type { ActorDefinition, TraitMechanic } from "@vtt/schemas";
import { SRD_SKILL_ABILITY } from "@vtt/content-srd-5.2.1/schemas";
import { CommandRejectedError } from "./game-store.js";
import type { DefinitionAction } from "./resolution/context.js";

/**
 * The choices a stat block leaves to the GM for each creature (SRD 5.2.1): a half-dragon's Draconic Origin ("one of the
 * following damage types (DM's choice)") and a commoner's Training ("proficiency in one skill of the DM's choice"). The
 * GM picks one for a creature in its row tools (`actor.set-pick`), the creature keeps it (`Actor.statBlockPicks`), and
 * the rules read it: a damage part with that `pick` deals the chosen type, and a trained skill is proficient and rolled
 * with Advantage (`ability-checks.ts`).
 */

type Actor = GameState["actors"][number];
export type StatBlockPick = Extract<TraitMechanic, { kind: "pick" }>;

/** The picks a stat block prints. */
export function picksOf(definition: ActorDefinition | undefined): StatBlockPick[] {
  return (definition?.traitMechanics ?? []).filter((mechanic): mechanic is StatBlockPick => mechanic.kind === "pick");
}

/** What a pick may be: its printed options, or any SRD skill for a skill pick that names none. */
export function pickOptionsOf(pick: StatBlockPick): readonly string[] {
  return pick.options ?? (pick.of === "skill" ? Object.keys(SRD_SKILL_ABILITY) : []);
}

/** The action with each picked part's damage type the creature's pick; refused when the creature has none yet. */
export function withPickedDamageTypes(
  action: DefinitionAction,
  actor: Pick<Actor, "name" | "statBlockPicks">,
  definition: ActorDefinition | undefined
): DefinitionAction {
  if (!action.damage.some((part) => part.pick !== undefined)) return action;
  return {
    ...action,
    damage: action.damage.map((part) => {
      if (part.pick === undefined) return part;
      const picked = actor.statBlockPicks?.[part.pick];
      if (picked === undefined) {
        const name = picksOf(definition).find((pick) => pick.key === part.pick)?.name ?? part.pick;
        throw new CommandRejectedError(
          `Choose ${actor.name}'s ${name} in its row tools first: ${action.name} deals the damage type it names.`
        );
      }
      return { ...part, type: picked };
    })
  };
}

/** The skill a creature's Training made it proficient in, with Advantage on its checks; null without one. */
export function trainedSkillOf(
  actor: Pick<Actor, "statBlockPicks">,
  definition: ActorDefinition | undefined
): string | null {
  const training = picksOf(definition).find((pick) => pick.of === "skill" && pick.skillAdvantage === true);
  return training ? (actor.statBlockPicks?.[training.key] ?? null) : null;
}

/** Records the GM's pick for a creature, checked against what its stat block lets the pick be; null clears it. */
export function setStatBlockPick(
  actor: Actor,
  definition: ActorDefinition | undefined,
  key: string,
  value: string | null
): StatBlockPick {
  const pick = picksOf(definition).find((candidate) => candidate.key === key);
  if (!pick) throw new CommandRejectedError(`${actor.name}'s stat block leaves no such choice.`);
  if (value !== null && !pickOptionsOf(pick).includes(value))
    throw new CommandRejectedError(`${pick.name} can't be ${value} for ${actor.name}.`);
  const { [key]: _previous, ...rest } = actor.statBlockPicks ?? {};
  const picks = value === null ? rest : { ...rest, [key]: value };
  if (Object.keys(picks).length > 0) actor.statBlockPicks = picks;
  else delete actor.statBlockPicks;
  return pick;
}
