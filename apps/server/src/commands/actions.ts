import type { RollRecord } from "@vtt/domain";
import { rollDice } from "@vtt/rules-5e";
import { resolveDefinitionAction } from "../action-resolution.js";
import { addAnnotation, shapeGeometry } from "../annotations.js";
import { areaOriginatesFromCaster, tokensInTemplate } from "../area-targeting.js";
import { canPlayerTarget, GameAccessDeniedError, requireActorAccess } from "../authorization.js";
import { builtinAction } from "../builtin-actions.js";
import { effectiveActions } from "../effective-actions.js";
import { pushTokenAway } from "../forced-movement.js";
import { ActionResolveSchema, ActionUseSchema, DiceRollSchema } from "@vtt/domain/commands";
import { CommandRejectedError } from "../game-store.js";
import { damageAdjustmentDetail } from "../hit-points.js";
import { tokenCreatureDistance } from "../movement-narration.js";
import { settlePlayerDamage, type AppliedDamage } from "../player-damage.js";
import { recordRoll, rolledTerms } from "../roll-history.js";
import { overrideReason, overrideWaives, rememberOverride } from "../rules-families.js";
import {
  looseRollPlan,
  NOT_YOUR_TURN,
  offTurnVerdict,
  routeForTap,
  slotsModeFor,
  spendLooseUses
} from "../tap-routing.js";
import { upcastAction } from "../item-actions.js";
import { lastChargeLine, lastChargeRollFor } from "../item-charges.js";
import { consumableRowFor, withOneUsedUp } from "../consumables.js";
import { castSlotLevel } from "../resolution/economy.js";
import { withChosenDamageType } from "../resolution/validate.js";
import { useCostOf, withChosenCost } from "../use-cost.js";
import { gmGradeLabelOf, initiatorOf, isGmGrade, principalTag, sessionIdOf } from "./kit.js";
import { defineCommand } from "./pipeline.js";

// Stat-block actions, the server-routed "use this action" tap, and free dice rolls.
export const actionCommands = [
  defineCommand({
    type: "action.resolve",
    operationId: "resolveAction",
    description:
      "Runs a stat-block action: attack vs target AC with 2024 crit doubling, or save-DC surfacing with proposed damage. GM-grade for any combatant; a player session only for their own claimed character (area templates, cover, and rules overrides stay GM-only). A player's hit is handed to the GM as a damage proposal, or applied directly when the table's player-damage-mode is `direct`. Targets are explicit ids or an area template (never both); rolls are recorded in the shared history and the response carries the `resolution`.",
    summary:
      "Run a stat-block action: attack vs AC or save-DC with typed damage (GM anyone; a player their own claimed character).",
    schema: ActionResolveSchema,
    malformed: "The action command is malformed.",
    issueMessage: true,
    async run({ principal, request, execute }, kit) {
      const {
        commandId,
        actorId,
        actionId,
        targetIds,
        template,
        conditionId,
        rollMode,
        override,
        commit,
        attackNatural,
        attackTotal,
        critical
      } = request;
      // A player resolves only for their own claimed character (checked inside the mutation); GM-only
      // inputs (templates, overrides, cover, applied conditions/notes) are refused or stripped.
      const initiator = initiatorOf(principal);
      const isPlayer = initiator.role === "player";
      if (isPlayer && template) throw new GameAccessDeniedError("Your GM places area templates.");
      if (isPlayer && override) throw new GameAccessDeniedError("Your GM adjudicates rules overrides.");
      const effectiveConditionId = isPlayer ? null : (conditionId ?? null);
      const effectiveCover = isPlayer ? null : (request.cover ?? null);
      const effectiveNote = isPlayer ? null : (request.note ?? null);
      if (effectiveConditionId !== null && !kit.catalogFor(principal).hasCondition(effectiveConditionId))
        throw new CommandRejectedError("That condition is not in the bundled reference.");
      // The grid is fetched up front (async) so template containment and token-distance rules can run
      // inside the synchronous mutation.
      const mapAssetId = kit.read().combat.mapAssetId;
      const geometry = mapAssetId ? await kit.context.tokenGeometryFor(mapAssetId) : null;
      if (template && !geometry?.calibration)
        throw new CommandRejectedError("Calibrate this map before placing an area template.");
      const gmSessionId = sessionIdOf(principal);
      let resolution: ReturnType<typeof resolveDefinitionAction> | undefined;
      // A player's confirmed hit (or darts) in "direct" mode applies server-side inside the mutation; captured for
      // narration.
      let playerDamageApplied: readonly AppliedDamage[] = [];
      const { state, duplicate } = await execute((draft) => {
        const attacker = draft.actors.find((item) => item.id === actorId);
        if (!attacker) throw new CommandRejectedError("That combatant no longer exists.");
        // The action kind is passed for the per-table policy hook (ADR-0021).
        requireActorAccess(initiator, draft, actorId, "attack");
        const definition = attacker.definitionId ? kit.resolveDefinitionIn(draft, attacker.definitionId) : undefined;
        // Effective actions, so `item-<itemId>` ids resolve and item-raised numbers apply. A stat-block
        // action wins on id collision; builtins cover every combatant.
        const statBlockAction = effectiveActions(definition, attacker, kit.equipmentCatalog()).find(
          (candidate) => candidate.id === actionId
        );
        const listed = statBlockAction ?? builtinAction(actionId);
        if (!listed) throw new CommandRejectedError("That action is not on the stat block.");
        // An action whose user picks its cost (Lay on Hands) resolves at the amount picked.
        const action = withChosenCost(listed, request.spend);
        let resolvedTargetIds: readonly string[];
        if (template) {
          if (action.attack)
            throw new CommandRejectedError(
              "Attacks target a single token - pick it directly instead of placing a template."
            );
          if (draft.combat.mapAssetId !== mapAssetId)
            throw new CommandRejectedError("The active encounter changed. Try again.");
          const calibration = geometry!.calibration!;
          // Snap the template the same way the drawn annotation will, then find who is under it.
          const snapped = shapeGeometry(calibration, template.shape, template.origin, template.target);
          const spell = action.spellId ? kit.equipmentCatalog().spellRecord?.(action.spellId) : undefined;
          const casterOutside = areaOriginatesFromCaster(action.area?.shape ?? template.shape, spell?.range.text);
          resolvedTargetIds = tokensInTemplate(
            draft,
            calibration,
            snapped,
            template.shape,
            action.area?.widthFeet ?? null
          ).filter(
            (id) => (id !== actorId || !casterOutside) && draft.combat.initiative.some((entry) => entry.actorId === id)
          );
          if (resolvedTargetIds.length === 0) throw new CommandRejectedError("No combatants are inside that area.");
        } else {
          resolvedTargetIds = targetIds ?? [];
        }
        // A player may target only public combatants: resolving against a hidden actor would leak its
        // name/AC/outcome through the ack (and in direct mode damage it).
        if (isPlayer && resolvedTargetIds.some((targetId) => !canPlayerTarget(draft, targetId)))
          throw new CommandRejectedError("You can only target combatants you can see.");
        // Footprint-aware (SRD Creature Size): Medium adjacent to Large is 5 ft, not center-to-center 10.
        const distanceFeet = (actorIdA: string, actorIdB: string): number | null =>
          geometry ? (tokenCreatureDistance(draft, geometry, actorIdA, actorIdB)?.value ?? null) : null;
        // SRD forced movement (Push), snapped like a GM drag; takes no client input. Only `targets[0]` of a hit
        // is pushed, already restricted to public combatants for players. If the map changed since the grid
        // was fetched, degrade to null ("move the token") rather than throw.
        const pushToken = (input: Readonly<{ actorId: string; awayFromActorId: string; distanceFeet: number }>) =>
          draft.combat.mapAssetId === mapAssetId ? pushTokenAway(draft, input, geometry) : null;
        resolution = resolveDefinitionAction(
          draft,
          action,
          {
            actorId,
            targetIds: resolvedTargetIds,
            commandId,
            conditionId: effectiveConditionId,
            rollMode: rollMode ?? null,
            override: isPlayer ? null : (override ?? null),
            builtin: statBlockAction === undefined,
            note: effectiveNote,
            effectId: request.effectId ?? null,
            cover: effectiveCover,
            commit,
            attackNatural,
            attackTotal,
            critical,
            ...(request.pushFeet !== undefined ? { pushFeet: request.pushFeet } : {}),
            ...(request.slotLevel !== undefined ? { slotLevel: request.slotLevel } : {}),
            ...(request.damageType !== undefined ? { damageType: request.damageType } : {}),
            ...(request.hitOptions ? { hitOptions: request.hitOptions } : {})
          },
          {
            random: (sides) => kit.context.random(sides),
            newRollId: kit.context.newId,
            gmSessionId,
            initiatorRole: initiator.role,
            initiatorSessionId: sessionIdOf(principal),
            now: () => new Date().toISOString(),
            definition,
            distanceFeet,
            resolveDefinition: (definitionId) => kit.resolveDefinitionIn(draft, definitionId),
            catalog: kit.equipmentCatalog(),
            pushToken
          }
        );
        // A player's confirmed hit is settled server-side per the player-damage policy (GM-confirmed proposal
        // by default, or applied directly), so the player never mutates a creature they don't own.
        if (isPlayer)
          playerDamageApplied = settlePlayerDamage(
            draft,
            resolution,
            attacker.name,
            actorId,
            draft.combat.playerDamageMode,
            {
              resolveDefinition: (definitionId) => kit.resolveDefinitionIn(draft, definitionId),
              newId: kit.context.newId,
              now: () => Date.now(),
              catalog: kit.equipmentCatalog(),
              distanceFeet
            }
          );
        // Record the blast as a public shape; id=commandId keeps re-delivery idempotent.
        if (template)
          addAnnotation(
            draft,
            {
              id: commandId,
              kind: "shape",
              shape: template.shape,
              origin: template.origin,
              target: template.target,
              visibility: "public",
              actor: { sessionId: gmSessionId, role: "gm" },
              now: Date.now()
            },
            geometry!
          );
      });
      if (duplicate || !resolution) return;
      // A preview recorded only the attack die: publish the roll, but hold narration until the resolve is confirmed.
      kit.publishRolls(state, commandId);
      if (!resolution.preview) {
        const hidden = kit.actorHidden(actorId);
        kit.context.broadcastTableEvent({
          kind: "action",
          text: `${kit.actorName(actorId)} used ${resolution.actionName}.`,
          actorIds: [actorId],
          gmOnly: hidden
        });
        // Rules-engine narration (ADR-0020): overrides are audited, warnings reach the GM, applied effects reach the table.
        if (resolution.overridden)
          kit.context.appendLog({
            kind: "override",
            text: `OVERRIDE (${resolution.overridden.rule}): ${kit.actorName(actorId)} used ${resolution.actionName} - ${resolution.overridden.reason}`,
            actorIds: [actorId]
          });
        // Builtin check rolls narrate to the table.
        if (resolution.check) {
          const verdict =
            resolution.check.success === null ? "" : resolution.check.success ? " - success" : " - failure";
          kit.context.appendLog({
            kind: "action",
            text: `${kit.actorName(actorId)} rolled ${resolution.check.total} on ${resolution.check.skill}${resolution.check.dc !== null ? ` vs DC ${resolution.check.dc}` : ""}${verdict}.`,
            actorIds: [actorId],
            gmOnly: hidden
          });
        }
        kit.narrateResolution(resolution, actorId);
        for (const { outcome, targetId, sourceActorId, label } of playerDamageApplied) {
          // Narrated like actor:apply-damage. Both actors ride actorIds so the line is gm-only if either is hidden.
          const detail = damageAdjustmentDetail(outcome.application);
          const text = `${label} hit ${kit.actorName(targetId)} for ${outcome.application.totalApplied} damage${detail}.`;
          kit.context.broadcastTableEvent({ kind: "damage", text, actorIds: [targetId, sourceActorId] });
          kit.context.appendLog({ kind: "damage", text, actorIds: [targetId, sourceActorId] });
          kit.publishNarrations(outcome.events);
        }
      }
      return { resolution };
    }
  }),

  defineCommand({
    type: "action.use",
    operationId: "useAction",
    description:
      "Uses an action and lets the SERVER decide what that means. In the fight on this creature's turn it delegates to the full structured resolution and acks `route: \"resolved\"`. Off turn it is refused with the overridable, askable rules block `economy.not-your-turn` (reactions and legendary actions are exempt - taking those off turn is the point); under an `economy` exception of advise/off it resolves, with a GM-only warning line under advise. With no fight running - or with this creature not in the turn order - the server rolls the action's own attack die (and, only with `includeDamage`, its damage parts) as attributed rolls, spends what the action costs (an item's charges or a feature's per-rest uses, and any spell slot an item cast consumes; refused when none remain; an item's last charge rolls its d20 for the GM), touches no combat state, and acks `route: \"loose\"` with the roll ids. An action with nothing to roll is still used, with a feed line. No hit points ever move on the loose route. GM-grade for any combatant, including a monster's sheet; a player session only for their own claimed character.",
    summary:
      "Use an action and let the SERVER route it: resolved in the fight on your turn, refused off turn, loose dice outside a fight (GM anyone; a player their own claimed character).",
    schema: ActionUseSchema,
    malformed: "The action command is malformed.",
    // The server picks structured resolve, blocked or loose roll and says so in the reply.
    async run({ principal, request, execute, dispatch }, kit) {
      const {
        commandId,
        actorId,
        actionId,
        targetIds,
        rollMode,
        includeDamage,
        override,
        slotLevel,
        spend: chosenSpend,
        damageType,
        expectedRevision
      } = request;
      if (override && !isGmGrade(principal)) throw new GameAccessDeniedError("Your GM adjudicates rules overrides.");
      const snapshot = kit.read();
      requireActorAccess(initiatorOf(principal), snapshot, actorId, "attack");
      const actor = snapshot.actors.find((candidate) => candidate.id === actorId);
      if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
      const route = routeForTap(snapshot.combat, actorId);
      const resolve = (withOverride: boolean) =>
        dispatch("action.resolve", {
          commandId,
          actorId,
          actionId,
          ...(targetIds ? { targetIds } : {}),
          ...(rollMode ? { rollMode } : {}),
          ...(withOverride && override ? { override } : {}),
          ...(slotLevel === undefined ? {} : { slotLevel }),
          ...(chosenSpend === undefined ? {} : { spend: chosenSpend }),
          ...(damageType === undefined ? {} : { damageType }),
          ...(expectedRevision === undefined ? {} : { expectedRevision })
        });

      // On this creature's turn in combat: delegate to the structured path unchanged.
      if (route === "resolved") return { ...(await resolve(false)), route: "resolved" };

      const definition = actor.definitionId ? kit.resolveDefinitionIn(snapshot, actor.definitionId) : undefined;
      const available = effectiveActions(definition, actor, kit.equipmentCatalog());
      const found = available.find((candidate) => candidate.id === actionId) ?? builtinAction(actionId);
      if (!found) throw new CommandRejectedError("That action is not on the stat block.");
      const listed = withChosenCost(found, chosenSpend);
      // A spell cast with a higher slot rolls that slot's dice, on the loose route as in the fight.
      const castLevel = listed.spellSlot ? castSlotLevel(actor, listed.spellSlot.level, slotLevel) : undefined;
      const spell = listed.spellId ? kit.equipmentCatalog().spellRecord?.(listed.spellId) : undefined;
      const action = withChosenDamageType(
        castLevel !== undefined && spell && castLevel > listed.spellSlot!.level
          ? upcastAction(listed, spell, castLevel)
          : listed,
        damageType ?? null
      );

      // Off turn in combat: a real rules block, so the GM can override and the player can ask. Advise
      // resolves with a warning; Off just resolves.
      if (route === "blocked") {
        const currentName =
          snapshot.combat.turnActorId === null ? "Someone else" : kit.actorName(snapshot.combat.turnActorId);
        // A GM Allow waves the refusal through and remembers the family so the rest of this creature's
        // off-turn actions stop re-prompting. The memory write is its own small mutation.
        const waived = overrideWaives(override, NOT_YOUR_TURN);
        const verdict = waived ? { warning: null } : offTurnVerdict(snapshot, action, currentName);
        if (waived) {
          await kit.store.execute(
            {
              id: kit.context.newId(),
              type: "action.use",
              actorId,
              payload: { commandId, override },
              principal: principalTag(principal)
            },
            (state) => {
              rememberOverride(state, NOT_YOUR_TURN, override);
            }
          );
          kit.context.appendLog({
            kind: "override",
            text: `OVERRIDE (${NOT_YOUR_TURN}): ${kit.actorName(actorId)} acted off turn - ${overrideReason(override)}`,
            actorId,
            actorIds: [actorId]
          });
        }
        const resolved = await resolve(true);
        if (verdict.warning !== null)
          kit.context.appendLog({
            kind: "action",
            text: `Rules note: ${verdict.warning}`,
            actorId,
            actorIds: [actorId],
            gmOnly: true
          });
        return { ...resolved, route: "resolved", ...(verdict.warning === null ? {} : { warning: verdict.warning }) };
      }

      // Loose: the server rolls the action's dice, attributed to the character, and spends what the action
      // costs (an item's charges), touching no combat state. HP only ever moves through the resolver.
      const plan = looseRollPlan(action, { includeDamage: includeDamage === true, ...(rollMode ? { rollMode } : {}) });
      const initiator = initiatorOf(principal);
      const rollIds = plan.map(() => kit.context.newId());
      let spend: ReturnType<typeof spendLooseUses> = { usesLeft: null, spent: false };
      let lastCharge: string | null = null;
      let usedUp = false;
      const { state, duplicate } = await execute((draft) => {
        requireActorAccess(initiator, draft, actorId, "attack");
        const live = draft.actors.find((candidate) => candidate.id === actorId)!;
        spend = spendLooseUses(live, action, available, castLevel, slotsModeFor(draft), definition);
        // A potion drunk or a flask thrown outside a fight is used up all the same.
        const consumable = consumableRowFor(action, live.inventory, kit.equipmentCatalog());
        if (consumable) live.inventory = withOneUsedUp(live.inventory, consumable.id);
        usedUp = consumable !== null;
        // SRD charged items: spending the last charge rolls a d20, whose 1 is the item's own text.
        const due = spend.usesLeft === 0 ? lastChargeRollFor(action, live.inventory, kit.equipmentCatalog()) : null;
        lastCharge = null;
        if (due) {
          const face = kit.context.random(20);
          recordRoll(draft, {
            id: kit.context.newId(),
            commandId,
            initiatorSessionId: sessionIdOf(principal),
            initiatorRole: initiator.role,
            initiatorLabel: live.name,
            label: `${due.item.name}: last charge`,
            actorId,
            purpose: "manual",
            visibility: live.visibility === "gm-only" ? "gm-only" : "public",
            formula: "1d20",
            normalizedFormula: "1d20",
            dice: [{ group: 0, sides: 20, face, kept: true, sign: 1 as const }],
            modifiers: [],
            total: face,
            createdAt: new Date().toISOString()
          });
          lastCharge = lastChargeLine(due.item.name, face);
        }
        plan.forEach((entry, index) => {
          const resolution = rollDice(entry.formula, (sides) => kit.context.random(sides));
          recordRoll(draft, {
            id: rollIds[index],
            commandId,
            initiatorSessionId: sessionIdOf(principal),
            initiatorRole: initiator.role,
            initiatorLabel: live.name,
            label: entry.label,
            actorId,
            purpose: entry.purpose,
            visibility: live.visibility === "gm-only" ? "gm-only" : "public",
            formula: entry.formula,
            normalizedFormula: resolution.expression.normalized,
            ...rolledTerms(resolution),
            total: resolution.total,
            createdAt: new Date().toISOString()
          });
        });
      });
      if (duplicate) return { route: "loose", rollIds };
      kit.publishRolls(state, commandId);
      if (spend.warning)
        kit.context.appendLog({
          kind: "action",
          text: `Rules note: ${spend.warning}`,
          actorId,
          actorIds: [actorId],
          gmOnly: true
        });
      if (lastCharge !== null)
        kit.context.appendLog({
          kind: "action",
          text: lastCharge,
          actorId,
          actorIds: [actorId],
          gmOnly: kit.actorHidden(actorId)
        });
      // Rolls narrate themselves; a use with nothing to roll, or one that cost a charge, says so.
      if (plan.length === 0 || spend.spent || usedUp) {
        const cost = useCostOf(action);
        const left =
          spend.usesLeft === null
            ? ""
            : cost > 1
              ? ` (${cost} spent, ${spend.usesLeft} left)`
              : ` (${spend.usesLeft} ${spend.usesLeft === 1 ? "use" : "uses"} left)`;
        kit.context.appendLog({
          kind: "action",
          text: `${kit.actorName(actorId)} uses ${action.name}${left}.`,
          actorId,
          actorIds: [actorId],
          gmOnly: kit.actorHidden(actorId)
        });
      }
      return { route: "loose", rollIds };
    }
  }),

  defineCommand({
    type: "dice.roll",
    operationId: "rollDice",
    description:
      "Rolls dice into the shared, auditable roll history; the response carries `rollId`. Player sessions cannot roll gm-only, and rolling for an actor requires owning it.",
    summary: "Roll dice into the shared, auditable roll history.",
    schema: DiceRollSchema,
    malformed: "The roll request is malformed.",
    async run({ principal, request, execute }, kit) {
      const { commandId, formula, purpose, visibility, label, actorId } = request;
      const gmGrade = isGmGrade(principal);
      if (!gmGrade && visibility === "gm-only") throw new GameAccessDeniedError("Only the GM can make a GM-only roll.");
      const initiatorSessionId = sessionIdOf(principal);
      const initiatorRole = gmGrade ? ("gm" as const) : ("player" as const);
      let resolution: ReturnType<typeof rollDice>;
      try {
        resolution = rollDice(formula, (sides) => kit.context.random(sides));
      } catch (error) {
        throw new CommandRejectedError(error instanceof Error ? error.message : "The roll failed.");
      }
      const rollId = kit.context.newId();
      const { state, duplicate } = await execute((draft) => {
        // A player's roll with no actorId is attributed to their single claimed character (ambiguous claims
        // stay unattributed). An explicit actorId wins and is still authorized below.
        const claimed =
          principal.kind === "player"
            ? draft.actors.filter((candidate) => candidate.ownerSessionId === initiatorSessionId && !candidate.archived)
            : [];
        const attributedActorId = actorId ?? (claimed.length === 1 ? claimed[0].id : null);
        if (actorId)
          requireActorAccess(
            initiatorOf(principal),
            draft,
            actorId,
            purpose === "save" ? "save" : purpose === "attack" || purpose === "damage" ? "attack" : "check",
            "You may only roll for your claimed character."
          );
        const record: RollRecord = {
          id: rollId,
          commandId,
          initiatorSessionId,
          initiatorRole,
          initiatorLabel:
            initiatorRole === "gm"
              ? gmGradeLabelOf(principal)
              : (draft.actors.find((candidate) => candidate.ownerSessionId === initiatorSessionId)?.name ?? "A player"),
          ...(label ? { label } : {}),
          actorId: attributedActorId,
          purpose,
          // A roll made for a creature the players can't see stays the GM's, or it would reveal the creature.
          visibility:
            visibility === "public" &&
            draft.actors.some((candidate) => candidate.id === attributedActorId && candidate.visibility !== "public")
              ? "gm-only"
              : visibility,
          formula,
          normalizedFormula: resolution.expression.normalized,
          ...rolledTerms(resolution),
          total: resolution.total,
          createdAt: new Date().toISOString()
        };
        recordRoll(draft, record);
      });
      if (!duplicate) kit.publishRolls(state, commandId);
      return {
        rollId: state.rolls.find((roll) => roll.commandId === commandId)?.id,
        hiddenFromRoller: visibility === "blind" && !gmGrade
      };
    }
  })
];
