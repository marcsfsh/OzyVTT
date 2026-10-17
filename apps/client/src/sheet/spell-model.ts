/** The spells as the sheet lists and casts them: shared by the laptop's list, the phone's list, the turn's options and
 *  the one cast detail, so only the presentation differs between them. */
import type { ActorDefinition, ContentActionSummary, ContentSpellSummary } from "@vtt/domain";
import { cantripTierAt } from "@vtt/content-srd-5.2.1/schemas";
import { signed } from "../encounter/format";
import type { SheetActor } from "./sheet-model";

export type SheetSpellEntry = NonNullable<ActorDefinition["spellcasting"]>["spells"][number];

/** One pool of slots by level, what is left of it, and whether it is Pact Magic. */
export type SlotPool = Readonly<{ level: number; remaining: number; max: number; pact: boolean }>;

/** The character's spell slots by level, and its Pact Magic pool. A sheet that doesn't state the pact's size shows what
 *  is left as the size. */
export function slotPools(
  definition: ActorDefinition,
  actor: SheetActor
): { slots: SlotPool[]; pact: SlotPool | null } {
  const spellcasting = definition.spellcasting;
  const live = new Map<number, number>((actor.spellSlots ?? []).map((slot) => [slot.level, slot.remaining]));
  const slots = (spellcasting?.slots ?? [])
    .filter((slot) => slot.max > 0)
    .map((slot) => ({ level: slot.level, remaining: live.get(slot.level) ?? slot.max, max: slot.max, pact: false }))
    .sort((left, right) => left.level - right.level);
  const pact = actor.pactSlots
    ? {
        level: actor.pactSlots.level,
        remaining: actor.pactSlots.remaining,
        max: Math.max(spellcasting?.pact?.max ?? 0, actor.pactSlots.remaining),
        pact: true
      }
    : null;
  return { slots, pact };
}

/** "120 feet" reads "120 ft". */
export const shortRange = (range: string | null | undefined) => (range ? range.replace(/\bfeet\b/g, "ft") : null);

/** The word a spell counts its extra targets in, from its own higher-level text: rays, darts, beams. */
export function countNoun(content: ContentSpellSummary | undefined): string {
  const match = content?.higherLevel?.match(/\b(dart|ray|beam|bolt|humanoid|creature|target)s?\b/i);
  const word = match ? match[1].toLowerCase() : "target";
  return word === "humanoid" ? "Humanoids" : `${word}s`;
}

/** How many of its targets a spell makes at a level: Scorching Ray's 3 at level 2, 4 at level 3. */
export function targetCountAt(content: ContentSpellSummary | undefined, level: number): number | null {
  if (!content) return null;
  const row = content.castingOptions.find((option) => option.level === level);
  if (row?.targetCount) return row.targetCount;
  // The base level is not a casting option; the next one up names one more than it.
  const next = content.castingOptions.find((option) => option.level === level + 1);
  return level === content.level && next?.targetCount ? next.targetCount - 1 : null;
}

/**
 * The damage a spell deals when cast at `level`, the single source for the shown effect and a rolled formula: the SRD
 * upcast row for that slot, a cantrip's row for the character's level, else the base damage. For several targets the
 * formula repeats the die once per target, so the whole amount is rolled.
 */
export function spellEffectAt(
  content: ContentSpellSummary | undefined,
  baseLevel: number,
  level: number,
  characterLevel = 1
): { label: string | null; formula: string | null } {
  const scaled =
    baseLevel === 0
      ? cantripTierAt(content?.cantripScaling ?? [], characterLevel)
      : level > baseLevel
        ? content?.castingOptions.find((option) => option.level === level)
        : undefined;
  const die = scaled?.damageRoll ?? content?.damageRoll ?? null;
  const targets = scaled?.targetCount ?? null;
  if (die && targets && targets > 1)
    return { label: `${targets}× ${die}`, formula: Array.from({ length: targets }, () => die).join(" + ") };
  if (die) return { label: die, formula: die };
  if (targets) return { label: `${targets} targets`, formula: null };
  return { label: null, formula: null };
}

/** What a level of a spell buys, in the words of its own scaling: "4 rays", "9d6 fire". */
export function whatLevelBuys(content: ContentSpellSummary | undefined, level: number): string | null {
  if (!content) return null;
  const count = targetCountAt(content, level);
  if (count !== null) return `${count} ${countNoun(content)}`;
  const row = level > content.level ? content.castingOptions.find((option) => option.level === level) : undefined;
  const die = row?.damageRoll ?? content.damageRoll;
  if (!die) return null;
  return `${die}${content.damageTypes.length > 0 ? ` ${content.damageTypes.join(" or ")}` : ""}`;
}

/** A grant's free casting of a spell: the uses its feature has left (shared with that feature's counter), or at will. */
export function freeCastOf(
  spell: SheetSpellEntry,
  definition: ActorDefinition,
  actor: SheetActor
): { left: number | null; actionId: string } | null {
  const action = spell.freeActionId
    ? definition.actions.find((candidate) => candidate.id === spell.freeActionId)
    : undefined;
  if (!action) return null;
  if (!action.uses) return { left: null, actionId: action.id };
  const spent = actor.actionUses?.[action.uses.pool ?? action.id] ?? 0;
  return { left: Math.max(0, action.uses.limit - spent), actionId: action.id };
}

/** A sheet with a prepared cap keeps a prepared list; an import without one casts whatever it lists. */
export const keepsPreparedList = (definition: ActorDefinition) =>
  (definition.spellcasting?.classes ?? []).some((entry) => entry.prepared !== undefined);

/** Where a spell stands: a cantrip, kept prepared by a feature, prepared, or only on the list (or in the book). */
export type PreparedState = "cantrip" | "always" | "prepared" | "unprepared";

export function preparedState(spell: SheetSpellEntry, actor: SheetActor, definition: ActorDefinition): PreparedState {
  if (spell.level === 0) return "cantrip";
  if (spell.alwaysPrepared) return "always";
  if ((actor.preparedSpellIds ?? []).includes(spell.id) || !keepsPreparedList(definition)) return "prepared";
  return "unprepared";
}

/** The spell's one line: casting time, range and what it does, the numbers from the character's own action. */
export function spellLine(
  spell: Pick<SheetSpellEntry, "level">,
  content: ContentSpellSummary | undefined,
  action: Pick<ContentActionSummary, "attackBonus" | "saveAbility" | "saveDc" | "damage"> | null,
  characterLevel: number
): string {
  const parts: string[] = [];
  if (content?.castingTime) parts.push(content.castingTime);
  const range = shortRange(content?.rangeText);
  if (range) parts.push(range);
  if (action?.attackBonus !== null && action?.attackBonus !== undefined) parts.push(signed(action.attackBonus));
  if (action?.saveAbility) parts.push(`DC ${action.saveDc} ${action.saveAbility.toUpperCase()}`);
  const damage =
    action && action.damage.length > 0
      ? action.damage.map((part) => `${part.formula} ${part.type}`).join(" + ")
      : spellEffectAt(content, spell.level, spell.level, characterLevel).label;
  if (damage) parts.push(damage);
  else if (content?.duration && content.duration !== "instantaneous") parts.push(content.duration);
  return parts.join(" · ");
}

/** One way to cast a spell now, as the cast detail offers it. */
export type CastOption = Readonly<{
  key: string;
  kind: "slot" | "free" | "ritual" | "cantrip";
  level: number;
  title: string;
  /** How many are left and what it buys ("3 of 3 left · 4 rays"). */
  detail: string;
  available: boolean;
  reason: string | null;
  pact: boolean;
}>;

/** The ways a spell can be cast now: each slot level at or above its own, a free casting, or as a Ritual. */
export function castOptions({
  spell,
  definition,
  actor,
  content,
  policeSlots,
  prepared
}: Readonly<{
  spell: SheetSpellEntry;
  definition: ActorDefinition;
  actor: SheetActor;
  content: ContentSpellSummary | undefined;
  /** Whether an empty slot level, or a spell not prepared, is refused here. */
  policeSlots: boolean;
  prepared: boolean;
}>): CastOption[] {
  if (spell.level === 0)
    return [
      {
        key: "cantrip",
        kind: "cantrip",
        level: 0,
        title: "Cantrip",
        detail: "No slot",
        available: true,
        reason: null,
        pact: false
      }
    ];
  const options: CastOption[] = [];
  const { slots, pact } = slotPools(definition, actor);
  if (spell.withSlot !== false) {
    const pools = [...slots, ...(pact ? [pact] : [])].filter((pool) => pool.level >= spell.level);
    const levels = [...new Set(pools.map((pool) => pool.level))].sort((left, right) => left - right);
    for (const level of levels) {
      const atLevel = pools.filter((pool) => pool.level === level);
      const remaining = atLevel.reduce((sum, pool) => sum + pool.remaining, 0);
      const max = atLevel.reduce((sum, pool) => sum + pool.max, 0);
      const buys = whatLevelBuys(content, level);
      const empty = remaining === 0;
      const unprepared = !prepared;
      options.push({
        key: `slot-${level}`,
        kind: "slot",
        level,
        title: `Level ${level}`,
        detail: [`${remaining} of ${max} left`, atLevel.some((pool) => pool.pact) ? "Pact Magic" : null, buys]
          .filter(Boolean)
          .join(" · "),
        available: !policeSlots || (!empty && !unprepared),
        reason: empty ? `No level ${level} spell slots left.` : unprepared ? "Not prepared." : null,
        pact: atLevel.some((pool) => pool.pact)
      });
    }
  }
  const free = freeCastOf(spell, definition, actor);
  if (free)
    options.push({
      key: "free",
      kind: "free",
      level: spell.level,
      title: free.left === null ? "At will" : "Without a slot",
      detail: free.left === null ? "No slot" : `${free.left} free ${free.left === 1 ? "cast" : "casts"} left`,
      available: free.left !== 0,
      reason: free.left === 0 ? "No free casts left." : null,
      pact: false
    });
  if (spell.ritualActionId)
    options.push({
      key: "ritual",
      kind: "ritual",
      level: spell.level,
      title: "As a Ritual",
      detail: "No slot · 10 minutes longer",
      available: true,
      reason: null,
      pact: false
    });
  return options;
}

/** What the cast detail's one primary says for an option: the result it names. */
export const castLabel = (option: CastOption) =>
  option.kind === "slot"
    ? `Cast at level ${option.level}`
    : option.kind === "free"
      ? "Cast without a slot"
      : option.kind === "ritual"
        ? "Cast as a Ritual"
        : "Cast";
