/**
 * A stat block's actions as the SRD 5.2.1 writes them, built from answers: an attack ("Melee Attack Roll: +5, reach
 * 5 ft. 7 (1d8 + 3) Slashing damage."), a saving throw ("Dexterity Saving Throw: DC 13, each creature in a 15-foot
 * Cone. Failure: 22 (4d10) Fire damage. Success: Half damage."), a Multiattack, or prose.
 *
 * The structured fields (`attack`, `save`, `damage`, `onHit`, `multiattack`, `uses`, `legendary`) are what the
 * engine rolls; the description is what the sheet prints. The text follows the answers until the GM writes their
 * own, and the area the text names is what the map's template is read from (`areaOfProse`).
 */

import { averageOf } from "@vtt/rules-5e";
import { newId } from "../../lib/ids";
import type { Draft } from "../schema";
import { ABILITY_NAMES, type AbilityId } from "./monster-build";

export type MonsterAction = Readonly<Record<string, unknown>>;
export type ActionKind = "attack" | "save" | "multiattack" | "other";
export type Activation = "action" | "bonus-action" | "reaction" | "legendary";

type Part = Readonly<{ formula: string; type: string }>;
type Attack = Readonly<{ bonus: number; reachFeet?: number; rangeFeet?: number; rangeNormalFeet?: number }>;
type Save = Readonly<{
  ability: AbilityId;
  dc: number;
  successDamage?: "half" | "none";
  failureConditions?: readonly string[];
}>;
type OnHit = Readonly<{
  conditions: ReadonlyArray<Readonly<{ id: string }>>;
  escapeDc?: number;
  maxTargetSize?: string;
}>;
type Component = Readonly<{ actionId: string; count: number; or?: readonly string[] }>;
type Uses = Readonly<{ limit: number; per: string; recharge?: number }>;

const title = (slug: string) =>
  slug
    .split("-")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");

const words = (list: readonly string[]) =>
  list.length <= 1 ? (list[0] ?? "") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;

const COUNT_WORDS = ["zero", "one", "two", "three", "four", "five", "six"];

/** The damage the action deals. A part whose dice are blank deals nothing, so it is no part: a saving throw with its
 *  dice cleared prints no damage and halves none. */
export const partsOf = (action: MonsterAction): readonly Part[] =>
  Array.isArray(action.damage)
    ? (action.damage as Part[]).filter((part) => typeof part.formula === "string" && part.formula.trim() !== "")
    : [];

export function kindOf(action: MonsterAction): ActionKind {
  if (Array.isArray(action.multiattack)) return "multiattack";
  if (action.attack) return "attack";
  if (action.save) return "save";
  return "other";
}

export function activationOf(action: MonsterAction): Activation {
  if (action.legendary) return "legendary";
  if (action.activation === "bonus-action" || action.activation === "reaction") return action.activation;
  return "action";
}

/** A new action of the kind and timing asked for; the id is a slug of its name, minted once. */
export function newAction(kind: ActionKind, activation: Activation): MonsterAction {
  const base = {
    id: `action-${newId()
      .slice(0, 8)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")}`,
    name: "",
    activation: activation === "legendary" ? "other" : activation,
    description: "",
    damage: [] as Part[],
    ...(activation === "legendary" ? { legendary: { cost: 1 } } : {})
  };
  if (kind === "attack")
    return { ...base, attack: { bonus: 4, reachFeet: 5 }, damage: [{ formula: "1d6 + 2", type: "slashing" }] };
  if (kind === "save")
    return {
      ...base,
      save: { ability: "dex", dc: 12, successDamage: "half", failureConditions: [] },
      damage: [{ formula: "2d6", type: "fire" }]
    };
  if (kind === "multiattack") return { ...base, name: "Multiattack", multiattack: [] };
  return base;
}

/** "5 (1d6 + 2) Slashing damage". */
export const damageWords = (part: Part): string => {
  const average = averageOf(part.formula);
  return `${average === null ? "" : `${average} `}(${part.formula}) ${title(part.type)} damage`;
};

const sizeWords: Readonly<Record<string, string>> = {
  tiny: "Tiny",
  small: "Small",
  medium: "Medium",
  large: "Large",
  huge: "Huge",
  gargantuan: "Gargantuan"
};

function onHitWords(onHit: readonly OnHit[]): string {
  return onHit
    .map((rider) => {
      const conditions = rider.conditions.map((condition) => title(condition.id));
      const grappled = rider.conditions.some((condition) => condition.id === "grappled");
      const condition = `has the ${words(conditions)} condition${conditions.length > 1 ? "s" : ""}${
        grappled && rider.escapeDc ? ` (escape DC ${rider.escapeDc})` : ""
      }`;
      return rider.maxTargetSize
        ? `If the target is a ${sizeWords[rider.maxTargetSize] ?? title(rider.maxTargetSize)} or smaller creature, it ${condition}.`
        : `The target ${condition}.`;
    })
    .join(" ");
}

export function attackText(action: MonsterAction): string {
  const attack = action.attack as Attack;
  const melee = typeof attack.reachFeet === "number";
  const ranged = typeof attack.rangeFeet === "number";
  const kind = melee && ranged ? "Melee or Ranged" : ranged ? "Ranged" : "Melee";
  const reach = melee ? `reach ${attack.reachFeet} ft.` : "";
  const range = ranged
    ? `range ${attack.rangeNormalFeet && attack.rangeNormalFeet !== attack.rangeFeet ? `${attack.rangeNormalFeet}/` : ""}${attack.rangeFeet} ft.`
    : "";
  const parts = partsOf(action);
  const hit = parts.length > 0 ? ` ${parts.map(damageWords).join(" plus ")}.` : "";
  const riders =
    Array.isArray(action.onHit) && action.onHit.length > 0 ? ` ${onHitWords(action.onHit as OnHit[])}` : "";
  return `${kind} Attack Roll: ${attack.bonus >= 0 ? "+" : ""}${attack.bonus}, ${[reach, range].filter(Boolean).join(" or ")}${hit}${riders}`;
}

/** Where a save reaches: an area, which the map draws as a template and the engine stores as `area`, or one
 *  creature within a distance, which only the text says. */
export type SaveTarget =
  | Readonly<{ kind: "area"; shape: "cone" | "line" | "sphere" | "emanation" | "cube"; size: number }>
  | Readonly<{ kind: "one"; feet: number }>;

const ONE_TARGET = /one creature [^.]*?within (\d+) feet/i;

export function saveTargetOf(action: MonsterAction): SaveTarget {
  const area = action.area as { shape?: string; sizeFeet?: number } | undefined;
  if (area?.shape && typeof area.sizeFeet === "number")
    return { kind: "area", shape: area.shape as Extract<SaveTarget, { kind: "area" }>["shape"], size: area.sizeFeet };
  const match = ONE_TARGET.exec(typeof action.description === "string" ? action.description : "");
  return { kind: "one", feet: match ? Number(match[1]) : 30 };
}

/** The action aimed at a new target: the area as data, or the distance in its words. */
export function withSaveTarget(action: MonsterAction, target: SaveTarget): MonsterAction {
  const { area: _area, ...rest } = action as Record<string, unknown>;
  if (target.kind === "area")
    return {
      ...rest,
      area: { shape: target.shape, sizeFeet: target.size, widthFeet: target.shape === "line" ? 5 : null }
    };
  const description = typeof action.description === "string" ? action.description : "";
  return { ...rest, description: description.replace(/(one creature [^.]*?within )\d+( feet)/i, `$1${target.feet}$2`) };
}

/** "each creature in a 15-foot Cone", in the words `areaOfProse` reads, or "one creature the ogre can see within 30
 *  feet". */
export function targetWords(target: SaveTarget, creature: string): string {
  if (target.kind === "one") return `one creature the ${creature} can see within ${target.feet} feet`;
  if (target.shape === "line") return `each creature in a ${target.size}-foot-long, 5-foot-wide Line`;
  if (target.shape === "sphere") return `each creature in a ${target.size}-foot-radius Sphere`;
  return `each creature in a ${target.size}-foot ${title(target.shape)}`;
}

export function saveText(action: MonsterAction, creature: string): string {
  const save = action.save as Save;
  const parts = partsOf(action);
  const conditions = (save.failureConditions ?? []).map(title);
  const failure = [
    parts.length > 0 ? parts.map(damageWords).join(" plus ") : null,
    conditions.length > 0
      ? `The target has the ${words(conditions)} condition${conditions.length > 1 ? "s" : ""}`
      : null
  ].filter(Boolean);
  const success =
    parts.length > 0 ? (save.successDamage === "none" ? " Success: No damage." : " Success: Half damage.") : "";
  return `${ABILITY_NAMES[save.ability]} Saving Throw: DC ${save.dc}, ${targetWords(saveTargetOf(action), creature)}.${
    failure.length > 0 ? ` Failure: ${failure.join(". ")}.` : ""
  }${success}`;
}

/** "The ogre makes two Greatclub attacks." Parts name the actions they use, in the words `multiattackOfProse`
 *  reads, so an import of the text would find the same plan. */
export function multiattackText(action: MonsterAction, actions: readonly MonsterAction[], creature: string): string {
  const plan = (Array.isArray(action.multiattack) ? action.multiattack : []) as Component[];
  const nameOf = (id: string) => {
    const found = actions.find((candidate) => candidate.id === id);
    return typeof found?.name === "string" && found.name ? found.name.replace(/\s*\([^)]*\)$/, "") : id;
  };
  const clauses = plan.map((component) => {
    const count = COUNT_WORDS[component.count] ?? String(component.count);
    const names = [component.actionId, ...(component.or ?? [])].map(nameOf);
    if (names.length > 1)
      return `${count} attacks, using ${words(names).replace(/ and (?=[^,]*$)/, " or ")} in any combination`;
    const target = actions.find((candidate) => candidate.id === component.actionId);
    return target && kindOf(target) === "attack"
      ? `${count} ${names[0]} attack${component.count > 1 ? "s" : ""}`
      : `uses ${names[0]}${component.count > 1 ? " twice" : ""}`;
  });
  if (clauses.length === 0) return "";
  return `The ${creature} makes ${words(clauses)}.`.replace(" makes uses ", " uses ");
}

/** The text the answers give, or null for an action that is prose only. */
export function generatedText(
  action: MonsterAction,
  actions: readonly MonsterAction[],
  creature: string
): string | null {
  const kind = kindOf(action);
  const legendary = action.legendary ? "Legendary Action. " : "";
  const who = creature.trim().toLowerCase() || "monster";
  if (kind === "attack") return `${legendary}${attackText(action)}`;
  if (kind === "save") return `${legendary}${saveText(action, who)}`;
  if (kind === "multiattack") return multiattackText(action, actions, who);
  return null;
}

/** An edit to an action: its text follows the answers while it still says what the answers last gave (or nothing),
 *  and is the GM's own once they have changed it. */
export function editAction(
  before: MonsterAction,
  after: MonsterAction,
  actions: readonly MonsterAction[],
  creature: string
): MonsterAction {
  // A change to the text itself is the GM writing their own.
  if (after.description !== before.description) return after;
  const held = typeof before.description === "string" ? before.description : "";
  const was = generatedText(before, actions, creature);
  const now = generatedText(after, actions, creature);
  if (now === null) return after;
  return held.trim() === "" || held === was ? { ...after, description: now } : after;
}

/* ---------------------------------------------------------------- uses ---- */

export type Usage = "always" | "recharge-6" | "recharge-5" | "recharge-4" | "1-day" | "2-day" | "3-day";

export const USAGES: ReadonlyArray<Readonly<{ value: Usage; label: string }>> = [
  { value: "always", label: "Every turn" },
  { value: "recharge-5", label: "Recharge 5-6" },
  { value: "recharge-6", label: "Recharge 6" },
  { value: "recharge-4", label: "Recharge 4-6" },
  { value: "1-day", label: "1/Day" },
  { value: "2-day", label: "2/Day" },
  { value: "3-day", label: "3/Day" }
];

export function usageOf(action: MonsterAction): Usage {
  const uses = action.uses as Uses | undefined;
  if (!uses) return "always";
  if (uses.per === "recharge")
    return uses.recharge === 6 ? "recharge-6" : uses.recharge === 4 ? "recharge-4" : "recharge-5";
  if (uses.per === "long-rest" && uses.limit >= 1 && uses.limit <= 3) return `${uses.limit}-day` as Usage;
  return "always";
}

const SUFFIX = /\s*\((?:Recharge [0-9-]+|\d+\/Day)\)$/;

/** The uses and the name's printed suffix together: "Fire Breath (Recharge 5-6)", "Misty Step (3/Day)". A Long Rest
 *  is this table's day. */
export function withUsage(action: MonsterAction, usage: Usage): MonsterAction {
  const name = (typeof action.name === "string" ? action.name : "").replace(SUFFIX, "");
  const { uses: _old, ...rest } = action as Record<string, unknown>;
  if (usage === "always") return { ...rest, name };
  const label = USAGES.find((entry) => entry.value === usage)!.label;
  const uses: Uses = usage.startsWith("recharge")
    ? { limit: 1, per: "recharge", recharge: Number(usage.slice("recharge-".length)) }
    : { limit: Number(usage[0]), per: "long-rest" };
  return { ...rest, name: name ? `${name} (${label})` : name, uses };
}

/* ------------------------------------------------------------ suggestions ---- */

/** The SRD's arithmetic for a monster's attack: its Proficiency Bonus plus the ability it attacks with. */
export const attackBonusFor = (proficiency: number, modifier: number) => proficiency + modifier;
/** A monster's save DC: 8 plus its Proficiency Bonus plus the ability the effect uses. */
export const saveDcFor = (proficiency: number, modifier: number) => 8 + proficiency + modifier;

export const actionsOf = (draft: Draft): readonly MonsterAction[] =>
  Array.isArray(draft.actions) ? (draft.actions as MonsterAction[]) : [];

/** The record under a new name: every text the answers wrote ("The ogre makes...") follows it, and texts the GM
 *  wrote stay as written. */
export function withName(draft: Draft, name: string): Draft {
  const actions = actionsOf(draft);
  const before = typeof draft.name === "string" ? draft.name : "";
  return {
    ...draft,
    name,
    actions: actions.map((action) => {
      const held = typeof action.description === "string" ? action.description : "";
      const was = generatedText(action, actions, before);
      if (was === null || held !== was) return action;
      return { ...action, description: generatedText(action, actions, name) ?? held };
    })
  };
}
