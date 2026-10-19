import type { SpellReference } from "@vtt/content-srd-5.2.1";
import type { ActionTableNarration } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { creatureTypeOf } from "../statblock-facts.js";
import type { DefinitionAction, LiveActor } from "./context.js";

/**
 * SRD 5.2.1 Spells, "Targets": "If you cast a spell on someone or something that can't be affected by the spell, nothing
 * happens to that target, but if you used a spell slot to cast the spell, the slot is still expended." A spell that
 * names the creature types it affects (Hold Person, Calm Emotions' area), and an item or feature that does (Holy Water,
 * Turn Undead), takes a creature of another type as its target: the cast or use goes ahead and is spent, and that
 * target is left out of what it does. The player hears only that nothing happened to it, so a disguised creature's
 * type stays hidden; the GM's line names the type. A type the stat block doesn't print counts as affected.
 */

export type TypeGated = Readonly<{
  /** The targets the action affects. */
  affected: LiveActor[];
  /** A sentence for each target left out, naming no creature type, for whoever used the action. */
  warnings: string[];
  /** The GM's line for each target left out, naming its type. */
  gmLines: ActionTableNarration[];
}>;

const titled = (type: string) => `${type[0]!.toUpperCase()}${type.slice(1)}`;
/** A creature type as a plural ("Fiends", "Undead", "Monstrosities"). */
const plural = (type: string) =>
  type === "undead" || type === "fey"
    ? titled(type)
    : type.endsWith("y")
      ? `${titled(type).slice(0, -1)}ies`
      : `${titled(type)}s`;

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

/** Splits an action's targets into the ones its creature types let it affect and the ones it leaves untouched. */
export function typeGated(
  input: Readonly<{
    action: DefinitionAction;
    spell: SpellReference | undefined;
    targets: readonly LiveActor[];
    resolveDefinition: ((definitionId: string) => ActorDefinition | undefined) | undefined;
    /** Whether the user's player may not know of the creature, which then goes unnamed to them. */
    hidden: (actorId: string) => boolean;
  }>
): TypeGated {
  const rules = typeRules(input.action, input.spell);
  // An attack resolves against its one target, so an attack's types are checked as it is aimed (`action-targets.ts`).
  if (!rules || !input.resolveDefinition || input.action.attack !== undefined)
    return { affected: [...input.targets], warnings: [], gmLines: [] };
  const affected: LiveActor[] = [];
  const warnings: string[] = [];
  const gmLines: ActionTableNarration[] = [];
  for (const target of input.targets) {
    const definition = target.definitionId ? input.resolveDefinition(target.definitionId) : undefined;
    const type = creatureTypeOf(target, definition);
    const outside =
      type !== null && ((rules.only !== undefined && !rules.only.includes(type)) || rules.not?.includes(type) === true);
    if (!outside) {
      affected.push(target);
      continue;
    }
    if (!input.hidden(target.id)) warnings.push(`${input.action.name} has no effect on ${target.name}.`);
    gmLines.push({
      kind: "effect",
      text: `${target.name} is ${/^[aeiou]/.test(type!) ? "an" : "a"} ${titled(type!)}, and ${input.action.name} ${
        rules.only ? `affects only ${rules.only.map(plural).join(" or ")}` : `has no effect on ${plural(type!)}`
      }, so nothing happens to it.`,
      actorIds: [target.id],
      gmOnly: true
    });
  }
  return { affected, warnings, gmLines };
}
