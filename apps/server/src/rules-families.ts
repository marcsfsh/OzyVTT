import type { CombatState, GameState, RuleFamily, RuleMode } from "@vtt/domain";

/**
 * Which FAMILY each rule id the engine can throw belongs to, and what mode actually applies to it.
 *
 * The engine used to read one table-wide `combat.rulesMode` at five call sites, so "don't police
 * movement" was not expressible without also switching off the action economy. A GM relaxes rules a
 * family at a time; the per-turn override memory is keyed the same way, so one Allow stops the same
 * KIND of block re-prompting for the rest of that creature's turn (D9) instead of nagging per rule id.
 *
 * `familyOf` is deliberately total-with-a-null: an unrecognised rule id maps to `null` and falls back
 * to the dial rather than being silently swept into some family a GM has switched off. The totality
 * test (`test/rules-families.test.ts`) pins every id the codebase actually throws to a real family, so
 * `null` means "new rule id, nobody classified it yet" - and it fails safe.
 */

/** Exact rule ids that do not follow their own prefix (the prefix would put them in the wrong family). */
const EXACT: Readonly<Record<string, RuleFamily>> = {
  // Being incapacitated or down is an ACTION-ECONOMY block - you have no actions - not a condition
  // the targeting family should be able to switch off.
  "condition.incapacitated": "economy",
  "condition.down": "economy",
  // "Legendary actions are taken on other creatures' turns" is a timing/economy rule ...
  "legendary.own-turn": "economy",
  // ... while "no legendary actions left this round" is a spent resource, like limited uses.
  "legendary.no-actions-remaining": "resources",
  // Being Charmed by your target is a targeting restriction, not an economy one.
  "condition.charmed-charmer": "targeting"
};

/** Prefix rules, longest-first at lookup time so an EXACT entry always wins. */
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

/** The mode in force for one rule id. THE single reader - never read `combat.rulesMode` at a rule site. */
export function effectiveModeFor(combat: Pick<CombatState, "rulesMode" | "ruleExceptions">, rule: string): RuleMode {
  const family = familyOf(rule);
  return family === null ? combat.rulesMode : familyModeFor(combat, family);
}

/**
 * Did the GM already wave this KIND of block through on this turn? Prefers the per-family array;
 * falls back to the legacy boolean's two hardcoded prefixes so a turn persisted mid-fight by an older
 * build keeps behaving exactly as it did.
 */
export function overrideCovers(turn: CombatState["turn"], rule: string): boolean {
  const family = familyOf(rule);
  if (turn.rulesOverriddenFamilies !== undefined) return family !== null && turn.rulesOverriddenFamilies.includes(family);
  return turn.rulesOverridden === true && (rule.startsWith("economy.") || rule.startsWith("range."));
}

/**
 * Record a GM override so the same family stops re-prompting for the rest of this turn. Writes BOTH
 * shapes: the array is the truth, the boolean keeps an older build that reads only it behaving
 * sanely for the two families it knew about. Cleared with the rest of `turn` on turn advance.
 */
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

/** The audited reason for an override. D9 made the reason optional - one tap, never a mandatory modal. */
export function overrideReason(override: Readonly<{ reason?: string }> | null | undefined): string {
  return override?.reason?.trim() || "GM override";
}

export type { CombatLike };
