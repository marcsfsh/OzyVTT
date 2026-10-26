import type { Actor, GameState } from "@vtt/domain";
import { abilityModifier } from "@vtt/rules-5e";
import { catalogIdOf, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
import { holdsFeature, picksFor } from "./class-features.js";
import { endEffect, type EffectNarration } from "./effects.js";
import { CommandRejectedError } from "./game-store.js";

/**
 * SRD 5.2.1 Pact of the Tome: "you conjure forth a book in your hand at the end of a Short or Long Rest ... the book
 * disappears if you conjure another book with this feature ... While the book is on your person, you have the chosen
 * spells prepared ... You can use the book as a Spellcasting Focus." The book is a row in the Warlock's gear, so
 * dropping it or handing it over is an ordinary gear change, and the spells follow it.
 */

export const BOOK_OF_SHADOWS_ID = "book-of-shadows";
const FEATURE_ID = "pact-of-the-tome";
/** A name written on the page Gift of the Protectors adds to the book: an effect on the named creature, from the
 *  Warlock. */
export const GIFT_OF_THE_PROTECTORS_TAG = "gift-of-the-protectors";
/** The Warlock's once-per-Long-Rest use of the page, the pool of the sheet's counter action. */
export const GIFT_OF_THE_PROTECTORS_POOL = "gift-of-the-protectors-page";

/** Whether the sheet has Pact of the Tome. */
export const holdsPactOfTheTome = (definition: ActorDefinition | undefined): boolean =>
  holdsFeature(definition, FEATURE_ID, "Pact of the Tome");

/** Whether a Book of Shadows is in this gear. */
export const carriesBookOfShadows = (inventory: readonly InventoryItem[]): boolean =>
  inventory.some((row) => catalogIdOf(row) === BOOK_OF_SHADOWS_ID && row.quantity > 0);

/** The spells the book holds: the three cantrips and two rituals picked for it. */
export function bookSpellIds(definition: ActorDefinition | undefined): ReadonlySet<string> {
  return new Set([...picksFor(definition, FEATURE_ID, "cantrip"), ...picksFor(definition, FEATURE_ID, "spell")]);
}

/** Why a spell can't be cast for want of the book, or null: it isn't one of the book's, or the book is carried. */
export function bookOfShadowsGap(
  actor: Pick<Actor, "name"> & Partial<Pick<Actor, "inventory">>,
  spell: Readonly<{ id: string; name: string }>,
  definition: ActorDefinition | undefined
): string | null {
  if (!bookSpellIds(definition).has(spell.id) || carriesBookOfShadows(actor.inventory ?? [])) return null;
  return `${spell.name} is prepared from ${actor.name}'s Book of Shadows, which isn't on ${actor.name}. A new one appears at the end of a Short or Long Rest.`;
}

/** The book as a gear row. */
export function bookOfShadowsRow(): InventoryItem {
  return {
    id: BOOK_OF_SHADOWS_ID,
    name: "Book of Shadows",
    quantity: 1,
    equipped: false,
    attuned: false,
    category: "adventuring-gear",
    description:
      "Conjured with Pact of the Tome. While it is on your person you have its spells prepared, and you can use it as a Spellcasting Focus. It disappears when you conjure another."
  };
}

/** Ends every name the Warlock's page holds. */
function clearPage(state: GameState, warlockId: string): EffectNarration[] {
  return state.actors.flatMap((holder) =>
    holder.effects
      .filter((effect) => effect.tags.includes(GIFT_OF_THE_PROTECTORS_TAG) && effect.sourceActorId === warlockId)
      .flatMap((effect) => endEffect(state, holder.id, effect.id))
  );
}

/** A new book in the Warlock's hand at the end of a rest, in place of any earlier one, with a blank page for Gift of
 *  the Protectors ("A new page appears in your Book of Shadows when you conjure it"). Says so when the book was gone. */
export function conjureBookOfShadows(
  state: GameState,
  actor: Actor,
  definition: ActorDefinition | undefined
): EffectNarration[] {
  if (!holdsPactOfTheTome(definition)) return [];
  const had = carriesBookOfShadows(actor.inventory);
  actor.inventory = [...actor.inventory.filter((row) => catalogIdOf(row) !== BOOK_OF_SHADOWS_ID), bookOfShadowsRow()];
  return [
    ...(had ? [] : [{ kind: "effect" as const, text: `${actor.name} conjures a Book of Shadows.`, actorId: actor.id }]),
    ...clearPage(state, actor.id)
  ];
}

/** A rebuild that gains Pact of the Tome brings the book; one that gives the invocation up takes it and its page
 *  away. */
export function syncBookOfShadows(
  state: GameState,
  actor: Actor,
  previous: ActorDefinition | undefined,
  definition: ActorDefinition
): void {
  const had = holdsPactOfTheTome(previous);
  const has = holdsPactOfTheTome(definition);
  if (has && !had) conjureBookOfShadows(state, actor, definition);
  if (had && !has) {
    actor.inventory = actor.inventory.filter((row) => catalogIdOf(row) !== BOOK_OF_SHADOWS_ID);
    clearPage(state, actor.id);
  }
}

/** Gift of the Protectors: the page "can contain a number of names equal to your Charisma modifier (minimum of one
 *  name)". Refuses a name already written, and one more than the page holds. */
export function refuseFullPage(
  state: GameState,
  warlock: Pick<Actor, "id" | "name">,
  named: Pick<Actor, "id" | "name">,
  definition: ActorDefinition | undefined
): void {
  const written = state.actors.filter((holder) =>
    holder.effects.some(
      (effect) => effect.tags.includes(GIFT_OF_THE_PROTECTORS_TAG) && effect.sourceActorId === warlock.id
    )
  );
  if (written.some((holder) => holder.id === named.id))
    throw new CommandRejectedError(`${named.name}'s name is already on ${warlock.name}'s page.`);
  const room = Math.max(1, abilityModifier(definition?.abilityScores.cha ?? 10));
  if (written.length >= room)
    throw new CommandRejectedError(
      `${warlock.name}'s page holds ${room} ${room === 1 ? "name" : "names"} (the Charisma modifier), and it is full.`
    );
}

/** SRD Gift of the Protectors: "When any creature whose name is on the page is reduced to 0 Hit Points but not killed
 *  outright, the creature magically drops to 1 Hit Point instead. Once this magic is triggered, no creature can benefit
 *  from it until you finish a Long Rest." True when it held the creature at 1, spending the Warlock's use. */
export function giftOfTheProtectors(
  state: GameState,
  actor: Actor,
  overflow: number,
  events: EffectNarration[]
): boolean {
  if (overflow >= actor.hp.maximum) return false;
  for (const name of actor.effects.filter((effect) => effect.tags.includes(GIFT_OF_THE_PROTECTORS_TAG))) {
    const warlock = state.actors.find((candidate) => candidate.id === name.sourceActorId);
    const spent = warlock?.actionUses[GIFT_OF_THE_PROTECTORS_POOL] ?? 0;
    if (!warlock || spent >= 1) continue;
    warlock.actionUses = { ...warlock.actionUses, [GIFT_OF_THE_PROTECTORS_POOL]: spent + 1 };
    actor.hp = { ...actor.hp, current: 1 };
    events.push({
      kind: "condition",
      text: `${actor.name} drops to 1 Hit Point instead (${warlock.name}'s Gift of the Protectors).`,
      actorId: actor.id
    });
    return true;
  }
  return false;
}
