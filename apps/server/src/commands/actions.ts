import type { RollRecord } from "@vtt/domain";
import { rollDice } from "@vtt/rules-5e";
import { resolveDefinitionAction } from "../action-resolution.js";
import { addAnnotation, shapeGeometry } from "../annotations.js";
import { parseAreaProse, tokensInTemplate } from "../area-targeting.js";
import { canPlayerTarget, GameAccessDeniedError, requireActorAccess } from "../authorization.js";
import { builtinAction } from "../builtin-actions.js";
import { effectiveActions } from "../effective-actions.js";
import { pushTokenAway } from "../forced-movement.js";
import { ActionResolveSchema, ActionUseSchema, DiceRollSchema } from "../game-commands.js";
import { CommandRejectedError } from "../game-store.js";
import { damageAdjustmentDetail } from "../hit-points.js";
import { tokenCreatureDistance } from "../movement-narration.js";
import { settlePlayerHit, type AppliedDamage } from "../player-damage.js";
import { recordRoll } from "../roll-history.js";
import { overrideReason, rememberOverride } from "../rules-families.js";
import { looseRollPlan, NOT_YOUR_TURN, offTurnVerdict, routeForTap } from "../tap-routing.js";
import { gmGradeLabelOf, initiatorOf, isGmGrade, principalTag, rolledTerms, sessionIdOf } from "./kit.js";
import { defineCommand } from "./pipeline.js";

// Stat-block actions, the server-routed "use this action" tap, and free dice rolls.

export const actionCommands = [
  defineCommand({
    type: "action.resolve",
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
      // A player's confirmed hit in "direct" mode applies server-side inside the mutation; captured for narration.
      let playerDamageApplied: AppliedDamage | undefined;
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
        const action = statBlockAction ?? builtinAction(actionId);
        if (!action) throw new CommandRejectedError("That action is not on the stat block.");
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
          resolvedTargetIds = tokensInTemplate(
            draft,
            calibration,
            snapped,
            template.shape,
            parseAreaProse(action.description)?.widthFeet ?? null
          ).filter((id) => id !== actorId && draft.combat.initiative.some((entry) => entry.actorId === id));
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
            critical
          },
          {
            random: (sides) => kit.context.random(sides),
            newRollId: kit.context.newId,
            gmSessionId,
            initiatorRole: initiator.role,
            initiatorSessionId: sessionIdOf(principal),
            now: () => new Date().toISOString(),
            hasCondition: (id) => kit.catalogFor(principal).hasCondition(id),
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
          playerDamageApplied =
            settlePlayerHit(draft, resolution, attacker.name, actorId, draft.combat.playerDamageMode, {
              resolveDefinition: (definitionId) => kit.resolveDefinitionIn(draft, definitionId),
              newId: kit.context.newId,
              now: () => Date.now(),
              catalog: kit.equipmentCatalog()
            }) ?? undefined;
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
        for (const warning of resolution.warnings ?? [])
          kit.context.appendLog({ kind: "action", text: `Rules note: ${warning}`, actorIds: [actorId], gmOnly: true });
        kit.appendTableNarration(resolution);
        for (const applied of resolution.effectsApplied ?? [])
          kit.context.broadcastTableEvent({
            kind: "effect",
            text: `${applied.targetName} is ${applied.name}.`,
            actorIds: [applied.targetId],
            gmOnly: hidden
          });
        if (resolution.effectGranted)
          kit.context.broadcastTableEvent({
            kind: "effect",
            text: `${kit.actorName(actorId)} gains ${resolution.effectGranted.name}.`,
            actorIds: [actorId],
            gmOnly: hidden
          });
        // A reaction window opened: the rolled damage waits on the answer, so the table hears why nothing landed yet.
        for (const prompt of resolution.reactionPrompts ?? []) {
          const promptHidden = hidden || kit.actorHidden(prompt.actorId);
          kit.context.appendLog({
            kind: "reaction",
            text: `${prompt.actorName} may use ${prompt.actionName} - the damage waits on their answer.`,
            actorIds: [prompt.actorId],
            gmOnly: promptHidden
          });
          kit.context.broadcastTableEvent({
            kind: "reaction",
            text: `${prompt.actorName} may use ${prompt.actionName}.`,
            actorIds: [prompt.actorId],
            gmOnly: promptHidden
          });
        }
        // Builtin check rolls and rule-consequence endings narrate to the table.
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
        for (const ended of resolution.effectsEnded ?? [])
          kit.context.broadcastTableEvent({
            kind: "effect",
            text: `${ended.name} ended on ${ended.actorName}.`,
            actorIds: [ended.actorId],
            gmOnly: hidden || kit.actorHidden(ended.actorId)
          });
        if (playerDamageApplied) {
          // Narrated like actor:apply-damage. Both actors ride actorIds so the line is gm-only if either is hidden.
          const { outcome, targetId, sourceActorId, label } = playerDamageApplied;
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
    summary:
      "Use an action and let the SERVER route it: resolved in the fight on your turn, refused off turn, loose dice outside a fight (GM anyone; a player their own claimed character).",
    schema: ActionUseSchema,
    malformed: "The action command is malformed.",
    // The server picks structured resolve, blocked or loose roll and says so in the reply.
    async run({ principal, request, execute, dispatch }, kit) {
      const { commandId, actorId, actionId, targetIds, rollMode, includeDamage, override, expectedRevision } = request;
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
          ...(expectedRevision === undefined ? {} : { expectedRevision })
        });

      // On this creature's turn in combat: delegate to the structured path unchanged.
      if (route === "resolved") return { ...(await resolve(false)), route: "resolved" };

      const definition = actor.definitionId ? kit.resolveDefinitionIn(snapshot, actor.definitionId) : undefined;
      const action =
        effectiveActions(definition, actor, kit.equipmentCatalog()).find((candidate) => candidate.id === actionId) ??
        builtinAction(actionId);
      if (!action) throw new CommandRejectedError("That action is not on the stat block.");

      // Off turn in combat: a real rules block, so the GM can override and the player can ask. Advise
      // resolves with a warning; Off just resolves.
      if (route === "blocked") {
        const currentName =
          snapshot.combat.turnActorId === null ? "Someone else" : kit.actorName(snapshot.combat.turnActorId);
        // A GM Allow waves the refusal through and remembers the family so the rest of this creature's
        // off-turn actions stop re-prompting. The memory write is its own small mutation.
        const verdict = override ? { warning: null } : offTurnVerdict(snapshot, action, currentName);
        if (override) {
          await kit.store.execute(
            {
              id: kit.context.newId(),
              type: "action.use",
              actorId,
              payload: { commandId, override },
              principal: principalTag(principal)
            },
            (state) => {
              rememberOverride(state, NOT_YOUR_TURN);
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

      // Loose: the server rolls the action's dice, attributed to the character, and touches no combat
      // state. HP only ever moves through the resolver.
      const plan = looseRollPlan(action, { includeDamage: includeDamage === true, ...(rollMode ? { rollMode } : {}) });
      if (plan.length === 0) throw new CommandRejectedError(`${action.name} has nothing to roll outside a fight.`);
      const initiator = initiatorOf(principal);
      const rollIds = plan.map(() => kit.context.newId());
      const { state, duplicate } = await execute((draft) => {
        requireActorAccess(initiator, draft, actorId, "attack");
        const live = draft.actors.find((candidate) => candidate.id === actorId)!;
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
      if (!duplicate) kit.publishRolls(state, commandId);
      return { route: "loose", rollIds };
    }
  }),

  defineCommand({
    type: "dice.roll",
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
          visibility,
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
