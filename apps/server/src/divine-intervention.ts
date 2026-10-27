import type { Actor } from "@vtt/domain";
import { abilityModifier, parseDiceFormula, resolveDice } from "@vtt/rules-5e";
import type { ActorAction, ActorDefinition } from "@vtt/schemas";
import type { EffectNarration } from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { castAreaOf, spellCastMechanics } from "./item-actions.js";
import { tableLineOf, type ResolveContext } from "./resolution/context.js";
import { hasClassFeature } from "./ritual-adept.js";

/**
 * SRD 5.2.1 Cleric, Divine Intervention: "As a Magic action, choose any Cleric spell of level 5 or lower that doesn't
 * require a Reaction to cast. As part of the same action, you cast that spell without expending a spell slot or
 * needing Material components. You can't use this feature again until you finish a Long Rest." Greater Divine
 * Intervention: "you can choose Wish when you select a spell. If you do so, you can't use Divine Intervention again
 * until you finish 2d4 long rests."
 *
 * Each spell it may cast is an action of its own (`divine-intervention-<spell>`), minted at the Cleric's numbers like
 * a Ritual Adept's book rituals, cast at once whatever its casting time, on Divine Intervention's one use.
 */

const PREFIX = "divine-intervention-";
/** The use pool every Divine Intervention cast spends: the feature's own action's. */
export const DIVINE_INTERVENTION_POOL = "divine-intervention";
/** The Long Rests still to finish before Divine Intervention comes back, after a Wish. */
export const DIVINE_RESTS_KEY = "divine-intervention:rests-left";

export const divineCastId = (spellId: string) => `${PREFIX}${spellId}`;
/** Whether an action is a spell cast through Divine Intervention, which needs no Material components. */
export const isDivineCast = (actionId: string) => actionId.startsWith(PREFIX);

const minted = new WeakMap<ActorDefinition, WeakMap<object, readonly ActorAction[]>>();

/** The casts Divine Intervention offers this Cleric: every Cleric spell of level 5 or lower that isn't cast with a
 *  Reaction, and Wish with Greater Divine Intervention. Empty without the feature or the catalog's spell list. */
export function divineInterventionCasts(
  definition: ActorDefinition | undefined,
  catalog: EquipmentCatalog | undefined
): readonly ActorAction[] {
  if (!definition || !catalog?.spellSummaries || !catalog.spellRecord) return [];
  if (!hasClassFeature(definition, "divine-intervention", "cleric")) return [];
  // Minted once for a sheet and a spell list: the list is the same array while the content is unchanged.
  const summaries = catalog.spellSummaries();
  const byCatalog = minted.get(definition) ?? new WeakMap<object, readonly ActorAction[]>();
  minted.set(definition, byCatalog);
  const known = byCatalog.get(summaries);
  if (known) return known;
  const casting = definition.spellcasting;
  const cleric = casting?.classes?.find((entry) => entry.classId === "cleric") ?? casting;
  if (!casting || !cleric) return [];
  const numbers = {
    attackBonus: cleric.attackBonus ?? casting.attackBonus ?? 0,
    saveDc: cleric.saveDc ?? casting.saveDc ?? 10,
    bearersDc: true,
    modifier: abilityModifier(definition.abilityScores[cleric.ability])
  };
  const listId = catalog.classRecord?.("cleric")?.spellcasting?.spellListId ?? "cleric";
  const greater = hasClassFeature(definition, "greater-divine-intervention", "cleric");
  const feature = definition.actions.find((action) => action.id === DIVINE_INTERVENTION_POOL);
  const uses: NonNullable<ActorAction["uses"]> = {
    ...(feature?.uses ?? { limit: 1, per: "long-rest" }),
    pool: DIVINE_INTERVENTION_POOL
  };
  const casts = summaries
    .filter(
      (summary) =>
        (summary.classes.includes(listId) && summary.level <= 5 && !/^reaction\b/i.test(summary.castingTime.trim())) ||
        (greater && summary.id === "wish")
    )
    .flatMap((summary) => {
      const spell = catalog.spellRecord!(summary.id);
      if (!spell) return [];
      const mechanics = spellCastMechanics(spell, numbers);
      return [
        {
          id: divineCastId(spell.id),
          name: `${spell.name} (Divine Intervention)`,
          activation: "action",
          description: spell.description.slice(0, 12000),
          ...mechanics,
          ...castAreaOf(spell, mechanics),
          // "As part of the same action": cast at once, whatever its casting time.
          castsAtOnce: true,
          uses,
          spellId: spell.id
        } as ActorAction
      ];
    });
  byCatalog.set(summaries, casts);
  return casts;
}

/** Greater Divine Intervention's Wish: Divine Intervention waits 2d4 Long Rests, rolled by the server as it is cast. */
export function afterDivineWish(ctx: ResolveContext): void {
  const { action, attacker, input, deps } = ctx;
  if (action.id !== divineCastId("wish") || input.commit === false) return;
  const rests = Math.max(1, resolveDice(parseDiceFormula("2d4"), deps.random).total);
  attacker.actionUses = { ...attacker.actionUses, [DIVINE_RESTS_KEY]: rests };
  const line: EffectNarration = {
    kind: "effect",
    text: `${attacker.name} can't use Divine Intervention again until finishing ${rests} Long Rests.`,
    actorId: attacker.id
  };
  ctx.tableNarration.push(tableLineOf(ctx, line));
}

/** What a Long Rest keeps spent after a Wish: Divine Intervention's use and the count, one rest fewer, until the last
 *  of them. */
export function divineInterventionWaiting(actor: Pick<Actor, "actionUses">): Record<string, number> {
  const left = actor.actionUses[DIVINE_RESTS_KEY] ?? 0;
  if (left <= 1) return {};
  return {
    [DIVINE_RESTS_KEY]: left - 1,
    [DIVINE_INTERVENTION_POOL]: Math.max(1, actor.actionUses[DIVINE_INTERVENTION_POOL] ?? 1)
  };
}
