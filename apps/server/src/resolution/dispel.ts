import { d20FacesFor } from "@vtt/rules-5e";
import { resolveSpellcasting, type AbilityId, type ActorDefinition } from "@vtt/schemas";
import { ABILITY_NAMES, checkPlan, totalCheck } from "../ability-checks.js";
import { CURSE_TAG, type EffectNarration } from "../effects.js";
import { breakCursedAttunement } from "../inventory.js";
import { endCursesOn, endSpellOn, endSpellZone, spellsOn } from "../spell-endings.js";
import { zoneContentOf } from "../spell-zone-state.js";
import { endedEffect, recordRoll, tableLineOf, type LiveActor, type ResolveContext } from "./context.js";

/**
 * Casts that end spells (SRD Dispel Magic) and curses (SRD Remove Curse) on their target, run when the cast is
 * committed. Dispel Magic: "Any ongoing spell of level 3 or lower on the target ends. For each ongoing spell of level
 * 4 or higher on the target, make an ability check using your spellcasting ability (DC 10 plus that spell's level)",
 * and a higher slot ends a spell of its level or lower outright. The target is one creature, or a spell area the GM
 * aims it at. Remove Curse: "all curses affecting one creature ... end", and its Attunement to a cursed item breaks.
 */
export function applySpellEndings(ctx: ResolveContext): void {
  const { action, input } = ctx;
  if ((!action.dispel && !action.endsCurses) || input.commit === false) return;
  const target = ctx.targets[0];
  if (ctx.targets.length > 1)
    ctx.warnings.push(`${action.name} affects one target: ${target!.name}. The others were left alone.`);
  if (action.dispel) dispel(ctx, action.dispel.automaticLevel, target);
  if (action.endsCurses && target) removeCurses(ctx, target);
}

/** The ability a caster's checks for this spell are made with: its casting class's, a stat block's Spellcasting, or the
 *  sheet's own. */
function spellcastingAbilityFor(definition: ActorDefinition | undefined, spellId: string | undefined): AbilityId {
  const casting = definition?.spellcasting;
  const classId = casting?.spells.find((entry) => entry.id === spellId)?.classId;
  const byClass = resolveSpellcasting(casting, classId)?.ability;
  if (byClass) return byClass;
  const statBlock = definition?.actions.find((entry) =>
    entry.castsSpells?.spells.some((spell) => spell.spellId === spellId)
  )?.castsSpells?.ability;
  return statBlock ?? casting?.ability ?? "int";
}

/** Whether a spell of `level` ends: outright at or below `automatic`, else on the caster's check against 10 + level. */
function ends(ctx: ResolveContext, level: number, automatic: number, spellName: string): boolean {
  if (level <= automatic) return true;
  const ability = spellcastingAbilityFor(ctx.deps.definition, ctx.action.spellId);
  const plan = checkPlan(ctx.attacker, ctx.deps.definition, ctx.derivation, { ability });
  const mode = plan.rollMode.mode;
  const roll = totalCheck(plan, d20FacesFor(mode, [], ctx.deps.random), mode, ctx.deps.random);
  const dc = 10 + level;
  recordRoll(ctx, roll.resolution, "check", `${ctx.action.name}: ${spellName}`, { total: roll.total });
  const success = roll.total >= dc;
  ctx.tableNarration.push({
    kind: "effect",
    text: `${ctx.attacker.name}'s ${ABILITY_NAMES[ability]} check against ${spellName} (DC ${dc}): ${roll.total}. ${success ? `${spellName} ends.` : `${spellName} holds.`}`,
    actorIds: [ctx.attacker.id]
  });
  return success;
}

function dispel(ctx: ResolveContext, printed: number, target: LiveActor | undefined): void {
  const { state, input, action } = ctx;
  // "You automatically end a spell on the target if the spell's level is equal to or less than the level of the spell
  // slot you use."
  const automatic = Math.max(printed, ctx.plan.castLevel ?? 0);
  const zone =
    input.zoneId !== undefined ? state.combat.spellZones.find((candidate) => candidate.id === input.zoneId) : undefined;
  if (input.zoneId !== undefined && !zone) ctx.warnings.push("That spell's area has already ended.");
  if (zone?.rule) {
    ctx.warnings.push(`${zone.name} is no spell, so ${action.name} leaves it.`);
    return;
  }
  // SRD Antimagic Field: "Dispel Magic has no effect on the aura".
  if (zone && zoneContentOf(zone, ctx.deps.catalog)?.trigger.antimagic) {
    ctx.warnings.push(`${action.name} has no effect on ${zone.name}.`);
    return;
  }
  if (zone) {
    if (ends(ctx, zone.level, automatic, zone.name)) narrate(ctx, endSpellZone(state, zone));
    return;
  }
  if (!target) {
    ctx.warnings.push(`${action.name} names no creature or spell area, so nothing ends.`);
    return;
  }
  const spells = spellsOn(target, ctx.deps.catalog);
  if (spells.length === 0) {
    ctx.tableNarration.push({
      kind: "effect",
      text: `No spell is on ${target.name} for ${action.name} to end.`,
      actorIds: [target.id]
    });
    return;
  }
  for (const spell of spells) {
    // "A Dispel Magic spell can end the spell only if it is cast with a level 9 spell slot" (Imprisonment).
    const floor = ctx.deps.catalog?.spellRecord?.(spell.spellId)?.effect?.dispelledFromSlot;
    if (floor !== undefined && (ctx.plan.castLevel ?? 0) < floor) {
      ctx.tableNarration.push({
        kind: "effect",
        text: `${spell.name} holds: only ${action.name} from a level ${floor} spell slot ends it.`,
        actorIds: [target.id]
      });
      continue;
    }
    if (!ends(ctx, spell.level, automatic, spell.name)) continue;
    for (const effectId of spell.effectIds) {
      const effect = target.effects.find((candidate) => candidate.id === effectId);
      if (effect) ctx.effectsEnded.push(endedEffect(target, effect));
    }
    narrate(ctx, endSpellOn(state, target.id, spell));
  }
}

function removeCurses(ctx: ResolveContext, target: LiveActor): void {
  const { state, deps } = ctx;
  for (const effect of target.effects.filter((candidate) => candidate.tags.includes(CURSE_TAG)))
    ctx.effectsEnded.push(endedEffect(target, effect));
  const ended = endCursesOn(state, target.id);
  narrate(ctx, ended);
  const definition =
    target.id === ctx.attacker.id
      ? deps.definition
      : target.definitionId
        ? deps.resolveDefinition?.(target.definitionId)
        : undefined;
  const items = breakCursedAttunement(target, definition, {
    ...(deps.catalog ? { catalog: deps.catalog } : {}),
    role: "gm"
  });
  for (const name of items)
    ctx.tableNarration.push({
      kind: "effect",
      text: `${target.name} is no longer attuned to ${name}. Its curse stays on the item, which can now be removed.`,
      actorIds: [target.id]
    });
  if (ended.length === 0 && items.length === 0)
    ctx.tableNarration.push({ kind: "effect", text: `No curse is on ${target.name}.`, actorIds: [target.id] });
}

function narrate(ctx: ResolveContext, events: readonly EffectNarration[]): void {
  for (const event of events) ctx.tableNarration.push(tableLineOf(ctx, event));
}
