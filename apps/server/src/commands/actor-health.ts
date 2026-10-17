import { isDead, type RollRecord } from "@vtt/domain";
import { setCondition } from "../actor-conditions.js";
import { GameAccessDeniedError, requireActorAccess } from "../authorization.js";
import { replaceableOffers } from "../choice-overrides.js";
import type { EffectNarration } from "../effects.js";
import { HIDDEN_SOURCE } from "../hidden-source.js";
import {
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
import { applyRest, hitDieSizesToSpend, spendHitDice } from "../rests.js";
import { restoreUses, spendUses } from "../use-pools.js";
import { builtinActionFor } from "../builtin-actions.js";
import { effectiveActions } from "../effective-actions.js";
import type { EquipmentCatalog } from "../equipment-derivation.js";
import type { ActorDefinition } from "@vtt/schemas";
import { recordRoll } from "../roll-history.js";
import { initiatorOf, isGmGrade, sessionIdOf } from "./kit.js";
import { defineCommand } from "./pipeline.js";

// Hit points, conditions and rests.

/** SRD Knocking Out a Creature: only "a melee attack" can, so a named source action that isn't one is refused. */
function requireMeleeKnockOut(
  state: Parameters<typeof applyDamageDetailed>[0],
  sourceActorId: string,
  sourceActionId: string,
  kit: Readonly<{
    resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
    equipmentCatalog: () => EquipmentCatalog;
  }>
): void {
  const source = state.actors.find((candidate) => candidate.id === sourceActorId);
  if (!source) return;
  const definition = source.definitionId ? kit.resolveDefinition(source.definitionId) : undefined;
  const action =
    effectiveActions(definition, source, kit.equipmentCatalog()).find((candidate) => candidate.id === sourceActionId) ??
    builtinActionFor(definition, sourceActionId);
  if (!action) return;
  // A ranged attack, or a save or spell with no attack roll; an action that doesn't say stays the GM's call.
  const ranged =
    action.attack !== undefined && action.attack.reachFeet === undefined && action.attack.rangeFeet !== undefined;
  const noAttack = action.attack === undefined && (action.save !== undefined || action.spellId !== undefined);
  if (ranged || noAttack)
    throw new CommandRejectedError(`Only a melee attack can knock a creature out - ${action.name} isn't one.`);
}

export const actorHealthCommands = [
  defineCommand({
    type: "actor.apply-damage",
    operationId: "applyDamage",
    description:
      "Applies damage (temporary hit points absorb first). Optional typed `parts` run the defense pipeline - immunity, then resistance (half, rounded down), then vulnerability (double) - from the target's definition and active effects, with the per-part breakdown returned in `applied`; the bare `amount` is the manual path (no defense math). Dropping a player character to 0 starts the dying state (Unconscious + Prone + death saves; `critical: true` while dying adds two failures). `nonlethal` knocks out instead (SRD): a melee attack that would drop the target to 0 leaves it at 1 HP and Unconscious until it regains hit points; a named `sourceActionId` that is not a melee attack is refused. Any damage ends the target's effects that end on damage (Sleep). Player sessions may target only their claimed character.",
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
            nonlethal
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
          text: `"${damageType}" is not one of the SRD damage types - only a homebrew defence naming it exactly will match.`,
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
      "Applies or clears a bundled SRD condition. Exhaustion is cumulative: without `level` it gains one level, with one it is set to that level. Player sessions may target only their claimed character: they may add any condition and clear one they added, while clearing one imposed by a save, an effect or the GM is a rules block (`condition.imposed`) they can ask the GM about; standing from Prone is allowed only on their own turn in a fight (`movement.stand-up-off-turn`) and costs half their Speed.",
    summary: "Apply or clear an SRD condition, with exhaustion levels.",
    schema: SetConditionSchema,
    malformed: "The condition command is malformed.",
    async run({ principal, request, execute }, kit) {
      if (!kit.catalogFor(principal).hasCondition(request.conditionId))
        throw new CommandRejectedError("That condition is not in the bundled rules.");
      if (request.override && !isGmGrade(principal))
        throw new GameAccessDeniedError("Only the GM can override movement rules.");
      const { actorId, conditionId, active, level } = request;
      let events: EffectNarration[] = [];
      const { duplicate } = await execute((state) => {
        events = setCondition(state, actorId, conditionId, active, level, initiatorOf(principal), {
          override: request.override ?? null,
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
      // Immunity skips narrate through the events instead of the generic applied line.
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
      "Re-makes a pick the character's content says may be re-made on a rest (Circle of the Land's land type on a Long Rest; Fiendish Resilience's damage type on either). A pick the build itself reads - its options grant spells, or another pick depends on it, as the land's spells and Nature's Ward do - is written to the character's choices ledger and the sheet is rebuilt from it, keeping what has been spent; a player makes it in the prepare step a Long Rest opens, the GM any time outside a fight. Any other pick is runtime state on the actor, cleared by the matching rest, so a re-choice between fights needs no rebuild. A player session may re-choose only on their claimed character, the GM on anyone. Which offers are re-choosable, and what each may become, are both decided from the content: a client cannot widen either.",
    summary:
      "Re-make a pick a feature says may be re-made on a rest (Circle of the Land's land type on a Long Rest, Fiendish Resilience's damage type on either). Your own character; the GM anyone.",
    schema: ActorRechooseSchema,
    malformed: "The re-choose command is malformed.",
    // What may be re-chosen comes from content, never the request.
    async run({ principal, request, execute }, kit) {
      const { actorId, offer, id } = request;
      const initiator = initiatorOf(principal);
      let line = "";
      const { duplicate } = await execute((state) => {
        // Same owner-or-GM rule as a rest, checked first so a missing creature and someone else's get one answer.
        requireActorAccess(initiator, state, actorId, "resource");
        const actor = state.actors.find((candidate) => candidate.id === actorId);
        if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
        const definition = actor.definitionId ? kit.resolveDefinition(actor.definitionId) : undefined;
        // GM audience: legality is a content question and must match what the GM would get. Nothing GM-only
        // is projected.
        const choices = replaceableOffers(definition, kit.contentLibrary.forAudience("gm"));
        const match = choices.find((candidate) => candidate.offer === offer);
        if (!match) {
          throw new CommandRejectedError(
            choices.length === 0
              ? `Nothing on ${actor.name}'s sheet can be re-chosen on a rest.`
              : `${actor.name} cannot re-choose "${offer}" - only ${choices.map((candidate) => `"${candidate.offer}"`).join(", ")}.`
          );
        }
        if (!match.options.includes(id)) {
          throw new CommandRejectedError(
            `"${id}" is not one of the options ${match.label} offers (${match.options.join(", ")}).`
          );
        }
        const chosen = match.optionNames[id] ?? id;
        if (!match.rebuilds) {
          // Stored as `choiceOverrides` on the actor (not the choices ledger) and cleared by the matching rest.
          actor.choiceOverrides = { ...actor.choiceOverrides, [offer]: { id, per: match.per } };
          line = `${kit.actorName(actorId)} re-chose ${match.label}: ${chosen}.`;
          return;
        }
        // The build reads this answer (the land's spells and Nature's Ward), so it goes into the ledger.
        if (state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actorId))
          throw new CommandRejectedError(`${match.label} is chosen after a rest - end the encounter first.`);
        // SRD: "Whenever you finish a Long Rest, choose" - a player makes it in the step that rest opens.
        if (initiator.role !== "gm" && match.per === "long-rest" && actor.preparation === null)
          throw new CommandRejectedError(`${actor.name} chooses ${match.label} again after finishing a Long Rest.`);
        rechooseInLedger(state, actorId, offer, id, {
          library: kit.contentLibrary.forAudience("gm"),
          policy: state.builderPolicy,
          catalog: kit.equipmentCatalog()
        });
        // An override from before the answer moved into the ledger would only shadow it.
        const { [offer]: _stale, ...others } = actor.choiceOverrides;
        actor.choiceOverrides = others;
        line = `${kit.actorName(actorId)} chose ${chosen} for ${match.label}.`;
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
      "Applies a rest to a rostered actor outside combat; a player session may take a Short Rest on their claimed character and asks the GM for a Long Rest (rest.ask), the GM rests anyone. Either rest needs at least 1 hit point (SRD) and is refused for a creature at 0 or dead, and a Long Rest is refused within 16 hours of game time after the actor's last one (the refusal says how long is left; time.pass moves the clock). Long: the actor's Concentration and its effects measured in turns or rounds end (their on-end grants fire first; effects that last until ended stay), hit points restore to maximum, temporary HP clears, limited-use pools refresh (a charged item regains its printed dice), all spent Hit Point Dice restore, spell slots and Pact Magic refill, a caster that prepares its spells after a Long Rest gets the step to change them, and Exhaustion drops one level. Short: per-short-rest, recharge and per-encounter pools and Pact Magic slots re-arm, and features that say so give back uses of a long-rest pool (Rage, Second Wind, Channel Divinity, Wild Shape: one; Bardic Inspiration from Bard 5: all); healing is the separate spend-hit-dice call.",
    summary:
      "Take a Short Rest on your own character (GM: either rest on anyone, at 1 HP or more): short re-arms short-rest uses and Pact Magic and gives back what features say; long restores HP, hit dice, spell slots and limited uses, opens the prepare step, and drops one Exhaustion level.",
    schema: ActorRestSchema,
    malformed: "The rest command is malformed.",
    async run({ principal, request, execute }, kit) {
      const { actorId, kind } = request;
      const initiator = initiatorOf(principal);
      // A Long Rest is the GM's to give: a player asks for one (rest.ask) instead.
      if (kind === "long" && initiator.role !== "gm")
        throw new GameAccessDeniedError("Ask the GM for a Long Rest - they approve it.");
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
      "Spends several uses of one of the actor's limited-use pools at once, keyed as the counters are (`uses.pool ?? action.id`): Lay on Hands' points outside a fight, or Focus Points for a feature the engine doesn't run. A player session only on their claimed character, the GM anyone. Refused when the pool holds fewer, and for a pool that comes back every turn.",
    summary: "Spend several uses of a limited-use pool at once (your own character; GM anyone).",
    schema: ActorSpendUsesSchema,
    malformed: "The spend is malformed.",
    async run({ principal, request, execute }, kit) {
      const { actorId, poolId, amount } = request;
      let spent = { name: "", left: 0 };
      const { duplicate } = await execute((state) => {
        spent = spendUses(state, actorId, poolId, amount, initiatorOf(principal), {
          resolveDefinition: (definitionId) => kit.resolveDefinitionIn(state, definitionId),
          catalog: kit.equipmentCatalog()
        });
      });
      if (duplicate) return;
      kit.context.appendLog({
        kind: "action",
        text: `${kit.actorName(actorId)} spends ${amount} of ${spent.name} (${spent.left} left).`,
        actorIds: [actorId],
        gmOnly: kit.actorHidden(actorId)
      });
    }
  }),

  defineCommand({
    type: "actor.restore-uses",
    operationId: "restoreUses",
    description:
      "GM-only: gives back up to `amount` spent uses of one of the actor's limited-use pools (a feature that refills it, such as Uncanny Metabolism or Persistent Rage, or a ruling). Refused when the pool is already full and for a pool that comes back every turn.",
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
    type: "actor.spend-hit-dice",
    operationId: "spendHitDice",
    description:
      "Spends Hit Point Dice to heal (SRD Short Rest: each die heals its roll + Con modifier, minimum 1). Rejected while the actor is in an active encounter, and at 0 hit points or dead (a Short Rest needs at least 1). Player sessions may target only their claimed character; the dice land in the shared roll history.",
    summary: "Spend Hit Point Dice to heal on a short rest (roll + Con modifier each, minimum 1).",
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
          count
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
