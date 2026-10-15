import { requireActorAccess } from "../authorization.js";
import { addEffect, endEffect, makeEffect, type EffectNarration } from "../effects.js";
import { EffectAddSchema, EffectEndSchema } from "../game-commands.js";
import { initiatorOf } from "./kit.js";
import { defineCommand } from "./pipeline.js";

// Rules-engine effects added and ended by hand (ADR-0020).

export const effectCommands = [
  defineCommand({
    type: "effect.add",
    operationId: "addEffect",
    description:
      "Adds a rules-engine effect to a combatant (GM-grade only): a named, tagged state with an optional duration and typed modifiers (damage bonus, damage resistance, advantage). Structured actions create richer effects via their own declarations; this is the house-rule/manual path. The response's `effectId` equals the commandId.",
    summary: "Add a rules-engine effect to a combatant (GM).",
    schema: EffectAddSchema,
    malformed: "The effect command is malformed.",
    gmOnly: "Only the GM can add effects.",
    async run({ request, execute }, kit) {
      const { commandId, actorId, name, tags, duration, modifiers, concentration } = request;
      let events: EffectNarration[] = [];
      const { duplicate } = await execute((state) => {
        events = [];
        addEffect(
          state,
          actorId,
          makeEffect({
            id: commandId,
            name,
            tags: tags ? [...tags] : [],
            // A GM-added concentration effect is sustained by its bearer (damage to them prompts the CON save).
            sourceActorId: concentration ? actorId : null,
            startedRound: state.combat.round,
            duration:
              duration === undefined
                ? { type: "manual" }
                : duration.type === "rounds"
                  ? { type: "rounds", remaining: duration.rounds }
                  : duration,
            concentration: concentration ?? false,
            modifiers: modifiers ? [...modifiers] : []
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
      "Ends an effect: linked conditions clear (a released grapple removes Grappled/Restrained) and its on-end grants fire (a Frenzied Rage ending adds Exhaustion). GM-grade anyone; a player session only their claimed character.",
    summary:
      "End an effect (GM anyone; a player their claimed character), clearing linked conditions and firing its on-end grants.",
    schema: EffectEndSchema,
    malformed: "The effect command is malformed.",
    async run({ principal, request, execute }, kit) {
      const { actorId, effectId } = request;
      let events: EffectNarration[] = [];
      const { duplicate } = await execute((state) => {
        // Ending fires onEnd and clears linked conditions.
        requireActorAccess(initiatorOf(principal), state, actorId, "track", "You can only track your own character.");
        events = endEffect(state, actorId, effectId);
      });
      if (!duplicate) kit.publishNarrations(events);
    }
  })
];
