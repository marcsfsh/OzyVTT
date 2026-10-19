import { ABILITY_NAMES } from "../ability-checks.js";
import { rollCheck } from "./builtins.js";
import type { ResolveContext } from "./context.js";

/**
 * An action that works only after its user succeeds on an ability check (SRD 5.2.1 Chain: "if you succeed on a DC 13
 * Strength (Athletics) check"; Manacles' DC 13 Dexterity (Sleight of Hand)). The check is rolled when the action is
 * committed; a failure spends the action and does nothing else. True when it failed.
 */
export function failsCheckFirst(ctx: ResolveContext): boolean {
  const { action, attacker, input } = ctx;
  const gate = action.checkFirst;
  if (!gate || input.commit === false || input.economyPaid === true) return false;
  const subject = { ability: gate.ability, ...(gate.skill !== undefined ? { skill: gate.skill } : {}) };
  if (rollCheck(ctx, subject, gate.dc, `${action.name}: check`) !== false) return false;
  ctx.tableNarration.push({
    kind: "effect",
    text: `${attacker.name} fails the DC ${gate.dc} ${ABILITY_NAMES[gate.ability]} check, so ${action.name} does nothing.`,
    actorIds: [attacker.id]
  });
  return true;
}
