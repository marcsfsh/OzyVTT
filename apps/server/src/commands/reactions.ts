import { DamageResolveSchema, ReactionAnswerSchema, ReactionDismissSchema } from "@vtt/domain/commands";
import { heldRollFor, requireTypedDie } from "../held-rolls.js";
import { damageAdjustmentDetail } from "../hit-points.js";
import { resolvePendingDamage, type AppliedDamage } from "../player-damage.js";
import { pushThroughZones } from "../pushed-through.js";
import type { EffectNarration } from "../effects.js";
import { answerReaction, dismissReaction, reactionHoldKey, type ReactionOutcome } from "../reactions.js";
import type { ActionResolution } from "@vtt/domain";
import { withoutSourceName } from "../hidden-source.js";
import { initiatorOf, isGmGrade, sessionIdOf } from "./kit.js";
import { countOptionUse } from "../option-uses.js";
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
    case "roll-answer": {
      if (!outcome.used) return null;
      const save = outcome.save;
      const after = save
        ? `: ${save.awaitingAnswer ? "the save waits on another answer" : `the save ${save.success ? "succeeds" : "fails"} (${save.total} vs DC ${save.dc})`}`
        : verdict
          ? `: ${verdict}${damage ? `, ${damage}` : ""}`
          : damage
            ? `: ${damage}`
            : "";
      return {
        kind: "reaction",
        text: `${outcome.actorName} used ${outcome.actionName} on ${outcome.sourceName}'s roll${after}.`
      };
    }
    case "takes-damage":
    case "hit-by-attack":
      return outcome.used
        ? {
            kind: "reaction",
            text: `${outcome.actorName} used ${outcome.actionName}, and ${outcome.proposedDamage} damage becomes ${outcome.appliedDamage}${detail}.${
              resolution?.save
                ? ` It turns the force on ${outcome.other?.name ?? "a creature"}: DC ${resolution.save.dc} ${resolution.save.ability.toUpperCase()} save.`
                : ""
            }`
          }
        : {
            kind: "damage",
            text:
              outcome.kind === "takes-damage"
                ? `${outcome.actorName} declined ${outcome.actionName} and took ${outcome.appliedDamage} damage${detail}.`
                : `${outcome.actorName} declined ${outcome.actionName}, and ${outcome.sourceName} hit for ${outcome.appliedDamage} damage${detail}.`
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
          ? `${outcome.actorName} used ${outcome.actionName}, and ${landed}.`
          : `${outcome.actorName} declined ${outcome.actionName}, and ${landed}.`
      };
    }
    case "casts-spell": {
      const caster = outcome.other?.name ?? outcome.sourceName;
      if (outcome.countered)
        return {
          kind: "reaction",
          text: `${outcome.actorName} used ${outcome.actionName}, and ${caster}'s spell fails.`
        };
      const ahead = resolution ? `, and ${caster}'s ${resolution.actionName} goes ahead` : "";
      return {
        kind: "reaction",
        text: outcome.used
          ? `${outcome.actorName} used ${outcome.actionName}${ahead || `, and ${caster} keeps casting`}.`
          : `${outcome.actorName} let ${caster}'s spell go${ahead}.`
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
    case "triggered": {
      if (!outcome.used) return null;
      const target = outcome.other?.name;
      const uses = resolution && resolution.actionName !== outcome.actionName ? ` (${resolution.actionName})` : "";
      const result = verdict
        ? `: ${verdict}${damage ? `, ${damage}` : ""}`
        : resolution?.save
          ? `: DC ${resolution.save.dc} ${resolution.save.ability.toUpperCase()} save`
          : "";
      const aimed = target && (verdict || resolution?.save) ? ` against ${target}` : "";
      return { kind: "reaction", text: `${outcome.actorName} used ${outcome.actionName}${aimed}${uses}${result}.` };
    }
    case "attack-targeted": {
      if (!resolution) return null;
      const swing = `${outcome.sourceName}'s ${resolution.actionName}`;
      const at = resolution.attack?.targetName;
      const result =
        resolution.waitingOnReaction || resolution.reactionPrompts?.length
          ? "waits on another answer"
          : verdict
            ? `${verdict}${damage ? `, ${damage}` : ""}`
            : "is made";
      return {
        kind: "reaction",
        text: outcome.used
          ? `${outcome.actorName} used ${outcome.actionName}: ${swing}${at ? ` at ${at}` : ""} ${result}.`
          : `${outcome.actorName} declined ${outcome.actionName}: ${swing} ${result}.`
      };
    }
    case "falls":
      // The landing itself is told by the fall's own line.
      return outcome.used
        ? {
            kind: "reaction",
            text:
              outcome.actorName === outcome.sourceName
                ? `${outcome.actorName} used ${outcome.actionName}.`
                : `${outcome.actorName} used ${outcome.actionName} for ${outcome.sourceName}.`
          }
        : null;
  }
}

/** The attack a player's Parry or Shield met, as that player reads it: whether it hit and what it dealt. The attack
 *  is the GM's creature's, so what its engine noted stays with the GM. An attacker hidden from the player stays
 *  unnamed in the action and in what the hit imposed. */
function metAttack(resolution: ActionResolution, attacker: string | null, attackerHidden: boolean): ActionResolution {
  const named = (text: string) => (attackerHidden ? withoutSourceName(text, attacker) : text);
  return {
    actionName: attackerHidden ? "An attack" : resolution.actionName,
    activation: resolution.activation,
    attack: resolution.attack,
    save: null,
    damage: resolution.damage.map(({ source: _source, ...part }) => part),
    damageTotal: resolution.damageTotal,
    crit: resolution.crit,
    ...(resolution.effectsApplied
      ? { effectsApplied: resolution.effectsApplied.map((applied) => ({ ...applied, name: named(applied.name) })) }
      : {})
  };
}

export const reactionCommands = [
  defineCommand({
    type: "reaction.answer",
    operationId: "answerReaction",
    description:
      "Answers a pending reaction prompt; `use: true` spends the reaction, `use: false` declines it. What else happens depends on the prompt's `kind`. `hit-by-attack` (Uncanny Dodge, Deflect Attacks) and `takes-damage` (Stone's Endurance, Superior Hunter's Defense): the parked damage applies either way, halved, less a rolled amount, or met with Resistance to its type on use. `roll-answer` (Cutting Words, Countercharm, Improve Fate): use applies the answer to the other creature's roll (`subtract` takes an either-way die off), and either way the roll moves on to the next creature that may answer it, then lands. `attack-would-hit` (Parry, Shield): the attack waiting at its roll finishes either way with the same die, against AC raised by the reaction on use, and a hit's damage applies. `leaves-reach` (an opportunity attack) and `damaged-by-creature` (Hellish Rebuke, Retaliation): use strikes the creature with one melee attack with a weapon or an Unarmed Strike (another action is refused), previewable with `commit: false`, the confirm carrying the `hitOptions` its preview offered (Sneak Attack), and damage that lands applies. `triggered` (a stat block's reaction to a hit, a creature's turn starting or ending or its move ending nearby, or damage it takes: Reflexive Antennae, Unnerving Gaze, Ink Cloud, Pursuit, Split, named by `cause`): use does what the reaction says, against the creature that set it off (its action's save or swing) or on the reactor (its area and move, a teleport near that creature, splitting in two). Deflect Missile's use, when the reduction takes the damage to 0, turns its save on `redirectTo`, one of the prompt's `redirectChoices`, else on the attacker. `casts-spell` (Counterspell): the cast waits before anything of it happens; use spends the reaction and a slot, and the caster rolls the saving throw against the reactor's spell save DC, a failure losing the spell with its slot unspent; once every prompt on the cast is answered without stopping it, the cast goes ahead and spends its slot. `slotLevel` casts a reaction spell with a higher slot, which upcasts it (Hellish Rebuke's dice). Player sessions may answer only their claimed character's prompts. The response carries the `outcome`.",
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
        reroll,
        pushFeet,
        hitOptions,
        slotLevel,
        subtract,
        redirectTo
      } = request;
      const initiator = initiatorOf(principal);
      // The rules count a player's Advantage and Disadvantage; only the GM may force a mode.
      const forcedMode = initiator.role === "gm" ? rollMode : undefined;
      // The grid, fetched up front like `action.resolve`'s, so Push on an opportunity attack moves the token.
      const mapAssetId = kit.read().combat.mapAssetId;
      const geometry = mapAssetId ? await kit.context.tokenGeometryFor(mapAssetId) : null;
      const distance = await kit.creatureDistance();
      let outcome: ReturnType<typeof answerReaction> | undefined;
      // What the spell areas a push moves a creature through did to it.
      const pushedThrough: EffectNarration[] = [];
      const { state, duplicate } = await execute((draft) => {
        // A typed die must be one the table takes, and not one typed over the strike's thrown die.
        if (attackNatural !== undefined && reroll !== true)
          requireTypedDie(draft, initiator, heldRollFor(draft, reactionHoldKey(reactionId)), attackNatural);
        const prompt = draft.combat.pendingReactions.find((entry) => entry.id === reactionId);
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
              geometry && draft.combat.mapAssetId === mapAssetId
                ? pushThroughZones(draft, input, geometry, kit.zoneDeps(draft, geometry), pushedThrough)
                : null,
            distanceFeet: (actorIdA, actorIdB) => distance(draft, actorIdA, actorIdB)
          },
          {
            commit,
            ...(forcedMode !== undefined ? { rollMode: forcedMode } : {}),
            ...(attackNatural !== undefined ? { attackNatural } : {}),
            ...(request.attackRolledTotal !== undefined ? { attackRolledTotal: request.attackRolledTotal } : {}),
            ...(reroll === true ? { reroll: true } : {}),
            ...(pushFeet !== undefined ? { pushFeet } : {}),
            ...(hitOptions ? { hitOptions } : {}),
            ...(slotLevel !== undefined ? { slotLevel } : {}),
            ...(subtract === true ? { subtract: true } : {}),
            ...(redirectTo !== undefined ? { redirectTo } : {})
          }
        );
        // The reaction taken counts toward the sheet's most-used options: the strike's own action, or the prompt's.
        const strike = outcome.kind === "leaves-reach" || outcome.kind === "damaged-by-creature";
        const counted = strike
          ? outcome.resolution?.preview
            ? undefined
            : outcome.resolution?.actionId
          : prompt?.actionId;
        if (outcome.used && counted) countOptionUse(draft, outcome.actorId, counted);
      });
      if (duplicate || !outcome) return;
      kit.publishRolls(state, commandId);
      // A cast that went ahead rolled under its own command, as it would have with no Counterspell.
      if (outcome.castCommandId && outcome.resolution) kit.publishRolls(state, outcome.castCommandId);
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
          outcome.kind === "attack-would-hit" ||
            outcome.kind === "casts-spell" ||
            outcome.kind === "roll-answer" ||
            outcome.kind === "attack-targeted"
            ? outcome.other!.id
            : outcome.actorId
        );
      kit.publishNarrations(outcome.events);
      kit.publishNarrations(pushedThrough);
      const resolution =
        outcome.resolution &&
        (outcome.kind === "attack-would-hit" || outcome.kind === "roll-answer" || outcome.kind === "attack-targeted") &&
        !isGmGrade(principal)
          ? metAttack(
              outcome.resolution,
              outcome.other?.name ?? null,
              outcome.other ? kit.hiddenFor(initiator, state)(outcome.other.id) : true
            )
          : outcome.kind === "casts-spell" && !isGmGrade(principal)
            ? undefined
            : outcome.resolution;
      return {
        outcome: {
          used: outcome.used,
          appliedDamage: outcome.appliedDamage,
          ...(resolution ? { resolution } : {}),
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
      "Dismisses a pending reaction prompt without applying anything it holds (GM-grade only): parked damage is dropped, and so are an attack waiting on a Parry or Shield and a spell waiting on a Counterspell. It is for when the GM settled it by hand. A prompt asking another creature to answer a roll (`roll-answer`) is declined instead, so the roll moves on without that answer.",
    summary: "Dismiss a pending reaction prompt without applying what it holds (GM).",
    schema: ReactionDismissSchema,
    malformed: "The dismissal is malformed.",
    gmOnly: "Only the GM can dismiss a reaction prompt.",
    async run({ principal, request, execute, dispatch }, kit) {
      // A roll waiting on an answer moves on without it: the GM closing the prompt is a decline.
      const prompt = kit.read().combat.pendingReactions.find((entry) => entry.id === request.reactionId);
      if (prompt?.kind === "roll-answer")
        return dispatch("reaction.answer", {
          commandId: request.commandId,
          reactionId: request.reactionId,
          use: false,
          ...(request.expectedRevision === undefined ? {} : { expectedRevision: request.expectedRevision })
        });
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
            distanceFeet: (actorIdA, actorIdB) => distance(state, actorIdA, actorIdB),
            rollDie: (sides) => kit.context.random(sides)
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
