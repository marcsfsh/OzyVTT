import type { HeldRoll, LooseSaveOutcome, RollAnswered, RollAnswerOffer } from "@vtt/domain";
import { aggregateRollMode, otherDiceOf } from "@vtt/rules-5e";
import { GameAccessDeniedError, requireActorAccess, requireGm } from "../authorization.js";
import { autoFailsPhysicalSaves, conditionLabel, exhaustionPenalty } from "../condition-rules.js";
import { holdsFeature } from "../class-features.js";
import { DEATH_SAVE_FLOOR_TAG, rollDeathSave, SURVIVOR_CRITICAL } from "../death-saves.js";
import { startStableRecovery, type EffectNarration } from "../effects.js";
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
import { heldRollFor, holdRoll, releaseHeldRoll, rollHeldTest } from "../held-rolls.js";
import { damageAdjustmentDetail, healActor } from "../hit-points.js";
import { recordRoll } from "../roll-history.js";
import {
  answeredLines,
  answersOffered,
  applyRollAnswer,
  withAnswers,
  type AnswerDeps,
  type AnswerTarget
} from "../roll-answers.js";
import {
  answerSave,
  anySaveRollSources,
  auraOfProtection,
  dismissSave,
  recordSaveRoll,
  saveRiderBonusForAnySave,
  saveRiderDiceTerms,
  saveRiderDiceTermsForAnySave,
  saveRollSources,
  saveTotalFor,
  shownRollMode
} from "../saving-throws.js";
import { initiatorOf, isGmGrade, sessionIdOf } from "./kit.js";
import { pushThroughZones } from "../pushed-through.js";
import { defineCommand } from "./pipeline.js";
import { withArticle } from "@vtt/domain";

// Saving throws, owed and loose, and death saves.

export const saveCommands = [
  defineCommand({
    type: "save.roll",
    operationId: "rollSave",
    description:
      'Rolls a saving throw for one character. When a pending save is open for that character and ability, this answers it through the same path the encounter tracker uses (the damage and condition apply and the prompt closes) and acks `route: "answered"` with the `saveId`. With nothing open it rolls a loose, attributed save under the same rules the resolver uses (the modifier, Exhaustion, an ally Paladin\'s aura, the Advantage and Disadvantage the rules give, and the automatic failure of a Strength or Dexterity save while Paralyzed, Petrified, Stunned or Unconscious), and acks `route: "loose"` with the `outcome`. `face` is a typed d20 (a player only while the table lets players type their dice); `total` and `rollMode` are the GM\'s alone. GM-grade for anyone; a player session only for their own claimed character.',
    summary:
      "Roll a saving throw: answers a matching pending save when one is open, otherwise rolls a loose, attributed save.",
    schema: SaveRollSchema,
    malformed: "The saving throw is malformed.",
    issueMessage: true,
    async run({ principal, request, dispatch, execute }, kit) {
      const { commandId, actorId, ability, rollMode, face, total, expectedRevision } = request;
      const initiator = initiatorOf(principal);
      const snapshot = kit.read();
      requireActorAccess(initiator, snapshot, actorId, "save");
      if (total !== undefined) requireGm(initiator, "Type the d20 your die shows; the server adds your bonus.");
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
          ...(face === undefined ? {} : { face }),
          ...(rollMode ? { rollMode } : {}),
          commit: true,
          ...(expectedRevision === undefined ? {} : { expectedRevision })
        });
        return { ...answered, route: "answered", saveId: pending.id };
      }
      // Loose save: the resolver's own rules, with no DC and nothing to apply.
      const distance = await kit.creatureDistance();
      const rollId = kit.context.newId();
      let outcome: LooseSaveOutcome | undefined;
      const { state, duplicate } = await execute((draft) => {
        const live = draft.actors.find((candidate) => candidate.id === actorId);
        if (!live) throw new CommandRejectedError("That combatant no longer exists.");
        const label = `${ability.toUpperCase()} save`;
        const visibility = live.visibility === "gm-only" ? ("gm-only" as const) : ("public" as const);
        const autoFailed = ability === "str" || ability === "dex" ? autoFailsPhysicalSaves(live) : null;
        if (total !== undefined) {
          // The GM's typed total is a ruling, and stands as given.
          recordRoll(draft, {
            id: rollId,
            commandId,
            initiatorSessionId: sessionIdOf(principal),
            initiatorRole: initiator.role,
            initiatorLabel: live.name,
            label,
            actorId,
            purpose: "save",
            visibility,
            formula: String(total),
            normalizedFormula: String(total),
            dice: [],
            modifiers: [{ value: Math.abs(total), sign: total < 0 ? -1 : 1 }],
            total,
            typed: true,
            createdAt: new Date().toISOString()
          });
          outcome = { total };
          return;
        }
        if (autoFailed !== null) {
          // SRD: no die is rolled; the save fails.
          outcome = { autoFailed, total: 0 };
          return;
        }
        const definition = live.definitionId ? kit.resolveDefinitionIn(draft, live.definitionId) : undefined;
        const derivation = deriveEquipment(live, definition, kit.equipmentCatalog());
        const aura =
          auraOfProtection(draft, live, {
            resolveDefinition: (definitionId) => kit.resolveDefinitionIn(draft, definitionId),
            distanceFeet: (actorIdA, actorIdB) => distance(draft, actorIdA, actorIdB),
            catalog: kit.equipmentCatalog()
          })?.amount ?? 0;
        const sources = saveRollSources(live, ability, derivation);
        const aggregated = aggregateRollMode(sources.advantage, sources.disadvantage);
        const forced = initiator.role === "gm" ? rollMode : undefined;
        // A loose save has no preview, so nothing is held: the key is its own roll.
        const test = rollHeldTest(
          draft,
          `loose-save:${rollId}`,
          live,
          initiator,
          forced ?? aggregated.mode,
          saveTotalFor(definition, live, ability, derivation) + aura,
          saveRiderDiceTerms(derivation, ability),
          face === undefined ? {} : { face },
          (sides) => kit.context.random(sides)
        );
        recordSaveRoll(draft, test.resolution, {
          id: rollId,
          commandId,
          sessionId: sessionIdOf(principal),
          role: initiator.role,
          label: live.name,
          saveLabel: label,
          actorId,
          visibility,
          createdAt: new Date().toISOString(),
          typed: test.typed
        });
        const shown = test.typed ? undefined : shownRollMode(aggregated, forced);
        outcome = { total: test.resolution.total, natural: test.natural, ...(shown ? { rollMode: shown } : {}) };
      });
      if (duplicate) return { route: "loose", rollId };
      kit.publishRolls(state, commandId);
      if (outcome?.autoFailed)
        kit.context.appendLog({
          kind: "save",
          text: `${kit.actorName(actorId)} automatically fails the ${ability.toUpperCase()} save (${conditionLabel(outcome.autoFailed)}).`,
          actorId,
          actorIds: [actorId],
          gmOnly: kit.actorHidden(actorId)
        });
      return { route: "loose", rollId, ...(outcome ? { outcome } : {}) };
    }
  }),

  defineCommand({
    type: "save.answer",
    operationId: "answerSave",
    description:
      'Answers a pending saving throw; on commit the outcome auto-applies damage and conditions, and pushes a creature whose failure pushes it on the live map. `method: "roll"`: the server throws the d20, or takes `face`, a typed d20 (a player only while the table lets players type their dice, and never over a die the server already threw for this save), and adds the save\'s modifier; a Strength or Dexterity save fails without a roll while the creature is Paralyzed, Petrified, Stunned or Unconscious. A preview (`commit: false`) holds its die, so another preview shows the same one and the confirm uses it; `reroll` throws it again (a player spends Heroic Inspiration to reroll one die, the GM throws afresh). A player\'s `rollMode` is ignored: the rules decide. `method: "manual"` with `total` is the GM\'s ruling, used as given. `method: "fail"` is the creature choosing to fail without a roll (a willing target), which its own player or the GM may answer. Player sessions may answer only their claimed character\'s saves. The response carries the `outcome`.',
    summary: "Answer a pending saving throw by rolling, by a typed d20, or (the GM) by a total.",
    schema: SaveAnswerSchema,
    malformed: "The saving-throw answer is malformed.",
    issueMessage: true,
    async run({ principal, request, execute }, kit) {
      const initiator = initiatorOf(principal);
      const { commandId, saveId, method, total, face, reroll, rollMode, commit, legendaryResistance, damageOverride } =
        request;
      const pending = kit.read().combat.pendingSaves.find((entry) => entry.id === saveId);
      const distance = await kit.creatureDistance();
      // A failure that pushes moves the token on the live map; one changed meanwhile asks the GM to move it.
      const mapAssetId = kit.read().combat.mapAssetId;
      const geometry = pending?.failurePush ? await kit.liveGeometry() : null;
      let answered: ReturnType<typeof answerSave> | undefined;
      // What the spell areas a push moves the creature through did to it.
      const pushedThrough: EffectNarration[] = [];
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
            distanceFeet: (actorIdA, actorIdB) => distance(draft, actorIdA, actorIdB),
            pushToken: (input) =>
              geometry && draft.combat.mapAssetId === mapAssetId
                ? pushThroughZones(draft, input, geometry, kit.zoneDeps(draft, geometry), pushedThrough)
                : null
          },
          legendaryResistance,
          rollMode,
          damageOverride,
          {
            ...(face !== undefined ? { face } : {}),
            ...(reroll === true ? { reroll: true } : {}),
            ...(request.answer ? { answer: request.answer } : {})
          }
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
          text: `${kit.actorName(pending.targetActorId)} ${outcome.autoFailed ? "automatically failed" : outcome.autoSucceeded ? "automatically succeeded on" : outcome.success ? "succeeded on" : "failed"} ${withArticle(`${pending.ability.toUpperCase()} save`)}${outcome.appliedDamage > 0 ? ` and took ${outcome.appliedDamage} damage${detail}` : ""}.`,
          actorIds: [pending.targetActorId],
          gmOnly: kit.actorHidden(pending.targetActorId)
        });
      }
      kit.publishNarrations(answered?.events ?? []);
      kit.publishNarrations(pushedThrough);
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
      "Rolls a death saving throw for a dying character (at 0 HP): natural 20 regains 1 HP, natural 1 counts two failures, a total of 10+ (after Exhaustion, save bonuses, Bless's d4 and an ally Paladin's aura) succeeds (three stabilize), otherwise a failure (three kill). In a fight a player commits one per turn, on the character's own turn. Default applies in one step; pass `commit: false` to preview the projected pips first: the server holds the previewed die, so another preview shows the same one and the confirm (`commit: true`) uses it, and `reroll` throws it again (a player spends Heroic Inspiration, the GM throws afresh). `naturalRoll` is a typed d20 (a player only while the table lets players type their dice, and never over a die the server already threw). Riders on every saving throw give Advantage or Disadvantage; a player's `rollMode` is ignored. The roll is recorded in the shared history and the response carries `deathSave`. GM-grade anyone; a player session only their claimed character.",
    summary: "Roll a death saving throw for a dying character (GM anyone; a player their claimed character).",
    schema: DeathSaveRollSchema,
    malformed: "The death save is malformed.",
    async run({ principal, request, execute }, kit) {
      const initiator = initiatorOf(principal);
      const { commandId, actorId, commit, rollMode, naturalRoll, reroll } = request;
      const rollId = kit.context.newId();
      const distance = await kit.creatureDistance();
      let roll: ReturnType<typeof rollDeathSave> | undefined;
      let rollModeSources: ReturnType<typeof shownRollMode>;
      const events: EffectNarration[] = [];
      let answered: RollAnswered[] = [];
      let offered: RollAnswerOffer[] = [];
      const { state, duplicate } = await execute((draft) => {
        // Access first: a missing creature and someone else's get one answer.
        requireActorAccess(initiator, draft, actorId, "save", "You can only roll for your own character.");
        const actor = draft.actors.find((candidate) => candidate.id === actorId);
        if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
        if (actor.deathSaves === null || actor.hp.current > 0)
          throw new CommandRejectedError("That character isn't dying.");
        if (actor.deathSaves.stable) throw new CommandRejectedError("A stable character doesn't roll death saves.");
        if (actor.deathSaves.failures >= 3)
          throw new CommandRejectedError("That character is dead. Only a revival brings a dead character back.");
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
        // A death save is a saving throw: Exhaustion, every-save bonuses and Bless's d4, and an ally Paladin's aura.
        const aura =
          auraOfProtection(draft, actor, {
            resolveDefinition: (definitionId) => kit.resolveDefinitionIn(draft, definitionId),
            distanceFeet: (actorIdA, actorIdB) => distance(draft, actorIdA, actorIdB),
            catalog: kit.equipmentCatalog()
          })?.amount ?? 0;
        const modifier = exhaustionPenalty(actor) + saveRiderBonusForAnySave(derivation) + aura;
        const sources = anySaveRollSources(derivation);
        const aggregated = aggregateRollMode(sources.advantage, sources.disadvantage);
        const forced = initiator.role === "gm" ? rollMode : undefined;
        const key = `death-save:${actorId}`;
        if (request.answer && (commit || reroll === true || naturalRoll !== undefined))
          throw new CommandRejectedError("Answer the death save on a look of its own, before you confirm it.");
        if (request.answer && !heldRollFor(draft, key))
          throw new CommandRejectedError("Roll first: an answer meets a roll that was made.");
        const mode = forced ?? aggregated.mode;
        const throwDeathSave = (choice: Readonly<{ face?: number; reroll?: boolean }>) =>
          rollHeldTest(
            draft,
            key,
            actor,
            initiator,
            mode,
            modifier,
            saveRiderDiceTermsForAnySave(derivation),
            choice,
            kit.context.random
          );
        let test = throwDeathSave(
          request.answer
            ? {}
            : {
                ...(naturalRoll !== undefined ? { face: naturalRoll } : {}),
                ...(reroll === true ? { reroll: true } : {})
              }
        );
        rollModeSources = test.typed ? undefined : shownRollMode(aggregated, forced);
        // What answered the death save on an earlier look counts in this one, the confirm included.
        const answeredBefore = heldRollFor(draft, key);
        const answerDeps: AnswerDeps = {
          resolveDefinition: (definitionId) => kit.resolveDefinitionIn(draft, definitionId),
          catalog: kit.equipmentCatalog(),
          random: kit.context.random,
          newRollId: kit.context.newId,
          sessionId: sessionIdOf(principal),
          role: initiator.role,
          now: () => new Date().toISOString(),
          commandId,
          distanceFeet: (actorIdA, actorIdB) => distance(draft, actorIdA, actorIdB)
        };
        const answerTarget = (held: HeldRoll | undefined): AnswerTarget => {
          const shown = withAnswers(held, test.natural, test.resolution.total);
          return {
            kind: "death-save",
            roller: actor,
            key,
            natural: shown.natural,
            total: shown.total,
            threshold: 10,
            mode,
            purpose: "save",
            label: "death save",
            visibility: actor.visibility === "gm-only" ? "gm-only" : "public"
          };
        };
        if (request.answer && answeredBefore) {
          events.push(...applyRollAnswer(draft, answerTarget(answeredBefore), actor, request.answer, answerDeps));
          // A reroll answer changed the held dice; this look reads them.
          test = throwDeathSave({});
        }
        const answeredHeld = commit ? answeredBefore : heldRollFor(draft, key);
        const read = withAnswers(answeredHeld, test.natural, test.resolution.total);
        answered = answeredLines(answeredHeld);
        // The die and preview/commit logic live in the shared death-save core.
        roll = rollDeathSave(
          draft,
          actor,
          {
            commit,
            test: { ...test, natural: read.natural },
            total: read.total,
            ...(derivation.context.effectTags?.includes(DEATH_SAVE_FLOOR_TAG) ? { floor: 10 } : {}),
            ...(holdsFeature(definition, "survivor", "Survivor") ? { criticalFrom: SURVIVOR_CRITICAL } : {})
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
        if (commit) releaseHeldRoll(draft, key);
        else {
          holdRoll(draft, {
            key,
            actorId,
            faces: test.faces,
            others: otherDiceOf(test.resolution),
            rollId: test.fresh ? rollId : (heldRollFor(draft, key)?.rollId ?? null),
            typed: test.typed
          });
          offered = answersOffered(draft, answerTarget(heldRollFor(draft, key)), answerDeps);
        }
        if (commit && inFight && draft.combat.turnActorId === actorId)
          draft.combat.turn = { ...draft.combat.turn, deathSaveRolled: true };
        if (commit && roll.outcome.regainsOneHitPoint) events.push(...healActor(draft, actorId, 1, { role: "gm" }));
        // Three successes: Stable, and 1 Hit Point back after 1d4 hours of game time.
        else if (commit && roll.outcome.state.stable)
          events.push(...startStableRecovery(draft, actor, kit.context.random, `${commandId}:stable`));
      });
      if (duplicate || !roll) return { rollId };
      kit.publishRolls(state, commandId);
      const outcome = roll.outcome;
      if (commit) {
        const name = kit.actorName(actorId);
        const text = outcome.regainsOneHitPoint
          ? roll.face < 20
            ? `${name} rolled ${roll.face} on a death save, which counts as a 20 (Survivor), and regains 1 HP.`
            : `${name} rolled a natural 20 on a death save and regains 1 HP.`
          : outcome.dead
            ? `${name} failed a third death save and dies.`
            : outcome.state.stable
              ? `${name} is stable.`
              : `${name} ${outcome.outcome === "critical-failure" ? "rolled a natural 1, which counts as two death save failures" : outcome.outcome === "success" ? "succeeded on a death save" : "failed a death save"} (${outcome.state.successes}S/${outcome.state.failures}F).`;
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
          total: roll.total,
          outcome: outcome.outcome,
          successes: outcome.state.successes,
          failures: outcome.state.failures,
          stable: outcome.state.stable,
          dead: outcome.dead,
          regainedConsciousness: outcome.regainsOneHitPoint,
          committed: commit,
          ...(roll.mode ? { rollMode: roll.mode } : {}),
          ...(rollModeSources ? { rollModeSources } : {}),
          ...(answered.length > 0 ? { answered } : {}),
          ...(offered.length > 0 ? { answers: offered } : {})
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
            distanceFeet: (actorIdA, actorIdB) => distance(draft, actorIdA, actorIdB),
            unseen: kit.unseenBy(initiator, draft)
          }
        );
      });
      if (duplicate || !outcome) return;
      kit.publishRolls(state, request.commandId);
      if (outcome.overridden)
        kit.context.appendLog({
          kind: "override",
          text: `OVERRIDE (${outcome.overridden.rule}): aid for ${kit.actorName(request.actorId)} · ${outcome.overridden.reason}`,
          actorIds: [request.actorId]
        });
      kit.publishNarrations(outcome.events);
      return { stabilize: { stabilized: outcome.stabilized, woke: outcome.woke, check: outcome.check } };
    }
  })
];
