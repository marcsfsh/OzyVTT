import { ActorAwardExperienceSchema } from "@vtt/domain/commands";
import { awardExperience, type ExperienceOutcome } from "../experience.js";
import { defineCommand } from "./pipeline.js";

// Experience Points, which the GM awards.

export const experienceCommands = [
  defineCommand({
    type: "actor.award-experience",
    operationId: "awardExperience",
    description:
      "Awards Experience Points to player characters (GM-grade only). SRD 5.2.1: characters earn XP, which the GM awards, and when a character's total crosses a threshold of the Character Advancement table its level increases. Each recipient gains `amount`, plus an even share (rounded down) of the XP the stat blocks of `defeatedIds` print, each at its lair XP when it is in `inLairIds`. A character's total starts at the least XP its level needs; a negative amount takes XP back, never below 0. The response says what each gained and which characters now have the XP for their next level, which they reach through a level up as usual; a GM levelling by milestone needs no XP.",
    summary: "Award XP to player characters: an amount each, and a share of the defeated creatures' XP (GM).",
    schema: ActorAwardExperienceSchema,
    malformed: "The XP award is malformed.",
    gmOnly: "Only the GM awards XP.",
    async run({ request, execute }, kit) {
      let outcome: ExperienceOutcome = { each: 0, creatures: 0, ready: [] };
      const committed = await execute((draft) => {
        outcome = awardExperience(
          draft,
          {
            recipientIds: request.actorIds,
            amount: request.amount,
            defeatedIds: request.defeatedIds,
            inLairIds: request.inLairIds
          },
          (definitionId) => kit.resolveDefinitionIn(draft, definitionId)
        );
      });
      if (!committed.duplicate) {
        const names = request.actorIds.map((id) => kit.actorName(id)).join(", ");
        kit.context.appendLog({
          kind: "encounter",
          text: `${names} ${outcome.each < 0 ? "lose" : "gain"} ${Math.abs(outcome.each).toLocaleString("en")} XP each.`,
          actorIds: [...request.actorIds]
        });
        for (const reached of outcome.ready)
          kit.context.appendLog({
            kind: "encounter",
            text: `${reached.name} has the XP to reach level ${reached.level}.`,
            actorIds: [reached.actorId]
          });
      }
      return { each: outcome.each, creatures: outcome.creatures, ready: outcome.ready };
    }
  })
];
