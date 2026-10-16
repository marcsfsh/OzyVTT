import { d20Die } from "@vtt/rules-5e";
import { GameAccessDeniedError, requireActorAccess } from "../authorization.js";
import { rollDeathSave } from "../death-saves.js";
import type { EffectNarration } from "../effects.js";
import { deriveEquipment } from "../equipment-derivation.js";
import { stabilizeCreature } from "../stabilize.js";
import {
  ActorStabilizeSchema,
  DeathSaveRollSchema,
  SaveAnswerSchema,
  SaveDismissSchema,
  SaveRollSchema
} from "@vtt/domain/commands";
import { CommandRejectedError } from "../game-store.js";
import { damageAdjustmentDetail, healActor } from "../hit-points.js";
import { answerSave, dismissSave, saveRiderBonusForAnySave, saveTotalFor } from "../saving-throws.js";
import { exhaustionPenalty } from "../condition-rules.js";
import { initiatorOf, isGmGrade, sessionIdOf } from "./kit.js";
import { defineCommand } from "./pipeline.js";

// Saving throws, owed and loose, and death saves.

export const saveCommands = [
  defineCommand({
    type: "save.roll",
    operationId: "rollSave",
    description:
      'Rolls a saving throw for one character. When a pending save is open for that character and ability, this ANSWERS it through the same path the encounter tracker uses - the damage and condition apply and the prompt closes - and acks `route: "answered"` with the `saveId`; the sheet\'s save chip used to roll a loose die that ignored the open prompt entirely. With nothing open it rolls a loose, attributed save at the same modifier the resolver would use, and acks `route: "loose"`. Supply `total` for an off-screen die. GM-grade for anyone; a player session only for their own claimed character.',
    summary:
      "Roll a saving throw: answers a matching pending save when one is open, otherwise rolls a loose, attributed save.",
    schema: SaveRollSchema,
    malformed: "The saving throw is malformed.",
    async run({ principal, request, dispatch }, kit) {
      const { commandId, actorId, ability, rollMode, total, expectedRevision } = request;
      const snapshot = kit.read();
      requireActorAccess(initiatorOf(principal), snapshot, actorId, "save");
      const actor = snapshot.actors.find((candidate) => candidate.id === actorId);
      if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
      // Oldest first: a character owing two saves answers the longest-waiting one.
      const pending = snapshot.combat.pendingSaves.find(
        (entry) => entry.targetActorId === actorId && entry.ability === ability
      );
      if (pending) {
        const answered = await dispatch("save.answer", {
          commandId,
          saveId: pending.id,
          method: total === undefined ? "roll" : "manual",
          ...(total === undefined ? {} : { total }),
          ...(rollMode ? { rollMode } : {}),
          commit: true,
          ...(expectedRevision === undefined ? {} : { expectedRevision })
        });
        return { ...answered, route: "answered", saveId: pending.id };
      }
      // Loose save at the same modifier the resolver would use.
      const definition = actor.definitionId ? kit.resolveDefinitionIn(snapshot, actor.definitionId) : undefined;
      const modifier = saveTotalFor(
        definition,
        actor,
        ability,
        deriveEquipment(actor, definition, kit.equipmentCatalog())
      );
      const die = d20Die(rollMode);
      const loose = await dispatch("dice.roll", {
        commandId,
        actorId,
        formula:
          total === undefined
            ? `${die}${modifier === 0 ? "" : modifier < 0 ? ` - ${Math.abs(modifier)}` : ` + ${modifier}`}`
            : `${total}`,
        purpose: "save",
        visibility: actor.visibility === "gm-only" ? "gm-only" : "public",
        label: `${ability.toUpperCase()} save`,
        ...(expectedRevision === undefined ? {} : { expectedRevision })
      });
      return { ...loose, route: "loose" };
    }
  }),

  defineCommand({
    type: "save.answer",
    operationId: "answerSave",
    description:
      "Answers a pending saving throw by server roll or manual total; on commit the outcome auto-applies damage/conditions. Player sessions may answer only their claimed character's saves. The response carries the `outcome`.",
    summary: "Answer a pending saving throw by rolling or entering a total.",
    schema: SaveAnswerSchema,
    malformed: "The saving-throw answer is malformed.",
    issueMessage: true,
    async run({ principal, request, execute }, kit) {
      const initiator = initiatorOf(principal);
      const { commandId, saveId, method, total, rollMode, commit, legendaryResistance, damageOverride } = request;
      const pending = kit.read().combat.pendingSaves.find((entry) => entry.id === saveId);
      const distance = await kit.creatureDistance();
      let answered: ReturnType<typeof answerSave> | undefined;
      const { state, duplicate } = await execute((draft) => {
        answered = answerSave(
          draft,
          commandId,
          saveId,
          method,
          total,
          commit,
          initiator,
          {
            random: (sides) => kit.context.random(sides),
            newRollId: kit.context.newId,
            sessionId: sessionIdOf(principal),
            role: initiator.role,
            now: () => new Date().toISOString(),
            resolveDefinition: kit.resolveDefinition,
            catalog: kit.equipmentCatalog(),
            distanceFeet: (actorIdA, actorIdB) => distance(draft, actorIdA, actorIdB)
          },
          legendaryResistance,
          rollMode,
          damageOverride
        );
      });
      if (duplicate) return;
      kit.publishRolls(state, commandId);
      const outcome = answered?.outcome;
      if (outcome && outcome.committed && pending) {
        // Same damage-adjustment formatter as every other damage line.
        const detail = damageAdjustmentDetail({
          parts: outcome.parts ?? [],
          ...(outcome.flatReduction ? { flatReduction: outcome.flatReduction } : {})
        });
        kit.context.broadcastTableEvent({
          kind: "save",
          text: `${kit.actorName(pending.targetActorId)} ${outcome.autoFailed ? "automatically failed" : outcome.success ? "succeeded on" : "failed"} a ${pending.ability.toUpperCase()} save${outcome.appliedDamage > 0 ? ` - ${outcome.appliedDamage} damage${detail}` : ""}.`,
          actorIds: [pending.targetActorId],
          gmOnly: kit.actorHidden(pending.targetActorId)
        });
      }
      kit.publishNarrations(answered?.events ?? []);
      return outcome ? { outcome } : undefined;
    }
  }),

  defineCommand({
    type: "save.dismiss",
    operationId: "dismissSave",
    description: "Dismisses a pending saving throw without resolving it (GM-grade, or the owing player).",
    summary: "Dismiss a pending saving throw without resolving it.",
    schema: SaveDismissSchema,
    malformed: "The dismissal is malformed.",
    async run({ principal, request, execute }) {
      await execute((state) => dismissSave(state, request.saveId, initiatorOf(principal)));
    }
  }),

  defineCommand({
    type: "death-save.roll",
    operationId: "rollDeathSave",
    description:
      "Rolls a death saving throw for a dying character (at 0 HP): natural 20 regains 1 HP, natural 1 counts two failures, a total of 10+ (after Exhaustion and save bonuses) succeeds (three stabilize), otherwise a failure (three kill). In a fight a player commits one per turn, on the character's own turn. Default applies in one step; pass `commit: false` to preview the projected pips first (honoring `rollMode` adv/disadv), then confirm with `commit: true` and the shown `naturalRoll`. The roll is recorded in the shared history and the response carries `deathSave`. GM-grade anyone; a player session only their claimed character.",
    summary: "Roll a death saving throw for a dying character (GM anyone; a player their claimed character).",
    schema: DeathSaveRollSchema,
    malformed: "The death save is malformed.",
    async run({ principal, request, execute }, kit) {
      const initiator = initiatorOf(principal);
      const { commandId, actorId, commit, rollMode, naturalRoll } = request;
      const rollId = kit.context.newId();
      let roll: ReturnType<typeof rollDeathSave> | undefined;
      let events: EffectNarration[] = [];
      const { state, duplicate } = await execute((draft) => {
        const actor = draft.actors.find((candidate) => candidate.id === actorId);
        if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
        requireActorAccess(initiator, draft, actorId, "save", "You can only roll for your own character.");
        if (actor.deathSaves === null || actor.hp.current > 0)
          throw new CommandRejectedError("That character isn't dying.");
        if (actor.deathSaves.stable) throw new CommandRejectedError("A stable character doesn't roll death saves.");
        if (actor.deathSaves.failures >= 3)
          throw new CommandRejectedError("That character is dead - only a revival brings them back.");
        // In a fight a death save comes once, at the start of the dying creature's turn. The GM may roll
        // one any time, as a correction.
        const inFight = draft.combat.active && draft.combat.initiative.some((entry) => entry.actorId === actorId);
        if (inFight && commit && !isGmGrade(principal)) {
          if (draft.combat.turnActorId !== actorId)
            throw new CommandRejectedError(`${actor.name} rolls a death save at the start of their own turn.`);
          if (draft.combat.turn.deathSaveRolled === true)
            throw new CommandRejectedError(`${actor.name} has already made this turn's death save.`);
        }
        const definition = actor.definitionId ? kit.resolveDefinitionIn(draft, actor.definitionId) : undefined;
        const derivation = deriveEquipment(actor, definition, kit.equipmentCatalog());
        // The die and preview/commit logic live in the shared death-save core.
        roll = rollDeathSave(
          draft,
          actor,
          {
            commit,
            rollMode,
            naturalRoll,
            modifier: exhaustionPenalty(actor) + saveRiderBonusForAnySave(derivation)
          },
          {
            random: kit.context.random,
            rollId,
            commandId,
            sessionId: sessionIdOf(principal),
            role: initiator.role,
            now: () => new Date().toISOString()
          }
        );
        if (commit && inFight && draft.combat.turnActorId === actorId)
          draft.combat.turn = { ...draft.combat.turn, deathSaveRolled: true };
        if (commit && roll.outcome.regainsOneHitPoint) events = healActor(draft, actorId, 1, { role: "gm" });
      });
      if (duplicate || !roll) return { rollId };
      kit.publishRolls(state, commandId);
      const outcome = roll.outcome;
      if (commit) {
        const name = kit.actorName(actorId);
        const text = outcome.regainsOneHitPoint
          ? `${name} rolled a natural 20 on a death save and regains 1 HP!`
          : outcome.dead
            ? `${name} failed a third death save and dies.`
            : outcome.state.stable
              ? `${name} is stable.`
              : `${name} ${outcome.outcome === "critical-failure" ? "rolled a natural 1 - two death save failures" : outcome.outcome === "success" ? "succeeded on a death save" : "failed a death save"} (${outcome.state.successes}S/${outcome.state.failures}F).`;
        kit.context.broadcastTableEvent({
          kind: "death-save",
          text,
          actorIds: [actorId],
          gmOnly: kit.actorHidden(actorId)
        });
        kit.publishNarrations(events);
      }
      return {
        rollId,
        deathSave: {
          naturalRoll: roll.face,
          outcome: outcome.outcome,
          successes: outcome.state.successes,
          failures: outcome.state.failures,
          stable: outcome.state.stable,
          dead: outcome.dead,
          regainedConsciousness: outcome.regainsOneHitPoint,
          committed: commit,
          ...(roll.mode ? { rollMode: roll.mode } : {})
        }
      };
    }
  }),

  defineCommand({
    type: "actor.stabilize",
    operationId: "stabilizeActor",
    description:
      'Stabilizes a creature at 0 hit points (SRD Stabilizing a Character), or wakes one knocked out, by the aid `helperId` gives. `method` "medicine" is the Help action\'s first aid: the server rolls the helper\'s Wisdom (Medicine) check (its sheet bonus, Exhaustion, check riders) against DC 10, and a knocked-out creature wakes on a success. "healers-kit" spends one from the helper\'s Healer\'s Kit stack, "spare-the-dying" needs the helper to know the cantrip; neither checks. "gm" is the GM\'s own ruling, with no helper. A Stable creature keeps its Unconscious and stops making death saves. In a fight the aid is the helper\'s action on its own turn, within reach (Spare the Dying: its range), through the rules ladder (`override` is the GM\'s). The response carries `stabilize`. GM-grade with any helper; a player only with their own claimed character, on a creature they can see.',
    summary: "Stabilize a creature at 0 hit points with first aid, a Healer's Kit or Spare the Dying.",
    schema: ActorStabilizeSchema,
    malformed: "The stabilize command is malformed.",
    issueMessage: true,
    async run({ principal, request, execute }, kit) {
      if (request.override && !isGmGrade(principal))
        throw new GameAccessDeniedError("Your GM adjudicates rules overrides.");
      const initiator = initiatorOf(principal);
      const distance = await kit.creatureDistance();
      let outcome: ReturnType<typeof stabilizeCreature> | undefined;
      const { state, duplicate } = await execute((draft) => {
        outcome = stabilizeCreature(
          draft,
          {
            targetId: request.actorId,
            method: request.method,
            ...(request.helperId ? { helperId: request.helperId } : {}),
            override: request.override ?? null,
            commandId: request.commandId
          },
          initiator,
          {
            resolveDefinition: (definitionId) => kit.resolveDefinitionIn(draft, definitionId),
            catalog: kit.equipmentCatalog(),
            random: (sides) => kit.context.random(sides),
            newRollId: kit.context.newId,
            now: () => new Date().toISOString(),
            sessionId: sessionIdOf(principal),
            role: initiator.role,
            distanceFeet: (actorIdA, actorIdB) => distance(draft, actorIdA, actorIdB)
          }
        );
      });
      if (duplicate || !outcome) return;
      kit.publishRolls(state, request.commandId);
      if (outcome.overridden)
        kit.context.appendLog({
          kind: "override",
          text: `OVERRIDE (${outcome.overridden.rule}): aid for ${kit.actorName(request.actorId)} - ${outcome.overridden.reason}`,
          actorIds: [request.actorId]
        });
      kit.publishNarrations(outcome.events);
      return { stabilize: { stabilized: outcome.stabilized, woke: outcome.woke, check: outcome.check } };
    }
  })
];
