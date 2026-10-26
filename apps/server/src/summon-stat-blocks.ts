import type { ActorAction, ActorDefinition, SummonCreature, SummonForm } from "@vtt/schemas";

/**
 * A summoned creature's stat block as it comes onto the map (SRD 5.2.1 summoned creatures): a spell-printed one scaled to
 * the level it was cast at and its summoner's numbers (`summonScaling`), in the form its summoner picked, and with the
 * creature type its summoner picked (a familiar is a Celestial, Fey or Fiend). Pure: the summon stores the result.
 */

/** What a scaled stat block reads from its summoner: its spell attack bonus, spell save DC, spellcasting ability
 *  modifier, Proficiency Bonus and Hit Point maximum. */
export type SummonerNumbers = Readonly<{
  attackBonus: number;
  saveDc: number;
  modifier: number;
  proficiencyBonus: number;
  hitPointMaximum?: number;
}>;

export type StatBlockPicks = Readonly<{
  /** The spell level it was summoned at; null for an action that casts no spell. */
  level: number | null;
  form?: string;
  creatureType?: string;
  /** The damage type of its `chosenDamageType` actions (a Draconic Spirit's Breath Weapon). */
  damageType?: string;
  /** How it differs from its stat block (a Phantom Steed's Speed of 100 feet). */
  except?: SummonCreature["except"];
}>;

const FOOTPRINT: Readonly<Record<ActorDefinition["size"], number>> = {
  tiny: 1,
  small: 1,
  medium: 1,
  large: 2,
  huge: 3,
  gargantuan: 4
};

/** The form a pick names, else the stat block's first. */
export function formOf(definition: ActorDefinition, formId: string | undefined): SummonForm | undefined {
  const forms = definition.summonScaling?.forms ?? [];
  return forms.find((form) => form.id === formId) ?? forms[0];
}

/** One die term plus at most one flat modifier ("1d6 + 4"), split; null for a formula of another shape. */
function parseFormula(formula: string): { count: number; die: number; flat: number } | null {
  const match = /^(\d+)d(\d+)(?:\s*([+-])\s*(\d+))?$/.exec(formula.trim());
  if (!match) return null;
  const flat = match[4] === undefined ? 0 : Number(match[4]) * (match[3] === "-" ? -1 : 1);
  return { count: Number(match[1]), die: Number(match[2]), flat };
}

function formulaOf(parts: { count: number; die: number; flat: number }): string {
  const base = `${parts.count}d${parts.die}`;
  if (parts.flat === 0) return base;
  return parts.flat > 0 ? `${base} + ${parts.flat}` : `${base} - ${-parts.flat}`;
}

/** A formula with `dice` more of its own die and `plus` more flat. */
function grown(formula: string, dice: number, plus: number): string {
  const parts = parseFormula(formula);
  if (!parts) return formula;
  return formulaOf({ count: Math.min(99, parts.count + dice), die: parts.die, flat: parts.flat + plus });
}

function scaledAction(
  action: ActorAction,
  definition: ActorDefinition,
  numbers: SummonerNumbers,
  picks: StatBlockPicks,
  form: SummonForm | undefined
): ActorAction {
  const scaling = definition.summonScaling!;
  const above = Math.max(0, (picks.level ?? scaling.baseLevel) - scaling.baseLevel);
  let next: ActorAction = { ...action };
  // Its attack rolls add its summoner's spell attack modifier, and its saves are at its summoner's spell save DC.
  if (next.attack) next = { ...next, attack: { ...next.attack, bonus: numbers.attackBonus } };
  if (next.save) next = { ...next, save: { ...next.save, dc: numbers.saveDc } };
  const formDamage = form?.damage?.find((entry) => entry.actionId === action.id);
  if (formDamage && next.damage.length > 0)
    next = {
      ...next,
      damage: next.damage.map((part, index) =>
        index === 0
          ? {
              ...part,
              formula: formDamage.addsModifier ? grown(formDamage.formula, 0, numbers.modifier) : formDamage.formula
            }
          : part
      )
    };
  const perLevel = scaling.perLevel?.find((entry) => entry.actionId === action.id);
  if (perLevel && above > 0) {
    const dice = (perLevel.dice ?? 0) * above;
    const plus = (perLevel.plus ?? 0) * above;
    if (next.damage.length > 0)
      next = {
        ...next,
        damage: next.damage.map((part, index) =>
          index === 0 ? { ...part, formula: grown(part.formula, dice, plus) } : part
        )
      };
    else if (next.healing)
      next = { ...next, healing: { ...next.healing, formula: grown(next.healing.formula, dice, plus) } };
  }
  // A form's damage type takes the place of its attacks' printed one (a Fey steed's Psychic Slam).
  if (form?.damageType && next.attack)
    next = {
      ...next,
      damage: next.damage.map((part, index) => (index === 0 ? { ...part, type: form.damageType! } : part))
    };
  if (picks.damageType && scaling.chosenDamageType?.includes(action.id))
    next = { ...next, damage: next.damage.map((part) => ({ ...part, type: picks.damageType! })) };
  const halves = scaling.halfLevelAttacks ?? [];
  if (next.multiattack && halves.length > 0 && picks.level !== null) {
    const count = Math.max(1, Math.min(6, Math.floor(picks.level / 2)));
    next = {
      ...next,
      multiattack: next.multiattack.map((part) => (halves.includes(part.actionId) ? { ...part, count } : part))
    };
  }
  return next;
}

/** The extension bag's printed facts with a creature type and speeds of its own. */
function withFacts(
  definition: ActorDefinition,
  creatureType: string | undefined,
  speeds: Readonly<Partial<Record<"fly" | "climb" | "swim", number>>>
): ActorDefinition["extensions"] {
  const printed = (definition.extensions["open5e.srd-2024"] ?? {}) as Record<string, unknown>;
  const printedSpeeds = (printed.speeds ?? {}) as Record<string, unknown>;
  return {
    ...definition.extensions,
    "open5e.srd-2024": {
      ...printed,
      ...(creatureType ? { type: creatureType } : {}),
      ...(Object.keys(speeds).length > 0 ? { speeds: { ...printedSpeeds, ...speeds } } : {})
    }
  };
}

/**
 * The stat block a summon brings: unchanged for a bundled one with nothing picked, otherwise a copy with the cast's
 * level, the summoner's numbers, the form and the creature type applied. Its `summonScaling` is dropped, since the copy
 * is no longer a template.
 */
export function summonedStatBlock(
  definition: ActorDefinition,
  numbers: SummonerNumbers,
  picks: StatBlockPicks
): ActorDefinition {
  const scaled = scaledStatBlock(definition, numbers, picks);
  return picks.except ? withExceptions(scaled, picks.except) : scaled;
}

/** "Uses the Riding Horse stat block, except it has a Speed of 100 feet": a copy with what the text changes. */
function withExceptions(definition: ActorDefinition, except: NonNullable<SummonCreature["except"]>): ActorDefinition {
  const dropped = new Set(except.withoutActions ?? []);
  const printed = (definition.extensions["open5e.srd-2024"] ?? {}) as Record<string, unknown>;
  const speeds = (printed.speeds ?? {}) as Record<string, unknown>;
  return {
    ...definition,
    ...(except.name ? { name: except.name } : {}),
    ...(except.speedFeet !== undefined ? { speedFeet: except.speedFeet } : {}),
    abilityScores: { ...definition.abilityScores, ...except.abilityScores },
    ...(except.conditionImmunities
      ? {
          conditionImmunities: [
            ...new Set([...(definition.conditionImmunities ?? []), ...except.conditionImmunities])
          ].slice(0, 20)
        }
      : {}),
    actions: definition.actions
      .filter((action) => !dropped.has(action.id))
      .map((action) =>
        action.multiattack
          ? { ...action, multiattack: action.multiattack.filter((part) => !dropped.has(part.actionId)) }
          : action
      ),
    extensions:
      except.speedFeet !== undefined || except.senses
        ? {
            ...definition.extensions,
            "open5e.srd-2024": {
              ...printed,
              ...(except.speedFeet !== undefined ? { speeds: { ...speeds, walk: except.speedFeet } } : {}),
              ...(except.senses ? { senses: [...printedSenseLines(printed), ...except.senses] } : {})
            }
          }
        : definition.extensions
  };
}

/** The senses a stat block prints, as their lines. */
function printedSenseLines(printed: Record<string, unknown>): string[] {
  return Array.isArray(printed.senses) ? printed.senses.filter((line): line is string => typeof line === "string") : [];
}

function scaledStatBlock(
  definition: ActorDefinition,
  numbers: SummonerNumbers,
  picks: StatBlockPicks
): ActorDefinition {
  const scaling = definition.summonScaling;
  if (!scaling) {
    if (!picks.creatureType) return definition;
    return { ...definition, extensions: withFacts(definition, picks.creatureType, {}) };
  }
  const { summonScaling: _template, ...rest } = definition;
  const form = formOf(definition, picks.form);
  const level = picks.level ?? scaling.baseLevel;
  const above = Math.max(0, level - scaling.baseLevel);
  const formOnly = new Set(scaling.formActions ?? []);
  const kept = new Set(form?.actions ?? []);
  const speeds: Partial<Record<"fly" | "climb" | "swim", number>> = { ...(form?.speeds ?? {}) };
  for (const row of scaling.speedsFrom ?? []) if (level >= row.level) speeds[row.mode] = row.feet;
  const size = form?.size ?? definition.size;
  const hitPoints =
    scaling.hitPointsOfSummoner && numbers.hitPointMaximum !== undefined
      ? numbers.hitPointMaximum
      : (form?.hitPoints ?? definition.hitPoints.maximum + above * (scaling.hitPointsPerLevel ?? 0));
  return {
    ...rest,
    name: form && (scaling.forms?.length ?? 0) > 1 ? `${definition.name} (${form.name})` : definition.name,
    size,
    token: { ...definition.token, footprint: { width: FOOTPRINT[size], height: FOOTPRINT[size] } },
    proficiencyBonus: numbers.proficiencyBonus,
    armorClass: Math.min(40, definition.armorClass + above * (scaling.armorClassPerLevel ?? 0)),
    hitPoints: { maximum: Math.max(1, hitPoints) },
    actions: definition.actions
      .filter((action) => !formOnly.has(action.id) || kept.has(action.id))
      .map((action) => scaledAction(action, definition, numbers, picks, form)),
    extensions: withFacts(definition, form?.creatureType ?? picks.creatureType, speeds)
  };
}
