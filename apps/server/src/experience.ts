import type { GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { experienceForLevel, levelForExperience } from "@vtt/rules-5e";
import { CommandRejectedError } from "./game-store.js";
import { statblockFacts } from "./statblock-facts.js";

/**
 * SRD 5.2.1 Experience Points: "Characters earn Experience Points (XP), which are awarded by the Game Master. When a
 * character's XP total crosses certain thresholds, the character's level increases." The GM awards XP; each character
 * keeps its total, which starts at the least XP its level needs ("You begin with the minimum amount of XP required to
 * reach your starting level"). Reaching the next level's threshold offers the level up; the GM may level a character
 * without XP too, as a table that levels by milestone does.
 */

export type ExperienceAward = Readonly<{
  /** The player characters who share the award. */
  recipientIds: readonly string[];
  /** What each recipient gains besides the creatures' share; negative takes XP back. */
  amount: number;
  /** Creatures overcome: their stat blocks' XP, shared evenly among the recipients. */
  defeatedIds: readonly string[];
  /** Of those, the ones fought in their lair, whose XP is their lair XP. */
  inLairIds: readonly string[];
}>;

export type ExperienceOutcome = Readonly<{
  /** What each recipient gained in all. */
  each: number;
  /** The creatures' XP before it was shared. */
  creatures: number;
  /** The recipients whose total now reaches a level above their own, with that level. */
  ready: ReadonlyArray<Readonly<{ actorId: string; name: string; level: number }>>;
}>;

/** A built or imported character's level, from its class rows. */
function characterLevelOf(definition: ActorDefinition | undefined): number {
  return Math.max(
    1,
    (definition?.character?.classes ?? []).reduce((total, row) => total + row.level, 0)
  );
}

/** Awards XP. Mutates `state`. */
export function awardExperience(
  state: GameState,
  award: ExperienceAward,
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined
): ExperienceOutcome {
  const recipients = [...new Set(award.recipientIds)].map(
    (id) =>
      state.actors.find((actor) => actor.id === id && actor.kind === "player-character") ??
      (() => {
        throw new CommandRejectedError("XP goes to player characters.");
      })()
  );
  if (recipients.length === 0) throw new CommandRejectedError("Choose the characters who gain the XP.");
  let creatures = 0;
  for (const id of new Set(award.defeatedIds)) {
    const creature = state.actors.find((actor) => actor.id === id);
    if (!creature || creature.kind === "player-character")
      throw new CommandRejectedError("Only creatures the party overcame give their XP.");
    const definition = creature.definitionId ? resolveDefinition(creature.definitionId) : undefined;
    const facts = definition ? statblockFacts(definition) : null;
    const worth = award.inLairIds.includes(id)
      ? (facts?.experiencePointsInLair ?? facts?.experiencePoints)
      : facts?.experiencePoints;
    if (worth === null || worth === undefined)
      throw new CommandRejectedError(`${creature.name}'s stat block gives no XP. Give the XP as an amount.`);
    creatures += worth;
  }
  const each = Math.floor(creatures / recipients.length) + award.amount;
  const ready: Array<{ actorId: string; name: string; level: number }> = [];
  for (const actor of recipients) {
    const definition = actor.definitionId ? resolveDefinition(actor.definitionId) : undefined;
    const level = characterLevelOf(definition);
    const before = actor.experiencePoints ?? experienceForLevel(level);
    actor.experiencePoints = Math.min(10_000_000, Math.max(0, before + each));
    const reaches = levelForExperience(actor.experiencePoints);
    if (reaches > level) ready.push({ actorId: actor.id, name: actor.name, level: level + 1 });
  }
  return { each, creatures, ready };
}
