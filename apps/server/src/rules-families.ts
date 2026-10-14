import type { CombatState, GameState, RuleFamily, RuleMode } from "@vtt/domain";

/**
 * Which family each rule id belongs to, and the mode that applies to it. GMs relax rules one family at
 * a time (movement without the action economy, say), and the per-turn override memory is keyed by
 * family, so one Allow stops that kind of block re-prompting for the rest of the turn.
 *
 * An unrecognised rule id maps to null and falls back to the table dial rather than being swept into a
 * family the GM switched off. A test pins every id the codebase throws to a real family.
 */

/** Exact rule ids that do not follow their own prefix (the prefix would put them in the wrong family). */
const EXACT: Readonly<Record<string, RuleFamily>> = {
  // Being incapacitated or down means you have no actions: an economy block, not a targeting one.
  "condition.incapacitated": "economy",
  "condition.down": "economy",
  // "Legendary actions are taken on other creatures' turns" is a timing/economy rule...
  "legendary.own-turn": "economy",
  // ...while "no legendary actions left this round" is a spent resource, like limited uses.
  "legendary.no-actions-remaining": "resources",
  // Being Charmed by your target is a targeting restriction, not an economy one.
  "condition.charmed-charmer": "targeting"
};

/** Prefix rules, longest-first at lookup time so an `EXACT` entry always wins. */
const PREFIXES: ReadonlyArray<readonly [prefix: string, family: RuleFamily]> = [
  ["movement.", "movement"],
  ["economy.", "economy"],
  ["feature.", "resources"],
  ["legendary.", "resources"],
  ["range.", "targeting"],
  ["target.", "targeting"],
  ["cover.", "targeting"],
  ["slots.", "slots"]
];

/** The family a rule id belongs to, or null when nothing has classified it (falls back to the dial). */
export function familyOf(rule: string): RuleFamily | null {
  const exact = EXACT[rule];
  if (exact) return exact;
  for (const [prefix, family] of PREFIXES) if (rule.startsWith(prefix)) return family;
  return null;
}

type CombatLike = Pick<CombatState, "rulesMode" | "ruleExceptions" | "turn">;

/** The mode in force for one family: its exception if the GM set one, otherwise this fight's dial. */
export function familyModeFor(combat: Pick<CombatState, "rulesMode" | "ruleExceptions">, family: RuleFamily): RuleMode {
  return combat.ruleExceptions[family] ?? combat.rulesMode;
}

/** The mode in force for one rule id. The single reader: never read `combat.rulesMode` at a rule site. */
export function effectiveModeFor(combat: Pick<CombatState, "rulesMode" | "ruleExceptions">, rule: string): RuleMode {
  const family = familyOf(rule);
  return family === null ? combat.rulesMode : familyModeFor(combat, family);
}

/** Whether the GM already allowed this kind of block this turn. Prefers the per-family array; falls back
 *  to the legacy boolean's two prefixes for turns persisted by an older build. */
export function overrideCovers(turn: CombatState["turn"], rule: string): boolean {
  const family = familyOf(rule);
  if (turn.rulesOverriddenFamilies !== undefined)
    return family !== null && turn.rulesOverriddenFamilies.includes(family);
  return turn.rulesOverridden === true && (rule.startsWith("economy.") || rule.startsWith("range."));
}

/** Records a GM override so the family stops re-prompting for the rest of this turn. Writes both the
 *  per-family array and the legacy boolean (for older builds). Cleared with `turn` on turn advance. */
export function rememberOverride(state: GameState, rule: string): void {
  const family = familyOf(rule);
  if (family === null) return;
  const existing = state.combat.turn.rulesOverriddenFamilies ?? [];
  if (existing.includes(family)) return;
  state.combat = {
    ...state.combat,
    turn: {
      ...state.combat.turn,
      rulesOverridden: true,
      rulesOverriddenFamilies: [...existing, family]
    }
  };
}

/** The audited reason for an override; optional, so an override is one tap. */
export function overrideReason(override: Readonly<{ reason?: string }> | null | undefined): string {
  return override?.reason?.trim() || "GM override";
}

export type { CombatLike };
