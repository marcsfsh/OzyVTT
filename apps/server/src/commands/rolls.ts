import type { GameState } from "@vtt/domain";
import { ActorSetHeroicInspirationSchema, CheckRerollSchema, CheckRollSchema } from "@vtt/domain/commands";
import { rerollAbilityCheck, rollAbilityCheck, type CheckResult, type CheckRollDependencies } from "../check-rolls.js";
import { CommandRejectedError } from "../game-store.js";
import { initiatorOf, sessionIdOf, type GamePrincipal, type Kit } from "./kit.js";
import { defineCommand } from "./pipeline.js";

// Ability checks rolled on the server, and Heroic Inspiration (ADR-0012).

function checkDeps(kit: Kit, principal: GamePrincipal, draft: GameState): CheckRollDependencies {
  const skills = kit.catalogFor(principal).skillSummaries();
  const catalog = kit.equipmentCatalog();
  return {
    random: (sides) => kit.context.random(sides),
    newId: kit.context.newId,
    sessionId: sessionIdOf(principal),
    now: () => new Date().toISOString(),
    resolveDefinition: (definitionId) => kit.resolveDefinitionIn(draft, definitionId),
    catalog,
    names: {
      skill: (id) => skills.find((skill) => skill.id === id)?.name,
      tool: (id) => catalog.equipmentRecord(id)?.name
    }
  };
}

/** The reply to a check: its numbers, or only that it went to the GM (a blind roll keeps them from the roller). */
function checkReply(result: CheckResult) {
  return result.hiddenFromRoller ? { hiddenFromRoller: true } : { check: result.outcome };
}

/** The feed line for a check against a DC; a roll the table can't see keeps its verdict with the GM. */
function narrateVerdict(kit: Kit, actorId: string, result: CheckResult, visibility: string) {
  const { outcome } = result;
  if (outcome.dc === null) return;
  kit.context.appendLog({
    kind: "action",
    text: `${kit.actorName(actorId)} rolled ${outcome.total} on ${outcome.label} vs DC ${outcome.dc} - ${outcome.success ? "success" : "failure"}.`,
    actorId,
    actorIds: [actorId],
    gmOnly: visibility !== "public" || kit.actorHidden(actorId)
  });
}

export const rollCommands = [
  defineCommand({
    type: "check.roll",
    operationId: "rollCheck",
    description:
      "Rolls an ability check on the server: an ability, a skill, or a tool (with the skill it uses, when one does). The server works out the bonus (proficiency or Expertise, Jack of All Trades, a stat block's printed skill, check riders, Exhaustion) and the Advantage or Disadvantage the rules give (items, armor's Stealth Disadvantage, armor worn without training, Poisoned, Frightened, Hex, Hunter's Mark on the creature named by `findActorId`, a tool used with a proficient skill), applies Reliable Talent, records the roll and, with a `dc`, says whether it succeeded. `face` is a typed d20 (a player only while the table's typedRolls is open); `rollMode` is the GM's alone. A player can't roll GM-only, a hidden creature's roll is always the GM's, and a blind roll's numbers stay with the GM. GM-grade for anyone; a player session only for their own claimed character. The response carries `check`.",
    summary: "Roll an ability, skill or tool check on the server, with the rules' bonus and Advantage or Disadvantage.",
    schema: CheckRollSchema,
    malformed: "The check is malformed.",
    async run({ principal, request, execute }, kit) {
      const { commandId, actorId, ability, skill, tool, dc, visibility, face, rollMode, findActorId } = request;
      const initiator = initiatorOf(principal);
      let result: CheckResult | undefined;
      const { state, duplicate } = await execute((draft) => {
        result = rollAbilityCheck(
          draft,
          initiator,
          {
            commandId,
            actorId,
            subject: { ability, ...(skill !== undefined ? { skill } : {}), ...(tool !== undefined ? { tool } : {}) },
            dc: dc ?? null,
            visibility,
            ...(face !== undefined ? { face } : {}),
            ...(rollMode !== undefined ? { forcedMode: rollMode } : {}),
            ...(findActorId !== undefined ? { findActorId } : {})
          },
          checkDeps(kit, principal, draft)
        );
      });
      if (duplicate || !result) return;
      kit.publishRolls(state, commandId);
      narrateVerdict(kit, actorId, result, visibility);
      return checkReply(result);
    }
  }),

  defineCommand({
    type: "check.reroll",
    operationId: "rerollCheck",
    description:
      "Rerolls one die of a character's latest check, while it is still that character's latest roll (SRD Heroic Inspiration: \"reroll any die immediately after rolling it\"). A player spends the character's Heroic Inspiration and rerolls the lowest d20, keeping the new roll; a typed check takes `face`, what the rerolled physical die shows. The GM throws the check again freely. A check answering the GM's call updates the call. The response carries `check`.",
    summary: "Reroll a character's latest check: Heroic Inspiration for a player, free for the GM.",
    schema: CheckRerollSchema,
    malformed: "The reroll is malformed.",
    async run({ principal, request, execute }, kit) {
      const initiator = initiatorOf(principal);
      let result: CheckResult | undefined;
      let visibility = "public";
      const { state, duplicate } = await execute((draft) => {
        visibility =
          draft.heldRolls.find((held) => held.key === `check:${request.actorId}`)?.check?.visibility ?? "public";
        result = rerollAbilityCheck(
          draft,
          initiator,
          {
            commandId: request.commandId,
            actorId: request.actorId,
            ...(request.face !== undefined ? { face: request.face } : {})
          },
          checkDeps(kit, principal, draft)
        );
      });
      if (duplicate || !result) return;
      kit.publishRolls(state, request.commandId);
      narrateVerdict(kit, request.actorId, result, visibility);
      return checkReply(result);
    }
  }),

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
