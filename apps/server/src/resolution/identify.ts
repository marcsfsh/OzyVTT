import type { ResolveContext } from "./context.js";

/**
 * SRD 5.2.1 Identify: "You touch an object throughout the spell's casting. If the object is a magic item or some other
 * magic-imbued object, you learn its properties and how to use them, whether it requires Attunement, and how many
 * charges it has." The cast names a row its caster carries, which is marked identified: its player's sheet then shows
 * the copy's kind and the type the GM picked, as attuning would (`projections.ts`). What a creature's spells are is
 * the GM's to tell.
 */
export function identifyOnCast(ctx: ResolveContext): void {
  const { action, attacker, input, state } = ctx;
  if (!action.identifiesItem || input.commit === false || input.itemId == null) return;
  const caster = state.actors.find((actor) => actor.id === attacker.id);
  const row = caster?.inventory.find((entry) => entry.id === input.itemId && entry.quantity > 0);
  if (!caster || !row) return;
  caster.inventory = caster.inventory.map((entry) =>
    entry.id === row.id ? { ...entry, identified: true as const } : entry
  );
  ctx.tableNarration.push({
    kind: "effect",
    text: `${attacker.name} learns the properties of the item it touched, how to use them and whether it needs Attunement.`,
    actorIds: [attacker.id]
  });
}
