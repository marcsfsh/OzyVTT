import type { PendingSave } from "@vtt/domain";
import { killOutright, previewDamage } from "../hit-points.js";
import { HEADS_KEY } from "../death-traits.js";
import { laterRowOf } from "../item-actions.js";
import { createPendingSaves } from "../saving-throws.js";
import { traitOf } from "../statblock-traits.js";
import { spellOf } from "./concentration.js";
import { sizeAtMost, tableLineOf, type DefinitionAction, type LiveActor, type ResolveContext } from "./context.js";
import { damagePartsOf } from "./damage.js";
import { isMagicalAction } from "./pending.js";

/**
 * Casts and hits that kill outright. SRD Power Word Kill: "If the target has 100 Hit Points or fewer, it dies.
 * Otherwise, it takes 12d12 Psychic damage." A weapon's killing hit (`OnHitRider.kills`): Nine Lives Stealer's Life
 * Stealing, Mace of Disruption's and Mace of Smiting's destruction of a creature left at 25 Hit Points or fewer, and the
 * Vorpal Sword's cut. Death Ward negates a kill that deals no damage.
 */

/** The deps a kill passes on to what dies (a Death Burst's dice, a rising corpse). */
function killDeps(ctx: ResolveContext) {
  return ctx.deps.resolveDefinition
    ? {
        deps: {
          resolveDefinition: ctx.deps.resolveDefinition,
          ...(ctx.deps.catalog ? { catalog: ctx.deps.catalog } : {}),
          newId: ctx.deps.newRollId,
          now: ctx.deps.now,
          rollDie: ctx.deps.random
        }
      }
    : {};
}

/** A target at or under the cast's threshold dies with no damage dealt, unless Death Ward negates it, and takes none of
 *  the cast's damage either way; one above it takes the damage. */
export function killOnCast(ctx: ResolveContext): void {
  const spell = spellOf(ctx);
  const threshold = spell?.effect?.killsAtHitPoints;
  if (!spell || threshold === undefined || laterRowOf(spell, ctx.action.id) !== undefined) return;
  if (ctx.input.commit === false) return;
  const doomed = ctx.targets.filter((target) => target.hp.current <= threshold);
  if (doomed.length === 0) return;
  ctx.spared = new Set([...(ctx.spared ?? []), ...doomed.map((target) => target.id)]);
  for (const target of doomed)
    for (const event of killOutright(ctx.state, target.id, spell.name, { withoutDamage: true, ...killDeps(ctx) }))
      ctx.tableNarration.push(tableLineOf(ctx, event));
  // With no target left above the threshold, nothing takes the damage.
  if (ctx.targets.every((target) => ctx.spared!.has(target.id))) {
    ctx.damage.splice(0);
    ctx.bonusDamage.splice(0);
  }
}

type Rider = NonNullable<DefinitionAction["onHit"]>[number];

/** The target's Hit Points once this hit's damage lands, through its defences and its Temporary Hit Points. */
function hitPointsAfterHit(ctx: ResolveContext, target: LiveActor): number {
  const parts = damagePartsOf(ctx);
  const applied =
    parts.length === 0
      ? 0
      : previewDamage(
          ctx.state,
          target.id,
          { amount: 0, parts },
          ctx.deps.resolveDefinition
            ? {
                resolveDefinition: ctx.deps.resolveDefinition,
                ...(ctx.deps.catalog ? { catalog: ctx.deps.catalog } : {})
              }
            : undefined
        ).totalApplied;
  return Math.max(0, target.hp.current - Math.max(0, applied - target.hp.temporary));
}

/** A hit rider that can kill outright: its gates, then the save, the cut, or the death. */
export function applyKillingHit(ctx: ResolveContext, rider: Rider, index: number): void {
  const kills = rider.kills!;
  const target = ctx.targets[0];
  if (!target) return;
  const type = ctx.riderFilters.targetCreatureType;
  if (kills.exceptCreatureTypes && type !== undefined && kills.exceptCreatureTypes.includes(type)) {
    ctx.tableNarration.push(
      tableLineOf(ctx, {
        kind: "effect",
        text: `${target.name} is untouched by ${ctx.action.name}'s killing power (${type}).`,
        actorId: target.id
      })
    );
    return;
  }
  if (kills.hitPointsUnder !== undefined && target.hp.current >= kills.hitPointsUnder) return;
  if (kills.afterHitAtOrBelow !== undefined && hitPointsAfterHit(ctx, target) > kills.afterHitAtOrBelow) return;
  if (kills.beheads) {
    behead(ctx, target);
    return;
  }
  if (rider.save) {
    openKillingSave(ctx, rider, index, target);
    return;
  }
  for (const event of killOutright(ctx.state, target.id, ctx.action.name, killDeps(ctx)))
    ctx.tableNarration.push(tableLineOf(ctx, event));
}

/** "The creature must succeed on a DC 15 Constitution saving throw or be slain" (Nine Lives Stealer); "On a successful
 *  save, the creature has the Frightened condition until the end of your next turn" (Mace of Disruption). */
function openKillingSave(ctx: ResolveContext, rider: Rider, index: number, target: LiveActor): void {
  const save = rider.save!;
  const conditions = rider.conditions.map((condition) => condition.id);
  const onSuccessEffect: PendingSave["onSuccessEffect"] =
    conditions.length > 0
      ? {
          name: `${conditions.map((id) => id[0]!.toUpperCase() + id.slice(1)).join(" and ")} (${ctx.action.name})`,
          tags: [],
          modifiers: [],
          linkedConditionIds: conditions,
          escapeDc: null,
          sourceActorId: ctx.attacker.id,
          sourceName: ctx.attacker.name,
          ...(rider.duration ? { duration: rider.duration } : {}),
          sourceActionId: `${ctx.action.id}:${index}`
        }
      : undefined;
  createPendingSaves(ctx.state, {
    sourceActorId: ctx.attacker.id,
    sourceName: ctx.attacker.name,
    actionName: ctx.action.name,
    ability: save.ability,
    dc: save.dc,
    targetIds: [target.id],
    proposedDamage: 0,
    halfOnSuccess: false,
    conditionIds: [],
    // A failure kills whatever the target's Hit Points (no creature has more than the band's 1,000).
    extra: { failureByHitPoints: [{ atOrBelow: 1000, dies: true }], ...(onSuccessEffect ? { onSuccessEffect } : {}) },
    replaceExisting: false,
    magical: isMagicalAction({
      action: ctx.action,
      attacker: ctx.attacker,
      riderItemId: ctx.riderItemId,
      deps: ctx.deps
    }),
    newSaveId: ctx.deps.newRollId,
    createdAt: Date.parse(ctx.deps.now())
  });
}

/**
 * SRD Vorpal Sword: "you cut off one of the creature's heads. The creature dies if it can't survive without the lost
 * head. A creature is immune to this effect if it has Immunity to Slashing damage, if it doesn't have or need a head, or
 * if the GM decides that the creature is too big ... Such a creature instead takes an extra 30 Slashing damage from the
 * hit. If the creature has Legendary Resistance, it can expend one daily use of that trait to avoid losing its head."
 * An Ooze has no head; a creature with several heads (a hydra) loses one; a Huge or larger creature takes the 30 and the
 * GM may rule the cut instead; one with Legendary Resistance left spends it.
 */
function behead(ctx: ResolveContext, target: LiveActor): void {
  const { state, action } = ctx;
  const definition = target.definitionId ? ctx.deps.resolveDefinition?.(target.definitionId) : undefined;
  const instead = (why: string) => {
    ctx.bonusDamage.push({ amount: 30, type: "slashing", source: `${action.name} (${why})` });
    ctx.tableNarration.push(
      tableLineOf(ctx, {
        kind: "effect",
        text: `${action.name} can't take ${target.name}'s head (${why}), and the hit deals 30 Slashing damage more.`,
        actorId: target.id
      })
    );
  };
  const slashingImmune =
    previewDamage(
      state,
      target.id,
      { amount: 0, parts: [{ amount: 10, type: "slashing" }] },
      ctx.deps.resolveDefinition
        ? {
            resolveDefinition: ctx.deps.resolveDefinition,
            ...(ctx.deps.catalog ? { catalog: ctx.deps.catalog } : {})
          }
        : undefined
    ).totalApplied === 0;
  if (slashingImmune) return instead("Immunity to Slashing damage");
  if (ctx.riderFilters.targetCreatureType === "ooze") return instead("no head");
  const heads = traitOf(definition, "multiple-heads");
  if (heads) {
    const left = Math.max(0, (target.actionUses[HEADS_KEY] ?? heads.heads) - 1);
    target.actionUses = { ...target.actionUses, [HEADS_KEY]: left };
    ctx.tableNarration.push(
      tableLineOf(ctx, {
        kind: "effect",
        text: `${action.name} cuts off one of ${target.name}'s heads: ${left} ${left === 1 ? "head" : "heads"} left.`,
        actorId: target.id
      })
    );
    if (left === 0)
      for (const event of killOutright(state, target.id, action.name, killDeps(ctx)))
        ctx.tableNarration.push(tableLineOf(ctx, event));
    return;
  }
  if (!sizeAtMost(target.size, "large")) {
    ctx.warnings.push(`${action.name}: whether ${target.name} is too big to behead is the GM's call.`);
    return instead("too big");
  }
  const perDay = target.legendary?.resistancesPerDay ?? 0;
  const spent = target.actionUses["legendary-resistance"] ?? 0;
  if (spent < perDay) {
    target.actionUses = { ...target.actionUses, "legendary-resistance": spent + 1 };
    return instead(`Legendary Resistance, ${perDay - spent - 1} of ${perDay} left`);
  }
  ctx.tableNarration.push(
    tableLineOf(ctx, {
      kind: "condition",
      text: `${action.name} cuts off ${target.name}'s head.`,
      actorId: target.id
    })
  );
  ctx.warnings.push(`${action.name}: a creature that can live without its head is the GM's to revive.`);
  for (const event of killOutright(state, target.id, action.name, killDeps(ctx)))
    ctx.tableNarration.push(tableLineOf(ctx, event));
}
