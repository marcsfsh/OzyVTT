import { policeConditionRule } from "../actor-conditions.js";
import { canInitiateForActor, GameAccessDeniedError, requireActorAccess, type Initiator } from "../authorization.js";
import { addEffect, endEffect, makeEffect, refundUnspentTime, type EffectNarration } from "../effects.js";
import { CommandRejectedError } from "../game-store.js";
import { EffectAddSchema, EffectEndSchema } from "@vtt/domain/commands";
import type { GameState } from "@vtt/domain";
import type { RulesOverride } from "../rules-families.js";
import { withoutSourceName } from "../hidden-source.js";
import { initiatorOf, isGmGrade } from "./kit.js";
import { defineCommand } from "./pipeline.js";

// Rules-engine effects added and ended by hand (ADR-0020).

/**
 * Who may end an effect by hand (SRD: a grappler may release, a creator end its Concentration, at any time). The GM
 * may end any. A player may end what their own character is the source of, on whoever bears it (their grapple on a
 * goblin, their Concentration on an ally). An effect on their character that someone else imposed ends by its own
 * rules (Escape, its duration, a repeated save) or the GM's say, so ending it is a rules block they can ask about.
 */
function authorizeEnd(
  state: GameState,
  initiator: Initiator,
  actorId: string,
  effectId: string,
  override: RulesOverride | null,
  events: EffectNarration[],
  hidden: (actorId: string) => boolean
): void {
  if (initiator.role === "gm") return;
  const bearer = state.actors.find((candidate) => candidate.id === actorId);
  const effect = bearer?.effects.find((candidate) => candidate.id === effectId);
  const sourceId = effect?.sourceActorId ?? null;
  if (sourceId !== null && canInitiateForActor(initiator, state, sourceId, "track").ok) return;
  requireActorAccess(initiator, state, actorId, "track", "You can only track your own character.");
  if (!bearer || !effect) return;
  const how =
    effect.escapeDc !== null
      ? `Escape it (DC ${effect.escapeDc}) or ask the GM`
      : "It ends by its own rules, or ask the GM";
  // Named as the player's own sheet shows it: a source hidden from them stays "A hidden threat" here too.
  const name = sourceId !== null && hidden(sourceId) ? withoutSourceName(effect.name, effect.sourceName) : effect.name;
  policeConditionRule(
    state,
    bearer,
    "condition.imposed",
    `${name} wasn't ${bearer.name}'s own doing. ${how}.`,
    { override },
    events
  );
}

export const effectCommands = [
  defineCommand({
    type: "effect.add",
    operationId: "addEffect",
    description:
      "Adds a rules-engine effect to a combatant (GM-grade only): a named, tagged state with an optional duration and typed modifiers (damage bonus, damage resistance, advantage). Structured actions create richer effects via their own declarations; this is the house-rule/manual path. With `concentration`, `sourceActorId` names the creature concentrating on it (the caster of a Bless on an ally); without one, the bearer sustains it. The response's `effectId` equals the commandId.",
    summary: "Add a rules-engine effect to a combatant (GM).",
    schema: EffectAddSchema,
    malformed: "The effect command is malformed.",
    gmOnly: "Only the GM can add effects.",
    async run({ request, execute }, kit) {
      const { commandId, actorId, name, tags, duration, modifiers, concentration, sourceActorId } = request;
      let events: EffectNarration[] = [];
      const { duplicate } = await execute((state) => {
        events = [];
        const source = sourceActorId ? state.actors.find((candidate) => candidate.id === sourceActorId) : undefined;
        if (sourceActorId && !source) throw new CommandRejectedError("The effect's source is no longer on the table.");
        // A concentration effect is sustained by its caster when named, else by its bearer: the one whose damage
        // prompts the CON save. A named caster already concentrating holds this as part of that same Concentration
        // (a Bless the GM puts on three allies), and the effect itself stays.
        const sustainer = source?.id ?? (concentration ? actorId : null);
        const ongoing =
          concentration && source
            ? state.actors
                .flatMap((candidate) => candidate.effects)
                .find((candidate) => candidate.concentration && candidate.sourceActorId === source.id)
            : undefined;
        const castId = concentration && source ? (ongoing?.castId ?? commandId) : undefined;
        addEffect(
          state,
          actorId,
          makeEffect({
            id: commandId,
            name,
            tags: tags ? [...tags] : [],
            sourceActorId: sustainer,
            sourceName: source?.name ?? null,
            startedRound: state.combat.round,
            duration:
              duration === undefined
                ? { type: "manual" }
                : duration.type === "rounds"
                  ? { type: "rounds", remaining: duration.rounds }
                  : duration,
            concentration: concentration ?? false,
            modifiers: modifiers ? [...modifiers] : [],
            ...(castId !== undefined ? { castId } : {})
          }),
          events
        );
      });
      if (!duplicate) {
        kit.context.broadcastTableEvent({
          kind: "effect",
          text: `${kit.actorName(actorId)} gains ${name}.`,
          actorIds: [actorId],
          gmOnly: kit.actorHidden(actorId)
        });
        kit.publishNarrations(events);
      }
      return { effectId: commandId };
    }
  }),

  defineCommand({
    type: "effect.end",
    operationId: "endEffect",
    description:
      "Ends an effect: linked conditions clear (a released grapple removes Grappled/Restrained) and its on-end grants fire. GM-grade anyone. A player session may end an effect its claimed character is the source of, on any creature (releasing its grapple, dropping its Concentration), or one on its claimed character it gave itself; an effect someone else imposed on it is a rules block (`condition.imposed`) the player can ask the GM about.",
    summary:
      "End an effect (GM anyone; a player one their character is the source of, or one on it that it gave itself). Its linked conditions clear and its on-end grants fire.",
    schema: EffectEndSchema,
    malformed: "The effect command is malformed.",
    async run({ principal, request, execute }, kit) {
      const { actorId, effectId } = request;
      if (request.override && !isGmGrade(principal))
        throw new GameAccessDeniedError("Only the GM can override a rules block.");
      let events: EffectNarration[] = [];
      const { duplicate } = await execute((state) => {
        events = [];
        const initiator = initiatorOf(principal);
        authorizeEnd(
          state,
          initiator,
          actorId,
          effectId,
          request.override ?? null,
          events,
          kit.hiddenFor(initiator, state)
        );
        const ending = state.actors
          .find((candidate) => candidate.id === actorId)
          ?.effects.find((effect) => effect.id === effectId);
        // Ending fires onEnd and clears linked conditions.
        events.push(...endEffect(state, actorId, effectId));
        const refunded = ending ? refundUnspentTime(state, ending) : null;
        if (refunded) events.push({ kind: "effect", text: refunded, actorId });
      });
      if (!duplicate) kit.publishNarrations(events);
    }
  })
];
