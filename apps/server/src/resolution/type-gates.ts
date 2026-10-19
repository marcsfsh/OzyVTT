import type { SpellReference } from "@vtt/content-srd-5.2.1";
import type { ActionTableNarration, GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import type { EquipmentCatalog } from "../equipment-derivation.js";
import { liveAbilityScores } from "../live-abilities.js";
import { creatureTypeOf } from "../statblock-facts.js";
import type { DefinitionAction, LiveActor } from "./context.js";
import { spellWardOf } from "./spell-wards.js";

/**
 * SRD 5.2.1 Spells, "Targets": "If you cast a spell on someone or something that can't be affected by the spell, nothing
 * happens to that target, but if you used a spell slot to cast the spell, the slot is still expended." A spell that
 * names the creature types it affects (Hold Person, Calm Emotions' area) or the most an ability score may be (Awaken's
 * Intelligence of 3), and an item or feature that names creature types (Holy Water, Turn Undead), takes a creature it
 * can't affect as its target: the cast or use goes ahead and is spent, and that target is left out of what it does. The
 * player hears only that nothing happened to it, so a disguised creature's type stays hidden; the GM's line says why. A
 * type the stat block doesn't print counts as affected. A placed area leaves out, the same way, a creature a ward keeps
 * the spell from (`spell-wards.ts`); a picked target with a ward is refused as it is aimed.
 */

export type TypeGated = Readonly<{
  /** The targets the action affects. */
  affected: LiveActor[];
  /** A sentence for each target left out, naming no creature type, for whoever used the action. */
  warnings: string[];
  /** The GM's line for each target left out, saying why. */
  gmLines: ActionTableNarration[];
}>;

const titled = (word: string) => `${word[0]!.toUpperCase()}${word.slice(1)}`;
/** A creature type as a plural ("Fiends", "Undead", "Monstrosities"). */
const plural = (type: string) =>
  type === "undead" || type === "fey"
    ? titled(type)
    : type.endsWith("y")
      ? `${titled(type).slice(0, -1)}ies`
      : `${titled(type)}s`;
const ABILITY_NAMES: Readonly<Record<string, string>> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma"
};

/** The creature types an action affects and the ones it doesn't, from its spell or its own `targets`. */
function typeRules(
  action: DefinitionAction,
  spell: SpellReference | undefined
): Readonly<{ only?: readonly string[]; not?: readonly string[] }> | null {
  const only = spell?.effect?.targetTypes ?? action.targets?.creatureTypes;
  const not = action.targets?.notCreatureTypes;
  if (!only && !not) return null;
  return { ...(only ? { only } : {}), ...(not ? { not } : {}) };
}

/** Why the action can't affect this target, in the GM's words, or null when it can. */
function unaffectedBecause(
  input: Parameters<typeof typeGated>[0],
  target: LiveActor,
  rules: ReturnType<typeof typeRules>
): string | null {
  const { action, spell } = input;
  const definition = target.definitionId ? input.resolveDefinition?.(target.definitionId) : undefined;
  const type = rules ? creatureTypeOf(target, definition) : null;
  if (type !== null && rules) {
    if (rules.only && !rules.only.includes(type))
      return `${target.name} is ${/^[aeiou]/.test(type) ? "an" : "a"} ${titled(type)}, and ${action.name} affects only ${rules.only.map(plural).join(" or ")}`;
    if (rules.not?.includes(type))
      return `${target.name} is ${/^[aeiou]/.test(type) ? "an" : "a"} ${titled(type)}, and ${action.name} has no effect on ${plural(type)}`;
  }
  const cap = spell?.effect?.targetAbilityMax;
  if (cap && definition) {
    const score = liveAbilityScores(target, definition, input.catalog)[cap.ability];
    if (score > cap.score)
      return `${target.name}'s ${ABILITY_NAMES[cap.ability]} is ${score}, and ${action.name} affects only a creature with ${cap.score} or less`;
  }
  if (spell && input.areaPlaced) {
    const ward = spellWardOf(input.state, target, spell, input.casterId, input);
    if (ward !== null) return `${ward} keeps ${action.name} from ${target.name}`;
  }
  return null;
}

/** Splits an action's targets into the ones it can affect and the ones it leaves untouched. */
export function typeGated(
  input: Readonly<{
    state: GameState;
    casterId: string;
    action: DefinitionAction;
    spell: SpellReference | undefined;
    targets: readonly LiveActor[];
    /** The targets are whoever a placed area covers. */
    areaPlaced: boolean;
    resolveDefinition: ((definitionId: string) => ActorDefinition | undefined) | undefined;
    catalog: EquipmentCatalog | undefined;
    /** Whether the user's player may not know of the creature, which then goes unnamed to them. */
    hidden: (actorId: string) => boolean;
  }>
): TypeGated {
  const rules = typeRules(input.action, input.spell);
  const gates = rules !== null || input.spell?.effect?.targetAbilityMax !== undefined || input.areaPlaced;
  // An attack resolves against its one target, so an attack's types are checked as it is aimed (`action-targets.ts`).
  if (!gates || !input.resolveDefinition || input.action.attack !== undefined)
    return { affected: [...input.targets], warnings: [], gmLines: [] };
  const affected: LiveActor[] = [];
  const warnings: string[] = [];
  const gmLines: ActionTableNarration[] = [];
  for (const target of input.targets) {
    const because = unaffectedBecause(input, target, rules);
    if (because === null) {
      affected.push(target);
      continue;
    }
    if (!input.hidden(target.id)) warnings.push(`${input.action.name} has no effect on ${target.name}.`);
    gmLines.push({
      kind: "effect",
      text: `${because}, so nothing happens to it.`,
      actorIds: [target.id],
      gmOnly: true
    });
  }
  return { affected, warnings, gmLines };
}
