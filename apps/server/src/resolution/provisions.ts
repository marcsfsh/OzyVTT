import { addEffect, GOODBERRY_ID, GOODBERRY_TAG, makeEffect } from "../effects.js";
import { freshNourishment, needsOf } from "../survival.js";
import type { ResolveContext } from "./context.js";

/** "Ten berries appear in your hand." */
const BERRIES = 10;
/** The spell's 24 hours, after which "uneaten berries disappear". */
const BERRY_MINUTES = 24 * 60;

/**
 * What a cast lays out to eat and drink (SRD 5.2.1): Goodberry's ten berries in the caster's hand, which vanish when the
 * spell ends; Create Food and Water's 45 pounds of food and 30 gallons of water, which the characters eat and drink
 * from (`actor.nourish`); and Heroes' Feast, whose partakers have eaten and drunk their fill for the day.
 */
export function layOutProvisions(ctx: ResolveContext): void {
  const spellId = ctx.action.spellId;
  if (spellId === "goodberry") goodberries(ctx);
  else if (spellId === "create-food-and-water")
    ctx.tableNarration.push({
      kind: "effect",
      text: `${ctx.attacker.name} creates 45 pounds of food and 30 gallons of fresh water within 30 feet: a day's food for 45 Medium creatures and water for 30. The food spoils after 24 hours if uneaten.`,
      actorIds: [ctx.attacker.id]
    });
  else if (spellId === "heroes-feast") feast(ctx);
}

function goodberries(ctx: ResolveContext): void {
  const { state, attacker, deps } = ctx;
  const held = attacker.inventory.find((row) => (row.recordId ?? row.id) === GOODBERRY_ID);
  attacker.inventory = held
    ? attacker.inventory.map((row) =>
        row === held ? { ...row, quantity: Math.min(9999, row.quantity + BERRIES) } : row
      )
    : [
        ...attacker.inventory,
        {
          id: GOODBERRY_ID,
          name: "Goodberry",
          quantity: BERRIES,
          equipped: false,
          attuned: false,
          category: "consumable",
          description:
            "A creature can take a Bonus Action to eat one berry. Eating a berry restores 1 Hit Point, and the berry provides enough nourishment to sustain a creature for one day. Uneaten berries disappear when the spell ends."
        }
      ];
  // The berries last the spell's 24 hours on the clock.
  addEffect(
    state,
    attacker.id,
    makeEffect({
      id: `${ctx.input.commandId}:goodberry`,
      name: "Goodberry",
      tags: [GOODBERRY_TAG],
      sourceActorId: attacker.id,
      sourceName: attacker.name,
      sourceActionId: GOODBERRY_TAG,
      startedRound: state.combat.round,
      duration: { type: "minutes", remaining: BERRY_MINUTES }
    }),
    undefined,
    deps
  );
  ctx.tableNarration.push({
    kind: "effect",
    text: `Ten berries appear in ${attacker.name}'s hand.`,
    actorIds: [attacker.id]
  });
}

/** "Up to twelve creatures can partake of the feast": the caster and its targets have eaten and drunk their fill. */
function feast(ctx: ResolveContext): void {
  if (!ctx.state.rest.survival) return;
  const partakers = [ctx.attacker, ...ctx.targets.filter((target) => target.id !== ctx.attacker.id)].slice(0, 12);
  for (const creature of partakers) {
    if (creature.kind !== "player-character") continue;
    const need = needsOf(creature);
    creature.nourishment = {
      ...(creature.nourishment ?? freshNourishment()),
      foodPounds: need.food,
      waterPints: need.water,
      hungerLevels: 0,
      thirstLevels: 0
    };
  }
}
