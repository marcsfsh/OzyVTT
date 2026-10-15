import { DamageResolveSchema, ReactionAnswerSchema, ReactionDismissSchema } from "@vtt/domain/commands";
import { damageAdjustmentDetail } from "../hit-points.js";
import { resolvePendingDamage, type AppliedDamage } from "../player-damage.js";
import { answerReaction, dismissReaction } from "../reactions.js";
import { initiatorOf, sessionIdOf } from "./kit.js";
import { defineCommand } from "./pipeline.js";

// Answers to what a hit leaves open: reaction prompts (ADR-0020) and the GM's damage proposals.

export const reactionCommands = [
  defineCommand({
    type: "reaction.answer",
    operationId: "answerReaction",
    description:
      "Answers a pending reaction prompt (Uncanny Dodge). The triggering attack's damage was parked on the prompt, so both answers apply it here: `use: true` spends the reaction and halves each typed part first; `use: false` applies it in full. Player sessions may answer only their claimed character's prompts. The response carries the `outcome`.",
    summary:
      "Answer a pending reaction prompt: use it (spend the reaction, halve the parked damage) or decline (apply it in full).",
    schema: ReactionAnswerSchema,
    malformed: "The reaction answer is malformed.",
    async run({ principal, request, execute }, kit) {
      const { commandId, reactionId, use, actionId: chosenActionId, commit, rollMode, attackNatural } = request;
      let outcome: ReturnType<typeof answerReaction> | undefined;
      const { state, duplicate } = await execute((draft) => {
        outcome = answerReaction(
          draft,
          commandId,
          reactionId,
          use,
          chosenActionId,
          initiatorOf(principal),
          {
            resolveDefinition: (definitionId) => kit.resolveDefinitionIn(draft, definitionId),
            catalog: kit.equipmentCatalog(),
            random: (sides) => kit.context.random(sides),
            newRollId: kit.context.newId,
            gmSessionId: sessionIdOf(principal),
            now: () => new Date().toISOString()
          },
          { commit, rollMode, attackNatural }
        );
      });
      if (duplicate || !outcome) return;
      kit.publishRolls(state, commandId);
      const hidden = kit.actorHidden(outcome.actorId);
      // The breakdown explains numbers the defences changed.
      const detail = damageAdjustmentDetail({
        parts: outcome.parts ?? [],
        ...(outcome.flatReduction ? { flatReduction: outcome.flatReduction } : {})
      });
      if (outcome.kind === "leaves-reach") {
        if (outcome.used && outcome.resolution) {
          const attack = outcome.resolution.attack;
          const verdict = attack ? (attack.outcome === "crit" ? "CRIT" : attack.outcome.toUpperCase()) : "resolved";
          const text = `${outcome.actorName} made an opportunity attack against ${outcome.sourceName} - ${verdict}${outcome.appliedDamage > 0 ? `, ${outcome.appliedDamage} damage${detail}` : ""}.`;
          kit.context.broadcastTableEvent({ kind: "reaction", text, actorIds: [outcome.actorId], gmOnly: hidden });
          // The off-turn swing runs the same resolver, so its rules notes (Push's "move the token", Topple's DC)
          // go to the GM too. `used` excludes the preview, so nothing is said twice.
          for (const warning of outcome.resolution.warnings ?? [])
            kit.context.appendLog({
              kind: "action",
              text: `Rules note: ${warning}`,
              actorIds: [outcome.actorId],
              gmOnly: true
            });
          // The off-turn swing's table lines drain here too (Push moves no token here: no geometry callback).
          kit.appendTableNarration(outcome.resolution);
        }
      } else if (outcome.used) {
        const text = `${outcome.actorName} used ${outcome.actionName} - ${outcome.proposedDamage} damage becomes ${outcome.appliedDamage}${detail}.`;
        kit.context.broadcastTableEvent({ kind: "reaction", text, actorIds: [outcome.actorId], gmOnly: hidden });
      } else {
        const text = `${outcome.actorName} declined ${outcome.actionName} - ${outcome.sourceName} hit for ${outcome.appliedDamage} damage${detail}.`;
        kit.context.broadcastTableEvent({ kind: "damage", text, actorIds: [outcome.actorId], gmOnly: hidden });
      }
      kit.publishNarrations(outcome.events);
      return {
        outcome: {
          used: outcome.used,
          appliedDamage: outcome.appliedDamage,
          ...(outcome.resolution ? { resolution: outcome.resolution } : {}),
          ...(outcome.parts ? { parts: outcome.parts } : {}),
          ...(outcome.flatReduction ? { flatReduction: outcome.flatReduction } : {})
        }
      };
    }
  }),

  defineCommand({
    type: "reaction.dismiss",
    operationId: "dismissReaction",
    description:
      "Dismisses a pending reaction prompt WITHOUT applying its parked damage (GM-grade only) - for when the damage was already applied manually.",
    summary: "Dismiss a pending reaction prompt without applying its damage (GM).",
    schema: ReactionDismissSchema,
    malformed: "The dismissal is malformed.",
    gmOnly: "Only the GM can dismiss a reaction prompt.",
    async run({ principal, request, execute }) {
      await execute((state) => dismissReaction(state, request.reactionId, initiatorOf(principal)));
    }
  }),

  defineCommand({
    type: "damage.resolve",
    operationId: "resolveProposedDamage",
    description:
      "Applies or dismisses a parked player-hit damage proposal (proposal mode; GM-grade only). `apply: true` reduces the target's HP through the typed-defense pipeline (an optional `amount` overrides the total as a bare number, no defense math); `apply: false` discards it. Either way the proposal clears.",
    summary: "Apply or dismiss a player-hit damage proposal parked in proposal mode (GM).",
    schema: DamageResolveSchema,
    malformed: "The damage-resolution command is malformed.",
    gmOnly: "Only the GM can apply proposed damage.",
    async run({ request, execute }, kit) {
      const { proposalId, apply, amount } = request;
      let applied: AppliedDamage | undefined;
      const { duplicate } = await execute((state) => {
        applied =
          resolvePendingDamage(state, proposalId, apply, amount, {
            resolveDefinition: kit.resolveDefinition,
            newId: kit.context.newId,
            now: () => Date.now(),
            catalog: kit.equipmentCatalog()
          }) ?? undefined;
      });
      if (duplicate || !applied) return;
      const { outcome, targetId, sourceActorId, label } = applied;
      const detail = damageAdjustmentDetail(outcome.application);
      const text = `${label} hit ${kit.actorName(targetId)} for ${outcome.application.totalApplied} damage${detail}.`;
      kit.context.broadcastTableEvent({ kind: "damage", text, actorIds: [targetId, sourceActorId] });
      kit.context.appendLog({ kind: "damage", text, actorIds: [targetId, sourceActorId] });
      kit.publishNarrations(outcome.events);
    }
  })
];
