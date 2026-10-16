import { abilityModifier } from "@vtt/rules-5e";
import type { Modifier } from "@vtt/schemas";
import { addEffect, makeEffect, type EffectNarration } from "../effects.js";
import { deriveEquipment } from "../equipment-derivation.js";
import { currentSpeedFeet } from "../speed.js";
import type { LiveActor, ResolveContext } from "./context.js";

/** A grant keyed on these tags measures its recipient when it lands, as Dash does: Mage Armor's AC, Haste's Speed. */
const MAGE_ARMOR_TAG = "mage-armor";
const HASTED_TAG = "hasted";

/** Granted effects (Rage, Reckless Attack on self; Help on an ally; Bless on each creature it targets): replace-on-
 *  refresh, ending when the granter drops to 0 HP. An `onHit` grant (Guiding Bolt) lands only on a hit. */
export function applyGrant(ctx: ResolveContext): void {
  const { action, attacker, targets, attack } = ctx;
  const grant = action.grants;
  if (!grant) return;
  if (grant.onHit && (attack === null || (attack.outcome !== "hit" && attack.outcome !== "crit"))) return;
  const recipients =
    grant.target === "targets" ? targets : grant.target === "target" ? targets.slice(0, 1) : [attacker];
  for (const recipient of recipients) grantTo(ctx, recipient);
}

function grantTo(ctx: ResolveContext, recipient: LiveActor): void {
  const { state, action, attacker, input, deps, warnings } = ctx;
  const grant = action.grants!;
  // A concentration grant may end the granter's previous concentration; surfaced as a warning line.
  const replaced: EffectNarration[] = [];
  const recipientDefinition =
    recipient.id === attacker.id
      ? deps.definition
      : recipient.definitionId
        ? deps.resolveDefinition?.(recipient.definitionId)
        : undefined;
  const derivation = deriveEquipment(recipient, recipientDefinition, deps.catalog);
  // Dash grants a quantity measured now, so a later Slow this turn doesn't shrink it. Keyed on the
  // `dashing` tag so homebrew actions match.
  const grantedMovement = grant.tags.includes("dashing")
    ? { movementGrantFeet: currentSpeedFeet(recipient, derivation) ?? 0 }
    : {};
  // Haste doubles Speed: the creature's Speed now, added while it lasts.
  const speedNow = grant.tags.includes(HASTED_TAG) ? (currentSpeedFeet(recipient, derivation) ?? 0) : 0;
  const hasteSpeed: Modifier[] = speedNow > 0 ? [{ type: "speed", amount: Math.min(60, speedNow) }] : [];
  // Mage Armor: base AC 13 + Dexterity for a creature wearing no armor, a shield still adding to it.
  let armorClassBonus = grant.armorClassBonus;
  if (grant.tags.includes(MAGE_ARMOR_TAG)) {
    if (derivation.context.armorWeight != null) {
      warnings.push(`${recipient.name} is wearing armor, so Mage Armor does nothing.`);
      return;
    }
    const mageArmor =
      13 + abilityModifier(recipientDefinition?.abilityScores.dex ?? 10) + (derivation.context.shieldEquipped ? 2 : 0);
    const gain = mageArmor - (recipient.armorClass ?? mageArmor);
    armorClassBonus = gain > 0 ? Math.min(10, gain) : undefined;
  }
  const effect = addEffect(
    state,
    recipient.id,
    makeEffect({
      id: grant.target === "targets" ? `${input.commandId}:grant:${recipient.id}` : `${input.commandId}:grant`,
      name: ctx.builtin?.grantName?.(ctx) ?? grant.name ?? action.name,
      tags: grant.tags,
      sourceActorId: attacker.id,
      sourceName: attacker.name,
      sourceActionId: action.id,
      startedRound: state.combat.round,
      duration:
        grant.duration.type === "rounds" ? { type: "rounds", remaining: grant.duration.rounds } : grant.duration,
      endsWhenSourceDefeated: true,
      voidWhileIncapacitated: grant.voidWhileIncapacitated,
      modifiers: [...grant.modifiers, ...hasteSpeed],
      onEnd: grant.onEnd,
      endsWithTag: grant.endsWithTag ?? null,
      concentration: grant.concentration,
      // SRD Combining Game Effects: one spell's effects on a creature don't add up (two Blesses give one d4).
      ...(action.spellId !== undefined ? { stackKey: `spell:${action.spellId}` } : {}),
      ...(armorClassBonus !== undefined ? { armorClassBonus } : {}),
      ...grantedMovement
    }),
    replaced,
    deps
  );
  warnings.push(...replaced.map((event) => event.text));
  if (recipient.id !== attacker.id || grant.target !== "self")
    ctx.effectsApplied.push({
      targetId: recipient.id,
      targetName: recipient.name,
      name: effect.name,
      conditionIds: []
    });
  else ctx.effectGranted = { name: effect.name, tags: effect.tags };
}
