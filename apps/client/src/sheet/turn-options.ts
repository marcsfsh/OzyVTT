/** Everything a character can do on a turn, grouped by what it costs: the one list behind the sheet's Play tab, the
 *  table's Turn tab and the phone's turn card. The server still decides each use. */
import type { ActorDefinition, ContentActionSummary, ContentSpellSummary } from "@vtt/domain";
import { castsSpell, plainActionName, signed } from "../encounter/format";
import type { SheetActor } from "./sheet-model";
import { freeCastOf, slotPools, spellEffectAt, type SheetSpellEntry, type SlotPool } from "./spell-model";

export type TurnCost = "action" | "magic" | "bonus-action" | "reaction" | "other";

/** The cost groups in the order a turn reads them. */
export const COST_GROUPS: ReadonlyArray<readonly [TurnCost, string]> = [
  ["action", "Action"],
  ["magic", "Magic action · items"],
  ["bonus-action", "Bonus Action"],
  ["reaction", "Reaction"],
  ["other", "No action"]
];

export type TurnOption = Readonly<{
  id: string;
  /** What targeting and the resolve read: the server's numbers where it sent them. */
  summary: ContentActionSummary;
  name: string;
  cost: TurnCost;
  kind: "weapon" | "spell" | "item" | "feature";
  /** The cost in words, always shown beside its colour ("Action · cantrip", "Reaction · level 1+"). */
  costWords: string;
  /** One line of what it does, in the server's numbers, its level first. */
  line: string;
  /** The same line without the level, which a turn card's tile names above it. */
  effect: string;
  concentration: boolean;
  /** The spell it casts from the character's list, which picks its slot in the cast detail. */
  spell: SheetSpellEntry | null;
  /** A grant's free casts left; null at will, undefined with none. */
  freeLeft: number | null | undefined;
  /** The lowest slot pool a levelled spell draws on, for the tile's pips. */
  slot: SlotPool | null;
  /** Why it can't be used now, as the server says it. */
  reason: string | null;
  /** The Weapon Mastery property a weapon swing applies ("Graze"). */
  mastery: string | null;
  /** What a lasting spell lets its caster do while it is up (a sphere's ram), shown inside the spell's row. */
  children: readonly TurnOption[];
}>;

/** What the server says about the character's actions beyond its own rows. */
export type TurnFacts = Readonly<{
  /** The server's rows by id: their numbers include item riders and a lasting spell's cast level. */
  rows: ReadonlyMap<string, ContentActionSummary>;
  /** Rows added to a hit, which the result offers. */
  ridesAHit: ReadonlySet<string>;
  /** A spell's later rows whose spell isn't up. */
  awaiting: ReadonlySet<string>;
  /** Why each unavailable row can't be used now. */
  reasons: ReadonlyMap<string, string>;
  /** Rows that are not actions on a turn (a rider, a rest feature), which the list leaves out. */
  passive: ReadonlySet<string>;
  /** Each weapon swing's Weapon Mastery property. */
  mastery: ReadonlyMap<string, string>;
}>;

export const NO_FACTS: TurnFacts = {
  rows: new Map(),
  ridesAHit: new Set(),
  awaiting: new Set(),
  reasons: new Map(),
  passive: new Set(),
  mastery: new Map()
};

const LATER = /^spell-(.+?)-then-/;

/** "reach 5 ft", "80/320 ft", "reach 5 ft, 20/60 ft". */
function reachWords(summary: ContentActionSummary): string | null {
  const reach = summary.reachFeet ? `reach ${summary.reachFeet} ft` : null;
  const range =
    summary.rangeNormalFeet && summary.rangeFeet && summary.rangeNormalFeet !== summary.rangeFeet
      ? `${summary.rangeNormalFeet}/${summary.rangeFeet} ft`
      : summary.rangeFeet
        ? `${summary.rangeFeet} ft`
        : null;
  return [reach, range].filter(Boolean).join(", ") || null;
}

const damageWords = (summary: ContentActionSummary) =>
  summary.damage.length > 0 ? summary.damage.map((part) => `${part.formula} ${part.type}`).join(" + ") : null;

/** Whether the list offers an action: something the server resolves, which isn't added to a hit or waiting. */
function offered(action: ActorDefinition["actions"][number], facts: TurnFacts): boolean {
  if (facts.ridesAHit.has(action.id) || facts.awaiting.has(action.id) || facts.passive.has(action.id)) return false;
  // What a spell's area does later is the server's or the GM's to run, not a tap.
  if (action.activation === "other" && LATER.test(action.id)) return false;
  const row = facts.rows.get(action.id);
  return Boolean(
    action.attack ||
    action.save ||
    action.damage.length > 0 ||
    action.uses !== undefined ||
    (action.healing !== undefined && action.spellId === undefined) ||
    // A spell the server can resolve (Misty Step, Fly), though it rolls nothing.
    ((action.spellId !== undefined || action.spellSlot !== undefined) && row?.targeting)
  );
}

/** Builds the options from the character's own actions, the actions its loadout adds and the server's facts. */
export function turnOptions({
  definition,
  actor,
  ownSummaries,
  extraActions,
  facts,
  spellReference,
  characterLevel
}: Readonly<{
  definition: ActorDefinition;
  actor: SheetActor | null;
  /** `summaryOfOwnAction` for each of the definition's actions. */
  ownSummaries: ReadonlyMap<string, ContentActionSummary>;
  /** The server-derived rows for the loadout (a wand's charge, an equipped weapon). */
  extraActions: readonly ContentActionSummary[];
  facts: TurnFacts;
  spellReference: ReadonlyMap<string, ContentSpellSummary>;
  characterLevel: number;
}>): TurnOption[] {
  const spells = definition.spellcasting?.spells ?? [];
  const spellOf = new Map<string, SheetSpellEntry>();
  const folded = new Set<string>();
  for (const spell of spells) {
    const primary = spell.actionId ?? spell.freeActionId ?? spell.ritualActionId;
    if (primary) spellOf.set(primary, spell);
    for (const variant of [spell.freeActionId, spell.ritualActionId])
      if (variant && variant !== primary) folded.add(variant);
  }
  const pools = actor ? slotPools(definition, actor) : { slots: [], pact: null };
  const uses = actor?.actionUses ?? {};

  const build = (summary: ContentActionSummary, own: ActorDefinition["actions"][number] | null): TurnOption => {
    const spell = spellOf.get(summary.id) ?? null;
    const content = spell ? spellReference.get(spell.id) : own?.spellId ? spellReference.get(own.spellId) : undefined;
    const isSpell = spell !== null || castsSpell(summary.id, summary.name) || own?.spellId !== undefined;
    const isItem = summary.id.startsWith("item-");
    const kind: TurnOption["kind"] = isSpell
      ? "spell"
      : summary.attackBonus !== null && (isItem || own?.attack)
        ? "weapon"
        : isItem
          ? "item"
          : "feature";
    const cost: TurnCost =
      summary.activation === "action"
        ? isItem && kind !== "weapon"
          ? "magic"
          : "action"
        : summary.activation === "bonus-action"
          ? "bonus-action"
          : summary.activation === "reaction"
            ? "reaction"
            : "other";
    const level = spell?.level ?? own?.spellSlot?.level ?? content?.level ?? null;
    const levelWords = level === null ? null : level === 0 ? "Cantrip" : `Level ${level}+`;
    const free = spell && actor ? freeCastOf(spell, definition, actor) : null;
    const spent = summary.usesLimit !== null ? (uses[summary.usesPool ?? summary.id] ?? 0) : 0;
    const left = summary.usesLimit !== null ? Math.max(0, summary.usesLimit - spent) : null;
    const effectParts = [
      summary.attackBonus !== null ? signed(summary.attackBonus) : null,
      summary.saveAbility ? `DC ${summary.saveDc} ${titleAbility(summary.saveAbility)}` : null,
      reachWords(summary) ?? (content?.rangeText ? content.rangeText.replace(/\bfeet\b/, "ft") : null),
      summary.darts ? `${summary.darts} darts` : null,
      damageWords(summary) ??
        (kind === "spell" ? spellEffectAt(content, level ?? 0, level ?? 0, characterLevel).label : null),
      summary.healing ? `Regain ${summary.healing.formula} HP` : null,
      free ? (free.left === null ? "at will" : `${free.left} free ${free.left === 1 ? "cast" : "casts"} left`) : null,
      left !== null && summary.usesLimit !== null
        ? `${left} of ${summary.usesLimit} ${isItem ? "charges " : ""}left`
        : null
    ].filter((part): part is string => Boolean(part));
    const effect = effectParts.join(" · ");
    const costWord =
      cost === "magic"
        ? "Magic action"
        : cost === "bonus-action"
          ? "Bonus Action"
          : cost === "reaction"
            ? "Reaction"
            : cost === "other"
              ? "No action"
              : "Action";
    const lowest =
      kind === "spell" && level !== null && level > 0
        ? ([...pools.slots, ...(pools.pact ? [pools.pact] : [])]
            .filter((pool) => pool.level >= level)
            .sort((left, right) => left.level - right.level)[0] ?? null)
        : null;
    return {
      id: summary.id,
      summary,
      name: spell?.name ?? plainActionName(summary.name),
      cost,
      kind,
      costWords: kind === "spell" && levelWords ? `${costWord} · ${levelWords.toLowerCase()}` : costWord,
      line: [kind === "spell" ? levelWords : null, effect].filter(Boolean).join(" · "),
      effect,
      concentration: content?.concentration ?? false,
      spell,
      freeLeft: free ? free.left : undefined,
      slot: lowest,
      reason: facts.reasons.get(summary.id) ?? null,
      mastery: facts.mastery.get(summary.id) ?? null,
      children: []
    };
  };

  const options: TurnOption[] = [];
  const children = new Map<string, TurnOption[]>();
  for (const action of definition.actions) {
    if (folded.has(action.id) || !offered(action, facts)) continue;
    const own = ownSummaries.get(action.id);
    if (!own) continue;
    const row = facts.rows.get(action.id);
    // The damage the server rolls, where it differs (a lasting spell's later row at its cast level).
    const summary = row && row.damage.length === own.damage.length ? { ...own, damage: row.damage } : own;
    const option = build(summary, action);
    const later = action.id.match(LATER);
    const parent = later ? `spell-${later[1]}` : null;
    if (parent && definition.actions.some((candidate) => candidate.id === parent)) {
      children.set(parent, [...(children.get(parent) ?? []), option]);
      continue;
    }
    options.push(option);
  }
  // Item-derived rows come after: their `item-` ids never collide with the stat block's. The server says which
  // resolve (a potion, a scroll, a coat of poison).
  for (const row of extraActions) {
    if (facts.passive.has(row.id)) continue;
    if (
      (row.targeting === undefined || row.targeting === null) &&
      row.attackBonus === null &&
      row.saveAbility === null &&
      row.damage.length === 0 &&
      row.usesLimit === null
    )
      continue;
    options.push(build(row, null));
  }
  return options.map((option) =>
    children.has(option.id) ? { ...option, children: children.get(option.id)! } : option
  );
}

const titleAbility = (ability: string) => `${ability[0]?.toUpperCase() ?? ""}${ability.slice(1)}`;

/** The options in a cost group, in list order. */
export const optionsOf = (options: readonly TurnOption[], cost: TurnCost) =>
  options.filter((option) => option.cost === cost);
