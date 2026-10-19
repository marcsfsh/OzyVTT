import { isDead, type RollRecord } from "@vtt/domain";
import { setCondition } from "../actor-conditions.js";
import { GameAccessDeniedError, requireActorAccess } from "../authorization.js";
import { replaceableOffers } from "../choice-overrides.js";
import type { EffectNarration } from "../effects.js";
import { HIDDEN_SOURCE } from "../hidden-source.js";
import { convertResource } from "../conversions.js";
import {
  ActorConvertSchema,
  ActorRechooseSchema,
  ActorRestoreUsesSchema,
  ActorRestSchema,
  ActorReviveSchema,
  ActorSpendHitDiceSchema,
  ActorSpendUsesSchema,
  ApplyDamageSchema,
  HpAmountSchema,
  SetConditionSchema,
  SetHpSchema,
  TempHpSchema
} from "@vtt/domain/commands";
import { CommandRejectedError } from "../game-store.js";
import {
  adjustableActor,
  applyDamageDetailed,
  damageAdjustmentDetail,
  deadCantHealLine,
  healActor,
  isSrdDamageType,
  reviveActor,
  setCurrentHp,
  setMaximumHp,
  setTemporaryHp,
  UNTYPED_DAMAGE
} from "../hit-points.js";
import { rechooseInLedger } from "../ledger-rechoice.js";
import { applyRest, hitDieSizesToSpend, spendHitDice, startOwnShortRest } from "../rests.js";
import { restoreUses, spendUses } from "../use-pools.js";
import { builtinActionFor } from "../builtin-actions.js";
import { effectiveActions } from "../effective-actions.js";
import type { EquipmentCatalog } from "../equipment-derivation.js";
import type { ActorDefinition } from "@vtt/schemas";
import { recordRoll } from "../roll-history.js";
import { initiatorOf, isGmGrade, sessionIdOf } from "./kit.js";
import { defineCommand } from "./pipeline.js";

// Hit points, conditions and rests.

type SourceKit = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  equipmentCatalog: () => EquipmentCatalog;
}>;

/** The action a named source used, read from its own sheet or stat block. */
function sourceActionOf(
  state: Parameters<typeof applyDamageDetailed>[0],
  sourceActorId: string,
  sourceActionId: string,
  kit: SourceKit
) {
  const source = state.actors.find((candidate) => candidate.id === sourceActorId);
  if (!source) return undefined;
  const definition = source.definitionId ? kit.resolveDefinition(source.definitionId) : undefined;
  return (
    effectiveActions(definition, source, kit.equipmentCatalog()).find((candidate) => candidate.id === sourceActionId) ??
    builtinActionFor(definition, sourceActionId, source)
  );
}

/** SRD Knocking Out a Creature: only "a melee attack" can, so a named source action that isn't one is refused. */
function requireMeleeKnockOut(
  state: Parameters<typeof applyDamageDetailed>[0],
  sourceActorId: string,
  sourceActionId: string,
  kit: SourceKit
): void {
  const action = sourceActionOf(state, sourceActorId, sourceActionId, kit);
  if (!action) return;
  // A ranged attack, or a save or spell with no attack roll; an action that doesn't say stays the GM's call.
  const ranged =
    action.attack !== undefined && action.attack.reachFeet === undefined && action.attack.rangeFeet !== undefined;
  const noAttack = action.attack === undefined && (action.save !== undefined || action.spellId !== undefined);
  if (ranged || noAttack)
    throw new CommandRejectedError(`Only a melee attack can knock a creature out, and ${action.name} isn't one.`);
}

export const actorHealthCommands = [
  defineCommand({
    type: "actor.apply-damage",
    operationId: "applyDamage",
    description:
      "Applies damage (temporary hit points absorb first). Optional typed `parts` run the defense pipeline (immunity, then resistance, half rounded down, then vulnerability, double) from the target's definition and active effects, with the per-part breakdown returned in `applied`; the bare `amount` is the manual path (no defense math). Dropping a player character to 0 starts the dying state (Unconscious + Prone + death saves; `critical: true` while dying adds two failures). `nonlethal` knocks out instead (SRD): a melee attack that would drop the target to 0 leaves it at 1 HP and Unconscious until it regains hit points; a named `sourceActionId` that is not a melee attack is refused. On the GM's apply, a named `sourceActionId` whose damage drains (a Life Drain, Vampiric Touch) lowers the target's Hit Point maximum or heals the source as the action says. Any damage ends the target's effects that end on damage (Sleep). Player sessions may target only their claimed character.",
    summary: "Apply damage (GM anyone; a player their claimed character).",
    schema: ApplyDamageSchema,
    malformed: "The damage command is malformed.",
    async run({ principal, request, execute }, kit) {
      const {
        commandId,
        actorId,
        amount,
        parts,
        damageType,
        damageOverride,
        sourceActorId,
        sourceName,
        critical,
        nonlethal
      } = request;
      const distance = await kit.creatureDistance();
      let outcome: ReturnType<typeof applyDamageDetailed> | undefined;
      const { duplicate } = await execute((state) => {
        if (nonlethal && sourceActorId && request.sourceActionId)
          requireMeleeKnockOut(state, sourceActorId, request.sourceActionId, kit);
        // What the named action's damage drains (a wraith's Life Drain), read from its own stat block. The GM's
        // apply alone: a player's names their own character as the target, never a source to heal.
        const drain =
          isGmGrade(principal) && sourceActorId && request.sourceActionId
            ? sourceActionOf(state, sourceActorId, request.sourceActionId, kit)?.drain
            : undefined;
        outcome = applyDamageDetailed(
          state,
          actorId,
          {
            amount,
            parts,
            damageType,
            damageOverride,
            critical,
            sourceName: sourceName ?? null,
            sourceActorId: sourceActorId ?? null,
            nonlethal,
            ...(drain ? { drain } : {})
          },
          initiatorOf(principal),
          {
            resolveDefinition: kit.resolveDefinition,
            newId: kit.context.newId,
            now: () => new Date().toISOString(),
            catalog: kit.equipmentCatalog(),
            commandId,
            rollDie: (sides) => kit.context.random(sides),
            distanceFeet: (actorIdA, actorIdB) => distance(state, actorIdA, actorIdB)
          }
        );
      });
      if (duplicate || !outcome) return;
      // Typed damage narrates its adjustments ("17 bludgeoning → 8, resistance: Rage") so the table sees
      // why the number differs (ADR-0020).
      const detail = damageAdjustmentDetail(outcome.application);
      // The GM's Apply names the attacker; one hidden from the table is "A hidden threat" there, as everywhere.
      const shownSource =
        sourceName && sourceActorId !== undefined && kit.actorHidden(sourceActorId) ? HIDDEN_SOURCE : sourceName;
      const attribution = shownSource
        ? `${shownSource} hit ${kit.actorName(actorId)} for`
        : `${kit.actorName(actorId)} took`;
      const text = `${attribution} ${outcome.application.totalApplied} damage${detail}.`;
      kit.context.broadcastTableEvent({ kind: "damage", text, actorIds: [actorId] });
      if (detail.length > 0 || sourceName) kit.context.appendLog({ kind: "damage", text, actorIds: [actorId] });
      // An unknown damage type is legal (homebrew) but usually a typo that silently does nothing, so the
      // GM gets a private warning and the damage still lands.
      if (
        damageType !== undefined &&
        !isSrdDamageType(damageType) &&
        damageType.trim().toLowerCase() !== UNTYPED_DAMAGE
      )
        kit.context.appendLog({
          kind: "damage",
          text: `"${damageType}" is not one of the SRD damage types. Only a homebrew defence naming it exactly will match.`,
          actorIds: [actorId],
          gmOnly: true
        });
      kit.publishNarrations(outcome.events);
      return { applied: outcome.application };
    }
  }),

  defineCommand({
    type: "actor.heal",
    operationId: "healActor",
    description:
      "Heals hit points up to the maximum. A dead creature can't regain hit points (refused; `actor.revive` brings it back first). Player sessions may target only their claimed character.",
    summary: "Heal hit points (GM anyone; a player their claimed character).",
    schema: HpAmountSchema,
    malformed: "The healing command is malformed.",
    async run({ principal, request, execute }, kit) {
      const { actorId, amount } = request;
      let events: EffectNarration[] = [];
      const { duplicate } = await execute((state) => {
        const target = adjustableActor(state, actorId, initiatorOf(principal));
        if (isDead(target)) throw new CommandRejectedError(deadCantHealLine(target.name));
        events = healActor(state, actorId, amount, initiatorOf(principal));
      });
      if (duplicate) return;
      kit.context.broadcastTableEvent({
        kind: "heal",
        text: `${kit.actorName(actorId)} healed ${amount}.`,
        actorIds: [actorId]
      });
      kit.publishNarrations(events);
    }
  }),

  defineCommand({
    type: "actor.set-temp-hp",
    operationId: "setTemporaryHp",
    description:
      "Sets temporary hit points (replaces, 5e-style). Player sessions may target only their claimed character.",
    summary: "Set temporary hit points (GM anyone; a player their claimed character).",
    schema: TempHpSchema,
    malformed: "The temporary hit point command is malformed.",
    async run({ principal, request, execute }) {
      await execute((state) => setTemporaryHp(state, request.actorId, request.amount, initiatorOf(principal)));
    }
  }),

  defineCommand({
    type: "actor.revive",
    operationId: "reviveActor",
    description:
      "Brings a dead creature back to life with the given hit points (SRD Dead: only magic such as Revivify or Raise Dead revives one; the GM applies it). The dying state and its Unconscious end, a creature that died with Exhaustion returns one level lower, and its magic items are no longer attuned. Refused for a creature that isn't dead. GM-grade only.",
    summary: "Revive a dead creature with the given hit points (GM).",
    schema: ActorReviveSchema,
    malformed: "The revive command is malformed.",
    gmOnly: "Only the GM can revive a creature.",
    async run({ principal, request, execute }, kit) {
      let events: EffectNarration[] = [];
      const { duplicate } = await execute((state) => {
        events = reviveActor(state, request.actorId, request.hitPoints, initiatorOf(principal), {
          resolveDefinition: (definitionId) => kit.resolveDefinitionIn(state, definitionId),
          catalog: kit.equipmentCatalog()
        });
      });
      if (!duplicate) kit.publishNarrations(events);
    }
  }),

  defineCommand({
    type: "actor.set-hp",
    operationId: "setCurrentHp",
    description:
      "Sets current hit points directly, and optionally the hit point maximum first (GM-grade only). Raising a dead creature's hit points is refused: `actor.revive` brings it back.",
    summary: "Set current (and maximum) hit points directly (GM).",
    schema: SetHpSchema,
    malformed: "The hit point command is malformed.",
    gmOnly: "Only the GM can set hit points directly.",
    async run({ request, execute }, kit) {
      let events: EffectNarration[] = [];
      if (request.current === undefined && request.maximum === undefined)
        throw new CommandRejectedError("Give the current hit points, the maximum, or both.");
      const { duplicate } = await execute((state) => {
        if (request.maximum !== undefined) setMaximumHp(state, request.actorId, request.maximum, { role: "gm" });
        if (request.current !== undefined)
          events = setCurrentHp(state, request.actorId, request.current, { role: "gm" });
      });
      if (!duplicate) kit.publishNarrations(events);
    }
  }),

  defineCommand({
    type: "actor.set-condition",
    operationId: "setCondition",
    description:
      "Applies or clears a bundled SRD condition. Exhaustion is cumulative: without `level` it gains one level, with one it is set to that level. The GM may name the charmer or the source of fear (`sourceActorId`) for Charmed or Frightened: the condition then rides an effect from that creature, so it can't be harmed by its charmed bearer or approached by its frightened one, and clearing the condition ends it. Player sessions may target only their claimed character: they may add any condition and clear one they added, while clearing one imposed by a save, an effect or the GM is a rules block (`condition.imposed`) they can ask the GM about; standing from Prone is allowed only on their own turn in a fight (`movement.stand-up-off-turn`) and costs half their Speed.",
    summary: "Apply or clear an SRD condition, with exhaustion levels.",
    schema: SetConditionSchema,
    malformed: "The condition command is malformed.",
    async run({ principal, request, execute }, kit) {
      if (!kit.catalogFor(principal).hasCondition(request.conditionId))
        throw new CommandRejectedError("That condition is not in the bundled rules.");
      if (request.override && !isGmGrade(principal))
        throw new GameAccessDeniedError("Only the GM can override movement rules.");
      const { actorId, conditionId, active, level, sourceActorId } = request;
      let events: EffectNarration[] = [];
      const { duplicate } = await execute((state) => {
        events = setCondition(state, actorId, conditionId, active, level, initiatorOf(principal), {
          override: request.override ?? null,
          ...(sourceActorId !== undefined ? { sourceActorId } : {}),
          resolveDefinition: kit.resolveDefinition,
          catalog: kit.equipmentCatalog()
        });
      });
      if (duplicate) return;
      const conditionName =
        kit
          .catalogFor(principal)
          .conditionSummaries()
          .find((entry) => entry.id === conditionId)?.name ?? conditionId;
      // Immunity skips narrate through the events, in place of the generic applied line.
      if (!events.some((event) => event.immune))
        kit.context.broadcastTableEvent({
          kind: "condition",
          text: active
            ? `${kit.actorName(actorId)} is ${conditionName}${conditionId === "exhaustion" && level ? ` ${level}` : ""}.`
            : `${kit.actorName(actorId)} is no longer ${conditionName}.`,
          actorIds: [actorId]
        });
      kit.publishNarrations(events);
    }
  }),

  defineCommand({
    type: "actor.rechoose",
    operationId: "rechooseActorPick",
    description:
      "Re-makes a pick the character's content says may be re-made on a rest (Circle of the Land's land type on a Long Rest; Fiendish Resilience's damage type on either). A pick the build itself reads (its options grant spells, or another pick depends on it, as the land's spells and Nature's Ward do) is written to the character's choices ledger and the sheet is rebuilt from it, keeping what has been spent, outside a fight. Any other pick is runtime state on the actor, kept until the character chooses again, so a re-choice needs no rebuild. A player session re-chooses only on their claimed character, outside a fight, in the step a finished rest opened (a Long Rest for a Long Rest pick, either rest for the others); the GM on anyone, any time. Which offers are re-choosable, and what each may become, are both decided from the content: a client cannot widen either.",
    summary:
      "Re-make a pick a feature says may be re-made on a rest (Circle of the Land's land type on a Long Rest, Fiendish Resilience's damage type on either). Your own character; the GM anyone.",
    schema: ActorRechooseSchema,
    malformed: "The re-choose command is malformed.",
    // What may be re-chosen comes from content, never the request.
    async run({ principal, request, execute }, kit) {
      const { actorId, offer, id, replacing } = request;
      const initiator = initiatorOf(principal);
      let line = "";
      const { duplicate } = await execute((state) => {
        // Same owner-or-GM rule as a rest, checked first so a missing creature and someone else's get one answer.
        requireActorAccess(initiator, state, actorId, "resource");
        const actor = state.actors.find((candidate) => candidate.id === actorId);
        if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
        const definition = actor.definitionId ? kit.resolveDefinition(actor.definitionId) : undefined;
        // Play content: legality is a question about what the sheet already has, whatever a pack's switch says.
        // Nothing GM-only is projected.
        const choices = replaceableOffers(definition, kit.playCatalog());
        const match = choices.find((candidate) => candidate.offer === offer);
        if (!match) {
          throw new CommandRejectedError(
            choices.length === 0
              ? `Nothing on ${actor.name}'s sheet can be re-chosen on a rest.`
              : `${actor.name} cannot re-choose "${offer}". ${actor.name} can re-choose only ${choices.map((candidate) => `"${candidate.offer}"`).join(", ")}.`
          );
        }
        if (!match.options.includes(id)) {
          throw new CommandRejectedError(
            `"${id}" is not one of the options ${match.label} offers (${match.options.join(", ")}).`
          );
        }
        const chosen = match.optionNames[id] ?? id;
        // SRD: "whenever you finish a Short or Long Rest" (or a Long Rest): a player re-chooses in the step that rest
        // opened, outside a fight; the GM any time.
        if (initiator.role !== "gm") {
          if (state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actorId))
            throw new CommandRejectedError(`${match.label} is chosen after a rest. End the fight first.`);
          const afterLong = actor.restStep?.after === "long-rest" || actor.preparation !== null;
          const open = match.per === "long-rest" ? afterLong : afterLong || actor.restStep !== null;
          if (!open)
            throw new CommandRejectedError(
              `${actor.name} chooses ${match.label} again after finishing a ${match.per === "long-rest" ? "Long Rest" : "Short or Long Rest"}.`
            );
        }
        // A pick of several changes one held answer at a time, as many a rest as the feature says ("change one of
        // those weapon choices"); the GM changes any number.
        if (match.multi && replacing === undefined)
          throw new CommandRejectedError(`Say which of ${actor.name}'s ${match.label} picks to change.`);
        if (!match.multi && replacing !== undefined)
          throw new CommandRejectedError(`${match.label} is one pick. Send no answer to replace.`);
        const swapped = actor.restStep?.swaps?.[offer] ?? 0;
        if (match.multi && initiator.role !== "gm" && swapped >= match.swaps)
          throw new CommandRejectedError(
            `${actor.name} has changed ${match.swaps === 1 ? "one" : match.swaps} of ${match.label} this rest already.`
          );
        if (!match.rebuilds) {
          // Stored as `choiceOverrides` on the actor (not the choices ledger) and cleared by the matching rest.
          actor.choiceOverrides = { ...actor.choiceOverrides, [offer]: { id, per: match.per } };
          line = `${kit.actorName(actorId)} re-chose ${match.label}: ${chosen}.`;
          return;
        }
        // The build reads this answer (the land's spells and Nature's Ward), so it goes into the ledger.
        if (state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actorId))
          throw new CommandRejectedError(`${match.label} is chosen after a rest. End the fight first.`);
        rechooseInLedger(
          state,
          actorId,
          offer,
          id,
          { library: kit.playCatalog(), policy: state.builderPolicy, catalog: kit.equipmentCatalog() },
          replacing
        );
        const rested = state.actors.find((candidate) => candidate.id === actorId);
        if (match.multi && rested?.restStep)
          rested.restStep = { ...rested.restStep, swaps: { ...rested.restStep.swaps, [offer]: swapped + 1 } };
        // An override from before the answer moved into the ledger would only shadow it.
        const { [offer]: _stale, ...others } = actor.choiceOverrides;
        actor.choiceOverrides = others;
        line =
          replacing !== undefined
            ? `${kit.actorName(actorId)} changed ${match.optionNames[replacing] ?? replacing} for ${chosen} (${match.label}).`
            : `${kit.actorName(actorId)} chose ${chosen} for ${match.label}.`;
      });
      if (!duplicate)
        kit.context.appendLog({
          kind: "encounter",
          text: line,
          actorIds: [actorId],
          gmOnly: kit.actorHidden(actorId)
        });
    }
  }),

  defineCommand({
    type: "actor.rest",
    operationId: "restActor",
    description:
      "Applies a rest to a rostered actor outside combat; the GM rests anyone at once. A player session starts a Short Rest for their claimed character, which is then under way like the party's (rest.party): the player spends Hit Point Dice during it (actor.spend-hit-dice) and marks it done (rest.mark-done), and the GM ends it (rest.finish), when its benefits land and an hour passes; a Short Rest already under way takes the character in. A player asks the GM for a Long Rest (rest.ask). Either rest needs at least 1 hit point (SRD) and is refused for a creature at 0 or dead, and a Long Rest is refused within 16 hours of game time after the actor's last one (the refusal says how long is left; time.pass moves the clock). Long: the actor's Concentration ends, and its other effects that would run out in the rest's 8 hours end, their on-end grants firing first. The clock itself moves only with time.pass or a party rest, so what lasts longer waits for the GM to pass those hours and they count once; effects that last until ended stay. Hit points restore to maximum, temporary HP clears, limited-use pools refresh (a charged item regains its printed dice), all spent Hit Point Dice restore, spell slots and Pact Magic refill, a caster that prepares its spells after a Long Rest gets the step to change them, and Exhaustion drops one level. Short: per-short-rest, recharge and per-encounter pools and Pact Magic slots re-arm, and features that say so give back uses of a long-rest pool (Rage, Second Wind, Channel Divinity, Wild Shape: one; Bardic Inspiration from Bard 5: all); healing is the separate spend-hit-dice call. A Short Rest leaves effects to the game clock, which the GM moves (the party Short Rest moves it an hour).",
    summary:
      "Start a Short Rest for your own character, which the GM ends; the GM rests anyone at once. Short re-arms short-rest uses and Pact Magic; long restores HP, Hit Dice, slots and uses, and drops one Exhaustion level.",
    schema: ActorRestSchema,
    malformed: "The rest command is malformed.",
    async run({ principal, request, execute }, kit) {
      const { actorId, kind } = request;
      const initiator = initiatorOf(principal);
      // A Long Rest is the GM's to give: a player asks for one (rest.ask) instead.
      if (kind === "long" && initiator.role !== "gm")
        throw new GameAccessDeniedError("Ask the GM for a Long Rest. The GM approves it.");
      // A player's Short Rest is under way until the GM ends it, so its hour passes and Hit Dice are spent during it.
      if (initiator.role !== "gm") {
        let joined = false;
        const { duplicate: again } = await execute((state) => {
          joined = startOwnShortRest(state, actorId, initiator);
        });
        if (again) return;
        kit.context.appendLog({
          kind: "heal",
          text: `${kit.actorName(actorId)} ${joined ? "joins the Short Rest" : "starts a Short Rest"}.`,
          actorIds: [actorId],
          gmOnly: kit.actorHidden(actorId)
        });
        kit.context.broadcastTableEvent({
          kind: "heal",
          text: `${kit.actorName(actorId)} ${joined ? "joins the Short Rest" : "starts a Short Rest"}. End it from Rest on the Table.`,
          actorIds: [actorId],
          gmOnly: true,
          logged: false
        });
        return;
      }
      let events: EffectNarration[] = [];
      const chargeLines: string[] = [];
      // Authorized inside the mutation against live state (applyRest still refuses a combatant in a running
      // encounter). A charged item's dawn regain is rolled with the server's dice.
      const { duplicate } = await execute((state) => {
        requireActorAccess(initiator, state, actorId, "resource");
        chargeLines.length = 0;
        events = applyRest(state, actorId, kind, kit.resolveDefinition, kit.equipmentCatalog(), {
          random: (sides) => kit.context.random(sides),
          lines: chargeLines
        });
      });
      if (duplicate) return;
      kit.context.appendLog({
        kind: "heal",
        text: `${kit.actorName(actorId)} completed a ${kind} rest.`,
        actorIds: [actorId],
        gmOnly: kit.actorHidden(actorId)
      });
      for (const line of chargeLines)
        kit.context.appendLog({ kind: "heal", text: line, actorIds: [actorId], gmOnly: kit.actorHidden(actorId) });
      kit.publishNarrations(events);
    }
  }),

  defineCommand({
    type: "actor.spend-uses",
    operationId: "spendUses",
    description:
      "Spends several uses of one of the actor's limited-use pools at once, keyed as the counters are: Lay on Hands' points outside a fight, or Focus Points for a feature the engine doesn't run. The key is `uses.pool`, or `action.id` when there is no pool. A player session only on their claimed character, the GM anyone. Refused when the pool holds fewer, and for a pool that comes back every turn.",
    summary: "Spend several uses of a limited-use pool at once (your own character; GM anyone).",
    schema: ActorSpendUsesSchema,
    malformed: "The spend is malformed.",
    async run({ principal, request, execute }, kit) {
      const { actorId, poolId, amount } = request;
      let spent: { name: string; left: number; line: string | null } = { name: "", left: 0, line: null };
      const { duplicate } = await execute((state) => {
        spent = spendUses(state, actorId, poolId, amount, initiatorOf(principal), {
          resolveDefinition: (definitionId) => kit.resolveDefinitionIn(state, definitionId),
          catalog: kit.equipmentCatalog(),
          random: (sides) => kit.context.random(sides)
        });
      });
      if (duplicate) return;
      kit.context.appendLog({
        kind: "action",
        text: `${kit.actorName(actorId)} spends ${amount} of ${spent.name} (${spent.left} left).${spent.line ? ` ${spent.line}` : ""}`,
        actorIds: [actorId],
        gmOnly: kit.actorHidden(actorId)
      });
    }
  }),

  defineCommand({
    type: "actor.restore-uses",
    operationId: "restoreUses",
    description:
      "GM-only: gives back up to `amount` spent uses of one of the actor's limited-use pools (a ruling; a feature that refills a pool by its own rule is `actor.convert`). Refused when the pool is already full and for a pool that comes back every turn.",
    summary: "Give back spent uses of a limited-use pool (GM).",
    schema: ActorRestoreUsesSchema,
    malformed: "The restore is malformed.",
    gmOnly: "Only the GM gives uses back.",
    async run({ principal, request, execute }, kit) {
      const { actorId, poolId, amount } = request;
      let back = { name: "", restored: 0, left: 0 };
      const { duplicate } = await execute((state) => {
        back = restoreUses(state, actorId, poolId, amount, initiatorOf(principal), {
          resolveDefinition: (definitionId) => kit.resolveDefinitionIn(state, definitionId),
          catalog: kit.equipmentCatalog()
        });
      });
      if (duplicate) return;
      kit.context.appendLog({
        kind: "action",
        text: `${kit.actorName(actorId)} gets ${back.restored} of ${back.name} back (${back.left} left).`,
        actorIds: [actorId],
        gmOnly: kit.actorHidden(actorId)
      });
    }
  }),

  defineCommand({
    type: "actor.convert",
    operationId: "convertResource",
    description:
      "Turns one of a character's resources into another, or recovers one, by a feature's rule; `actor:available-actions` lists the ones the character has (`conversions`), with why each can't be used now. Font of Magic: a spell slot for Sorcery Points equal to its level, up to the maximum, or as a Bonus Action Sorcery Points for a slot of level 5 or lower at the printed cost and Sorcerer level (a made slot can sit above the maximum and vanishes on a Long Rest). Font of Inspiration: a slot for a Bardic Inspiration. Wild Resurgence: a slot for a Wild Shape when none is left, once on each turn, and a Wild Shape for a level 1 slot once per Long Rest. Nature Magician: Wild Shape uses for one slot, 2 levels each, once per Long Rest. Arcane Recovery and Natural Recovery: spent slots adding up to half the class level (round up), none of level 6 or higher, in the step a finished Short Rest opens, once per Long Rest. Magical Cunning: Pact Magic slots up to half the maximum (all with Eldritch Master), outside a fight. Sorcerous Restoration: Sorcery Points up to half the Sorcerer level, after a Short Rest. Restoring a spent use: Intimidating Presence with a Rage, Holy Nimbus with a level 5 slot, Dragon Wings with 3 Sorcery Points, Hurl Through Hell with a Pact Magic slot, Innate Sorcery with 2 Sorcery Points (Sorcery Incarnate). Pearl of Power: a Magic action for a spent slot of level 3 or lower, once per dawn. Persistent Rage and Uncanny Metabolism (with its Martial Arts die and Monk level in Hit Points): from rolling Initiative to the end of the character's first turn, once per Long Rest. A player session only on their claimed character; the GM on anyone.",
    summary: "Turn one resource into another, or recover one, by a feature's rule.",
    schema: ActorConvertSchema,
    malformed: "The conversion is malformed.",
    async run({ principal, request, execute }, kit) {
      const { actorId, conversionId, level, pact, levels, count } = request;
      let line = "";
      const { duplicate } = await execute((state) => {
        requireActorAccess(initiatorOf(principal), state, actorId, "resource");
        line = convertResource(
          state,
          actorId,
          {
            conversionId,
            ...(level !== undefined ? { level } : {}),
            ...(pact !== undefined ? { pact } : {}),
            ...(levels !== undefined ? { levels } : {}),
            ...(count !== undefined ? { count } : {})
          },
          {
            resolveDefinition: (definitionId) => kit.resolveDefinitionIn(state, definitionId),
            catalog: kit.equipmentCatalog(),
            random: (sides) => kit.context.random(sides)
          }
        );
      });
      if (duplicate) return;
      kit.context.appendLog({ kind: "action", text: line, actorIds: [actorId], gmOnly: kit.actorHidden(actorId) });
      return { line };
    }
  }),

  defineCommand({
    type: "actor.spend-hit-dice",
    operationId: "spendHitDice",
    description:
      "Spends Hit Point Dice to heal (SRD Short Rest: each die heals its roll + Con modifier, minimum 1). Rejected while the actor is in an active encounter, and at 0 hit points or dead (a Short Rest needs at least 1). A player session may target only their claimed character, and only while it is in the Short Rest under way (the party's, or one the player started with actor.rest), since a creature spends Hit Dice during a Short Rest; the GM any time outside a fight. The dice land in the shared roll history.",
    summary: "Spend Hit Point Dice to heal on a Short Rest (roll + Con modifier each, minimum 1).",
    schema: ActorSpendHitDiceSchema,
    malformed: "The hit-dice command is malformed.",
    async run({ principal, request, execute }, kit) {
      const initiator = initiatorOf(principal);
      const { commandId, actorId, count } = request;
      // Roll before executing: a duplicate retry replays the stored outcome and must not consume fresh
      // randomness. The execute callback re-validates against live state.
      const snapshotActor = kit.read().actors.find((candidate) => candidate.id === actorId);
      // Each die at its own size: a multiclass pool spends its biggest dice first.
      const sizes = snapshotActor?.hitDice ? hitDieSizesToSpend(snapshotActor.hitDice.entries, count) : [];
      const faces = sizes.map((sides) => kit.context.random(sides));
      const rollId = kit.context.newId();
      let healed = 0;
      let events: EffectNarration[] = [];
      const { state, duplicate } = await execute((draft) => {
        const outcome = spendHitDice(
          draft,
          actorId,
          faces,
          initiator,
          (definitionId) => kit.resolveDefinitionIn(draft, definitionId),
          count,
          kit.equipmentCatalog()
        );
        healed = outcome.healed;
        events = outcome.events;
        const actor = draft.actors.find((candidate) => candidate.id === actorId)!;
        const bonus = Math.abs(outcome.conModifier * count);
        // "2d10 + 1d6": one term per die size, biggest first.
        const dicePart = [...new Set(sizes)]
          .map((sides) => `${sizes.filter((size) => size === sides).length}d${sides}`)
          .join(" + ");
        // The dice land in shared roll history; hidden actors stay GM-only.
        const record: RollRecord = {
          id: rollId,
          commandId,
          initiatorSessionId: sessionIdOf(principal),
          initiatorRole: initiator.role,
          initiatorLabel: actor.name,
          actorId,
          purpose: "manual",
          visibility: actor.visibility === "gm-only" ? "gm-only" : "public",
          formula: `${dicePart}${outcome.conModifier !== 0 ? ` ${outcome.conModifier < 0 ? "-" : "+"} ${bonus}` : ""}`,
          normalizedFormula: dicePart,
          dice: faces.map((face, index) => ({ group: 0, sides: sizes[index], face, kept: true, sign: 1 as const })),
          modifiers: outcome.conModifier !== 0 ? [{ value: bonus, sign: outcome.conModifier < 0 ? -1 : 1 }] : [],
          total: outcome.healed,
          createdAt: new Date().toISOString()
        };
        recordRoll(draft, record);
      });
      if (duplicate) return;
      kit.publishRolls(state, commandId);
      kit.context.appendLog({
        kind: "heal",
        text: `${kit.actorName(actorId)} spends ${count} Hit ${count === 1 ? "Die" : "Dice"} and regains ${healed} HP.`,
        actorIds: [actorId],
        gmOnly: kit.actorHidden(actorId)
      });
      kit.publishNarrations(events);
    }
  })
];
