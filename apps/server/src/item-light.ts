import type { GameState } from "@vtt/domain";
import { catalogIdOf, type InventoryItem } from "@vtt/schemas";
import { GameAccessDeniedError, requireActorAccess, type Initiator } from "./authorization.js";
import type { EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError, RulesBlockedError } from "./game-store.js";
import { effectiveModeFor, overrideCovers } from "./rules-families.js";
import { rowRecord } from "./item-records.js";

/**
 * Light sources in hand (SRD Adventuring Gear: Candle, Lamp, Lanterns, Torch, Tinderbox, Oil; and magic items that
 * glow): lit and put out on the row, which dynamic vision reads (`vision/senses.ts`). Lighting a Candle, Lamp, Lantern
 * or Torch takes a Tinderbox (or another flame in hand) and a Bonus Action, a Lamp or Lantern burns a flask of Oil for
 * 6 hours, and a Torch or Candle burns for an hour, then is used up. A Hooded Lantern's hood goes up or down as a Bonus
 * Action, and a Bullseye Lantern's Cone points where its bearer aims it. Burn time runs on the game clock.
 */

type Actor = GameState["actors"][number];

/** What only the server writes on a row: a client's copy of the row never carries them in. */
export function keepLightState(
  stored: InventoryItem | undefined,
  incoming: InventoryItem,
  clockHours: number
): InventoryItem {
  const {
    lit: _lit,
    hoodLowered: _hood,
    facingDegrees: _facing,
    burnsOutAtHour: _burns,
    burnHoursLeft: _left,
    ...rest
  } = incoming;
  if (!stored || incoming.quantity <= 0) return rest;
  // Stowing a burning light puts it out, and the fuel left in it waits for the next lighting.
  const stillLit = stored.lit === true && incoming.equipped;
  const left =
    !stillLit && stored.burnsOutAtHour !== undefined
      ? Math.max(1, stored.burnsOutAtHour - clockHours)
      : stored.burnHoursLeft;
  return {
    ...rest,
    ...(stillLit ? { lit: true } : {}),
    ...(stored.hoodLowered ? { hoodLowered: true as const } : {}),
    ...(stored.facingDegrees !== undefined ? { facingDegrees: stored.facingDegrees } : {}),
    ...(stillLit && stored.burnsOutAtHour !== undefined ? { burnsOutAtHour: stored.burnsOutAtHour } : {}),
    ...(left !== undefined ? { burnHoursLeft: left } : {})
  };
}

export type ItemLightChange = Readonly<{
  actorId: string;
  itemId: string;
  lit?: boolean;
  hoodLowered?: boolean;
  facingDegrees?: number;
}>;

const TINDERBOX = "tinderbox";

/** A flame to light it with: a Tinderbox, or another light already burning in hand. */
const hasFlame = (actor: Actor, itemId: string) =>
  actor.inventory.some(
    (row) =>
      row.quantity > 0 && (catalogIdOf(row) === TINDERBOX || (row.id !== itemId && row.lit === true && row.equipped))
  );

/** Spends the creature's Bonus Action when it is its turn in the fight; a player may not do this off its turn. */
export function spendBonusAction(state: GameState, actor: Actor, initiator: Initiator, what: string): void {
  const combat = state.combat;
  if (!combat.active || !combat.initiative.some((entry) => entry.actorId === actor.id)) return;
  if (combat.turnActorId !== actor.id) {
    if (initiator.role === "player") throw new GameAccessDeniedError(`${what} on ${actor.name}'s turn.`);
    return;
  }
  if (combat.turn.bonusActionUsed) {
    const rule = "economy.bonus-action-used" as const;
    const mode = effectiveModeFor(combat, rule);
    if (initiator.role === "player" && mode === "strict" && !overrideCovers(combat.turn, rule))
      throw new RulesBlockedError(rule, `${actor.name} has already used a Bonus Action this turn.`);
    return;
  }
  state.combat = { ...combat, turn: { ...combat.turn, bonusActionUsed: true } };
}

/** Lights, puts out, hoods or aims a light source a creature carries. Returns the sentence for the table. */
export function setItemLight(
  state: GameState,
  change: ItemLightChange,
  initiator: Initiator,
  catalog: EquipmentCatalog
): string | null {
  requireActorAccess(initiator, state, change.actorId, "inventory");
  const actor = state.actors.find((candidate) => candidate.id === change.actorId);
  if (!actor) throw new CommandRejectedError("That combatant no longer exists.");
  const row = actor.inventory.find((entry) => entry.id === change.itemId && entry.quantity > 0);
  if (!row) throw new CommandRejectedError("That item isn't carried.");
  const light = rowRecord(catalog, row)?.light;
  if (!light) throw new CommandRejectedError(`${row.name} sheds no light.`);
  const now = state.rest.clockHours;
  let next: InventoryItem = { ...row };
  let said: string | null = null;

  if (change.lit === true && row.lit !== true) {
    // A burning light needs a flame; a magic one lights at a word.
    if (light.burnHours !== undefined && !hasFlame(actor, row.id) && initiator.role === "player")
      throw new CommandRejectedError(`${actor.name} needs a Tinderbox or another flame in hand to light ${row.name}.`);
    let hours = row.burnHoursLeft !== undefined && row.burnHoursLeft > 0 ? row.burnHoursLeft : undefined;
    if (light.burnHours !== undefined && hours === undefined) {
      if (light.fuel) {
        const fuel = actor.inventory.find((entry) => catalogIdOf(entry) === light.fuel && entry.quantity > 0);
        if (!fuel) throw new CommandRejectedError(`${row.name} has no fuel. It burns a flask of Oil.`);
        actor.inventory = actor.inventory.map((entry) =>
          entry.id === fuel.id ? { ...entry, quantity: entry.quantity - 1 } : entry
        );
        actor.inventory = actor.inventory.filter((entry) => entry.quantity > 0 || entry.id !== fuel.id);
      }
      hours = light.burnHours;
    }
    spendBonusAction(state, actor, initiator, `Light ${row.name}`);
    const { burnHoursLeft: _left, ...rest } = next;
    next = { ...rest, lit: true, equipped: true, ...(hours !== undefined ? { burnsOutAtHour: now + hours } : {}) };
    said = `${actor.name} lights ${row.name}.`;
  } else if (change.lit === false && row.lit === true) {
    const { lit: _lit, burnsOutAtHour, ...rest } = next;
    next = { ...rest, ...(burnsOutAtHour !== undefined ? { burnHoursLeft: Math.max(1, burnsOutAtHour - now) } : {}) };
    said = `${actor.name} puts out ${row.name}.`;
  }
  if (change.hoodLowered !== undefined && change.hoodLowered !== (row.hoodLowered === true)) {
    if (!light.hooded) throw new CommandRejectedError(`${row.name} has no hood.`);
    spendBonusAction(state, actor, initiator, `Raise or lower the hood`);
    const { hoodLowered: _hood, ...rest } = next;
    next = change.hoodLowered ? { ...rest, hoodLowered: true } : rest;
    said = `${actor.name} ${change.hoodLowered ? "lowers" : "raises"} the hood of ${row.name}.`;
  }
  if (change.facingDegrees !== undefined) {
    if (light.cone !== true) throw new CommandRejectedError(`${row.name} sheds light all around.`);
    next = { ...next, facingDegrees: ((change.facingDegrees % 360) + 360) % 360 };
  }
  actor.inventory = actor.inventory.map((entry) => (entry.id === row.id ? next : entry));
  return said;
}

/**
 * Lights burn down on the game clock: a Torch or Candle whose hour is up is used up (one from its row), and a Lamp or
 * Lantern goes out with its flask of Oil spent. Runs after every command; returns a line for each light that went out.
 */
export function burnOutLights(state: GameState, catalog: EquipmentCatalog | undefined): string[] {
  const now = state.rest.clockHours;
  const lines: string[] = [];
  for (const actor of state.actors) {
    if (
      !actor.inventory.some((row) => row.lit === true && row.burnsOutAtHour !== undefined && row.burnsOutAtHour <= now)
    )
      continue;
    actor.inventory = actor.inventory.flatMap((row) => {
      if (row.lit !== true || row.burnsOutAtHour === undefined || row.burnsOutAtHour > now) return [row];
      const light = rowRecord(catalog, row)?.light;
      const { lit: _lit, burnsOutAtHour: _burns, burnHoursLeft: _left, ...rest } = row;
      if (light?.fuel) {
        lines.push(`${row.name} carried by ${actor.name} burns out its Oil.`);
        return [rest];
      }
      lines.push(`${row.name} carried by ${actor.name} burns out.`);
      return row.quantity > 1 ? [{ ...rest, quantity: row.quantity - 1 }] : [];
    });
  }
  return lines;
}
