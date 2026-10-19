import { abilityModifier } from "@vtt/rules-5e";
import { resolveSpellcasting, type Summon } from "@vtt/schemas";
import { laterRowOf } from "../item-actions.js";
import type { SummonerNumbers } from "../summon-stat-blocks.js";
import { spellEffectDuration, spellOf } from "./concentration.js";
import { tableLineOf, type ResolveContext } from "./context.js";

/**
 * An action that brings creatures onto the map (`summons.ts`): Summon Dragon, Animate Dead, an elemental from a bowl.
 * The cast's level, its Concentration and the user's spellcasting numbers go with the request, and what came is told to
 * the table. A sheet made before cast actions carried their summons reads the spell's own.
 */

/** The summon an action brings: its own, or the spell's (a sheet made before casts carried it). A spell's later action
 *  (Spiritual Weapon's attack) brings nothing. */
export function summonOf(ctx: Pick<ResolveContext, "action" | "deps">): Summon | undefined {
  if (ctx.action.summons) return ctx.action.summons;
  const spell = spellOf(ctx);
  if (!spell || laterRowOf(spell, ctx.action.id) !== undefined) return undefined;
  return spell.effect?.summons;
}

/** "Whenever you start casting the spell, you can modify it so that it doesn't require Concentration" (a Draconic
 *  Sorcerer's Dragon Companion): picked at the cast, where the cast's summons allow it. */
export function castWithoutConcentration(ctx: Pick<ResolveContext, "action" | "deps" | "input">): boolean {
  return ctx.input.summon?.withoutConcentration === true && summonOf(ctx)?.concentrationOptional === true;
}

/** The user's spell attack bonus, spell save DC, spellcasting ability modifier and Proficiency Bonus: the cast's own
 *  numbers when the action carries them, else its sheet's. */
function summonerNumbers(ctx: ResolveContext, summon: Summon): SummonerNumbers {
  const definition = ctx.deps.definition;
  const proficiencyBonus = definition?.proficiencyBonus ?? 2;
  if (summon.numbers) return { ...summon.numbers, proficiencyBonus };
  const casting = resolveSpellcasting(definition?.spellcasting);
  const modifier = casting && definition ? abilityModifier(definition.abilityScores[casting.ability]) : 0;
  return {
    attackBonus: casting?.attackBonus ?? proficiencyBonus + modifier,
    saveDc: casting?.saveDc ?? 8 + proficiencyBonus + modifier,
    modifier,
    proficiencyBonus
  };
}

export function applySummons(ctx: ResolveContext): void {
  const summon = summonOf(ctx);
  if (!summon) return;
  const { action, attacker, input, deps } = ctx;
  const spell = spellOf(ctx);
  if (!deps.summon) {
    ctx.warnings.push(
      `Place ${spell?.name ?? action.name}'s creatures on the map: the server had no map to place them on.`
    );
    return;
  }
  const level = spell ? (ctx.plan.castLevel ?? spell.level) : null;
  const outcome = deps.summon({
    userId: attacker.id,
    summon,
    action: { id: action.id, name: action.name },
    ...(spell && level !== null
      ? {
          spell: { id: spell.id, name: spell.name, level, printedLevel: spell.level },
          // Cast without Concentration (Dragon Companion), "the spell's duration becomes 1 minute for that casting".
          spellDuration: castWithoutConcentration(ctx)
            ? { type: "rounds" as const, remaining: 10 }
            : spellEffectDuration(spell, level)
        }
      : {}),
    castId: ctx.castId,
    commandId: input.commandId,
    corpseIds: summon.fromCorpse ? ctx.targets.map((target) => target.id) : [],
    choice: input.summon ?? {},
    numbers: summonerNumbers(ctx, summon)
  });
  for (const event of outcome.events) ctx.tableNarration.push(tableLineOf(ctx, event));
  ctx.summoned = outcome.created.map((entry) => ({ actorId: entry.id, name: entry.name }));
}
