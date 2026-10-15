import type { PendingRuleAsk } from "@vtt/domain";
import { requireActorAccess } from "../authorization.js";
import { RulesAnswerSchema, RulesAskSchema } from "../game-commands.js";
import { CommandRejectedError, RulesBlockedError } from "../game-store.js";
import {
  allowCovers,
  askRerunPayload,
  clearRuleAsk,
  findRuleAsk,
  parkRuleAsk,
  reaskRuleAsk,
  rerunPayload
} from "../rule-asks.js";
import { familyOf, overrideReason } from "../rules-families.js";
import { initiatorOf } from "./kit.js";
import { defineCommand, type GameReply } from "./pipeline.js";

// "Ask the GM": a player blocked by a rule parks the command as a question, and the GM allows or denies it.

/** The character a parked payload is about; an ask without one is not askable. */
function askActorId(payload: unknown): string | null {
  const actorId = (payload as { actorId?: unknown } | null | undefined)?.actorId;
  return typeof actorId === "string" && actorId.length > 0 ? actorId : null;
}

export const rulingCommands = [
  defineCommand({
    type: "rules.ask",
    summary:
      "Ask the GM to allow a blocked command; it re-runs first and is parked only if it still blocks (GM anyone; a player their own claimed character).",
    schema: RulesAskSchema,
    malformed: "The question is malformed.",
    async run({ principal, request, execute, dispatch }, kit) {
      const { type, payload } = request;
      // Re-run under the asker's own authority, so wrapping a command in an ask cannot widen what they may reach.
      const attempt = askRerunPayload(payload);
      let blocked: RulesBlockedError;
      try {
        return { ...(await dispatch(type, attempt)), ran: true };
      } catch (error) {
        // Only a rules block becomes a question; any other failure is the command's own refusal.
        if (!(error instanceof RulesBlockedError)) throw error;
        blocked = error;
      }
      const actorId = askActorId(attempt);
      if (actorId === null) throw new CommandRejectedError("That action names no character to ask about.");
      const askId = kit.context.newId();
      let parked: PendingRuleAsk | undefined;
      const { duplicate } = await execute(
        (state) => {
          requireActorAccess(initiatorOf(principal), state, actorId, "check");
          parked = parkRuleAsk(state, {
            id: askId,
            actorId,
            rule: blocked.rule,
            family: familyOf(blocked.rule),
            message: blocked.message,
            command: { type, payload: attempt },
            createdAt: new Date().toISOString()
          });
        },
        { actorId }
      );
      // GM-only: the rest of the table has no business seeing the question.
      if (!duplicate)
        kit.context.appendLog({
          kind: "override",
          text: `${kit.actorName(actorId)} asked the GM about a blocked action (${blocked.rule}): ${blocked.message}`,
          actorId,
          gmOnly: true
        });
      return {
        askId: parked?.id ?? askId,
        ran: false,
        blocked: { rule: blocked.rule, message: blocked.message, overridable: blocked.overridable }
      };
    }
  }),

  defineCommand({
    type: "rules.answer",
    summary: "Allow (re-running the parked command with an override) or decline a parked rules question (GM).",
    schema: RulesAnswerSchema,
    malformed: "The answer is malformed.",
    gmOnly: "Only the GM can answer a rules question.",
    // Allow replays the parked command with an override of the asked family before clearing the ask, so a
    // failed replay leaves it parked; a block of another family re-asks rather than riding the same Allow.
    // Deny clears it and tells the player.
    async run({ request, execute, dispatch }, kit) {
      const { askId, allow, reason } = request;
      const ask = findRuleAsk(kit.read(), askId);
      if (!ask) throw new CommandRejectedError("That question is no longer waiting - the fight moved on.");
      let ran: GameReply | undefined;
      let further: RulesBlockedError | undefined;
      if (allow) {
        try {
          ran = await dispatch(ask.command.type, rerunPayload(ask, reason));
        } catch (error) {
          if (!(error instanceof RulesBlockedError)) throw error;
          further = error;
        }
      }
      if (further) {
        const blocked = further;
        if (allowCovers(ask, blocked.rule)) throw blocked;
        await execute(
          (state) => {
            reaskRuleAsk(state, ask, blocked, kit.context.newId());
          },
          { actorId: ask.actorId }
        );
        kit.context.appendLog({
          kind: "override",
          text: `The GM allowed ${kit.actorName(ask.actorId)}'s blocked action, but it is also blocked by another rule (${blocked.rule}): ${blocked.message}`,
          actorId: ask.actorId,
          gmOnly: true
        });
        return {
          allowed: true,
          blocked: { rule: blocked.rule, message: blocked.message, overridable: blocked.overridable }
        };
      }
      const { duplicate } = await execute((state) => clearRuleAsk(state, askId), { actorId: ask.actorId });
      if (!duplicate) {
        const relaxed = ask.family === null ? "" : ` (${ask.family} checks relaxed for this turn)`;
        kit.context.appendLog({
          kind: "override",
          text: allow
            ? `The GM allowed ${kit.actorName(ask.actorId)}'s blocked action${relaxed} - ${overrideReason({ ...(reason === undefined ? {} : { reason }) })}.`
            : `The GM declined ${kit.actorName(ask.actorId)}'s blocked action.`,
          actorId: ask.actorId,
          actorIds: [ask.actorId],
          gmOnly: kit.actorHidden(ask.actorId)
        });
      }
      return { allowed: allow, ...(ran ? { outcome: ran } : {}) };
    }
  })
];
