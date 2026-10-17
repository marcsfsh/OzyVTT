import { DamageResolveSchema, ReactionAnswerSchema, ReactionDismissSchema } from "@vtt/domain/commands";
import { damageAdjustmentDetail } from "../hit-points.js";
import { resolvePendingDamage, type AppliedDamage } from "../player-damage.js";
import { pushTokenAway } from "../forced-movement.js";
import { answerReaction, dismissReaction, type ReactionOutcome } from "../reactions.js";
import { initiatorOf, sessionIdOf } from "./kit.js";
import { defineCommand } from "./pipeline.js";

// Answers to what a hit leaves open: reaction prompts (ADR-0020) and the GM's damage proposals.

/** The feed line for an answered prompt; null when there is nothing to say yet (a previewed swing) or at all (an
 *  opportunity let go). */
function reactionLine(outcome: ReactionOutcome): { kind: "reaction" | "damage"; text: string } | null {
  const detail = damageAdjustmentDetail({
    parts: outcome.parts ?? [],
    ...(outcome.flatReduction ? { flatReduction: outcome.flatReduction } : {})
  });
  const damage = outcome.appliedDamage > 0 ? `${outcome.appliedDamage} damage${detail}` : null;
  const resolution = outcome.resolution;
  const attack = resolution?.attack ?? null;
  const verdict = attack ? (attack.outcome === "crit" ? "CRIT" : attack.outcome.toUpperCase()) : null;
  switch (outcome.kind) {
    case "hit-by-attack":
      return outcome.used
        ? {
            kind: "reaction",
            text: `${outcome.actorName} used ${outcome.actionName} - ${outcome.proposedDamage} damage becomes ${outcome.appliedDamage}${detail}.`
          }
        : {
            kind: "damage",
            text: `${outcome.actorName} declined ${outcome.actionName} - ${outcome.sourceName} hit for ${outcome.appliedDamage} damage${detail}.`
          };
    case "attack-would-hit": {
      if (!resolution) return null;
      const swing = `${outcome.sourceName}'s ${resolution.actionName}`;
      const landed =
        resolution.waitingOnReaction || resolution.reactionPrompts?.length
          ? `${swing} hits`
          : attack && (attack.outcome === "hit" || attack.outcome === "crit")
            ? `${swing} hits${damage ? ` for ${damage}` : ""}`
            : `${swing} misses`;
      return {
        kind: "reaction",
        text: outcome.used
          ? `${outcome.actorName} used ${outcome.actionName} - ${landed}.`
          : `${outcome.actorName} declined ${outcome.actionName} - ${landed}.`
      };
    }
    case "leaves-reach":
    case "damaged-by-creature": {
      if (!outcome.used || !resolution) return null;
      const target = outcome.other?.name ?? outcome.sourceName;
      const what =
        outcome.kind === "leaves-reach"
          ? `made an opportunity attack against ${target}`
          : `used ${outcome.actionName} against ${target}${attack && resolution.actionName !== outcome.actionName ? ` (${resolution.actionName})` : ""}`;
      const result = verdict
        ? `${verdict}${damage ? `, ${damage}` : ""}`
        : resolution.save
          ? `DC ${resolution.save.dc} ${resolution.save.ability.toUpperCase()} save`
          : (damage ?? "no damage");
      return { kind: "reaction", text: `${outcome.actorName} ${what} - ${result}.` };
    }
  }
}

export const reactionCommands = [
  defineCommand({
    type: "reaction.answer",
    operationId: "answerReaction",
    description:
      "Answers a pending reaction prompt; `use: true` spends the reaction, `use: false` declines it. What else happens depends on the prompt's `kind`. `hit-by-attack` (Uncanny Dodge): the hit's parked damage applies either way, each typed part halved first on use. `attack-would-hit` (Parry, Shield): the attack waiting at its roll finishes either way with the same die, against AC raised by the reaction on use, and a hit's damage applies. `leaves-reach` (an opportunity attack) and `damaged-by-creature` (Hellish Rebuke, Retaliation): use strikes the creature with one melee attack with a weapon or an Unarmed Strike (another action is refused), previewable with `commit: false`, the confirm carrying the `hitOptions` its preview offered (Sneak Attack), and damage that lands applies. Player sessions may answer only their claimed character's prompts. The response carries the `outcome`.",
    summary: "Answer a pending reaction prompt: use it (spend the reaction) or decline it.",
    schema: ReactionAnswerSchema,
    malformed: "The reaction answer is malformed.",
    async run({ principal, request, execute }, kit) {
      const {
        commandId,
        reactionId,
        use,
        actionId: chosenActionId,
        commit,
        rollMode,
        attackNatural,
        pushFeet,
        hitOptions
      } = request;
      // The grid, fetched up front like `action.resolve`'s, so Push on an opportunity attack moves the token.
      const mapAssetId = kit.read().combat.mapAssetId;
      const geometry = mapAssetId ? await kit.context.tokenGeometryFor(mapAssetId) : null;
      const distance = await kit.creatureDistance();
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
            now: () => new Date().toISOString(),
            pushToken: (input) =>
              draft.combat.mapAssetId === mapAssetId ? pushTokenAway(draft, input, geometry) : null,
            distanceFeet: (actorIdA, actorIdB) => distance(draft, actorIdA, actorIdB)
          },
          {
            commit,
            rollMode,
            attackNatural,
            ...(pushFeet !== undefined ? { pushFeet } : {}),
            ...(hitOptions ? { hitOptions } : {})
          }
        );
      });
      if (duplicate || !outcome) return;
      kit.publishRolls(state, commandId);
      const line = reactionLine(outcome);
      if (line) {
        // Either creature hidden keeps the line with the GM: it names both.
        const gmOnly = kit.actorHidden(outcome.actorId) || (outcome.other ? kit.actorHidden(outcome.other.id) : false);
        kit.context.broadcastTableEvent({ kind: line.kind, text: line.text, actorIds: [outcome.actorId], gmOnly });
      }
      // A strike or a finished attack ran the resolver, so its rules notes, narration and any reaction window it opened
      // (the struck creature's own Parry) are told like any resolve's. A preview tells nothing yet.
      if (outcome.resolution && !outcome.resolution.preview)
        kit.narrateResolution(
          outcome.resolution,
          outcome.kind === "attack-would-hit" ? outcome.other!.id : outcome.actorId
        );
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
      "Dismisses a pending reaction prompt WITHOUT applying anything it holds (GM-grade only): parked damage is dropped, and so is an attack waiting on a Parry or Shield - for when the GM settled it by hand.",
    summary: "Dismiss a pending reaction prompt without applying what it holds (GM).",
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
      const distance = await kit.creatureDistance();
      let applied: AppliedDamage | undefined;
      const { duplicate } = await execute((state) => {
        applied =
          resolvePendingDamage(state, proposalId, apply, amount, {
            resolveDefinition: kit.resolveDefinition,
            newId: kit.context.newId,
            now: () => Date.now(),
            catalog: kit.equipmentCatalog(),
            distanceFeet: (actorIdA, actorIdB) => distance(state, actorIdA, actorIdB)
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
