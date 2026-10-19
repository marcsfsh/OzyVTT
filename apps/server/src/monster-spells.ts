import type { SpellReference } from "@vtt/content-srd-5.2.1";
import { abilityModifier } from "@vtt/rules-5e";
import type { ActorAction, ActorDefinition } from "@vtt/schemas";
import { castAreaOf, spellCastMechanics, upcastAction } from "./item-actions.js";

type CastsSpells = NonNullable<ActorAction["castsSpells"]>;
type Entry = CastsSpells["spells"][number];

/**
 * A stat block's spells as cast actions (`ActorAction.castsSpells`, read from its text when the bundle is built): each
 * entry of a Spellcasting list (or of an action that casts a choice of spells, Divine Aid) follows its action as a
 * cast action of its own, and an action that casts one spell (a legendary "uses Spellcasting to cast Fear", a 3/Day
 * Misty Step) becomes that cast. A cast carries the spell's attack, save, damage, healing and effects from its record
 * (`spellCastMechanics`, as an item's cast does), at the stat block's save DC and attack bonus and the printed level,
 * with no slot: an at-will spell has no limit, an "N/Day" one N uses a Long Rest gives back, and one from an action
 * with its own uses spends them. Applied as the catalog loads, so every reader (the action list, the resolver, the
 * economy's Multiattack places) sees the casts. A spell the catalog doesn't hold keeps a name-only cast.
 */
export function withMonsterSpells(
  definition: ActorDefinition,
  spellRecord: (spellId: string) => SpellReference | undefined
): ActorDefinition {
  if (!definition.actions.some((action) => action.castsSpells)) return definition;
  const taken = new Set(definition.actions.map((action) => action.id));
  const actions = definition.actions.flatMap((action): ActorAction[] => {
    const casts = action.castsSpells;
    if (!casts) return [action];
    if (casts.self) {
      const entry = casts.spells[0]!;
      return [{ ...action, ...castOf(entry, casts, spellRecord(entry.spellId), definition, action) }];
    }
    const children = casts.spells
      .filter((entry) => !taken.has(entry.id))
      .map((entry) => childCast(action, entry, casts, spellRecord(entry.spellId), definition));
    return [action, ...children];
  });
  return { ...definition, actions };
}

/** The name a cast of an entry goes by: the spell's, and the level when it isn't the spell's own ("Acid Arrow (level
 *  3)"). */
const castName = (entry: Entry, spell: SpellReference | undefined) =>
  `${spell?.name ?? entry.name}${entry.atLevel !== undefined && entry.atLevel !== spell?.level ? ` (level ${entry.atLevel})` : ""}`;

/** One entry of a list, cast as an action of its own with the list action's activation. */
function childCast(
  parent: ActorAction,
  entry: Entry,
  casts: CastsSpells,
  spell: SpellReference | undefined,
  definition: ActorDefinition
): ActorAction {
  const uses: ActorAction["uses"] =
    entry.perDay !== undefined
      ? { limit: entry.perDay, per: "long-rest" }
      : parent.uses
        ? { ...parent.uses, pool: parent.uses.pool ?? parent.id }
        : undefined;
  const base: ActorAction = {
    id: entry.id,
    name: castName(entry, spell).slice(0, 120),
    activation: parent.activation,
    description: (spell?.description ?? `${parent.name}: ${entry.name}.`).slice(0, 12000),
    damage: [],
    ...(uses ? { uses } : {}),
    // The stat block prints it inside its list, as SRD 5.2.1 does.
    partOf: parent.id
  };
  return { ...base, ...castOf(entry, casts, spell, definition, base) };
}

/** What casting the entry's spell does, from its record, at the stat block's numbers and the printed level. */
function castOf(
  entry: Entry,
  casts: CastsSpells,
  spell: SpellReference | undefined,
  definition: ActorDefinition,
  action: ActorAction
): Partial<ActorAction> {
  // Set even when the catalog can't resolve the spell, since riders gate on the id.
  if (!spell) return { spellId: entry.spellId };
  const mechanics = spellCastMechanics(spell, {
    attackBonus: casts.attackBonus,
    saveDc: casts.saveDc,
    bearersDc: false,
    modifier: abilityModifier(definition.abilityScores[casts.ability])
  });
  const grants =
    mechanics.grants && casts.grantTags
      ? { grants: { ...mechanics.grants, tags: [...new Set([...mechanics.grants.tags, ...casts.grantTags])] } }
      : {};
  const cast: ActorAction = {
    ...action,
    ...mechanics,
    ...grants,
    spellId: spell.id,
    ...castAreaOf(spell, mechanics),
    // A reaction spell's trigger rides a reaction's cast (Protective Magic's Counterspell), so the table offers it.
    ...(spell.effect?.reaction && action.activation === "reaction"
      ? { reaction: structuredClone(spell.effect.reaction) }
      : {})
  };
  const level = entry.atLevel ?? spell.level;
  const {
    id: _id,
    name: _name,
    activation: _activation,
    description: _description,
    ...rest
  } = level > spell.level ? upcastAction(cast, spell, level) : cast;
  return rest;
}
