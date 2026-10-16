import type { CombatState, GameState, RuleFamily, RuleMode } from "@vtt/domain";

/**
 * Every rule id the engine can raise, and the family a GM relaxes it under. GMs relax rules one family
 * at a time (movement without the action economy, say), and the per-turn override memory is keyed by
 * family, so one Allow stops that kind of block re-prompting for the rest of the turn. A new rule needs
 * an entry here before anything can raise it.
 */
const RULE_FAMILIES = {
  "movement.exceeds-speed": "movement",
  "movement.no-movement-remaining": "movement",
  "movement.stand-up-cost": "movement",
  "economy.action-used": "economy",
  "economy.bonus-action-used": "economy",
  "economy.reaction-used": "economy",
  "economy.not-your-turn": "economy",
  // Being incapacitated or down means you have no actions: an economy block, not a targeting one.
  "condition.incapacitated": "economy",
  "condition.down": "economy",
  // "Legendary actions are taken on other creatures' turns" is a timing/economy rule...
  "legendary.own-turn": "economy",
  // An extra attack (Light, Cleave) is owed only once the swing that opens it has happened this turn.
  "attack.light-needs-attack": "economy",
  "attack.cleave-needs-hit": "economy",
  // ...while "no legendary actions left this round" is a spent resource, like limited uses.
  "legendary.no-actions-remaining": "resources",
  "feature.no-uses-remaining": "resources",
  "feature.requires-effect": "resources",
  "range.out-of-range": "targeting",
  "range.out-of-reach": "targeting",
  "range.underwater": "targeting",
  "target.grappled-by-source": "targeting",
  "target.too-large-to-grapple": "targeting",
  "cover.total": "targeting",
  // Cleave's second creature: another one, within 5 feet of the first.
  "attack.cleave-same-target": "targeting",
  "attack.cleave-too-far": "targeting",
  // Being Charmed by your target is a targeting restriction, not an economy one.
  "condition.charmed-charmer": "targeting",
  // Spell slots are their own family, so "Don't police spell slots" relaxes these and nothing else.
  "slots.none-remaining": "slots",
  "slots.below-spell-level": "slots",
  "slots.one-per-turn": "slots"
} as const satisfies Record<string, RuleFamily>;

export type RuleId = keyof typeof RULE_FAMILIES;

export const RULE_IDS = Object.keys(RULE_FAMILIES) as readonly RuleId[];

export function familyOf(rule: RuleId): RuleFamily {
  return RULE_FAMILIES[rule];
}

/** The mode in force for one family: its exception if the GM set one, otherwise this fight's dial. */
export function familyModeFor(combat: Pick<CombatState, "rulesMode" | "ruleExceptions">, family: RuleFamily): RuleMode {
  return combat.ruleExceptions[family] ?? combat.rulesMode;
}

/** The mode in force for one rule id. The single reader: never read `combat.rulesMode` at a rule site. */
export function effectiveModeFor(combat: Pick<CombatState, "rulesMode" | "ruleExceptions">, rule: RuleId): RuleMode {
  return familyModeFor(combat, familyOf(rule));
}

/** Whether the GM already allowed this kind of block this turn. */
export function overrideCovers(turn: CombatState["turn"], rule: RuleId): boolean {
  return turn.rulesOverriddenFamilies?.includes(familyOf(rule)) ?? false;
}

/** A GM override as a command carries it. `families` names the kinds of block it waives (an Allow names the one
 *  the GM was asked about); absent, it is the GM's own ruling on the command and waives every block. */
export type RulesOverride = Readonly<{ reason?: string; families?: readonly RuleFamily[] }>;

/** Whether an override waives a block of this rule: only one of a family it names, so allowing one kind of block
 *  never waves another through. */
export function overrideWaives(override: RulesOverride | null | undefined, rule: RuleId): boolean {
  if (!override) return false;
  return override.families === undefined || override.families.includes(familyOf(rule));
}

/** Records a GM override so the family stops re-prompting for the rest of this turn. Cleared with `turn`
 *  on turn advance. */
export function rememberOverride(state: GameState, rule: RuleId, override?: RulesOverride | null): void {
  const existing = state.combat.turn.rulesOverriddenFamilies ?? [];
  const families = [familyOf(rule), ...(override?.families ?? [])].filter(
    (family, index, all) => !existing.includes(family) && all.indexOf(family) === index
  );
  if (families.length === 0) return;
  state.combat = {
    ...state.combat,
    turn: { ...state.combat.turn, rulesOverriddenFamilies: [...existing, ...families] }
  };
}

/** The audited reason for an override; optional, so an override is one tap. */
export function overrideReason(override: RulesOverride | null | undefined): string {
  return override?.reason?.trim() || "GM override";
}
