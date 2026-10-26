import { RESTORATION_PICKS, type GameState } from "@vtt/domain";
import type { AbilityId, ActorDefinition } from "@vtt/schemas";
import { ABILITY_NAMES } from "../ability-checks.js";
import { setCondition } from "../actor-conditions.js";
import { exhaustionLevel } from "../condition-rules.js";
import { CURSE_TAG, endEffect, reduceExhaustion, type EffectNarration } from "../effects.js";
import type { EquipmentCatalog } from "../equipment-derivation.js";
import { CommandRejectedError } from "../game-store.js";
import { DRAINED_TAG } from "../hit-points.js";
import { breakCursedAttunement } from "../inventory.js";
import { endedEffect, tableLineOf, type ResolveContext } from "./context.js";
import { ABILITY_DRAIN_TAG } from "./score-drain.js";

/**
 * SRD 5.2.1 Greater Restoration: "You touch a creature and magically remove one of the following effects from it: 1
 * Exhaustion level; The Charmed or Petrified condition; A curse, including the target's Attunement to a cursed magic
 * item; Any reduction to one of the target's ability scores; Any reduction to the target's Hit Point maximum." The
 * caster picks the kind (`optionId`); where the creature has several of it, the effect (`effectId`), the cursed item
 * (`itemId`) or the score (`ability`) the resolve names, else the first. An effect whose own text names Greater
 * Restoration as its end (Befuddlement) is a pick of its own. Wish's Instant Health ends all of them.
 */

/** On an effect, Greater Restoration ends it by its own text ("The effect can also be ended by the Greater Restoration,
 *  Heal, or Wish spell"). */
export const RESTORABLE_TAG = "restorable";
/** On an effect, a spell that ends it by name when cast on its bearer: `ended-by-heal` (Befuddlement). */
export const ENDED_BY_PREFIX = "ended-by-";

type Actor = GameState["actors"][number];
type Harm = (typeof RESTORATION_PICKS)[number]["id"];

export type RestoreDeps = Readonly<{ definition?: ActorDefinition; catalog?: EquipmentCatalog }>;
export type RestorePick = Readonly<{ effectId?: string; itemId?: string; ability?: AbilityId }>;

/** What the cast ends, told to the table, or null when the creature has none of that harm. */
function restoreHarm(
  state: GameState,
  target: Actor,
  harm: Harm,
  pick: RestorePick,
  deps: RestoreDeps,
  ended: EffectNarration[],
  all: boolean
): string[] | null {
  switch (harm) {
    case "exhaustion": {
      const levels = exhaustionLevel(target);
      if (levels === 0) return null;
      for (let level = 0; level < (all ? levels : 1); level += 1) reduceExhaustion(target);
      return [all ? `${target.name} has no Exhaustion now.` : `${target.name} has one Exhaustion level fewer.`];
    }
    case "charmed":
    case "petrified": {
      if (!target.conditions.some((condition) => condition.id === harm)) return null;
      ended.push(...setCondition(state, target.id, harm, false, undefined, { role: "gm" }));
      return [`${target.name} is no longer ${harm === "charmed" ? "Charmed" : "Petrified"}.`];
    }
    case "curse": {
      const curses = target.effects.filter((effect) => effect.tags.includes(CURSE_TAG));
      const named = curses.find((effect) => effect.id === pick.effectId);
      const lifted = all ? curses : named ? [named] : pick.itemId !== undefined ? [] : curses.slice(0, 1);
      const lines = lifted.map((effect) => `${target.name} is free of ${effect.name}.`);
      for (const effect of lifted) ended.push(...endEffect(state, target.id, effect.id));
      if (lifted.length === 0 || all) {
        const items = breakCursedAttunement(
          target,
          deps.definition,
          {
            ...(deps.catalog ? { catalog: deps.catalog } : {}),
            role: "gm"
          },
          all ? undefined : { ...(pick.itemId !== undefined ? { rowId: pick.itemId } : {}) }
        );
        lines.push(
          ...items.map(
            (name) =>
              `${target.name} is no longer attuned to ${name}. Its curse stays on the item, which can now be removed.`
          )
        );
      }
      return lines.length > 0 ? lines : null;
    }
    case "ability-score": {
      const lowered = target.effects.filter((effect) => effect.abilityReduction !== undefined);
      const ability = pick.ability ?? lowered[0]?.abilityReduction?.ability;
      const restored = lowered.filter((effect) => all || effect.abilityReduction?.ability === ability);
      if (restored.length === 0) return null;
      for (const effect of restored) {
        if (effect.tags.includes(ABILITY_DRAIN_TAG)) ended.push(...endEffect(state, target.id, effect.id));
        else
          target.effects = target.effects.map((kept) => {
            if (kept.id !== effect.id) return kept;
            const { abilityReduction: _given, ...rest } = kept;
            return rest;
          });
      }
      const abilities = [...new Set(restored.map((effect) => effect.abilityReduction!.ability))];
      return abilities.map((score) => `${target.name}'s ${ABILITY_NAMES[score]} score is whole again.`);
    }
    case "other": {
      const named = target.effects.filter((effect) => effect.tags.includes(RESTORABLE_TAG));
      const lifted = all ? named : named.filter((effect) => effect.id === (pick.effectId ?? named[0]?.id));
      if (lifted.length === 0) return null;
      for (const effect of lifted) ended.push(...endEffect(state, target.id, effect.id));
      return lifted.map((effect) => `${target.name} is free of ${effect.name}.`);
    }
    case "hit-point-maximum": {
      const lowered = target.effects.filter((effect) => effect.hitPointMaximumLoss !== undefined);
      if (lowered.length === 0) return null;
      for (const effect of lowered) {
        // A drained maximum is all its effect holds; a curse that lowers it (a mummy's rot) stays a curse.
        if (effect.tags.includes(DRAINED_TAG)) ended.push(...endEffect(state, target.id, effect.id));
        else {
          target.hp = { ...target.hp, maximum: target.hp.maximum + effect.hitPointMaximumLoss! };
          target.effects = target.effects.map((kept) => {
            if (kept.id !== effect.id) return kept;
            const { hitPointMaximumLoss: _given, ...rest } = kept;
            return rest;
          });
        }
      }
      return [`${target.name}'s Hit Point maximum is back to ${target.hp.maximum}.`];
    }
    default:
      return null;
  }
}

/** What a creature lacks when the cast would end nothing it picked. */
const LACKS: Readonly<Record<Harm, string>> = {
  exhaustion: "has no Exhaustion",
  charmed: "isn't Charmed",
  petrified: "isn't Petrified",
  curse: "bears no curse",
  "ability-score": "has no lowered ability score",
  "hit-point-maximum": "has no lowered Hit Point maximum",
  other: "bears no effect it ends"
};

/** The harm a pick names, refused when it isn't one Greater Restoration lists. */
function harmOf(optionId: string | undefined): Harm {
  const harm = RESTORATION_PICKS.find((option) => option.id === (optionId ?? RESTORATION_PICKS[0]!.id));
  if (!harm) throw new CommandRejectedError("Greater Restoration doesn't end that.");
  return harm.id;
}

/** Greater Restoration on its touched creature: the one harm its caster picked ends, or the cast is refused before
 *  anything is spent when the creature has none of it. */
export function applyRestoration(ctx: ResolveContext): void {
  const { action, input } = ctx;
  if (!action.restores || input.commit === false) return;
  const target = ctx.targets[0];
  if (!target) return;
  const harm = harmOf(input.optionId ?? undefined);
  const definition =
    target.id === ctx.attacker.id
      ? ctx.deps.definition
      : target.definitionId
        ? ctx.deps.resolveDefinition?.(target.definitionId)
        : undefined;
  const before = [...target.effects];
  const ended: EffectNarration[] = [];
  const lines = restoreHarm(
    ctx.state,
    target,
    harm,
    {
      ...(input.effectId != null ? { effectId: input.effectId } : {}),
      ...(input.itemId != null ? { itemId: input.itemId } : {}),
      ...(input.ability != null ? { ability: input.ability } : {})
    },
    { ...(definition ? { definition } : {}), ...(ctx.deps.catalog ? { catalog: ctx.deps.catalog } : {}) },
    ended,
    false
  );
  if (lines === null)
    throw new CommandRejectedError(`${target.name} ${LACKS[harm]}, so ${action.name} would do nothing.`);
  const remaining = new Set(target.effects.map((effect) => effect.id));
  ctx.effectsEnded.push(
    ...before.filter((effect) => !remaining.has(effect.id)).map((effect) => endedEffect(target, effect))
  );
  for (const line of lines)
    ctx.tableNarration.push({ kind: "effect", text: `${line.slice(0, -1)} (${action.name}).`, actorIds: [target.id] });
  for (const event of ended) ctx.tableNarration.push(tableLineOf(ctx, event));
}

/** Wish's Instant Health: "You end all effects on them described in the Greater Restoration spell." Returns what ended. */
export function restoreEverything(state: GameState, target: Actor, deps: RestoreDeps): string[] {
  const ended: EffectNarration[] = [];
  return RESTORATION_PICKS.flatMap(({ id }) => restoreHarm(state, target, id, {}, deps, ended, true) ?? []);
}

/** A spell that ends an effect by name ("The effect can also be ended by the ... Heal ... spell") ends it on each
 *  creature the cast reaches. */
export function endNamedEffects(ctx: ResolveContext): void {
  const { action, input } = ctx;
  if (!action.spellId || input.commit === false) return;
  const tag = `${ENDED_BY_PREFIX}${action.spellId}`;
  for (const target of ctx.targets)
    for (const effect of target.effects.filter((candidate) => candidate.tags.includes(tag))) {
      ctx.effectsEnded.push(endedEffect(target, effect));
      for (const event of endEffect(ctx.state, target.id, effect.id)) ctx.tableNarration.push(tableLineOf(ctx, event));
      ctx.tableNarration.push({
        kind: "effect",
        text: `${target.name} is free of ${effect.name} (${action.name}).`,
        actorIds: [target.id]
      });
    }
}
