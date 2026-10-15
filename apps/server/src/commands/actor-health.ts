import type { RollRecord } from "@vtt/domain";
import { setCondition } from "../actor-conditions.js";
import { GameAccessDeniedError, requireActorAccess } from "../authorization.js";
import { replaceableOffers } from "../choice-overrides.js";
import type { EffectNarration } from "../effects.js";
import {
  ActorRechooseSchema,
  ActorRestSchema,
  ActorSpendHitDiceSchema,
  ApplyDamageSchema,
  HpAmountSchema,
  SetConditionSchema,
  SetHpSchema,
  TempHpSchema
} from "@vtt/domain/commands";
import { CommandRejectedError } from "../game-store.js";
import {
  applyDamageDetailed,
  damageAdjustmentDetail,
  healActor,
  isSrdDamageType,
  setCurrentHp,
  setTemporaryHp,
  UNTYPED_DAMAGE
} from "../hit-points.js";
import { applyRest, spendHitDice } from "../rests.js";
import { recordRoll } from "../roll-history.js";
import { initiatorOf, isGmGrade, sessionIdOf } from "./kit.js";
import { defineCommand } from "./pipeline.js";

// Hit points, conditions and rests.

export const actorHealthCommands = [
  defineCommand({
    type: "actor.apply-damage",
    operationId: "applyDamage",
    description:
      "Applies damage (temporary hit points absorb first). Optional typed `parts` run the defense pipeline - immunity, then resistance (half, rounded down), then vulnerability (double) - from the target's definition and active effects, with the per-part breakdown returned in `applied`; the bare `amount` is the manual path (no defense math). Dropping a player character to 0 starts the dying state (Unconscious + Prone + death saves; `critical: true` while dying adds two failures). Player sessions may target only their claimed character.",
    summary: "Apply damage (GM anyone; a player their claimed character).",
    schema: ApplyDamageSchema,
    malformed: "The damage command is malformed.",
    async run({ principal, request, execute }, kit) {
      const { actorId, amount, parts, damageType, damageOverride, sourceName, critical, nonlethal } = request;
      let outcome: ReturnType<typeof applyDamageDetailed> | undefined;
      const { duplicate } = await execute((state) => {
        outcome = applyDamageDetailed(
          state,
          actorId,
          { amount, parts, damageType, damageOverride, critical, sourceName: sourceName ?? null, nonlethal },
          initiatorOf(principal),
          {
            resolveDefinition: kit.resolveDefinition,
            newId: kit.context.newId,
            now: () => new Date().toISOString(),
            catalog: kit.equipmentCatalog()
          }
        );
      });
      if (duplicate || !outcome) return;
      // Typed damage narrates its adjustments ("17 bludgeoning → 8, resistance: Rage") so the table sees
      // why the number differs (ADR-0020).
      const detail = damageAdjustmentDetail(outcome.application);
      const attribution = sourceName
        ? `${sourceName} hit ${kit.actorName(actorId)} for`
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
    description: "Heals hit points up to the maximum. Player sessions may target only their claimed character.",
    summary: "Heal hit points (GM anyone; a player their claimed character).",
    schema: HpAmountSchema,
    malformed: "The healing command is malformed.",
    async run({ principal, request, execute }, kit) {
      const { actorId, amount } = request;
      let events: EffectNarration[] = [];
      const { duplicate } = await execute((state) => {
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
    type: "actor.set-hp",
    operationId: "setCurrentHp",
    description: "Sets current hit points directly (GM-grade only).",
    summary: "Set current hit points directly (GM).",
    schema: SetHpSchema,
    malformed: "The hit point command is malformed.",
    gmOnly: "Only the GM can set hit points directly.",
    async run({ request, execute }, kit) {
      let events: EffectNarration[] = [];
      const { duplicate } = await execute((state) => {
        events = setCurrentHp(state, request.actorId, request.current, { role: "gm" });
      });
      if (!duplicate) kit.publishNarrations(events);
    }
  }),

  defineCommand({
    type: "actor.set-condition",
    operationId: "setCondition",
    description:
      "Applies or clears a bundled SRD condition (exhaustion carries a level). Player sessions may target only their claimed character.",
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
      "Re-makes a pick the character's content says may be re-made on a rest (Circle of the Land's land type on a Long Rest; Fiendish Resilience's damage type on either). The answer is NOT written to the character's choices ledger - it is runtime state on the actor, cleared by the matching rest - so a re-choice between fights needs no rebuild. A player session may re-choose only on their claimed character, the GM on anyone. Which offers are re-choosable, and what each may become, are both decided from the content: a client cannot widen either.",
    summary:
      "Re-make a pick a feature says may be re-made on a rest (Circle of the Land's land type on a Long Rest, Fiendish Resilience's damage type on either). Your own character; the GM anyone.",
    schema: ActorRechooseSchema,
    malformed: "The re-choose command is malformed.",
    // Stored as `choiceOverrides` on the actor (not the choices ledger) and cleared by the matching rest.
    // What may be re-chosen comes from content, never the request.
    async run({ principal, request, execute }, kit) {
      const { actorId, offer, id } = request;
      let label = "";
      const { duplicate } = await execute((state) => {
        const actor = state.actors.find((candidate) => candidate.id === actorId);
        if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
        // Same owner-or-GM rule as a rest.
        requireActorAccess(initiatorOf(principal), state, actorId, "resource");
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
        label = match.label;
        actor.choiceOverrides = { ...actor.choiceOverrides, [offer]: { id, per: match.per } };
      });
      if (!duplicate)
        kit.context.appendLog({
          kind: "encounter",
          text: `${kit.actorName(actorId)} re-chose ${label}: ${id}.`,
          actorIds: [actorId],
          gmOnly: kit.actorHidden(actorId)
        });
    }
  }),

  defineCommand({
    type: "actor.rest",
    operationId: "restActor",
    description:
      "Applies a rest to a rostered actor outside combat; a player session may rest only their claimed character, the GM anyone. Long: remaining effects end (their on-end grants fire first), hit points restore to maximum, temporary HP clears, the dying state resets, limited-use pools refresh, all spent Hit Point Dice restore, spell slots and prepared spells reset to the sheet defaults, and Exhaustion drops one level. Short: per-short-rest and recharge pools re-arm; healing is the separate spend-hit-dice call.",
    summary:
      "Take a rest on your own character (GM: anyone): short re-arms short-rest uses; long restores HP, hit dice, spell slots, prepared spells, limited uses, clears dying, and drops one Exhaustion level.",
    schema: ActorRestSchema,
    malformed: "The rest command is malformed.",
    async run({ principal, request, execute }, kit) {
      const { actorId, kind } = request;
      let events: EffectNarration[] = [];
      // Authorized inside the mutation against live state (applyRest still refuses a combatant in a running
      // encounter).
      const { duplicate } = await execute((state) => {
        requireActorAccess(initiatorOf(principal), state, actorId, "resource");
        events = applyRest(state, actorId, kind, kit.resolveDefinition, kit.equipmentCatalog());
      });
      if (duplicate) return;
      kit.context.appendLog({
        kind: "heal",
        text: `${kit.actorName(actorId)} completed a ${kind} rest.`,
        actorIds: [actorId],
        gmOnly: kit.actorHidden(actorId)
      });
      kit.publishNarrations(events);
    }
  }),

  defineCommand({
    type: "actor.spend-hit-dice",
    operationId: "spendHitDice",
    description:
      "Spends Hit Point Dice to heal (SRD Short Rest: each die heals its roll + Con modifier, minimum 1). Rejected while the actor is in an active encounter. Player sessions may target only their claimed character; the dice land in the shared roll history.",
    summary: "Spend Hit Point Dice to heal on a short rest (roll + Con modifier each, minimum 1).",
    schema: ActorSpendHitDiceSchema,
    malformed: "The hit-dice command is malformed.",
    async run({ principal, request, execute }, kit) {
      const initiator = initiatorOf(principal);
      const { commandId, actorId, count } = request;
      // Roll before executing: a duplicate retry replays the stored outcome and must not consume fresh
      // randomness. The execute callback re-validates against live state.
      const snapshotActor = kit.read().actors.find((candidate) => candidate.id === actorId);
      const sides = snapshotActor?.hitDice ? Number.parseInt(snapshotActor.hitDice.die.slice(1), 10) : 8;
      const faces = Array.from({ length: count }, () => kit.context.random(sides));
      const rollId = kit.context.newId();
      let healed = 0;
      let events: EffectNarration[] = [];
      const { state, duplicate } = await execute((draft) => {
        const outcome = spendHitDice(draft, actorId, faces, initiator, (definitionId) =>
          kit.resolveDefinitionIn(draft, definitionId)
        );
        healed = outcome.healed;
        events = outcome.events;
        const actor = draft.actors.find((candidate) => candidate.id === actorId)!;
        const bonus = Math.abs(outcome.conModifier * count);
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
          formula: `${count}${actor.hitDice!.die}${outcome.conModifier !== 0 ? ` ${outcome.conModifier < 0 ? "-" : "+"} ${bonus}` : ""}`,
          normalizedFormula: `${count}${actor.hitDice!.die}`,
          dice: faces.map((face) => ({ group: 0, sides, face, kept: true, sign: 1 as const })),
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
