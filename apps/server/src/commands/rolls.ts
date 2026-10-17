import { ActorSetHeroicInspirationSchema } from "@vtt/domain/commands";
import { CommandRejectedError } from "../game-store.js";
import { defineCommand } from "./pipeline.js";

// Heroic Inspiration (ADR-0012).

export const rollCommands = [
  defineCommand({
    type: "actor.set-heroic-inspiration",
    operationId: "setHeroicInspiration",
    description:
      "Gives or takes a character's Heroic Inspiration (GM-grade only). A character holds at most one; spending it rerolls one die of a check, a save, a death save or an attack (`reroll` on those commands). A Human regains it on finishing a Long Rest (Resourceful).",
    summary: "Give or take a character's Heroic Inspiration (GM).",
    schema: ActorSetHeroicInspirationSchema,
    malformed: "The Heroic Inspiration change is malformed.",
    gmOnly: "Only the GM gives Heroic Inspiration.",
    async run({ request, execute }, kit) {
      const committed = await execute((draft) => {
        const actor = draft.actors.find((candidate) => candidate.id === request.actorId);
        if (!actor) throw new CommandRejectedError("That character no longer exists.");
        actor.heroicInspiration = request.has;
      });
      if (!committed.duplicate)
        kit.context.appendLog({
          kind: "action",
          text: `${kit.actorName(request.actorId)} ${request.has ? "gains" : "no longer has"} Heroic Inspiration.`,
          actorId: request.actorId,
          actorIds: [request.actorId],
          gmOnly: kit.actorHidden(request.actorId)
        });
    }
  })
];
