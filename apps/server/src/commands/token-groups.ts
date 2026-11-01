import { randomUUID } from "node:crypto";
import {
  ActorSetTokenGroupSchema,
  TokenGroupCreateSchema,
  TokenGroupDeleteSchema,
  TokenGroupRenameSchema
} from "@vtt/domain/commands";
import { CommandRejectedError } from "../game-store.js";
import { defineCommand } from "./pipeline.js";

// The GM's token groups on Prep's Tokens page (ADR-0063). Stored only, GM-read: no player or table screen projection
// carries them, and a creature in no group sits under Party or Monsters.

const MAX_GROUPS = 50;

export const tokenGroupCommands = [
  defineCommand({
    type: "token-group.create",
    operationId: "createTokenGroup",
    description:
      "Makes a token group on Prep's Tokens page (GM-grade only, ADR-0063): a name of 1 to 40 characters, at most 50 groups. Groups are the GM's filing alone; no player or table screen sees them.",
    summary: "Make a token group (GM).",
    schema: TokenGroupCreateSchema,
    malformed: "The token group command is malformed.",
    gmOnly: "Only the GM can make token groups.",
    async run({ request, execute }) {
      await execute((state) => {
        if (state.tokenGroups.groups.length >= MAX_GROUPS)
          throw new CommandRejectedError(`A table keeps at most ${MAX_GROUPS} token groups.`);
        state.tokenGroups.groups.push({ id: randomUUID(), name: request.name });
      });
    }
  }),

  defineCommand({
    type: "token-group.rename",
    operationId: "renameTokenGroup",
    description: "Renames a token group (GM-grade only, ADR-0063).",
    summary: "Rename a token group (GM).",
    schema: TokenGroupRenameSchema,
    malformed: "The token group command is malformed.",
    gmOnly: "Only the GM can rename token groups.",
    async run({ request, execute }) {
      await execute((state) => {
        const group = state.tokenGroups.groups.find((entry) => entry.id === request.groupId);
        if (!group) throw new CommandRejectedError("That token group is gone.");
        group.name = request.name;
      });
    }
  }),

  defineCommand({
    type: "token-group.delete",
    operationId: "deleteTokenGroup",
    description:
      "Deletes a token group (GM-grade only, ADR-0063); the creatures filed in it return to Party or Monsters.",
    summary: "Delete a token group; its creatures return to Party or Monsters (GM).",
    schema: TokenGroupDeleteSchema,
    malformed: "The token group command is malformed.",
    gmOnly: "Only the GM can delete token groups.",
    async run({ request, execute }) {
      await execute((state) => {
        if (!state.tokenGroups.groups.some((entry) => entry.id === request.groupId))
          throw new CommandRejectedError("That token group is gone.");
        state.tokenGroups.groups = state.tokenGroups.groups.filter((entry) => entry.id !== request.groupId);
        for (const [actorId, groupId] of Object.entries(state.tokenGroups.members))
          if (groupId === request.groupId) delete state.tokenGroups.members[actorId];
      });
    }
  }),

  defineCommand({
    type: "actor.set-token-group",
    operationId: "setActorTokenGroup",
    description: "Files a creature in a token group, or takes it out with `groupId: null` (GM-grade only, ADR-0063).",
    summary: "File a creature in a token group, or take it out (GM).",
    schema: ActorSetTokenGroupSchema,
    malformed: "The token group command is malformed.",
    gmOnly: "Only the GM can file creatures in token groups.",
    async run({ request, execute }) {
      await execute((state) => {
        if (!state.actors.some((actor) => actor.id === request.actorId))
          throw new CommandRejectedError("That creature is not on the roster.");
        if (request.groupId === null) {
          delete state.tokenGroups.members[request.actorId];
          return;
        }
        if (!state.tokenGroups.groups.some((entry) => entry.id === request.groupId))
          throw new CommandRejectedError("That token group is gone.");
        state.tokenGroups.members[request.actorId] = request.groupId;
      });
    }
  })
];
