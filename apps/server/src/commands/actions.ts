import type { ActionResolution, AnnotationPoint, AnnotationShapeKind, GameState, RollRecord } from "@vtt/domain";
import { rollDice } from "@vtt/rules-5e";
import { resolveDefinitionAction } from "../action-resolution.js";
import { addAnnotation, shapeGeometry, templateOfArea } from "../annotations.js";
import { areaOriginatesFromCaster, tokensInTemplate } from "../area-targeting.js";
import { areaOriginHeight, creatureAtPoint, withinAreaHeight } from "../altitude.js";
import { GameAccessDeniedError, requireActorAccess } from "../authorization.js";
import { requireStartOrdered } from "../simultaneous-effects.js";
import { withSeenTargets } from "../resolution/seen-targets.js";
import { builtinActionFor } from "../builtin-actions.js";
import { effectiveActions } from "../effective-actions.js";
import { pushTokenAway } from "../forced-movement.js";
import { pushThroughZones } from "../pushed-through.js";
import { placeTemplates } from "../multi-templates.js";
import { spellRangeFeet } from "@vtt/content-srd-5.2.1/spell-effect";
import { ActionResolveSchema, ActionUseSchema, DiceRollSchema } from "@vtt/domain/commands";
import { CommandRejectedError, RulesBlockedError } from "../game-store.js";
import { heldRollFor, requireTypedDie } from "../held-rolls.js";
import { damageAdjustmentDetail } from "../hit-points.js";
import { activeMoveGrant } from "../granted-moves.js";
import { mapDistance, tokenCreatureDistance } from "../movement-narration.js";
import { settlePlayerDamage, type AppliedDamage } from "../player-damage.js";
import { recordRoll, rolledTerms } from "../roll-history.js";
import { effectiveModeFor, overrideWaives, rulesInForce } from "../rules-families.js";
import { looseRollPlan, routeForTap, slotsModeFor, spendLooseUses } from "../tap-routing.js";
import { conditionChoicesOf, isItemActionId, laterRowOf, upcastAction } from "../item-actions.js";
import { checkAimInArea, markStageUse, stageRefusal, withAreaDice } from "../zone-later.js";
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
import { castSlotLevel, untrainedArmorCast } from "../resolution/economy.js";
import { areaAtLevel } from "../spell-zone-state.js";
import { pickedZoneRow, zoneRowOf } from "../spell-zones.js";
import { ringTest } from "../zone-shapes.js";
import { spellWardedTargets } from "../zone-barriers.js";
import { deflectingWall, zoneCover } from "../zone-walls.js";
import { enclosedFrom } from "../enclosures.js";
import { areaMoveOf, moveArea, planAreaMove, type AreaMove } from "../zone-moves.js";
import { withChosenDamageType } from "../resolution/validate.js";
import { useCostOf, withChosenCost } from "../use-cost.js";
import { applyLooseHealing, looseHealTargets, partyMember } from "../loose-healing.js";
import { countOptionUse } from "../option-uses.js";
import { castLine, castSpellOf } from "../cast-narration.js";
import { castingMinutesOf } from "../resolution/long-casting.js";
import { passTime } from "../rests.js";
import { standsInSilence } from "../silence.js";
import { bringSummons, familiarDelivery } from "../summons.js";
import { distanceFromForce, settleForce, strikeOriginFor, struckFrom } from "../summon-strikes.js";
import { gmGradeLabelOf, initiatorOf, isGmGrade, sessionIdOf } from "./kit.js";
import { defineCommand } from "./pipeline.js";

// Stat-block actions, the server-routed "use this action" tap, and free dice rolls.

/** The fight's own ammunition rule, also held to outside one. */
const NO_AMMUNITION = "attack.no-ammunition";
const UNTRAINED_ARMOR = "spell.untrained-armor";

/** Who a player's cast outside a fight may name, said the same way whether the creature is hidden or gone. */
export const OUTSIDE_FIGHT_TARGETS = "Choose members of the party or creatures you can see.";

export const actionCommands = [
  defineCommand({
    type: "action.resolve",
    operationId: "resolveAction",
    description:
      "Runs a stat-block action: attack vs target AC with 2024 crit doubling, or save-DC surfacing with proposed damage. GM-grade for any combatant; a player session only for their own claimed character (cover and rules overrides stay GM-only). A player's hit is handed to the GM as a damage proposal, or applied directly when the table's player-damage-mode is `direct`. Targets are explicit ids or an area template (never both). An area catches every combatant under it; for a player it is refused when none they can see is inside, and their reply names only the creatures they can see. Rolls are recorded in the shared history and the response carries the `resolution`. An action or Bonus Action off the creature's own turn meets the `economy.not-your-turn` block, except a Readied creature's response, which spends its Reaction. A spell's cast may carry `shaping`: Metamagic options its caster knows, paid in Sorcery Points, and Sculpt Spells' protected creatures. The server checks each against the spell (`metamagic.*` blocks) and applies it.",
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
      const templates = request.templates;
      if ((template || templates) && !geometry?.calibration)
        throw new CommandRejectedError("Calibrate this map before placing an area template.");
      const gmSessionId = sessionIdOf(principal);
      let resolution: ReturnType<typeof resolveDefinitionAction> | undefined;
      // A player's confirmed hit (or darts) in "direct" mode applies server-side inside the mutation; captured for
      // narration.
      let playerDamageApplied: readonly AppliedDamage[] = [];
      // The spell this resolve casts and whom at, for the table's "casts" line.
      let cast = null as Readonly<{ name: string; targetIds: readonly string[] }> | null;
      let restBroken: EffectNarration[] = [];
      let castingOnward = false;
      let clock = { fromHours: 0, toHours: 0 };
      // A spell's area this action moved, what it did as it came to rest, and a rules note its move let through.
      let areaEvents: EffectNarration[] = [];
      // What the spell areas a push moves a creature through did to it.
      const pushedThrough: EffectNarration[] = [];
      let areaMoveNote: string | null = null;
      // A bolt aimed outside its spell's cloud that a rules mode let through.
      let areaAimNote: string | null = null;
      // The creatures a barrier against spells kept the cast from, for the GM.
      let wardNotes: string[] = [];
      const { state, duplicate } = await execute((draft) => {
        // Access first (the action kind is for the per-table policy hook, ADR-0021): a missing creature and someone
        // else's get one answer, so a player can't probe which ids exist.
        requireActorAccess(initiator, draft, actorId, "attack");
        const attacker = draft.actors.find((item) => item.id === actorId);
        if (!attacker) throw new CommandRejectedError("That combatant no longer exists.");
        // What its turn's start does at once comes first, in the order its player gives.
        requireStartOrdered(draft, actorId, initiator);
        const definition = attacker.definitionId ? kit.resolveDefinitionIn(draft, attacker.definitionId) : undefined;
        // Effective actions, so `item-<itemId>` ids resolve and item-raised numbers apply. A stat-block
        // action wins on id collision; builtins cover every combatant.
        const statBlockAction = effectiveActions(definition, attacker, kit.equipmentCatalog()).find(
          (candidate) => candidate.id === actionId
        );
        const listed = statBlockAction ?? builtinActionFor(definition, actionId, attacker);
        if (!listed) throw new CommandRejectedError("That action is not on the stat block.");
        // An action whose user picks its cost (Lay on Hands) resolves at the amount picked.
        const costed = withChosenCost(listed, request.spend);
        // What the spell's area asks of it: a stage it waits for (Storm of Vengeance's bolts), and the dice a storm adds
        // (Call Lightning).
        const areaSpell = costed.spellId ? kit.equipmentCatalog().spellRecord?.(costed.spellId) : undefined;
        const areaRow = areaSpell ? laterRowOf(areaSpell, costed.id) : undefined;
        const waiting =
          areaSpell && areaRow ? stageRefusal(draft, actorId, areaRow, areaSpell, kit.equipmentCatalog()) : null;
        if (waiting) throw new CommandRejectedError(waiting);
        const action = withAreaDice(draft, actorId, costed, areaSpell, request.option, kit.equipmentCatalog());
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
        let areaMove: AreaMove | null = null;
        let areaMoveTerms: NonNullable<ReturnType<typeof areaMoveOf>>["terms"] | undefined;
        // An item's action that leaves an area to act later (spread Caltrops) catches no one as it is used.
        const leavesArea = action.zone !== undefined && action.spellId === undefined;
        // The template as the action's area makes it, which the table's drawn shape records.
        let placed: Readonly<{ shape: AnnotationShapeKind; origin: AnnotationPoint; target: AnnotationPoint }> | null =
          null;
        // The other areas of a use that places several (Fire Storm's Cubes), drawn beside the first.
        let morePlaced: ReadonlyArray<
          Readonly<{ shape: AnnotationShapeKind; origin: AnnotationPoint; target: AnnotationPoint }>
        > = [];
        if (templates) {
          if (action.attack) throw new CommandRejectedError("Attacks target a single token. Pick the token itself.");
          if (draft.combat.mapAssetId !== mapAssetId)
            throw new CommandRejectedError("The active encounter changed. Try again.");
          if (!action.area) throw new CommandRejectedError(`${action.name} has no area to place.`);
          const casting = castSpellOf(action, kit.equipmentCatalog().spellRecord);
          const area = casting ? areaAtLevel(action.area, casting, request.slotLevel) : action.area;
          const range = casting ? kit.equipmentCatalog().spellRecord?.(casting.id)?.range : undefined;
          const many = placeTemplates(draft, {
            casterId: actorId,
            actionName: action.name,
            area,
            templates,
            rangeFeet: !range
              ? null
              : range.unit === "miles" && range.distance !== null
                ? range.distance * 5280
                : spellRangeFeet(range),
            geometry: geometry!
          });
          placed = many.placed[0] ?? null;
          morePlaced = many.placed.slice(1);
          resolvedTargetIds = many.targetIds;
          // Whether the areas hold anyone is judged on what the caster's player can see, as for one area.
          const unseen = isPlayer ? hiddenFromPlayer(draft) : new Set<string>();
          if (!resolvedTargetIds.some((id) => !unseen.has(id)))
            throw new CommandRejectedError(
              isPlayer ? "No creatures you can see are inside those areas." : "No combatants are inside those areas."
            );
        } else if (template) {
          if (action.attack) throw new CommandRejectedError("Attacks target a single token. Pick the token itself.");
          if (draft.combat.mapAssetId !== mapAssetId)
            throw new CommandRejectedError("The active encounter changed. Try again.");
          const calibration = geometry!.calibration!;
          // The action's own area decides the shape and the size, grown with a cast's slot (Fog Cloud); the drag only
          // places and points it.
          const casting = castSpellOf(action, kit.equipmentCatalog().spellRecord);
          // The form the cast picked is placed as its own area (Wall of Fire's ring).
          const form = casting ? pickedZoneRow(casting, request.option) : undefined;
          const ownArea = form?.area ?? action.area;
          const area = ownArea && casting ? areaAtLevel(ownArea, casting, request.slotLevel) : ownArea;
          placed = area ? templateOfArea(calibration, template, area) : template;
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
            (id) =>
              (id !== actorId || !casterOutside) &&
              (!draft.combat.active || draft.combat.initiative.some((entry) => entry.actorId === id))
          );
          // Height: an area reaches up and down only as far as its shape does (a flier above a Fireball is spared).
          resolvedTargetIds = withinAreaHeight(
            draft,
            resolvedTargetIds,
            action.area ?? { shape: placed.shape, sizeFeet: snapped.sizeFeet, widthFeet: null },
            areaOriginHeight(
              draft,
              actorId,
              casterOutside,
              creatureAtPoint(draft, calibration, snapped.origin),
              calibration.distancePerCell
            ),
            (id) => {
              const at = draft.combat.tokens.find((token) => token.actorId === id)?.position;
              return at ? (mapDistance(geometry!, snapped.origin, at)?.value ?? null) : null;
            },
            calibration.distancePerCell
          );
          // A ringed wall catches the creatures on its edge, not those it rings.
          if (form?.zone?.ring && placed.shape === "circle") {
            const onRing = ringTest(calibration, snapped);
            resolvedTargetIds = resolvedTargetIds.filter((id) => {
              const token = draft.combat.tokens.find((candidate) => candidate.actorId === id);
              return token?.position ? onRing(token.position, token.sizeCells) : false;
            });
          }
          // "Each creature on the ground in the area" (Earthquake): one in the air above it is spared.
          if (spell && zoneRowOf(spell)?.zone?.grounded)
            resolvedTargetIds = resolvedTargetIds.filter(
              (id) => (draft.combat.tokens.find((token) => token.actorId === id)?.altitudeFeet ?? 0) <= 0
            );
          // An area catches everyone under it, seen or not. Whether it holds anyone is judged on what the caster's
          // player can see, so an empty refusal never tells them a hidden creature is there. A spell that leaves its
          // area behind (Moonbeam, Web, a wall), or does nothing to whoever is in it (Minor Illusion's image), may be
          // placed where no one stands.
          const unseen = isPlayer ? hiddenFromPlayer(draft) : new Set<string>();
          const catches =
            action.save !== undefined ||
            action.damage.length > 0 ||
            action.healing !== undefined ||
            action.grants !== undefined ||
            action.endsConditions !== undefined;
          if (
            !resolvedTargetIds.some((id) => !unseen.has(id)) &&
            !(spell && (zoneRowOf(spell) || !catches)) &&
            !leavesArea
          )
            throw new CommandRejectedError(
              isPlayer ? "No creatures you can see are inside that area." : "No combatants are inside that area."
            );
          // Caltrops spread under a creature catch it only as it moves in.
          if (leavesArea) resolvedTargetIds = [];
          // What moves the spell's area (Moonbeam's move, Flaming Sphere's ram) places that area there instead, and
          // its save falls on the creatures the area moves onto.
          const moving = areaMoveOf(action, kit.equipmentCatalog());
          if (moving) {
            areaMove = planAreaMove(
              draft,
              {
                casterId: actorId,
                spell: moving.spell,
                feet: moving.feet,
                fromCaster: moving.fromCaster,
                terms: moving.terms,
                placed,
                override: isPlayer ? null : (override ?? null),
                widthFeet: action.area?.widthFeet ?? null
              },
              geometry!
            );
            areaMoveTerms = moving.terms;
            resolvedTargetIds = action.save ? areaMove.movedOnto : [];
          }
        } else {
          resolvedTargetIds = leavesArea ? [] : (targetIds ?? []);
          // A player may target only public combatants they can see: resolving against a hidden actor would leak
          // its name/AC/outcome through the ack (and in direct mode damage it). The refusal is the one a missing
          // creature gets, at the same point, so it says nothing of what is hidden.
          if (isPlayer && draft.combat.active && draft.combat.initiative.some((entry) => entry.actorId === actorId)) {
            const unseen = hiddenFromPlayer(draft);
            if (resolvedTargetIds.some((targetId) => unseen.has(targetId)))
              throw new CommandRejectedError("Every target must be in this encounter.");
          }
          // Outside a fight a player casts on the party or on a creature they can see.
          if (isPlayer && !draft.combat.active) {
            const unseen = hiddenFromPlayer(draft);
            if (
              resolvedTargetIds.some(
                (targetId) =>
                  unseen.has(targetId) &&
                  !partyMember(
                    draft.actors.find((actor) => actor.id === targetId),
                    initiator.sessionId
                  )
              )
            )
              throw new CommandRejectedError(OUTSIDE_FIGHT_TARGETS);
          }
        }
        // A bolt from a spell's cloud strikes under it (Call Lightning, Storm of Vengeance).
        if (areaSpell && geometry?.calibration && commit !== false)
          areaAimNote = checkAimInArea(
            draft,
            {
              casterId: actorId,
              action,
              spell: areaSpell,
              point: placed?.origin ?? null,
              targetIds: template || templates ? [] : resolvedTargetIds,
              override: isPlayer ? null : (override ?? null),
              option: request.option
            },
            kit.zoneDeps(draft, geometry)
          );
        // A spell's force (Spiritual Weapon's, an Arcane Eye) can't be harmed: an area passes over it, and nothing
        // harmful targets it.
        const untouchable = resolvedTargetIds.find(
          (id) => draft.actors.find((actor) => actor.id === id)?.summon?.intangible
        );
        if (untouchable && (template || templates))
          resolvedTargetIds = resolvedTargetIds.filter(
            (id) => !draft.actors.find((actor) => actor.id === id)?.summon?.intangible
          );
        else if (untouchable && (action.attack || action.save || action.damage.length > 0))
          throw new CommandRejectedError(`${kit.actorName(untouchable)} can't be harmed.`);
        // A barrier against spells (Globe of Invulnerability) leaves the creatures in it out of a lower spell cast from
        // outside it: the spell can target them and has no effect on them.
        const spellCast = castSpellOf(action, kit.equipmentCatalog().spellRecord);
        if (spellCast && geometry?.calibration && resolvedTargetIds.length > 0) {
          const warded = spellWardedTargets(
            draft,
            { casterId: actorId, castLevel: request.slotLevel ?? spellCast.level, targetIds: resolvedTargetIds },
            kit.zoneDeps(draft, geometry)
          );
          resolvedTargetIds = resolvedTargetIds.filter((id) => !warded.some((entry) => entry.actorId === id));
          wardNotes = warded.map(
            (entry) => `${entry.ward} keeps ${spellCast.name} from affecting ${kit.actorName(entry.actorId)}.`
          );
        }
        // A sphere of force lets no area in or out (Resilient Sphere); a single target across one is refused later.
        if (template && resolvedTargetIds.length > 0) {
          const enclosed = enclosedFrom(draft, actorId, resolvedTargetIds);
          resolvedTargetIds = resolvedTargetIds.filter((id) => !enclosed.some((entry) => entry.actorId === id));
          wardNotes = [
            ...wardNotes,
            ...enclosed.map(
              (entry) => `${entry.sphere} keeps ${action.name} from affecting ${kit.actorName(entry.actorId)}.`
            )
          ];
        }
        // Footprint-aware (SRD Creature Size): Medium adjacent to Large is 5 ft, measured edge to edge.
        const measured = (actorIdA: string, actorIdB: string): number | null =>
          geometry ? (tokenCreatureDistance(draft, geometry, actorIdA, actorIdB)?.value ?? null) : null;
        // A familiar delivering a touch spell: the touch reaches from the familiar, which takes its Reaction.
        const courier =
          request.deliveredBy !== undefined
            ? familiarDelivery(draft, {
                casterId: actorId,
                familiarId: request.deliveredBy,
                spell: action.spellId ? kit.equipmentCatalog().spellRecord?.(action.spellId) : undefined,
                distanceFeet: measured
              })
            : null;
        // A spell's force that strikes for its caster (Spiritual Weapon): the attack reaches from the force.
        const force = strikeOriginFor(
          draft,
          {
            userId: actorId,
            action,
            spell: action.spellId ? kit.equipmentCatalog().spellRecord?.(action.spellId) : undefined,
            at: request.summon?.at,
            targetId: resolvedTargetIds[0],
            override: isPlayer ? null : (override ?? null)
          },
          geometry?.calibration || geometry?.scale ? geometry : null
        );
        const fromCaster = (actorIdA: string, actorIdB: string): number | null =>
          courier && actorIdA === actorId ? measured(courier, actorIdB) : measured(actorIdA, actorIdB);
        const distanceFeet =
          force && geometry ? distanceFromForce(draft, actorId, force, geometry, fromCaster) : fromCaster;
        // The attack's d20 is held between a preview and its confirm, one per creature and turn (ADR-0012), so a
        // second look at the attack shows the same die. A typed die must be one the table takes.
        const holdKey = `attack:${actorId}`;
        if (attackNatural !== undefined && request.reroll !== true)
          requireTypedDie(draft, initiator, heldRollFor(draft, holdKey), attackNatural);
        // SRD forced movement (Push), snapped like a GM drag; takes no client input. Only `targets[0]` of a hit
        // is pushed, already restricted to public combatants for players. If the map changed since the grid
        // was fetched, degrade to null ("move the token") and never throw.
        const pushToken = (input: Readonly<{ actorId: string; awayFromActorId: string; distanceFeet: number }>) =>
          draft.combat.mapAssetId === mapAssetId
            ? geometry
              ? pushThroughZones(draft, input, geometry, kit.zoneDeps(draft, geometry), pushedThrough)
              : pushTokenAway(draft, input, geometry)
            : null;
        resolution = resolveDefinitionAction(
          draft,
          force ? struckFrom(action, force) : action,
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
            ...(request.answer ? { answer: request.answer } : {}),
            ...(request.damageLook === true ? { damageLook: true } : {}),
            ...(request.damageAnswer ? { damageAnswer: request.damageAnswer } : {}),
            attackTotal,
            critical,
            ...(fumble !== undefined ? { fumble } : {}),
            ...(request.skill !== undefined ? { skill: request.skill } : {}),
            ...(request.ability !== undefined ? { ability: request.ability } : {}),
            ...(request.optionId !== undefined ? { optionId: request.optionId } : {}),
            ...(request.targetOptions !== undefined ? { targetOptions: request.targetOptions } : {}),
            ...(request.itemId !== undefined ? { itemId: request.itemId } : {}),
            ...(request.pushFeet !== undefined ? { pushFeet: request.pushFeet } : {}),
            ...(request.slotLevel !== undefined ? { slotLevel: request.slotLevel } : {}),
            ...(request.damageType !== undefined ? { damageType: request.damageType } : {}),
            ...(request.hitOptions ? { hitOptions: request.hitOptions } : {}),
            ...(request.knockOut === true ? { knockOut: true } : {}),
            ...(request.overchannel === true ? { overchannel: true } : {}),
            ...(request.shaping && request.shaping.length > 0 ? { shaping: request.shaping } : {}),
            // The force appears where its cast strikes from.
            ...(force && force.markerId === null
              ? { summon: { ...(request.summon ?? {}), at: force.at } }
              : request.summon
                ? { summon: request.summon }
                : {}),
            // The form a shape-shift takes and what else it picks (its gear, Enlarge or Reduce).
            ...(request.form !== undefined ? { form: request.form } : {}),
            ...(request.targetForms ? { targetForms: request.targetForms } : {}),
            ...(request.gear !== undefined ? { gear: request.gear } : {}),
            ...(request.option !== undefined ? { option: request.option } : {}),
            ...(template || templates ? { areaPlaced: true } : {}),
            // The template as the map draws it, for the walls a cast raises on it (Wall of Force).
            ...(placed && geometry?.calibration
              ? {
                  placedArea: (({ origin, target }) => ({ shape: placed.shape, origin, target }))(
                    shapeGeometry(geometry.calibration, placed.shape, placed.origin, placed.target)
                  )
                }
              : {}),
            ...(request.wallId !== undefined ? { wallId: request.wallId } : {}),
            ...(request.ready === true ? { ready: true } : {}),
            ...(request.moveFirst === true ? { moveFirst: true } : {}),
            // The rest of an action whose move was taken first was paid for then.
            ...(request.moveFirst !== true && activeMoveGrant(draft, attacker)?.owedActionId === action.id
              ? { owedPaid: true }
              : {}),
            // Spell areas are the GM's to see, so only the GM aims a cast at one.
            ...(request.zoneId !== undefined && !isPlayer ? { zoneId: request.zoneId } : {}),
            ...(action.spellId !== undefined && standsInSilence(draft, actorId, geometry, kit.equipmentCatalog())
              ? { silenced: true }
              : {})
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
            pushToken,
            summon: (summonRequest) =>
              bringSummons(
                draft,
                summonRequest,
                kit.summonDeps(draft, draft.combat.mapAssetId === mapAssetId ? geometry : null)
              ),
            // The spell walls between two creatures that cover one or turn a shot (Blade Barrier, Wind Wall).
            ...(geometry?.calibration
              ? {
                  zoneCover: (fromId: string, targetId: string) =>
                    zoneCover(draft, fromId, targetId, kit.zoneDeps(draft, geometry)),
                  deflectedBy: (fromId: string, targetId: string) =>
                    deflectingWall(draft, fromId, targetId, kit.zoneDeps(draft, geometry))
                }
              : {})
          }
        );
        // A committed use counts toward the sheet's most-used options; a preview counts with its confirm.
        if (!resolution.preview) countOptionUse(draft, actorId, actionId);
        if (!resolution.preview && areaSpell && areaRow?.atRow) markStageUse(draft, actorId, areaRow, areaSpell);
        // The force moved before it struck again.
        if (force && geometry && !resolution.preview) settleForce(draft, force, geometry);
        if (force?.note) resolution = { ...resolution, warnings: [...(resolution.warnings ?? []), force.note] };
        // The familiar's Reaction delivered the touch.
        if (courier && !resolution.preview && draft.combat.active && !draft.combat.reactionsUsed.includes(courier))
          draft.combat = { ...draft.combat, reactionsUsed: [...draft.combat.reactionsUsed, courier] };
        const spell = castSpellOf(action, kit.equipmentCatalog().spellRecord);
        cast = spell ? { name: spell.name, targetIds: resolvedTargetIds } : null;
        // A casting under way on later turns, and outside a fight the hours a long one takes (SRD Longer Casting
        // Times): the cast completes at once and the game clock moves by its whole hours.
        castingOnward = attacker.effects.some((effect) => effect.longCast?.actionId === action.id);
        const hours =
          spell && !draft.combat.active && !action.castsAtOnce
            ? Math.floor(castingMinutesOf(spell, action.id) / 60)
            : 0;
        clock = { fromHours: draft.rest.clockHours, toHours: draft.rest.clockHours };
        let clockEvents: EffectNarration[] = [];
        if (!resolution.preview && hours > 0) {
          clockEvents = passTime(draft, hours, 0, {
            resolveDefinition: (definitionId) => kit.resolveDefinitionIn(draft, definitionId),
            catalog: kit.equipmentCatalog(),
            random: (sides) => kit.context.random(sides)
          });
          clock = { ...clock, toHours: draft.rest.clockHours };
        }
        // Casting a spell other than a cantrip stops a Short Rest, as it does on the loose route.
        restBroken = [
          ...clockEvents,
          ...(spell && spell.level > 0 && !draft.combat.active
            ? leaveShortRest(draft, new Set([actorId]), `cast ${spell.name}`)
            : [])
        ];
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
        // A nearly imperceptible glyph is drawn for the GM and its caster's player alone.
        const unseenArea = spell
          ? (pickedZoneRow(spell, request.option) ?? zoneRowOf(spell))?.zone?.hidden === true
          : action.zone?.hidden === true;
        if (placed && areaMove) {
          areaMoveNote = areaMove.note;
          areaEvents = moveArea(
            draft,
            areaMove,
            placed,
            { sessionId: gmSessionId, role: "gm" },
            {
              ...kit.zoneDeps(draft, geometry),
              geometry: geometry!
            },
            areaMoveTerms
          );
        } else if (placed)
          // The first area takes the command's id, which a lingering spell's zone reads; any others take their own.
          [placed, ...morePlaced].forEach((shape, index) =>
            addAnnotation(
              draft,
              {
                id: index === 0 ? commandId : kit.context.newId(),
                kind: "shape",
                shape: shape.shape,
                origin: shape.origin,
                target: shape.target,
                visibility: fromHiddenCaster ? "gm-only" : unseenArea ? "gm-actor" : "public",
                ...(unseenArea && !fromHiddenCaster ? { visibleToActorId: actorId } : {}),
                reachesPastMap: action.area !== undefined,
                actor: { sessionId: gmSessionId, role: "gm" },
                now: Date.now()
              },
              geometry!
            )
          );
      });
      if (duplicate || !resolution) return;
      // A player's reply names only the creatures they may see; the rest of an area's catch stays with the GM.
      const reply = isPlayer ? withSeenTargets(resolution, hiddenFromPlayer(state)) : resolution;
      // A preview recorded only the attack die: publish the roll, but hold narration until the resolve is confirmed.
      kit.publishRolls(state, commandId);
      if (!resolution.preview) {
        const hidden = kit.actorHidden(actorId);
        const told: { text: string; actorIds: string[] } = cast
          ? castLine(
              { id: actorId, name: kit.actorName(actorId) },
              cast.name,
              cast.targetIds.map((id) => ({ id, name: kit.actorName(id) })),
              kit.hiddenFromTable(state)
            )
          : { text: `${kit.actorName(actorId)} used ${resolution.actionName}.`, actorIds: [actorId] };
        // A casting still under way says so in its own line; the cast is told when it completes.
        if (!castingOnward)
          kit.context.broadcastTableEvent({ kind: "action", text: told.text, actorIds: told.actorIds, gmOnly: hidden });
        if (clock.toHours > clock.fromHours) {
          kit.context.onTimePassed?.(clock);
          const hours = clock.toHours - clock.fromHours;
          kit.context.appendLog({
            kind: "encounter",
            text: `${hours} ${hours === 1 ? "hour passes" : "hours pass"} while ${kit.actorName(actorId)} casts ${cast?.name ?? resolution.actionName}.`,
            gmOnly: hidden
          });
        }
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
        kit.publishNarrations(restBroken);
        kit.publishNarrations(areaEvents);
        kit.publishNarrations(pushedThrough);
        for (const note of wardNotes)
          kit.context.appendLog({ kind: "action", text: note, actorIds: [actorId], gmOnly: true });
        for (const note of [areaMoveNote, areaAimNote])
          if (note)
            kit.context.appendLog({
              kind: "action",
              text: `Rules note: ${note}`,
              actorIds: [actorId],
              gmOnly: true
            });
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
      "Uses an action and lets the server decide what that means. In the fight on this creature's turn it delegates to the full structured resolution and acks `route: \"resolved\"`. Off turn it is refused with the overridable, askable rules block `economy.not-your-turn` (reactions and legendary actions are exempt, because taking those off turn is the point); under an `economy` exception of advise/off it resolves, with a GM-only warning line under advise. With no fight running, a creature's own spell (an item's cast aside) resolves through the same structured path with no turn to spend, so its grant, Concentration, saves and slot apply, and acks `route: \"resolved\"` with the `resolution` (and `healing` for a heal); a cast that only helps lands on its caster when `targetIds` names no one, and one that rolls against creatures and names none rolls loose. Casting in armor the caster isn't trained with is refused there too (`spell.untrained-armor`). Otherwise with no fight running, or with this creature not in the turn order, the server rolls the action's own attack die (and, only with `includeDamage`, its damage parts) as attributed rolls, spends what the action costs (an item's charges or a feature's per-rest uses, and any spell slot an item cast consumes; refused when none remain; an item's last charge rolls its d20 for the GM), uses up a potion, flask or Spell Scroll and the shot's ammunition, reads a scroll only if the reader can (a spell above the reader's levels rolls its check first, and a failure loses the scroll with nothing else rolled), touches no combat state, and acks `route: \"loose\"` with the roll ids, and for a heal who regained what (`healing`). An action with nothing to roll is still used, with a feed line. A heal (a potion, a healing spell, Second Wind, Lay on Hands) lands on `targetIds` through the fight's hit point rules (the dead stay dead), its user when none are named: a player heals their own character or another member of the party, the GM anyone; damage never moves on the loose route. GM-grade for any combatant, including a monster's sheet; a player session only for their own claimed character.",
    summary:
      "Use an action and let the server route it: resolved in the fight on your turn, refused off turn, outside a fight resolved for a spell's cast and loose dice otherwise, where a heal lands on whoever it is given to (GM anyone; a player their own claimed character).",
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
        shaping,
        form,
        targetForms,
        gear,
        option,
        expectedRevision
      } = request;
      // What a shape-shift picks travels with the resolve wherever it goes.
      const shape = {
        ...(form === undefined ? {} : { form }),
        ...(targetForms === undefined ? {} : { targetForms }),
        ...(gear === undefined ? {} : { gear }),
        ...(option === undefined ? {} : { option })
      };
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
          ...(shaping === undefined ? {} : { shaping }),
          ...shape,
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
      const found =
        available.find((candidate) => candidate.id === actionId) ?? builtinActionFor(definition, actionId, actor);
      if (!found) throw new CommandRejectedError("That action is not on the stat block.");
      const listed = withChosenCost(found, chosenSpend);

      // Outside a fight a spell is cast as it is in one, from a sheet or an item, with no turn to spend: its grant,
      // Concentration, saves and area happen, and a heal says who regained what. So does an item's use that leaves an
      // effect on its user (Winged Boots). A cast that only helps lands on its caster when no one is named (Mage Armor
      // on oneself). One that rolls against creatures and names none (a Fire Bolt tapped on the sheet) has no one to
      // resolve against, so it rolls loose below.
      const rollsOnTargets = listed.attack !== undefined || listed.save !== undefined || listed.damage.length > 0;
      const aimed =
        listed.grants?.target === "target" ||
        listed.grants?.target === "targets" ||
        (listed.healing !== undefined && listed.healing.self !== true) ||
        listed.endsConditions !== undefined;
      const named = targetIds && targetIds.length > 0 ? targetIds : !rollsOnTargets && aimed ? [actorId] : [];
      // A shape-shift outside a fight (Wild Shape to scout, a werewolf's change) takes its form the same way.
      const shapeShifts = listed.shapeShift !== undefined || listed.endsForm === true;
      const itemGrant = isItemActionId(listed.id) && listed.grants !== undefined;
      if (
        !snapshot.combat.active &&
        (castSpellOf(listed, kit.equipmentCatalog().spellRecord) !== null || shapeShifts || itemGrant) &&
        (named.length > 0 || !rollsOnTargets || shapeShifts)
      ) {
        const result = await dispatch("action.resolve", {
          commandId,
          actorId,
          actionId,
          ...(named.length > 0 ? { targetIds: named } : {}),
          ...(rollMode ? { rollMode } : {}),
          ...(override ? { override } : {}),
          ...(slotLevel === undefined ? {} : { slotLevel }),
          ...(chosenSpend === undefined ? {} : { spend: chosenSpend }),
          ...(damageType === undefined ? {} : { damageType }),
          ...(shaping === undefined ? {} : { shaping }),
          ...shape,
          ...(expectedRevision === undefined ? {} : { expectedRevision })
        });
        const healing = (result.resolution as ActionResolution | undefined)?.healing;
        return { ...result, route: "resolved", ...(healing ? { healing } : {}) };
      }
      // Metamagic shapes a cast the server resolves; loose dice have nothing for it to change.
      if (shaping && shaping.length > 0)
        throw new CommandRejectedError("Metamagic shapes a spell cast at its targets. Choose who the spell targets.");
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
        // SRD Armor Training: no spells in armor the caster isn't trained with, an item's cast included.
        const armorBlock = untrainedArmorCast(live, action, definition, kit.equipmentCatalog());
        if (armorBlock !== null) {
          const mode = effectiveModeFor(rulesInForce(draft), UNTRAINED_ARMOR);
          if (mode === "strict" && !overrideWaives(override, UNTRAINED_ARMOR))
            throw new RulesBlockedError(UNTRAINED_ARMOR, armorBlock);
          if (mode !== "freeform") rulesNote = armorBlock;
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
          narrations = [
            ...narrations,
            ...grantOutsideFight(draft, live, action, commandId, (sides) => kit.context.random(sides))
          ];
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
        const casting = castSpellOf(action, kit.equipmentCatalog().spellRecord);
        kit.context.appendLog({
          kind: "action",
          text: casting
            ? `${kit.actorName(actorId)} casts ${casting.name}${left}.`
            : `${kit.actorName(actorId)} uses ${action.name}${left}.`,
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
      "Rolls dice into the shared, auditable roll history; the response carries `rollId`. Player sessions cannot roll gm-only, and rolling for an actor requires owning it. A formula with no dice is a number typed from physical dice: a player may send one only while the table's `typedRolls` is open, and its record is marked `typed`. A player's roll is marked `free` and shown as a free roll: its formula and label are the player's, and the rules' checks, saves and attacks come from the commands that work out their bonuses.",
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
          // A player's own formula and label: shown as a free roll, so it never reads as a rule's.
          ...(gmGrade ? {} : { free: true as const }),
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
