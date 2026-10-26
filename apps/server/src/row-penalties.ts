import type { GameState } from "@vtt/domain";
import { catalogIdOf, type ActorAction, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
import type { EffectNarration } from "./effects.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError } from "./game-store.js";
import { reconcileEquipment } from "./inventory.js";

/**
 * The cumulative penalty acid and rust leave on an armor or weapon row (SRD 5.2.1: a black pudding's and a gray ooze's
 * Pseudopod, a rust monster's Antennae, Corrosive Form): body armor offers 1 less AC each time and is destroyed when its
 * AC reaches 10, and a weapon takes 1 more off its attack rolls and is destroyed at -5. "The penalty can be removed by
 * casting the Mending spell on the armor or weapon." Magic items are spared. The penalty is the row's own
 * (`InventoryItem.penalty`), so one copy of a stack takes it apart from the rest.
 */

type Actor = GameState["actors"][number];
type Deps = Readonly<{
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
}>;

/** SRD armor and weapons made of something other than metal, which a rust monster's antennae leave alone. */
const NOT_METAL: ReadonlySet<string> = new Set([
  "padded-armor",
  "leather-armor",
  "studded-leather-armor",
  "hide-armor",
  "club",
  "greatclub",
  "quarterstaff",
  "sling",
  "shortbow",
  "longbow",
  "blowgun",
  "net",
  "whip"
]);

/** Armor a creature wears on its body; a Shield is held. */
const isBodyArmor = (row: InventoryItem, catalog: EquipmentCatalog | undefined) =>
  row.armor !== undefined &&
  row.category !== "shield" &&
  (row.baseId ?? catalogIdOf(row)) !== "shield" &&
  catalog?.equipmentRecord(catalogIdOf(row))?.slot !== "shield";

/** Whether a row is a magic item, which acid and rust leave alone. */
export function isMagicRow(row: InventoryItem, catalog: EquipmentCatalog | undefined): boolean {
  return row.magic?.isMagic === true || catalog?.equipmentRecord(catalogIdOf(row))?.isMagic === true;
}

/** Whether a row is of metal, by its base kind. */
const isMetal = (row: InventoryItem) => !NOT_METAL.has(row.baseId ?? catalogIdOf(row));

/** Whether a row is an object of the kinds an action acts on. */
function fits(row: InventoryItem, rule: NonNullable<ActorAction["object"]>, catalog: EquipmentCatalog | undefined) {
  if (row.quantity <= 0 || isMagicRow(row, catalog)) return false;
  if (rule.metal && !isMetal(row)) return false;
  return (
    (rule.kinds.includes("armor") && row.equipped && isBodyArmor(row, catalog)) ||
    (rule.kinds.includes("weapon") && row.weapon !== undefined)
  );
}

/** The armor or weapon of `target` an action acts on: the one named, else the worn armor, else a weapon in hand,
 *  else any weapon it carries. Refused when the one named isn't such an object; null when it carries none. */
export function objectRowOf(
  target: Actor,
  rule: NonNullable<ActorAction["object"]>,
  named: string | null | undefined,
  catalog: EquipmentCatalog | undefined
): InventoryItem | null {
  if (named) {
    const row = target.inventory.find((entry) => entry.id === named);
    if (!row || !fits(row, rule, catalog))
      throw new CommandRejectedError(
        `${row?.name ?? "That item"} isn't ${rule.metal ? "nonmagical metal" : "nonmagical"} ${rule.kinds.join(" or ")} ${target.name} wears or carries.`
      );
    return row;
  }
  const candidates = target.inventory.filter((row) => fits(row, rule, catalog));
  return (
    candidates.find((row) => row.armor !== undefined) ??
    candidates.find((row) => row.weapon !== undefined && row.equipped) ??
    candidates[0] ??
    null
  );
}

/** The nonmagical body armor a creature wears, if any. */
export function wornNonmagicalArmor(actor: Actor, catalog: EquipmentCatalog | undefined): InventoryItem | null {
  return actor.inventory.find((row) => row.equipped && isBodyArmor(row, catalog) && !isMagicRow(row, catalog)) ?? null;
}

/** A unique id for a copy split off a stack. */
function splitId(actor: Actor, row: InventoryItem): string {
  for (let n = 2; ; n += 1) {
    const id = `${row.id}-${n}`.slice(0, 80);
    if (!actor.inventory.some((entry) => entry.id === id)) return id;
  }
}

/**
 * Gives one copy of a carried armor or weapon row a cumulative -1: armor to the AC it offers, destroyed when that
 * reaches 10, a weapon to its attack rolls, destroyed at -5. One copy of a stack is split off to take it. Returns what
 * the table is told.
 */
export function penalizeRow(state: GameState, actorId: string, rowId: string, deps: Deps): EffectNarration[] {
  const actor = state.actors.find((candidate) => candidate.id === actorId);
  const row = actor?.inventory.find((entry) => entry.id === rowId);
  if (!actor || !row || (row.armor === undefined && row.weapon === undefined)) return [];
  const penalty = Math.min(10, (row.penalty ?? 0) + 1);
  const destroyed = row.armor !== undefined ? row.armor.acBase - penalty <= 10 : penalty >= 5;
  const rest = row.quantity > 1 ? { ...row, quantity: row.quantity - 1 } : null;
  const one: InventoryItem = {
    ...row,
    ...(rest ? { id: splitId(actor, row), quantity: 1 } : {}),
    penalty
  };
  actor.inventory = actor.inventory.flatMap((entry) => {
    if (entry.id !== row.id) return [entry];
    return [...(rest ? [rest] : []), ...(destroyed ? [] : [one])];
  });
  const definition = actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;
  reconcileEquipment(actor, definition, { ...(deps.catalog ? { catalog: deps.catalog } : {}) });
  const what = row.armor !== undefined ? "to the AC it offers" : "to its attack rolls";
  return [
    {
      kind: "effect",
      text: destroyed
        ? `${actor.name}'s ${row.name} is destroyed.`
        : `${actor.name}'s ${row.name} takes a -${penalty} penalty ${what}.`,
      actorId: actor.id
    }
  ];
}

/** Mending's repair: the penalty on the row named, else on the target's most penalized row, is removed. */
export function mendRow(actor: Actor, named: string | null | undefined, deps: Deps): EffectNarration[] {
  const penalized = actor.inventory.filter((row) => row.penalty !== undefined);
  const row = named
    ? penalized.find((entry) => entry.id === named)
    : [...penalized].sort((left, right) => (right.penalty ?? 0) - (left.penalty ?? 0))[0];
  if (!row) return [];
  const { penalty: _gone, ...mended } = row;
  actor.inventory = actor.inventory.map((entry) => (entry.id === row.id ? mended : entry));
  const definition = actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;
  reconcileEquipment(actor, definition, { ...(deps.catalog ? { catalog: deps.catalog } : {}) });
  return [
    { kind: "effect", text: `${actor.name}'s ${row.name} is mended, and its penalty is gone.`, actorId: actor.id }
  ];
}
