import { requireActorAccess } from "../authorization.js";
import { rollDeathSave } from "../death-saves.js";
import type { EffectNarration } from "../effects.js";
import { deriveEquipment } from "../equipment-derivation.js";
import { DeathSaveRollSchema, SaveAnswerSchema, SaveDismissSchema, SaveRollSchema } from "../game-commands.js";
import { CommandRejectedError } from "../game-store.js";
import { damageAdjustmentDetail, healActor } from "../hit-points.js";
import { answerSave, dismissSave, saveTotalFor } from "../saving-throws.js";
import { initiatorOf, sessionIdOf } from "./kit.js";
import { defineCommand } from "./pipeline.js";

// Saving throws, owed and loose, and death saves.

export const saveCommands = [
  defineCommand({
    type: "save.roll",
    summary:
      "Roll a saving throw: answers a matching pending save when one is open, otherwise rolls a loose, attributed save.",
    schema: SaveRollSchema,
    malformed: "The saving throw is malformed.",
    async run({ request, dispatch }, kit) {
      const { commandId, actorId, ability, rollMode, total, expectedRevision } = request;
      const snapshot = kit.read();
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
      const die = rollMode === "advantage" ? "2d20kh1" : rollMode === "disadvantage" ? "2d20kl1" : "1d20";
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
    summary: "Answer a pending saving throw by rolling or entering a total.",
    schema: SaveAnswerSchema,
    malformed: "The saving-throw answer is malformed.",
    issueMessage: true,
    async run({ principal, request, execute }, kit) {
      const initiator = initiatorOf(principal);
      const { commandId, saveId, method, total, rollMode, commit, legendaryResistance, damageOverride } = request;
      const pending = kit.read().combat.pendingSaves.find((entry) => entry.id === saveId);
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
            catalog: kit.equipmentCatalog()
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
    summary: "Dismiss a pending saving throw without resolving it.",
    schema: SaveDismissSchema,
    malformed: "The dismissal is malformed.",
    async run({ principal, request, execute }) {
      await execute((state) => dismissSave(state, request.saveId, initiatorOf(principal)));
    }
  }),

  defineCommand({
    type: "death-save.roll",
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
          throw new CommandRejectedError("That character is dead - heal or revive them through the GM.");
        // The die and preview/commit logic live in the shared death-save core.
        roll = rollDeathSave(
          draft,
          actor,
          { commit, rollMode, naturalRoll },
          {
            random: kit.context.random,
            rollId,
            commandId,
            sessionId: sessionIdOf(principal),
            role: initiator.role,
            now: () => new Date().toISOString()
          }
        );
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
  })
];
