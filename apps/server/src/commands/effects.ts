import { requireActorAccess } from "../authorization.js";
import { addEffect, endEffect, type EffectNarration } from "../effects.js";
import { EffectAddSchema, EffectEndSchema } from "../game-commands.js";
import { initiatorOf } from "./kit.js";
import { defineCommand } from "./pipeline.js";

// Rules-engine effects added and ended by hand (ADR-0020).

export const effectCommands = [
  defineCommand({
    type: "effect.add",
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
          {
            id: commandId,
            name,
            tags: tags ? [...tags] : [],
            // A GM-added concentration effect is sustained by its bearer (damage to them prompts the CON save).
            sourceActorId: concentration ? actorId : null,
            sourceName: null,
            sourceActionId: null,
            startedRound: state.combat.round,
            duration:
              duration === undefined
                ? { type: "manual" }
                : duration.type === "rounds"
                  ? { type: "rounds", remaining: duration.rounds }
                  : duration,
            endsWhenSourceDefeated: false,
            voidWhileIncapacitated: false,
            concentration: concentration ?? false,
            modifiers: modifiers ? [...modifiers] : [],
            linkedConditionIds: [],
            escapeDc: null,
            onEnd: [],
            endsWithTag: null
          },
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
