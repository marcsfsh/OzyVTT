import type { Actor, ConversionOffer, GameState } from "@vtt/domain";
import { catalogIdOf, type ActorDefinition } from "@vtt/schemas";
import { pactSlotMaximum, spellSlotMaxima } from "./actor-roster.js";
import { holdsFeature } from "./class-features.js";
import { actionPools, effectiveActions } from "./effective-actions.js";
import { deriveEquipment, type EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError } from "./game-store.js";
import { healActor } from "./hit-points.js";

/**
 * The SRD's resource conversions and recoveries: a feature that turns one resource into another (Font of Magic's slots
 * and Sorcery Points, a slot for a Bardic Inspiration or a Wild Shape), restores a spent use with another resource
 * (Intimidating Presence with a Rage), or recovers slots or points when a Short Rest finishes (Arcane Recovery,
 * Sorcerous Restoration). Each is checked here against its feature's rule, so a player gets back only what the rules
 * give; the GM still sets slots and gives uses back freely.
 */

export type ConversionRequest = Readonly<{
  conversionId: string;
  level?: number;
  pact?: boolean;
  levels?: readonly number[];
  count?: number;
}>;

type Pool = Readonly<{ id: string; name: string; limit: number; per: string }>;

type Context = Readonly<{
  state: GameState;
  actor: Actor;
  definition: ActorDefinition | undefined;
  pools: ReadonlyMap<string, Pool>;
  /** The table's slot maximum per level (a made slot can sit above it until a Long Rest). */
  slotMaxima: ReadonlyMap<number, number>;
  pactMax: number;
  inFight: boolean;
  /** The server's dice, for a conversion that rolls (Uncanny Metabolism's Martial Arts die). */
  random: (sides: number) => number;
}>;

type Timing = ConversionOffer["timing"];
type Pick = ConversionOffer["pick"];

/** One conversion: who has it, what it shows, and how it applies. `check` says why it can't be used now (null when it
 *  can); `apply` checks the request against the same rule and changes the actor, returning the line the table reads. */
type Conversion = Readonly<{
  id: string;
  name: string;
  timing: Timing;
  holds: (context: Context) => boolean;
  line: (context: Context) => string;
  check: (context: Context) => string | null;
  pick: (context: Context) => Pick;
  apply: (context: Context, request: ConversionRequest) => string;
}>;

const classLevel = (definition: ActorDefinition | undefined, classId: string) =>
  definition?.character?.classes.find((entry) => entry.id === classId)?.level ?? 0;

const poolLeft = (context: Context, poolId: string) => {
  const pool = context.pools.get(poolId);
  return pool ? Math.max(0, pool.limit - (context.actor.actionUses[poolId] ?? 0)) : 0;
};
const poolSpent = (context: Context, poolId: string) => context.actor.actionUses[poolId] ?? 0;

/** Moves a pool's spent count by `delta` (negative gives uses back), never below none spent. */
function movePool(actor: Actor, poolId: string, delta: number): void {
  const next = Math.max(0, (actor.actionUses[poolId] ?? 0) + delta);
  const { [poolId]: _old, ...others } = actor.actionUses;
  actor.actionUses = next > 0 ? { ...others, [poolId]: next } : others;
}

/** A counter a conversion keeps outside any pool ("can't do so again until you finish a Long Rest"). A Long Rest
 *  clears every count; a Short Rest leaves counts no action spends. */
const counterKey = (id: string) => `conversion-${id}`;
const counted = (context: Context, id: string) => (context.actor.actionUses[counterKey(id)] ?? 0) > 0;
const count = (actor: Actor, id: string) => movePool(actor, counterKey(id), 1);

/** "Once on each of your turns": a per-turn mark in a fight. */
const turnKey = (context: Context, id: string) => `${context.actor.id}:${counterKey(id)}`;
const usedThisTurn = (context: Context, id: string) =>
  context.inFight && (context.state.combat.turn.turnUses[turnKey(context, id)] ?? 0) > 0;
function markTurn(context: Context, id: string): void {
  if (!context.inFight) return;
  const { state } = context;
  state.combat = {
    ...state.combat,
    turn: { ...state.combat.turn, turnUses: { ...state.combat.turn.turnUses, [turnKey(context, id)]: 1 } }
  };
}

// ---- slots ----

type SlotChoice = { level: number; pact: boolean; left: number };
/** Which slots a cost takes: any (a spell slot), one level only (Holy Nimbus's level 5), or a Pact Magic slot. */
type SlotFilter = Readonly<{ level?: number; pact?: true }>;

/** The slots the character could spend that `filter` allows: spell slots, then its Pact Magic slots. */
function slotsLeft(context: Context, filter: SlotFilter = {}): SlotChoice[] {
  const { actor } = context;
  const fits = (level: number) => filter.level === undefined || level === filter.level;
  const spell = filter.pact
    ? []
    : (actor.spellSlots ?? [])
        .filter((slot) => fits(slot.level) && slot.remaining > 0)
        .map((slot) => ({ level: slot.level, pact: false, left: slot.remaining }));
  const pact =
    actor.pactSlots && fits(actor.pactSlots.level) && actor.pactSlots.remaining > 0
      ? [{ level: actor.pactSlots.level, pact: true, left: actor.pactSlots.remaining }]
      : [];
  return [...spell, ...pact];
}

/** Spends the slot the request names, refused when none `filter` allows is left there. Returns its level. */
function spendSlot(context: Context, request: ConversionRequest, filter: SlotFilter = {}): number {
  const { actor } = context;
  const level = request.level ?? filter.level ?? (filter.pact ? actor.pactSlots?.level : undefined);
  const pact = filter.pact === true || request.pact === true;
  const choice = slotsLeft(context, filter).find((entry) => entry.level === level && entry.pact === pact);
  if (level === undefined) throw new CommandRejectedError("Choose which spell slot to spend.");
  if (!choice)
    throw new CommandRejectedError(
      filter.level !== undefined && level !== filter.level
        ? `This takes a level ${filter.level} spell slot.`
        : `${actor.name} has no level ${level} ${pact ? "Pact Magic" : "spell"} slot left.`
    );
  if (pact) actor.pactSlots = { ...actor.pactSlots!, remaining: actor.pactSlots!.remaining - 1 };
  else
    actor.spellSlots = (actor.spellSlots ?? []).map((slot) =>
      slot.level === level ? { ...slot, remaining: slot.remaining - 1 } : slot
    );
  return level;
}

/** Gives one spell slot of `level`, which may sit above the table's maximum until a Long Rest. */
function makeSlot(actor: Actor, level: number): void {
  const slots = actor.spellSlots ?? [];
  actor.spellSlots = slots.some((slot) => slot.level === level)
    ? slots.map((slot) => (slot.level === level ? { ...slot, remaining: Math.min(9, slot.remaining + 1) } : slot))
    : [...slots, { level, remaining: 1 }].sort((left, right) => left.level - right.level);
}

/** The spell slots spent at each level, up to `maxLevel` (none of level 6 or higher, for the SRD's recoveries). */
function spentSlots(context: Context, maxLevel: number): { level: number; spent: number }[] {
  return (context.actor.spellSlots ?? [])
    .filter((slot) => slot.level <= maxLevel)
    .map((slot) => ({
      level: slot.level,
      spent: Math.max(0, (context.slotMaxima.get(slot.level) ?? 0) - slot.remaining)
    }))
    .filter((entry) => entry.spent > 0);
}

/** Recovers the spent slots `levels` names, their levels adding up to at most `budget`, none above `maxLevel`. */
function recoverSlots(context: Context, request: ConversionRequest, budget: number, maxLevel: number): string {
  const levels = request.levels ?? [];
  if (levels.length === 0) throw new CommandRejectedError("Choose the spent spell slots to recover.");
  const total = levels.reduce((sum, level) => sum + level, 0);
  if (levels.some((level) => level > maxLevel))
    throw new CommandRejectedError(`None of the slots can be level ${maxLevel + 1} or higher.`);
  if (total > budget)
    throw new CommandRejectedError(
      `The slots can add up to ${budget} ${budget === 1 ? "level" : "levels"}, and these add up to ${total}.`
    );
  const spent = new Map(spentSlots(context, maxLevel).map((entry) => [entry.level, entry.spent]));
  for (const level of new Set(levels)) {
    const asked = levels.filter((entry) => entry === level).length;
    if ((spent.get(level) ?? 0) < asked)
      throw new CommandRejectedError(`${context.actor.name} hasn't spent that many level ${level} spell slots.`);
  }
  const { actor } = context;
  actor.spellSlots = (actor.spellSlots ?? []).map((slot) => ({
    ...slot,
    remaining: slot.remaining + levels.filter((level) => level === slot.level).length
  }));
  const sorted = levels.slice().sort((left, right) => left - right);
  return sorted.length === 1
    ? `a level ${sorted[0]} spell slot`
    : `spell slots of levels ${sorted.slice(0, -1).join(", ")} and ${sorted[sorted.length - 1]}`;
}

const plural = (amount: number, one: string, many = `${one}s`) => `${amount} ${amount === 1 ? one : many}`;

/** A feature's once-per-Long-Rest use: its own pool when the sheet has one, else a counter a Long Rest clears. */
const useLeft = (context: Context, id: string) =>
  context.pools.has(id) ? poolLeft(context, id) > 0 : !counted(context, id);
function takeUse(context: Context, id: string): void {
  if (context.pools.has(id)) movePool(context.actor, id, 1);
  else count(context.actor, id);
}
const AFTER_SHORT_REST = "This is chosen when a Short Rest finishes, in the step it opens.";

/** The refusals a short-rest recovery shares: out of a fight, in the step a finished Short Rest opened. */
function afterShortRest(context: Context): string | null {
  if (context.inFight) return "This is chosen after a Short Rest, outside a fight.";
  return context.actor.restStep?.after === "short-rest" ? null : AFTER_SHORT_REST;
}

/** A slot recovery a Short Rest's end allows once per Long Rest (Arcane Recovery, Natural Recovery). */
function slotRecovery(id: string, name: string, classId: string): Conversion {
  const budget = (context: Context) => Math.ceil(classLevel(context.definition, classId) / 2);
  return {
    id,
    name,
    timing: "after-short-rest",
    holds: (context) => holdsFeature(context.definition, id, name),
    line: (context) =>
      `When a Short Rest finishes, recover spent spell slots adding up to ${plural(budget(context), "level")}, none of level 6 or higher. Once per Long Rest.`,
    check: (context) => {
      if (!useLeft(context, id)) return `${name} is used. It comes back on a Long Rest.`;
      const rest = afterShortRest(context);
      if (rest) return rest;
      return spentSlots(context, 5).length === 0 ? `${context.actor.name} has no spent spell slots to recover.` : null;
    },
    pick: (context) => ({ kind: "recover-slots", budget: budget(context), options: spentSlots(context, 5) }),
    apply: (context, request) => {
      const recovered = recoverSlots(context, request, budget(context), 5);
      takeUse(context, id);
      return `${context.actor.name} uses ${name} and recovers ${recovered}.`;
    }
  };
}

/** A feature's spent use restored by spending something else ("unless you expend a use of your Rage"). */
function restoreUse(
  id: string,
  name: string,
  featureId: string,
  pool: string,
  cost: Readonly<
    { kind: "pool"; pool: string; amount: number; words: string } | { kind: "slot"; filter: SlotFilter; words: string }
  >
): Conversion {
  return {
    id,
    name,
    timing: "no-action",
    holds: (context) => holdsFeature(context.definition, featureId, name) && context.pools.has(pool),
    line: () => `Restore your use of ${name} by spending ${cost.words}.`,
    check: (context) => {
      if (poolSpent(context, pool) === 0) return `${name} isn't spent.`;
      if (cost.kind === "pool")
        return poolLeft(context, cost.pool) >= cost.amount ? null : `${context.actor.name} doesn't have ${cost.words}.`;
      return slotsLeft(context, cost.filter).length > 0 ? null : `${context.actor.name} has no ${cost.words} left.`;
    },
    pick: (context) =>
      cost.kind === "pool" ? { kind: "none" } : { kind: "slot", options: slotsLeft(context, cost.filter) },
    apply: (context, request) => {
      if (cost.kind === "pool") movePool(context.actor, cost.pool, cost.amount);
      else spendSlot(context, request, cost.filter);
      movePool(context.actor, pool, -1);
      return `${context.actor.name} spends ${cost.words} to restore ${name}.`;
    }
  };
}

/** SRD Font of Magic, Creating Spell Slots: the cost of each level and the Sorcerer level it needs. */
export const CREATING_SPELL_SLOTS: ReadonlyArray<Readonly<{ level: number; cost: number; minSorcererLevel: number }>> =
  [
    { level: 1, cost: 2, minSorcererLevel: 2 },
    { level: 2, cost: 3, minSorcererLevel: 3 },
    { level: 3, cost: 5, minSorcererLevel: 5 },
    { level: 4, cost: 6, minSorcererLevel: 7 },
    { level: 5, cost: 7, minSorcererLevel: 9 }
  ];

const SORCERY_POINTS = "sorcery-points";

/** The Bonus Action or Magic action a conversion takes in a fight: refused off the character's turn or once spent. */
function takeTurnAction(context: Context, kind: "bonus-action" | "magic-action", spend: boolean): string | null {
  if (!context.inFight) return null;
  const { state, actor } = context;
  const word = kind === "bonus-action" ? "a Bonus Action" : "a Magic action";
  if (state.combat.turnActorId !== actor.id) return `This takes ${word}, on ${actor.name}'s turn.`;
  const used = kind === "bonus-action" ? state.combat.turn.bonusActionUsed : state.combat.turn.actionUsed;
  if (used) return `${actor.name} has used ${kind === "bonus-action" ? "the Bonus Action" : "the action"} this turn.`;
  if (spend)
    state.combat = {
      ...state.combat,
      turn: { ...state.combat.turn, ...(kind === "bonus-action" ? { bonusActionUsed: true } : { actionUsed: true }) }
    };
  return null;
}

/** A carried, attuned Pearl of Power row, and the key of its once-per-dawn use. */
function pearlOf(context: Context) {
  const row = context.actor.inventory.find(
    (item) => catalogIdOf(item) === "pearl-of-power" && item.quantity > 0 && item.attuned === true
  );
  return row ? { row, key: `pearl-of-power-${row.id}` } : null;
}

const CONVERSIONS: readonly Conversion[] = [
  {
    id: "font-of-magic-points",
    name: "Font of Magic",
    timing: "no-action",
    holds: (context) =>
      holdsFeature(context.definition, "font-of-magic", "Font of Magic") && context.pools.has(SORCERY_POINTS),
    line: () => "Spend a spell slot to gain Sorcery Points equal to its level, up to your maximum.",
    check: (context) => {
      if (poolSpent(context, SORCERY_POINTS) === 0) return "Sorcery Points are full.";
      return slotsLeft(context).length > 0 ? null : `${context.actor.name} has no spell slots left.`;
    },
    pick: (context) => ({ kind: "slot", options: slotsLeft(context) }),
    apply: (context, request) => {
      const gained = Math.min(spendSlot(context, request), poolSpent(context, SORCERY_POINTS));
      movePool(context.actor, SORCERY_POINTS, -gained);
      return `${context.actor.name} turns a spell slot into ${plural(gained, "Sorcery Point")}.`;
    }
  },
  {
    id: "font-of-magic-slot",
    name: "Font of Magic: create a spell slot",
    timing: "bonus-action",
    holds: (context) =>
      holdsFeature(context.definition, "font-of-magic", "Font of Magic") && context.pools.has(SORCERY_POINTS),
    line: () =>
      "As a Bonus Action, spend Sorcery Points for one spell slot of level 5 or lower. A slot made this way vanishes on a Long Rest.",
    check: (context) =>
      takeTurnAction(context, "bonus-action", false) ??
      (creatable(context).some((option) => option.cost <= poolLeft(context, SORCERY_POINTS))
        ? null
        : "Not enough Sorcery Points for any spell slot."),
    pick: (context) => ({ kind: "create-slot", options: creatable(context) }),
    apply: (context, request) => {
      const option = creatable(context).find((entry) => entry.level === request.level);
      if (!option)
        throw new CommandRejectedError(
          `${context.actor.name} can create spell slots of level ${creatable(context)
            .map((entry) => entry.level)
            .join(", ")}.`
        );
      const left = poolLeft(context, SORCERY_POINTS);
      if (left < option.cost)
        throw new CommandRejectedError(
          `A level ${option.level} spell slot costs ${option.cost} Sorcery Points, and ${context.actor.name} has ${left}.`
        );
      const refusal = takeTurnAction(context, "bonus-action", true);
      if (refusal) throw new CommandRejectedError(refusal);
      movePool(context.actor, SORCERY_POINTS, option.cost);
      makeSlot(context.actor, option.level);
      return `${context.actor.name} spends ${option.cost} Sorcery Points to create a level ${option.level} spell slot.`;
    }
  },
  {
    id: "font-of-inspiration",
    name: "Font of Inspiration",
    timing: "no-action",
    holds: (context) =>
      holdsFeature(context.definition, "font-of-inspiration", "Font of Inspiration") &&
      context.pools.has("bardic-inspiration"),
    line: () => "Spend a spell slot to regain one use of Bardic Inspiration.",
    check: (context) =>
      poolSpent(context, "bardic-inspiration") === 0
        ? "Bardic Inspiration is full."
        : slotsLeft(context).length > 0
          ? null
          : `${context.actor.name} has no spell slots left.`,
    pick: (context) => ({ kind: "slot", options: slotsLeft(context) }),
    apply: (context, request) => {
      spendSlot(context, request);
      movePool(context.actor, "bardic-inspiration", -1);
      return `${context.actor.name} spends a spell slot to regain a use of Bardic Inspiration.`;
    }
  },
  {
    id: "wild-resurgence-shape",
    name: "Wild Resurgence",
    timing: "no-action",
    holds: (context) =>
      holdsFeature(context.definition, "wild-resurgence", "Wild Resurgence") && context.pools.has("wild-shape"),
    line: () => "With no uses of Wild Shape left, spend a spell slot to gain one. Once on each of your turns.",
    check: (context) => {
      if (poolLeft(context, "wild-shape") > 0) return `${context.actor.name} still has uses of Wild Shape.`;
      if (context.inFight && context.state.combat.turnActorId !== context.actor.id)
        return `This is done on ${context.actor.name}'s turn.`;
      if (usedThisTurn(context, "wild-resurgence-shape")) return "Wild Resurgence gave a use of Wild Shape this turn.";
      return slotsLeft(context).length > 0 ? null : `${context.actor.name} has no spell slots left.`;
    },
    pick: (context) => ({ kind: "slot", options: slotsLeft(context) }),
    apply: (context, request) => {
      spendSlot(context, request);
      movePool(context.actor, "wild-shape", -1);
      markTurn(context, "wild-resurgence-shape");
      return `${context.actor.name} spends a spell slot to regain a use of Wild Shape.`;
    }
  },
  {
    id: "wild-resurgence-slot",
    name: "Wild Resurgence: a level 1 slot",
    timing: "no-action",
    holds: (context) =>
      holdsFeature(context.definition, "wild-resurgence", "Wild Resurgence") && context.pools.has("wild-shape"),
    line: () => "Spend a use of Wild Shape to gain a level 1 spell slot. Once per Long Rest.",
    check: (context) =>
      counted(context, "wild-resurgence-slot")
        ? "Wild Resurgence gave a spell slot. It can again after a Long Rest."
        : poolLeft(context, "wild-shape") > 0
          ? null
          : `${context.actor.name} has no uses of Wild Shape left.`,
    pick: () => ({ kind: "none" }),
    apply: (context) => {
      movePool(context.actor, "wild-shape", 1);
      makeSlot(context.actor, 1);
      count(context.actor, "wild-resurgence-slot");
      return `${context.actor.name} spends a use of Wild Shape to gain a level 1 spell slot.`;
    }
  },
  {
    id: "nature-magician",
    name: "Nature Magician",
    timing: "no-action",
    holds: (context) => holdsFeature(context.definition, "archdruid", "Archdruid") && context.pools.has("wild-shape"),
    line: () =>
      "Turn uses of Wild Shape into one spell slot, each use adding 2 levels: two uses make a level 4 slot. Once per Long Rest.",
    check: (context) =>
      counted(context, "nature-magician")
        ? "Nature Magician is used. It comes back on a Long Rest."
        : poolLeft(context, "wild-shape") > 0
          ? null
          : `${context.actor.name} has no uses of Wild Shape left.`,
    pick: (context) => ({
      kind: "count",
      min: 1,
      max: Math.max(1, Math.min(4, poolLeft(context, "wild-shape"))),
      unit: "use of Wild Shape"
    }),
    apply: (context, request) => {
      const uses = request.count ?? 0;
      const left = poolLeft(context, "wild-shape");
      if (uses < 1 || uses > 4)
        throw new CommandRejectedError("Choose 1 to 4 uses of Wild Shape: a slot is level 9 at most.");
      if (uses > left)
        throw new CommandRejectedError(`${context.actor.name} has ${plural(left, "use")} of Wild Shape left.`);
      movePool(context.actor, "wild-shape", uses);
      makeSlot(context.actor, uses * 2);
      count(context.actor, "nature-magician");
      return `${context.actor.name} turns ${plural(uses, "use")} of Wild Shape into a level ${uses * 2} spell slot.`;
    }
  },
  slotRecovery("arcane-recovery", "Arcane Recovery", "wizard"),
  slotRecovery("natural-recovery", "Natural Recovery", "druid"),
  {
    id: "magical-cunning",
    name: "Magical Cunning",
    timing: "one-minute",
    holds: (context) =>
      holdsFeature(context.definition, "magical-cunning", "Magical Cunning") && context.actor.pactSlots !== null,
    line: (context) =>
      eldritchMaster(context)
        ? "A 1-minute rite regains all your spent Pact Magic slots (Eldritch Master). Once per Long Rest."
        : "A 1-minute rite regains spent Pact Magic slots, up to half your maximum (round up). Once per Long Rest.",
    check: (context) => {
      if (!useLeft(context, "magical-cunning")) return "Magical Cunning is used. It comes back on a Long Rest.";
      if (context.inFight) return "The rite takes 1 minute, outside a fight.";
      return pactSpent(context) > 0 ? null : "No Pact Magic slots are spent.";
    },
    pick: () => ({ kind: "none" }),
    apply: (context) => {
      const regained = Math.min(
        pactSpent(context),
        eldritchMaster(context) ? context.pactMax : Math.ceil(context.pactMax / 2)
      );
      const { actor } = context;
      actor.pactSlots = { ...actor.pactSlots!, remaining: actor.pactSlots!.remaining + regained };
      takeUse(context, "magical-cunning");
      return `${actor.name} performs Magical Cunning's rite and regains ${plural(regained, "Pact Magic slot")}.`;
    }
  },
  {
    id: "sorcerous-restoration",
    name: "Sorcerous Restoration",
    timing: "after-short-rest",
    holds: (context) =>
      holdsFeature(context.definition, "sorcerous-restoration", "Sorcerous Restoration") &&
      context.pools.has(SORCERY_POINTS),
    line: (context) =>
      `When a Short Rest finishes, regain up to ${plural(restorable(context), "spent Sorcery Point")}. Once per Long Rest.`,
    check: (context) => {
      if (!useLeft(context, "sorcerous-restoration"))
        return "Sorcerous Restoration is used. It comes back on a Long Rest.";
      const rest = afterShortRest(context);
      if (rest) return rest;
      return poolSpent(context, SORCERY_POINTS) > 0 ? null : "Sorcery Points are full.";
    },
    pick: (context) => ({
      kind: "count",
      min: 1,
      max: Math.max(1, Math.min(restorable(context), poolSpent(context, SORCERY_POINTS))),
      unit: "Sorcery Point"
    }),
    apply: (context, request) => {
      const points = request.count ?? 0;
      const most = Math.min(restorable(context), poolSpent(context, SORCERY_POINTS));
      if (points < 1 || points > most)
        throw new CommandRejectedError(`${context.actor.name} can regain 1 to ${most} Sorcery Points.`);
      movePool(context.actor, SORCERY_POINTS, -points);
      takeUse(context, "sorcerous-restoration");
      return `${context.actor.name} uses Sorcerous Restoration and regains ${plural(points, "Sorcery Point")}.`;
    }
  },
  restoreUse(
    "intimidating-presence-restore",
    "Intimidating Presence",
    "intimidating-presence",
    "intimidating-presence",
    {
      kind: "pool",
      pool: "rage",
      amount: 1,
      words: "a use of Rage"
    }
  ),
  restoreUse("holy-nimbus-restore", "Holy Nimbus", "holy-nimbus", "holy-nimbus", {
    kind: "slot",
    filter: { level: 5 },
    words: "a level 5 spell slot"
  }),
  restoreUse("dragon-wings-restore", "Dragon Wings", "dragon-wings", "dragon-wings", {
    kind: "pool",
    pool: SORCERY_POINTS,
    amount: 3,
    words: "3 Sorcery Points"
  }),
  restoreUse("hurl-through-hell-restore", "Hurl Through Hell", "hurl-through-hell", "hurl-through-hell", {
    kind: "slot",
    filter: { pact: true },
    words: "a Pact Magic slot"
  }),
  {
    id: "sorcery-incarnate",
    name: "Sorcery Incarnate",
    timing: "no-action",
    holds: (context) =>
      holdsFeature(context.definition, "sorcery-incarnate", "Sorcery Incarnate") &&
      context.pools.has("innate-sorcery") &&
      context.pools.has(SORCERY_POINTS),
    line: () => "With no uses of Innate Sorcery left, spend 2 Sorcery Points to use it once more.",
    check: (context) =>
      poolLeft(context, "innate-sorcery") > 0
        ? `${context.actor.name} still has uses of Innate Sorcery.`
        : poolLeft(context, SORCERY_POINTS) >= 2
          ? null
          : `${context.actor.name} doesn't have 2 Sorcery Points.`,
    pick: () => ({ kind: "none" }),
    apply: (context) => {
      movePool(context.actor, SORCERY_POINTS, 2);
      movePool(context.actor, "innate-sorcery", -1);
      return `${context.actor.name} spends 2 Sorcery Points to use Innate Sorcery again.`;
    }
  },
  {
    id: "pearl-of-power",
    name: "Pearl of Power",
    timing: "magic-action",
    holds: (context) =>
      pearlOf(context) !== null && (context.actor.spellSlots !== null || context.actor.pactSlots !== null),
    line: () => "As a Magic action, regain one spent spell slot of level 3 or lower. Once per dawn.",
    check: (context) => {
      const pearl = pearlOf(context);
      if (pearl && (context.actor.actionUses[pearl.key] ?? 0) > 0)
        return "The Pearl of Power is used. It works again at dawn.";
      return (
        takeTurnAction(context, "magic-action", false) ??
        (pearlChoices(context).length > 0 ? null : `${context.actor.name} has no spent spell slot of level 3 or lower.`)
      );
    },
    pick: (context) => ({ kind: "slot", options: pearlChoices(context) }),
    apply: (context, request) => {
      const choice = pearlChoices(context).find(
        (entry) => entry.level === request.level && entry.pact === (request.pact === true)
      );
      if (!choice) throw new CommandRejectedError("Choose a spent spell slot of level 3 or lower.");
      const refusal = takeTurnAction(context, "magic-action", true);
      if (refusal) throw new CommandRejectedError(refusal);
      const { actor } = context;
      if (choice.pact) actor.pactSlots = { ...actor.pactSlots!, remaining: actor.pactSlots!.remaining + 1 };
      else
        actor.spellSlots = (actor.spellSlots ?? []).map((slot) =>
          slot.level === choice.level ? { ...slot, remaining: slot.remaining + 1 } : slot
        );
      movePool(actor, pearlOf(context)!.key, 1);
      return `${actor.name} uses a Pearl of Power to regain a level ${choice.level} spell slot.`;
    }
  },
  {
    id: "persistent-rage",
    name: "Persistent Rage",
    timing: "on-initiative",
    holds: (context) =>
      holdsFeature(context.definition, "persistent-rage", "Persistent Rage") && context.pools.has("rage"),
    line: () => "When you roll Initiative, regain every spent use of Rage. Once per Long Rest.",
    check: (context) =>
      !useLeft(context, "persistent-rage")
        ? "Persistent Rage is used. It comes back on a Long Rest."
        : (initiativeRefusal(context) ?? (poolSpent(context, "rage") > 0 ? null : "No uses of Rage are spent.")),
    pick: () => ({ kind: "none" }),
    apply: (context) => {
      const back = poolSpent(context, "rage");
      movePool(context.actor, "rage", -back);
      takeUse(context, "persistent-rage");
      return `${context.actor.name} regains ${plural(back, "use")} of Rage (Persistent Rage).`;
    }
  },
  {
    id: "uncanny-metabolism",
    name: "Uncanny Metabolism",
    timing: "on-initiative",
    holds: (context) =>
      holdsFeature(context.definition, "uncanny-metabolism", "Uncanny Metabolism") && context.pools.has("focus-points"),
    line: () =>
      "When you roll Initiative, regain every spent Focus Point and Hit Points equal to your Monk level plus a roll of your Martial Arts die. Once per Long Rest.",
    check: (context) =>
      !useLeft(context, "uncanny-metabolism")
        ? "Uncanny Metabolism is used. It comes back on a Long Rest."
        : initiativeRefusal(context),
    pick: () => ({ kind: "none" }),
    apply: (context) => {
      const { actor, definition } = context;
      const back = poolSpent(context, "focus-points");
      movePool(actor, "focus-points", -back);
      takeUse(context, "uncanny-metabolism");
      const sides = Number(/^1d(\d+)$/.exec(definition?.character?.martialArts?.die ?? "")?.[1] ?? 6);
      const face = context.random(sides);
      const healed = classLevel(definition, "monk") + face;
      healActor(context.state, actor.id, healed, { role: "gm" });
      return `${actor.name} regains ${plural(back, "Focus Point")} and rolls ${face} on the d${sides} to regain ${healed} Hit Points (Uncanny Metabolism).`;
    }
  }
];

/** "When you roll Initiative": a combatant may choose these from its roll to the end of its first turn. */
function initiativeRefusal(context: Context): string | null {
  return context.inFight && context.state.combat.initiativeWindow.includes(context.actor.id)
    ? null
    : `This is used when ${context.actor.name} rolls Initiative, before the end of ${context.actor.name}'s first turn.`;
}

function creatable(context: Context): { level: number; cost: number }[] {
  const sorcerer = classLevel(context.definition, "sorcerer");
  return CREATING_SPELL_SLOTS.filter((row) => sorcerer >= row.minSorcererLevel).map(({ level, cost }) => ({
    level,
    cost
  }));
}

const restorable = (context: Context) => Math.floor(classLevel(context.definition, "sorcerer") / 2);
const eldritchMaster = (context: Context) => holdsFeature(context.definition, "eldritch-master", "Eldritch Master");
const pactSpent = (context: Context) =>
  context.actor.pactSlots ? Math.max(0, context.pactMax - context.actor.pactSlots.remaining) : 0;

/** The spent slots of level 3 or lower a Pearl of Power can give back. */
function pearlChoices(context: Context): { level: number; pact: boolean; left: number }[] {
  const spell = spentSlots(context, 3).map((entry) => ({
    level: entry.level,
    pact: false,
    left: (context.actor.spellSlots ?? []).find((slot) => slot.level === entry.level)?.remaining ?? 0
  }));
  const pact =
    context.actor.pactSlots && context.actor.pactSlots.level <= 3 && pactSpent(context) > 0
      ? [{ level: context.actor.pactSlots.level, pact: true, left: context.actor.pactSlots.remaining }]
      : [];
  return [...spell, ...pact];
}

type Deps = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  /** The server's dice; absent where nothing is applied (the sheet's offers). */
  random?: (sides: number) => number;
}>;

function contextOf(state: GameState, actor: Actor, deps: Deps): Context {
  const definition = actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;
  const pools = new Map(
    actionPools(effectiveActions(definition, actor, deps.catalog)).map((pool) => [pool.id, pool] as const)
  );
  const slotMaxima = new Map(
    spellSlotMaxima(definition, deriveEquipment(actor, definition, deps.catalog).spellSlots).map(
      (entry) => [entry.level, entry.max] as const
    )
  );
  return {
    state,
    actor,
    definition,
    pools,
    slotMaxima,
    pactMax: pactSlotMaximum(definition)?.max ?? actor.pactSlots?.remaining ?? 0,
    inFight: state.combat.active && state.combat.initiative.some((entry) => entry.actorId === actor.id),
    random: deps.random ?? (() => 1)
  };
}

/** The conversions this character's features give, as the sheet offers them. */
export function conversionOffers(state: GameState, actor: Actor, deps: Deps): ConversionOffer[] {
  const context = contextOf(state, actor, deps);
  return CONVERSIONS.filter((conversion) => conversion.holds(context)).map((conversion) => ({
    id: conversion.id,
    name: conversion.name,
    line: conversion.line(context),
    timing: conversion.timing,
    reason: conversion.check(context),
    pick: conversion.pick(context)
  }));
}

/** Applies one conversion for `actorId`, refused unless its feature's rule allows it now. Returns the table's line. */
export function convertResource(state: GameState, actorId: string, request: ConversionRequest, deps: Deps): string {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  const context = contextOf(state, actor, deps);
  const conversion = CONVERSIONS.find((entry) => entry.id === request.conversionId);
  if (!conversion || !conversion.holds(context))
    throw new CommandRejectedError(`${actor.name} has no feature that does that.`);
  const refusal = conversion.check(context);
  if (refusal) throw new CommandRejectedError(refusal);
  return conversion.apply(context, request);
}
