import { WISH_USES } from "@vtt/domain";
import { DamageTypeSchema, type DamageType, type EffectInstance } from "@vtt/schemas";
import { addEffect, makeEffect } from "../effects.js";
import { CommandRejectedError } from "../game-store.js";
import { applyDamageDetailed, healActor } from "../hit-points.js";
import { spellOf } from "./concentration.js";
import { restoreEverything } from "./restoration.js";
import {
  tableLineOf,
  type DefinitionAction,
  type LiveActor,
  type ResolveContext,
  type ResolveInput
} from "./context.js";

/**
 * SRD 5.2.1 Wish. The cast picks one use: duplicating a spell of level 8 or lower, or one of the effects the spell
 * lists. Instant Health (with everything Greater Restoration ends), Resistance and Spell Immunity land on the creatures
 * picked; Object Creation, Sudden Learning, Roll Redo and Reshape Reality are told to the GM. Any use but duplication
 * stresses the caster: "each time you cast a spell until you finish a Long Rest, you take 1d10 Necrotic damage per
 * level of that spell. This damage can't be reduced or prevented in any way. In addition, your Strength score becomes 3
 * for 2d4 days ... Finally, there is a 33 percent chance that you are unable to cast Wish ever again."
 */

/** The tag on Wish's stress until its caster's Long Rest: each spell it casts hurts it. */
export const WISH_STRESS_TAG = "wish-stress";
/** The tag on a caster who can never cast Wish again. */
export const WISH_LOST_TAG = "wish-lost";
/** The uses that reach up to ten creatures; Instant Health reaches the caster and up to twenty others. */
const UP_TO_TEN: ReadonlySet<string> = new Set(["resistance", "spell-immunity"]);
const DAY_MINUTES = 24 * 60;

/** Refuses a use the cast can't carry: more than ten creatures for Resistance or Spell Immunity, or Resistance with no
 *  damage type picked. */
export function checkWishUse(action: DefinitionAction, input: ResolveInput, attacker: Pick<LiveActor, "name">): void {
  if (!action.wishUses) return;
  const use = WISH_USES.find((option) => option.id === input.optionId);
  if (use && UP_TO_TEN.has(use.id) && new Set(input.targetIds).size > 10)
    throw new CommandRejectedError(`Wish's ${use.name} reaches up to ten creatures ${attacker.name} can see.`);
  if (use?.id === "resistance" && !input.damageType)
    throw new CommandRejectedError("Pick the damage type Wish's Resistance is to.");
}

const titled = (text: string) => `${text[0]!.toUpperCase()}${text.slice(1)}`;

/** One effect a use leaves on a creature. */
function lasting(
  ctx: ResolveContext,
  bearerId: string,
  name: string,
  tags: readonly string[],
  duration: EffectInstance["duration"],
  modifiers: EffectInstance["modifiers"] = []
): void {
  addEffect(
    ctx.state,
    bearerId,
    makeEffect({
      id: `${ctx.input.commandId}:wish:${tags[0]}:${bearerId}`,
      name,
      tags: [...tags],
      sourceActorId: ctx.attacker.id,
      sourceName: ctx.attacker.name,
      startedRound: ctx.state.combat.round,
      duration,
      modifiers
    })
  );
}

/** The use's own effect, then the stress of any use but duplication. */
export function wishOnCast(ctx: ResolveContext): void {
  const { action, attacker, input, state } = ctx;
  if (!action.wishUses || input.commit === false) return;
  const picked = WISH_USES.find((option) => option.id === input.optionId);
  const use = picked ?? WISH_USES[0]!;
  if (!picked) ctx.warnings.push(`Wish: no use was picked, so it duplicates a spell.`);
  const targets = ctx.targets.map((target) => target.id);
  const say = (text: string) =>
    ctx.tableNarration.push({ kind: "effect", text, actorIds: [...new Set([attacker.id, ...targets])] });
  switch (use.id) {
    case "duplicate":
      say(
        `${attacker.name} wishes to duplicate a spell of level 8 or lower, cast with no components. Which spell, and its cast, are the GM's.`
      );
      return;
    case "instant-health":
      for (const id of [...new Set([attacker.id, ...targets])]) {
        const creature = state.actors.find((actor) => actor.id === id);
        if (!creature) continue;
        // "You end all effects on them described in the Greater Restoration spell", which may raise the maximum first.
        const definition =
          creature.id === attacker.id
            ? ctx.deps.definition
            : creature.definitionId
              ? ctx.deps.resolveDefinition?.(creature.definitionId)
              : undefined;
        for (const line of restoreEverything(state, creature, {
          ...(definition ? { definition } : {}),
          ...(ctx.deps.catalog ? { catalog: ctx.deps.catalog } : {})
        }))
          ctx.tableNarration.push({ kind: "effect", text: `${line.slice(0, -1)} (Wish).`, actorIds: [creature.id] });
        if (creature.hp.current >= creature.hp.maximum) continue;
        for (const event of healActor(state, id, creature.hp.maximum - creature.hp.current, { role: "gm" }))
          ctx.tableNarration.push(tableLineOf(ctx, event));
      }
      say(
        `Wish: ${attacker.name} and the creatures it chose regain all their Hit Points and are free of what Greater Restoration ends.`
      );
      break;
    case "resistance": {
      const type = (DamageTypeSchema.safeParse(input.damageType).data ?? "fire") as DamageType;
      for (const id of targets)
        lasting(ctx, id, `Wish: Resistance (${titled(type)})`, ["wish-resistance"], { type: "manual" }, [
          { type: "damage-resistance", damageTypes: [type] }
        ]);
      say(`Wish: the chosen creatures have Resistance to ${titled(type)} damage, for good.`);
      break;
    }
    case "spell-immunity":
      for (const id of targets)
        lasting(ctx, id, "Wish: Spell Immunity", ["wish-spell-immunity"], { type: "minutes", remaining: 480 });
      say("Wish: the chosen creatures are immune to one spell or magical effect for 8 hours. Which one is the GM's.");
      break;
    default:
      say(`Wish (${use.name}): what it does is the GM's to rule, as the spell says.`);
  }
  stress(ctx);
}

/** Wish's stress on its caster: the spells it casts hurt until a Long Rest, Strength 3 for 2d4 days, and a 33 percent
 *  chance it never casts Wish again. */
function stress(ctx: ResolveContext): void {
  const { attacker, deps } = ctx;
  lasting(ctx, attacker.id, "Wish's stress", [WISH_STRESS_TAG], { type: "until-rest", rest: "long" });
  const days = deps.random(4) + deps.random(4);
  lasting(ctx, attacker.id, `Wish's stress: Strength 3 for ${days} days`, ["wish-weakened"], {
    type: "minutes",
    remaining: days * DAY_MINUTES
  });
  const roll = Math.max(1, Math.min(100, deps.random(100)));
  const lost = roll <= 33;
  if (lost) lasting(ctx, attacker.id, "Can never cast Wish again", [WISH_LOST_TAG], { type: "manual" });
  ctx.tableNarration.push({
    kind: "effect",
    text: `Wish's stress weakens ${attacker.name}: each spell it casts until a Long Rest deals it 1d10 Necrotic damage per spell level, and its Strength is 3 for ${days} days. d100 ${roll}: ${lost ? "it can never cast Wish again" : "it can still cast Wish"}.`,
    actorIds: [attacker.id]
  });
}

/** A spell cast under Wish's stress: 1d10 Necrotic per level of the spell, which nothing reduces. */
export function wishStressOnCast(ctx: ResolveContext): void {
  const { action, attacker, input, state, deps } = ctx;
  if (input.commit === false || action.spellId === undefined) return;
  const caster = state.actors.find((actor) => actor.id === attacker.id);
  if (!caster?.effects.some((effect) => effect.tags.includes(WISH_STRESS_TAG))) return;
  const level = ctx.plan.castLevel ?? spellOf(ctx)?.level ?? 0;
  if (level < 1) return;
  let amount = 0;
  for (let die = 0; die < level; die += 1) amount += Math.max(1, Math.min(10, deps.random(10)));
  // Untyped, so no Resistance or Immunity reduces it.
  const { events } = applyDamageDetailed(
    state,
    attacker.id,
    { amount, sourceName: "Wish's stress" },
    { role: "gm" },
    {
      resolveDefinition: deps.resolveDefinition ?? (() => undefined),
      newId: deps.newRollId,
      now: deps.now,
      ...(deps.catalog ? { catalog: deps.catalog } : {}),
      rollDie: deps.random
    }
  );
  ctx.tableNarration.push({
    kind: "effect",
    text: `Wish's stress: casting a level ${level} spell deals ${attacker.name} ${amount} Necrotic damage.`,
    actorIds: [attacker.id]
  });
  for (const event of events) ctx.tableNarration.push(tableLineOf(ctx, event));
}
