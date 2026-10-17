import type { GameState } from "@vtt/domain";
import {
  ActorSetHeroicInspirationSchema,
  CheckRerollSchema,
  CheckRollSchema,
  RollCallAnswerSchema,
  RollCallCloseSchema,
  RollCallStartSchema
} from "@vtt/domain/commands";
import { ABILITY_NAMES, checkLabel } from "../ability-checks.js";
import {
  answerRollCall,
  closeRollCall,
  rerollAbilityCheck,
  rollAbilityCheck,
  startRollCall,
  type CheckResult,
  type CheckRollDependencies
} from "../check-rolls.js";
import { CommandRejectedError } from "../game-store.js";
import { tokenCreatureDistance } from "../movement-narration.js";
import type { TokenMapGeometry } from "../token-placement.js";
import { initiatorOf, sessionIdOf, type GamePrincipal, type Kit } from "./kit.js";
import { defineCommand } from "./pipeline.js";
import { withArticle } from "@vtt/domain";

// Ability checks rolled on the server, the GM's calls for a roll, and Heroic Inspiration (ADR-0012).

/** Where creatures stand, for an ally's aura around the roller (Aura of Courage), from the live map read before the
 *  command's turn. */
function checkDeps(
  kit: Kit,
  principal: GamePrincipal,
  draft: GameState,
  geometry: TokenMapGeometry | null
): CheckRollDependencies {
  const skills = kit.catalogFor(principal).skillSummaries();
  const catalog = kit.equipmentCatalog();
  return {
    random: (sides) => kit.context.random(sides),
    newId: kit.context.newId,
    sessionId: sessionIdOf(principal),
    now: () => new Date().toISOString(),
    resolveDefinition: (definitionId) => kit.resolveDefinitionIn(draft, definitionId),
    ...(geometry
      ? {
          distanceFeet: (actorIdA: string, actorIdB: string) =>
            tokenCreatureDistance(draft, geometry, actorIdA, actorIdB)?.value ?? null
        }
      : {}),
    catalog,
    names: {
      skill: (id) => skills.find((skill) => skill.id === id)?.name,
      tool: (id) => catalog.equipmentRecord(id)?.name
    },
    unseen: kit.unseenBy(initiatorOf(principal), draft)
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
      const geometry = await kit.liveGeometry();
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
          checkDeps(kit, principal, draft, geometry)
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
      const geometry = await kit.liveGeometry();
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
          checkDeps(kit, principal, draft, geometry)
        );
      });
      if (duplicate || !result) return;
      kit.publishRolls(state, request.commandId);
      narrateVerdict(kit, request.actorId, result, visibility);
      return checkReply(result);
    }
  }),

  defineCommand({
    type: "roll-call.start",
    operationId: "startRollCall",
    description:
      "The GM calls for a roll from one or several characters (GM-grade only): an ability, skill or tool check, or a saving throw with a DC. A save call opens a pending save for each character, answered like any save (the outcome is written back to the call); a check call is answered with `roll-call.answer`. A `blind` call keeps its DC and results from the players: they roll blind. Players see their own part of an open call in `rollCalls`; the GM sees every result and closes the call. The response carries `callId`.",
    summary: "Call for a check or a saving throw from one or several characters (GM).",
    schema: RollCallStartSchema,
    malformed: "The call for a roll is malformed.",
    issueMessage: true,
    gmOnly: "Only the GM can call for a roll.",
    async run({ request, execute }, kit) {
      const { commandId, kind, ability, skill, tool, dc, actorIds, blind } = request;
      const subject = { ability, ...(skill !== undefined ? { skill } : {}), ...(tool !== undefined ? { tool } : {}) };
      const committed = await execute((draft) => {
        startRollCall(
          draft,
          { id: commandId, kind, subject, dc: dc ?? null, actorIds, blind: blind === true },
          { newId: kit.context.newId, now: () => Date.now() }
        );
      });
      if (!committed.duplicate) {
        const skills = kit.contentLibrary.forAudience("gm").skillSummaries();
        const label = checkLabel(subject, {
          skill: (id) => skills.find((entry) => entry.id === id)?.name,
          tool: (id) => kit.equipmentCatalog().equipmentRecord(id)?.name
        });
        const what =
          kind === "save"
            ? withArticle(`${ABILITY_NAMES[ability]} saving throw`)
            : withArticle(label.endsWith(" check") ? label : `${label} check`);
        kit.context.broadcastTableEvent({
          kind: "action",
          text: `The GM calls for ${what}${dc !== undefined && blind !== true ? ` (DC ${dc})` : ""}.`,
          gmOnly: actorIds.every((actorId) => kit.actorHidden(actorId)),
          // The GM's panel shows the open call, so a toast about it would only repeat it in the third person.
          playersOnly: true
        });
      }
      return { callId: commandId };
    }
  }),

  defineCommand({
    type: "roll-call.answer",
    operationId: "answerRollCall",
    description:
      "Answers the GM's check call for one character: the server rolls the call's check as `check.roll` does (or takes `face`, a typed d20, from a player only while the table's typedRolls is open), once per character, and writes the result to the call. A blind call's roll is hidden from the player. A save call is answered through its pending save instead. GM-grade for anyone the call names; a player session only for their own claimed character. The response carries `check`.",
    summary: "Answer the GM's call for a check for your character.",
    schema: RollCallAnswerSchema,
    malformed: "The answer is malformed.",
    async run({ principal, request, execute }, kit) {
      const initiator = initiatorOf(principal);
      let result: CheckResult | undefined;
      let blind = false;
      const geometry = await kit.liveGeometry();
      const { state, duplicate } = await execute((draft) => {
        blind = draft.rollCalls.find((call) => call.id === request.callId)?.blind === true;
        result = answerRollCall(
          draft,
          initiator,
          {
            commandId: request.commandId,
            callId: request.callId,
            actorId: request.actorId,
            ...(request.face !== undefined ? { face: request.face } : {})
          },
          checkDeps(kit, principal, draft, geometry)
        );
      });
      if (duplicate || !result) return;
      kit.publishRolls(state, request.commandId);
      narrateVerdict(kit, request.actorId, result, blind ? "gm-only" : "public");
      return checkReply(result);
    }
  }),

  defineCommand({
    type: "roll-call.close",
    operationId: "closeRollCall",
    description:
      "Closes the GM's call for a roll (GM-grade only); the saves it opened that nobody answered are dismissed.",
    summary: "Close a call for a roll (GM).",
    schema: RollCallCloseSchema,
    malformed: "The close is malformed.",
    gmOnly: "Only the GM can close a call for a roll.",
    async run({ principal, request, execute }) {
      await execute((draft) => closeRollCall(draft, initiatorOf(principal), request.callId));
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
