import type { AnnotationPoint, AnnotationShapeKind, GameState, RollRecord } from "@vtt/domain";
import { rollDice } from "@vtt/rules-5e";
import { resolveDefinitionAction } from "../action-resolution.js";
import { addAnnotation, shapeGeometry, templateOfArea } from "../annotations.js";
import { areaOriginatesFromCaster, tokensInTemplate } from "../area-targeting.js";
import { GameAccessDeniedError, requireActorAccess } from "../authorization.js";
import { withSeenTargets } from "../resolution/seen-targets.js";
import { builtinActionFor } from "../builtin-actions.js";
import { effectiveActions } from "../effective-actions.js";
import { pushTokenAway } from "../forced-movement.js";
import { ActionResolveSchema, ActionUseSchema, DiceRollSchema } from "@vtt/domain/commands";
import { CommandRejectedError, RulesBlockedError } from "../game-store.js";
import { heldRollFor, requireTypedDie } from "../held-rolls.js";
import { damageAdjustmentDetail } from "../hit-points.js";
import { tokenCreatureDistance } from "../movement-narration.js";
import { settlePlayerDamage, type AppliedDamage } from "../player-damage.js";
import { recordRoll, rolledTerms } from "../roll-history.js";
import { effectiveModeFor, overrideWaives } from "../rules-families.js";
import { looseRollPlan, routeForTap, slotsModeFor, spendLooseUses } from "../tap-routing.js";
import { conditionChoicesOf, isItemActionId, upcastAction } from "../item-actions.js";
import { BURNING_TAG, PUT_OUT_FIRE_ACTION_ID, putOutFire } from "../hazards.js";
import type { EffectNarration } from "../effects.js";
import { grantOutsideFight } from "../resolution/grant.js";
import { lastChargeLine, lastChargeRollFor } from "../item-charges.js";
import { consumableRowFor, withOneUsedUp } from "../consumables.js";
import { leaveShortRest } from "../short-rest-interruptions.js";
import { ammunitionLabel, shotFrom, spendPiece } from "../ammunition.js";
import { checkPlan } from "../ability-checks.js";
import { rollSettledCheck } from "../check-rolls.js";
import { deriveEquipment, sourceItemOf } from "../equipment-derivation.js";
import { SCROLL_UNREADABLE, scrollCheckOf, scrollLostLine, scrollOfAction, scrollReading } from "../scrolls.js";
import { castSlotLevel } from "../resolution/economy.js";
import { zoneRowOf } from "../spell-zones.js";
import { withChosenDamageType } from "../resolution/validate.js";
import { useCostOf, withChosenCost } from "../use-cost.js";
import { applyLooseHealing, looseHealTargets } from "../loose-healing.js";
import { countOptionUse } from "../option-uses.js";
import { gmGradeLabelOf, initiatorOf, isGmGrade, sessionIdOf } from "./kit.js";
import { defineCommand } from "./pipeline.js";

// Stat-block actions, the server-routed "use this action" tap, and free dice rolls.

/** The fight's own ammunition rule, also held to outside one. */
const NO_AMMUNITION = "attack.no-ammunition";

export const actionCommands = [
  defineCommand({
    type: "action.resolve",
    operationId: "resolveAction",
    description:
      "Runs a stat-block action: attack vs target AC with 2024 crit doubling, or save-DC surfacing with proposed damage. GM-grade for any combatant; a player session only for their own claimed character (cover and rules overrides stay GM-only). A player's hit is handed to the GM as a damage proposal, or applied directly when the table's player-damage-mode is `direct`. Targets are explicit ids or an area template (never both). An area catches every combatant under it; for a player it is refused when none they can see is inside, and their reply names only the creatures they can see. Rolls are recorded in the shared history and the response carries the `resolution`. An action or Bonus Action off the creature's own turn meets the `economy.not-your-turn` block, except a Readied creature's response, which spends its Reaction.",
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
        critical,
        fumble
      } = request;
      // A player resolves only for their own claimed character (checked inside the mutation); GM-only
      // inputs (overrides, cover, applied conditions) are refused or stripped. A player may aim their own area: the
      // server decides who is under it. The note is the Ready action's trigger, which the table reads in the effect's
      // name, so a player's is kept.
      const initiator = initiatorOf(principal);
      const isPlayer = initiator.role === "player";
      // The creatures a player may not target or be told of: the shared hidden check from this player's own view
      // (GM-only, out of their characters' sight, under the fog, or not on the map).
      const hiddenFromPlayer = (state: GameState): ReadonlySet<string> => {
        const hidden = kit.hiddenFor(initiator, state);
        return new Set(state.actors.filter((actor) => hidden(actor.id)).map((actor) => actor.id));
      };
      if (isPlayer && override) throw new GameAccessDeniedError("Your GM adjudicates rules overrides.");
      // A player types the face their die shows, never a total: the server adds the bonus and reads a 1 or a 20.
      if (isPlayer && (attackTotal !== undefined || critical !== undefined || fumble !== undefined))
        throw new GameAccessDeniedError("Type the d20 your die shows; the server adds your bonus.");
      const requestedConditionId = conditionId ?? null;
      const effectiveCover = isPlayer ? null : (request.cover ?? null);
      const effectiveNote = request.note ?? null;
      if (requestedConditionId !== null && !kit.catalogFor(principal).hasCondition(requestedConditionId))
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
        // Access first (the action kind is for the per-table policy hook, ADR-0021): a missing creature and someone
        // else's get one answer, so a player can't probe which ids exist.
        requireActorAccess(initiator, draft, actorId, "attack");
        const attacker = draft.actors.find((item) => item.id === actorId);
        if (!attacker) throw new CommandRejectedError("That combatant no longer exists.");
        const definition = attacker.definitionId ? kit.resolveDefinitionIn(draft, attacker.definitionId) : undefined;
        // Effective actions, so `item-<itemId>` ids resolve and item-raised numbers apply. A stat-block
        // action wins on id collision; builtins cover every combatant.
        const statBlockAction = effectiveActions(definition, attacker, kit.equipmentCatalog()).find(
          (candidate) => candidate.id === actionId
        );
        const listed = statBlockAction ?? builtinActionFor(definition, actionId);
        if (!listed) throw new CommandRejectedError("That action is not on the stat block.");
        // An action whose user picks its cost (Lay on Hands) resolves at the amount picked.
        const action = withChosenCost(listed, request.spend);
        // The GM may impose any condition; a player picks only among the ones the action lets its caster choose
        // (Blindness/Deafness), read from the spell too for a sheet built before the action carried them.
        const offered = conditionChoicesOf(
          action,
          action.spellId ? kit.equipmentCatalog().spellRecord?.(action.spellId) : undefined
        );
        const effectiveConditionId =
          requestedConditionId === null || !isPlayer
            ? requestedConditionId
            : offered.includes(requestedConditionId)
              ? requestedConditionId
              : null;
        let resolvedTargetIds: readonly string[];
        let originAtCaster = false;
        // The template as the action's area makes it, which the table's drawn shape records.
        let placed: Readonly<{ shape: AnnotationShapeKind; origin: AnnotationPoint; target: AnnotationPoint }> | null =
          null;
        if (template) {
          if (action.attack) throw new CommandRejectedError("Attacks target a single token. Pick the token itself.");
          if (draft.combat.mapAssetId !== mapAssetId)
            throw new CommandRejectedError("The active encounter changed. Try again.");
          const calibration = geometry!.calibration!;
          // The action's own area decides the shape and the size; the drag only places and points it.
          placed = action.area ? templateOfArea(calibration, template, action.area) : template;
          // Snap the template the same way the drawn annotation will, then find who is under it.
          const snapped = shapeGeometry(calibration, placed.shape, placed.origin, placed.target);
          const spell = action.spellId ? kit.equipmentCatalog().spellRecord?.(action.spellId) : undefined;
          const casterOutside = areaOriginatesFromCaster(action.area?.shape ?? template.shape, spell?.range.text);
          originAtCaster = casterOutside;
          resolvedTargetIds = tokensInTemplate(
            draft,
            calibration,
            snapped,
            placed.shape,
            action.area?.widthFeet ?? null
          ).filter(
            (id) => (id !== actorId || !casterOutside) && draft.combat.initiative.some((entry) => entry.actorId === id)
          );
          // An area catches everyone under it, seen or not. Whether it holds anyone is judged on what the caster's
          // player can see, so an empty refusal never tells them a hidden creature is there. A spell that leaves its
          // area behind (Moonbeam, Web, a wall) may be placed where no one stands yet.
          const unseen = isPlayer ? hiddenFromPlayer(draft) : new Set<string>();
          if (!resolvedTargetIds.some((id) => !unseen.has(id)) && !(spell && zoneRowOf(spell)))
            throw new CommandRejectedError(
              isPlayer ? "No creatures you can see are inside that area." : "No combatants are inside that area."
            );
        } else {
          resolvedTargetIds = targetIds ?? [];
          // A player may target only public combatants they can see: resolving against a hidden actor would leak
          // its name/AC/outcome through the ack (and in direct mode damage it). The refusal is the one a missing
          // creature gets, at the same point, so it says nothing of what is hidden.
          if (isPlayer && draft.combat.active && draft.combat.initiative.some((entry) => entry.actorId === actorId)) {
            const unseen = hiddenFromPlayer(draft);
            if (resolvedTargetIds.some((targetId) => unseen.has(targetId)))
              throw new CommandRejectedError("Every target must be in this encounter.");
          }
        }
        // Footprint-aware (SRD Creature Size): Medium adjacent to Large is 5 ft, measured edge to edge.
        const distanceFeet = (actorIdA: string, actorIdB: string): number | null =>
          geometry ? (tokenCreatureDistance(draft, geometry, actorIdA, actorIdB)?.value ?? null) : null;
        // The attack's d20 is held between a preview and its confirm, one per creature and turn (ADR-0012), so a
        // second look at the attack shows the same die. A typed die must be one the table takes.
        const holdKey = `attack:${actorId}`;
        if (attackNatural !== undefined && request.reroll !== true)
          requireTypedDie(draft, initiator, heldRollFor(draft, holdKey), attackNatural);
        // SRD forced movement (Push), snapped like a GM drag; takes no client input. Only `targets[0]` of a hit
        // is pushed, already restricted to public combatants for players. If the map changed since the grid
        // was fetched, degrade to null ("move the token") and never throw.
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
            // The rules count Advantage and Disadvantage; only the GM may force a mode.
            rollMode: isPlayer ? null : (rollMode ?? null),
            override: isPlayer ? null : (override ?? null),
            builtin: statBlockAction === undefined,
            note: effectiveNote,
            effectId: request.effectId ?? null,
            cover: effectiveCover,
            commit,
            attackNatural,
            ...(attackNatural !== undefined ? { typedFace: true } : {}),
            holdKey,
            ...(request.reroll === true ? { reroll: true } : {}),
            attackTotal,
            critical,
            ...(fumble !== undefined ? { fumble } : {}),
            ...(request.skill !== undefined ? { skill: request.skill } : {}),
            ...(request.ability !== undefined ? { ability: request.ability } : {}),
            ...(request.pushFeet !== undefined ? { pushFeet: request.pushFeet } : {}),
            ...(request.slotLevel !== undefined ? { slotLevel: request.slotLevel } : {}),
            ...(request.damageType !== undefined ? { damageType: request.damageType } : {}),
            ...(request.hitOptions ? { hitOptions: request.hitOptions } : {}),
            ...(template ? { areaPlaced: true } : {}),
            ...(request.ready === true ? { ready: true } : {})
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
        // A committed use counts toward the sheet's most-used options; a preview counts with its confirm.
        if (!resolution.preview) countOptionUse(draft, actorId, actionId);
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
              distanceFeet,
              rollDie: (sides) => kit.context.random(sides)
            },
            action.drain
          );
        // Record the blast as a shape; id=commandId keeps re-delivery idempotent. A cone or line starts at its caster,
        // so one from a caster hidden from the table is drawn for the GM alone: it would point at where it hides.
        const fromHiddenCaster = originAtCaster && kit.hiddenFromTable(draft)(actorId);
        if (placed)
          addAnnotation(
            draft,
            {
              id: commandId,
              kind: "shape",
              shape: placed.shape,
              origin: placed.origin,
              target: placed.target,
              visibility: fromHiddenCaster ? "gm-only" : "public",
              reachesPastMap: action.area !== undefined,
              actor: { sessionId: gmSessionId, role: "gm" },
              now: Date.now()
            },
            geometry!
          );
      });
      if (duplicate || !resolution) return;
      // A player's reply names only the creatures they may see; the rest of an area's catch stays with the GM.
      const reply = isPlayer ? withSeenTargets(resolution, hiddenFromPlayer(state)) : resolution;
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
            text: `OVERRIDE (${resolution.overridden.rule}): ${kit.actorName(actorId)} used ${resolution.actionName} · ${resolution.overridden.reason}`,
            actorIds: [actorId]
          });
        // Builtin check rolls narrate to the table.
        if (resolution.check) {
          const verdict =
            resolution.check.success === null ? "" : resolution.check.success ? " · success" : " · failure";
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
      return { resolution: reply };
    }
  }),

  defineCommand({
    type: "action.use",
    operationId: "useAction",
    description:
      "Uses an action and lets the SERVER decide what that means. In the fight on this creature's turn it delegates to the full structured resolution and acks `route: \"resolved\"`. Off turn it is refused with the overridable, askable rules block `economy.not-your-turn` (reactions and legendary actions are exempt, because taking those off turn is the point); under an `economy` exception of advise/off it resolves, with a GM-only warning line under advise. With no fight running, or with this creature not in the turn order, the server rolls the action's own attack die (and, only with `includeDamage`, its damage parts) as attributed rolls, spends what the action costs (an item's charges or a feature's per-rest uses, and any spell slot an item cast consumes; refused when none remain; an item's last charge rolls its d20 for the GM), uses up a potion, flask or Spell Scroll and the shot's ammunition, reads a scroll only if the reader can (a spell above the reader's levels rolls its check first, and a failure loses the scroll with nothing else rolled), touches no combat state, and acks `route: \"loose\"` with the roll ids, and for a heal who regained what (`healing`). An action with nothing to roll is still used, with a feed line. A heal (a potion, a healing spell, Second Wind, Lay on Hands) lands on `targetIds` through the fight's hit point rules (the dead stay dead), its user when none are named: a player heals their own character or another member of the party, the GM anyone; damage never moves on the loose route. GM-grade for any combatant, including a monster's sheet; a player session only for their own claimed character.",
    summary:
      "Use an action and let the SERVER route it: resolved in the fight on your turn, refused off turn, loose dice outside a fight, where a heal lands on whoever it is given to (GM anyone; a player their own claimed character).",
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
      // Off turn in combat: the structured resolution's own economy refuses an action or Bonus Action with the
      // overridable, askable `economy.not-your-turn` block (advised, a GM note; off, nothing) and lets a reaction,
      // a readied response and a legendary action through. A GM override waives it, audited by the resolve.
      if (route === "blocked") return { ...(await resolve(true)), route: "resolved" };

      const definition = actor.definitionId ? kit.resolveDefinitionIn(snapshot, actor.definitionId) : undefined;
      const available = effectiveActions(definition, actor, kit.equipmentCatalog());
      const found = available.find((candidate) => candidate.id === actionId) ?? builtinActionFor(definition, actionId);
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

      // Loose: the server rolls the action's dice, attributed to the character, and spends what the action
      // costs (an item's charges). Combat state stays as it is; HP only moves through the resolver. Only the GM may
      // force a roll mode.
      const forcedMode = isGmGrade(principal) ? rollMode : undefined;
      const plan = looseRollPlan(action, {
        includeDamage: includeDamage === true,
        ...(forcedMode ? { rollMode: forcedMode } : {})
      });
      const initiator = initiatorOf(principal);
      const rollIds = plan.map(() => kit.context.newId());
      const scrollCheckId = kit.context.newId();
      let scrollChecked = false;
      let scrollLost: string | null = null;
      let spend: ReturnType<typeof spendLooseUses> = { usesLeft: null, spent: false };
      let lastCharge: string | null = null;
      let usedUp = false;
      let narrations: EffectNarration[] = [];
      let rulesNote: string | null = null;
      let healed: ReturnType<typeof applyLooseHealing> = { lines: [], healing: null };
      const { state, duplicate } = await execute((draft) => {
        requireActorAccess(initiator, draft, actorId, "attack");
        const live = draft.actors.find((candidate) => candidate.id === actorId)!;
        // A use outside a fight counts toward the sheet's most-used options too; a refusal below undoes it.
        countOptionUse(draft, actorId, actionId);
        // A heal lands on whoever it is given to, checked before anything is spent.
        const healTargets = action.healing
          ? looseHealTargets(draft, live, action, targetIds, initiator, spell, castLevel)
          : [];
        let healRoll: number | null = null;
        healed = { lines: [], healing: null };
        // A scroll outside a fight: one the reader can't read is refused, and a spell above their levels needs its
        // check first. A failure loses the scroll, and nothing else is rolled.
        const scroll = scrollOfAction(action, live.inventory, kit.equipmentCatalog());
        scrollChecked = false;
        scrollLost = null;
        if (scroll) {
          const catalog = kit.equipmentCatalog();
          const reading = scrollReading(definition, scroll.spell, catalog);
          if (!reading.readable) {
            const mode = effectiveModeFor(draft.combat, SCROLL_UNREADABLE);
            if (mode === "strict" && !overrideWaives(override, SCROLL_UNREADABLE))
              throw new RulesBlockedError(SCROLL_UNREADABLE, reading.message);
            if (mode !== "freeform") rulesNote = reading.message;
          } else if (reading.check) {
            // An ability check like any other (`checkPlan`), so Poisoned, Exhaustion and Reliable Talent count.
            const check = scrollCheckOf(reading.check, scroll.spell.name);
            const plan = checkPlan(live, definition, deriveEquipment(live, definition, catalog), check.subject);
            const rolled = rollSettledCheck(
              draft,
              live,
              plan,
              {
                id: scrollCheckId,
                commandId,
                sessionId: sessionIdOf(principal),
                role: initiator.role,
                label: check.label,
                visibility: live.visibility === "gm-only" ? "gm-only" : "public",
                createdAt: new Date().toISOString()
              },
              (sides) => kit.context.random(sides)
            );
            scrollChecked = true;
            if (rolled.total < reading.check.dc) {
              scrollLost = scrollLostLine(live.name, scroll.spell.name);
              live.inventory = withOneUsedUp(live.inventory, scroll.row.id);
              return;
            }
          }
        }
        // A shot outside a fight needs a piece to fire and spends it as in one; half come back when it is picked up.
        if (action.attack) {
          const catalog = kit.equipmentCatalog();
          const launcherId = sourceItemOf(action, deriveEquipment(live, definition, catalog), live.inventory);
          const shot = shotFrom(live, launcherId, catalog);
          if (shot?.ammo) spendPiece(live, shot.ammo, true);
          else if (shot) {
            const message = `${live.name} has no ${ammunitionLabel(shot.kind)} to fire from ${shot.launcher.name}.`;
            const mode = effectiveModeFor(draft.combat, NO_AMMUNITION);
            if (mode === "strict" && !overrideWaives(override, NO_AMMUNITION))
              throw new RulesBlockedError(NO_AMMUNITION, message);
            if (mode !== "freeform") rulesNote = message;
          }
        }
        // Rolling on the ground outside a fight puts the fire out all the same.
        if (action.id === PUT_OUT_FIRE_ACTION_ID) {
          if (!live.effects.some((effect) => effect.tags.includes(BURNING_TAG)))
            throw new CommandRejectedError(`${live.name} is not burning.`);
          narrations = putOutFire(draft, live, {
            selfApplied: initiator.role === "player",
            immunities: {
              resolveDefinition: (definitionId) => kit.resolveDefinitionIn(draft, definitionId),
              catalog: kit.equipmentCatalog()
            }
          }).events;
        }
        spend = spendLooseUses(live, action, available, castLevel, slotsModeFor(draft), definition);
        // Casting a spell other than a cantrip stops a Short Rest.
        if (spell && spell.level > 0)
          narrations = [...narrations, ...leaveShortRest(draft, new Set([actorId]), `cast ${spell.name}`)];
        // A potion drunk or a flask thrown outside a fight is used up all the same.
        const consumable = consumableRowFor(action, live.inventory, kit.equipmentCatalog());
        if (consumable) live.inventory = withOneUsedUp(live.inventory, consumable.id);
        usedUp = consumable !== null;
        // What an item puts on its user lasts beyond the moment: Antitoxin drunk, a blade coated before a fight.
        if (isItemActionId(action.id))
          narrations = [...narrations, ...grantOutsideFight(draft, live, action, commandId)];
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
          if (entry.purpose === "healing") healRoll = resolution.total;
        });
        healed = applyLooseHealing(draft, action, healTargets, healRoll, (sides) => kit.context.random(sides));
      });
      const usedRollIds = scrollLost !== null ? [scrollCheckId] : scrollChecked ? [scrollCheckId, ...rollIds] : rollIds;
      // Who regained what goes back to the one who used it, as the fight's resolution says it.
      const healedReply = healed.healing ? { healing: healed.healing } : {};
      if (duplicate) return { route: "loose", rollIds: usedRollIds };
      kit.publishRolls(state, commandId);
      kit.publishNarrations(narrations);
      for (const line of healed.lines)
        kit.context.appendLog({ kind: "heal", text: line.text, actorIds: [line.actorId] });
      if (scrollLost !== null) {
        kit.context.appendLog({
          kind: "action",
          text: scrollLost,
          actorId,
          actorIds: [actorId],
          gmOnly: kit.actorHidden(actorId)
        });
        return { route: "loose", rollIds: usedRollIds };
      }
      for (const note of [rulesNote, spend.warning ?? null])
        if (note !== null)
          kit.context.appendLog({
            kind: "action",
            text: `Rules note: ${note}`,
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
      return { route: "loose", rollIds: usedRollIds, ...healedReply };
    }
  }),

  defineCommand({
    type: "dice.roll",
    operationId: "rollDice",
    description:
      "Rolls dice into the shared, auditable roll history; the response carries `rollId`. Player sessions cannot roll gm-only, and rolling for an actor requires owning it. A formula with no dice is a number typed from physical dice: a player may send one only while the table's `typedRolls` is open, and its record is marked `typed`.",
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
      // A formula with no dice is a number typed from physical dice (the sheet's manual entry): a player may send one
      // only while the table lets players type their dice.
      const typed = !resolution.terms.some((term) => term.kind === "dice");
      if (typed && !gmGrade && kit.read().builderPolicy.typedRolls !== "open")
        throw new CommandRejectedError("At this table the server rolls players' dice. Tap Roll to roll them.");
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
          ...(typed ? { typed: true as const } : {}),
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
