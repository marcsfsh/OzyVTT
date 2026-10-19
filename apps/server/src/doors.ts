import type { DoorFastening, DoorState, GameState, RollVisibility, VisionWall } from "@vtt/domain";
import type { RandomSource } from "@vtt/rules-5e";
import { catalogIdOf, type ActorDefinition, type InventoryItem } from "@vtt/schemas";
import { checkPlan, type CheckNames, type CheckPlan } from "./ability-checks.js";
import { GameAccessDeniedError, requireActorAccess, type Initiator } from "./authorization.js";
import { rollSettledCheck } from "./check-rolls.js";
import { deriveEquipment, type EquipmentCatalog } from "./equipment-derivation.js";
import { CommandRejectedError } from "./game-store.js";
import { clockMinutesOf } from "./game-time.js";
import { carriedRow as carried, requireFastHands, spendUtilize } from "./utilize.js";
import { doorWithinReach } from "./vision/edit.js";

/**
 * Doors that stay shut (SRD 5.2.1 Lock, Thieves' Tools, Ram Portable, Spikes Iron, Knock, Arcane Lock): a closed door
 * may be locked, stuck, barred, jammed with a spike or sealed by Stone Shape, and may hold an Arcane Lock. A creature
 * opens it only when nothing holds it shut against that creature: a lock's key holder, and the creatures an Arcane Lock
 * names, pass. Thieves' Tools pick a lock, a Strength (Athletics) check forces the rest, and an Iron Spike jams a door.
 * The server keeps every fastening; a player learns of one by trying the door.
 */

type Actor = GameState["actors"][number];

/** SRD Lock: "pick this Lock with a successful DC 15 Dexterity (Sleight of Hand) check". */
export const LOCK_DC = 15;
/** A stuck, barred or jammed door is forced at this DC unless the GM sets another. */
export const FORCE_DC = 15;
/** SRD Ram, Portable: "you gain a +4 bonus to the Strength check". */
const RAM_BONUS = 4;
/** SRD Knock: an Arcane Lock "is suppressed for 10 minutes". */
const KNOCK_MINUTES = 10;

const THIEVES_TOOLS = "thieves-tools";
const PORTABLE_RAM = "portable-ram";
const IRON_SPIKES = "iron-spikes";
const CARPENTERS_TOOLS = "carpenters-tools";
const SMITHS_TOOLS = "smiths-tools";
/** SRD Carpenter's Tools: "Seal or pry open a door or container (DC 20)"; Smith's Tools: "Pry open a door or container
 *  (DC 20)". */
const TOOL_DOOR_DC = 20;
/** Spikes come in bundles of ten. */
const SPIKES_PER_BUNDLE = 10;

const SHUT: Readonly<Record<DoorFastening["kind"], string>> = {
  lock: "The door is locked.",
  stuck: "The door is stuck.",
  barred: "The door is barred.",
  jammed: "The door is jammed shut.",
  sealed: "The door is sealed shut."
};

/** Whether Knock still holds an Arcane Lock off: through its round in this fight, or its minute on the game clock. */
export function arcaneLockSuppressed(state: GameState, lock: NonNullable<DoorState["arcaneLock"]>): boolean {
  const suppressed = lock.suppressed;
  if (!suppressed) return false;
  if (suppressed.untilRound !== undefined && state.combat.active && state.combat.round <= suppressed.untilRound)
    return true;
  return suppressed.untilMinute !== undefined && clockMinutesOf(state) < suppressed.untilMinute;
}

/** Whether an Arcane Lock keeps the door shut against this creature: it holds, and the creature isn't its caster or
 *  one it names. */
function arcaneLockBars(state: GameState, door: DoorState, openerId: string | null): boolean {
  const lock = door.arcaneLock;
  if (!lock || arcaneLockSuppressed(state, lock)) return false;
  return openerId === null || (openerId !== lock.casterId && !lock.allowedIds.includes(openerId));
}

/** The fastenings that keep the door shut against this creature: all but a lock whose key it holds. */
function fasteningsAgainst(door: DoorState, openerId: string | null): DoorFastening[] {
  return door.fastenings.filter(
    (fastening) => !(fastening.kind === "lock" && openerId !== null && fastening.keyHolderIds?.includes(openerId))
  );
}

/** Why the door won't open for this creature (null: it opens). With no creature, why it won't open for anyone without
 *  a key. */
export function heldShutAgainst(state: GameState, wall: VisionWall, openerId: string | null): string | null {
  const door = wall.door;
  if (!door) return null;
  if (arcaneLockBars(state, door, openerId)) return SHUT.lock;
  const first = fasteningsAgainst(door, openerId)[0];
  return first ? SHUT[first.kind] : null;
}

/** A secret door: players see it as wall until the GM reveals it. */
export const isHiddenDoor = (wall: VisionWall) => wall.kind === "door" && wall.door?.hidden === true;

function requireDoor(state: GameState, wallId: string): VisionWall {
  const wall = state.combat.vision.walls.find((candidate) => candidate.id === wallId);
  if (!wall || wall.kind !== "door") throw new CommandRejectedError("That door is no longer there.");
  return wall;
}

function writeDoor(state: GameState, wallId: string, change: (wall: VisionWall) => VisionWall): void {
  state.combat = {
    ...state.combat,
    vision: {
      ...state.combat.vision,
      walls: state.combat.vision.walls.map((wall) => (wall.id === wallId ? change(wall) : wall))
    }
  };
}

/** A door's state as the GM sets it: what holds it shut, an Arcane Lock, and whether it is a secret door. */
export function setDoorState(state: GameState, wallId: string, door: DoorState | null): void {
  requireDoor(state, wallId);
  writeDoor(state, wallId, (wall) => {
    const next: VisionWall = { ...wall };
    if (door === null || (door.fastenings.length === 0 && !door.arcaneLock && !door.hidden)) delete next.door;
    else next.door = door;
    return next;
  });
}

export type DoorUse = "pick" | "force" | "jam" | "pry" | "seal";

export type DoorUseDeps = Readonly<{
  random: RandomSource;
  newId: () => string;
  commandId: string;
  sessionId: string;
  now: () => string;
  resolveDefinition: (definitionId: string) => ActorDefinition | undefined;
  catalog?: EquipmentCatalog;
  names?: CheckNames;
}>;

export type DoorUseResult = Readonly<{
  /** The line the table reads. */
  text: string;
  /** The door came open. */
  opened: boolean;
  /** The check's total, when one was rolled. */
  total?: number;
}>;

/**
 * A creature next to a door works on it: picks its lock with Thieves' Tools (a Dexterity (Sleight of Hand) check), forces
 * it (a Strength (Athletics) check, +4 with a Portable Ram and Advantage with a helper on the ram), or jams it shut with
 * an Iron Spike. With Carpenter's or Smith's Tools it pries the door open, and with Carpenter's Tools it seals one shut
 * (a Strength check with the tool against DC 20). Each takes the Utilize action in a fight. A pick, a force or a pry
 * that succeeds opens the way: the lock is unlocked, or every fastening it beat is broken and the door swings open.
 */
export function useDoor(
  state: GameState,
  input: Readonly<{
    wallId: string;
    actorId: string;
    how: DoorUse;
    helperId?: string;
    visibility: RollVisibility;
    /** A Thief's Fast Hands: the use takes the Bonus Action. */
    bonusAction?: boolean;
  }>,
  initiator: Initiator,
  deps: DoorUseDeps
): DoorUseResult {
  const actor = state.actors.find((candidate) => candidate.id === input.actorId);
  if (!actor) throw new CommandRejectedError("That character no longer exists.");
  requireActorAccess(initiator, state, actor.id, "move", "You can only work on a door with your own character.");
  const wall = state.combat.vision.walls.find((candidate) => candidate.id === input.wallId);
  // A secret door and one out of reach answer as a door that isn't there, so trying one gives nothing away.
  if (!wall || wall.kind !== "door" || (isHiddenDoor(wall) && initiator.role === "player"))
    throw new GameAccessDeniedError("Move your character next to the door to work on it.");
  if (!doorWithinReach(state, wall.id, [actor.id]))
    throw new GameAccessDeniedError("Move your character next to the door to work on it.");
  const definition = actor.definitionId ? deps.resolveDefinition(actor.definitionId) : undefined;
  // Each use is the Utilize action in a fight, or with Fast Hands a Bonus Action.
  if (input.bonusAction) requireFastHands(actor, definition);
  const spend: Spend = (what) => {
    spendUtilize(state, actor, initiator, what, { bonusAction: input.bonusAction === true, definition });
  };
  if (input.how === "jam") return jamDoor(state, wall, actor, spend);
  if (input.how === "seal") return sealDoor(state, wall, actor, definition, input.visibility, initiator, deps, spend);
  if (wall.open === true) throw new CommandRejectedError("The door is already open.");
  if (input.how === "pry") return pryDoor(state, wall, actor, definition, input.visibility, initiator, deps, spend);
  return input.how === "pick"
    ? pickLock(state, wall, actor, definition, input.visibility, initiator, deps, spend)
    : forceDoor(state, wall, actor, definition, input, initiator, deps, spend);
}

/** Spends one use of the door in a fight, named for its refusal. */
type Spend = (what: string) => void;

function rollFor(
  state: GameState,
  actor: Actor,
  plan: CheckPlan,
  label: string,
  visibility: RollVisibility,
  initiator: Initiator,
  deps: DoorUseDeps
) {
  return rollSettledCheck(
    state,
    actor,
    plan,
    {
      id: deps.newId(),
      commandId: deps.commandId,
      sessionId: deps.sessionId,
      role: initiator.role,
      label,
      visibility: actor.visibility === "public" ? visibility : "gm-only",
      createdAt: deps.now()
    },
    deps.random
  );
}

function pickLock(
  state: GameState,
  wall: VisionWall,
  actor: Actor,
  definition: ActorDefinition | undefined,
  visibility: RollVisibility,
  initiator: Initiator,
  deps: DoorUseDeps,
  spend: Spend
): DoorUseResult {
  const tools = carried(actor, THIEVES_TOOLS);
  if (!tools) throw new CommandRejectedError(`${actor.name} needs Thieves' Tools to pick a lock.`);
  const door = wall.door;
  const lock = door ? fasteningsAgainst(door, actor.id).find((fastening) => fastening.kind === "lock") : undefined;
  // SRD Arcane Lock: "This lock can't be unlocked by any nonmagical means."
  if (!lock && door && arcaneLockBars(state, door, actor.id))
    throw new CommandRejectedError("The lock doesn't yield to Thieves' Tools.");
  if (!lock) throw new CommandRejectedError("There is no lock to pick on this door.");
  spend("Pick the lock");
  const plan = checkPlan(
    actor,
    definition,
    deriveEquipment(actor, definition, deps.catalog),
    { ability: "dex", skill: "sleight-of-hand", tool: THIEVES_TOOLS },
    deps.names ? { names: deps.names } : {}
  );
  const dc = lock.dc ?? LOCK_DC;
  const roll = rollFor(state, actor, plan, "Pick a lock", visibility, initiator, deps);
  if (roll.total < dc) return { text: `${actor.name} fails to pick the lock.`, opened: false, total: roll.total };
  writeDoor(state, wall.id, (current) => withoutFastenings(current, [lock]));
  return { text: `${actor.name} picks the lock.`, opened: false, total: roll.total };
}

function forceDoor(
  state: GameState,
  wall: VisionWall,
  actor: Actor,
  definition: ActorDefinition | undefined,
  input: Readonly<{ helperId?: string; visibility: RollVisibility }>,
  initiator: Initiator,
  deps: DoorUseDeps,
  spend: Spend
): DoorUseResult {
  const door = wall.door;
  if (door?.fastenings.some((fastening) => fastening.kind === "sealed"))
    throw new CommandRejectedError("The door is sealed shut. Break it down or shape the stone again.");
  if (door && arcaneLockBars(state, door, actor.id))
    throw new CommandRejectedError("The door won't move: magic holds it shut. Break it down or dispel the magic.");
  const holding = door ? fasteningsAgainst(door, actor.id) : [];
  // A lock with no force DC is picked or broken, never forced with a check.
  const unforceable = holding.find((fastening) => fastening.kind === "lock" && fastening.forceDc === undefined);
  if (unforceable) throw new CommandRejectedError("The door is locked. Pick the lock or break the door down.");
  const ram = carried(actor, PORTABLE_RAM);
  const helper =
    ram && input.helperId !== undefined && input.helperId !== actor.id
      ? state.actors.find((candidate) => candidate.id === input.helperId)
      : undefined;
  if (input.helperId !== undefined && !helper)
    throw new CommandRejectedError("Only another character can help, and only with a Portable Ram.");
  if (helper && !doorWithinReach(state, wall.id, [helper.id]))
    throw new CommandRejectedError(`${helper.name} must be next to the door to help with the ram.`);
  spend("Force the door");
  const base = checkPlan(
    actor,
    definition,
    deriveEquipment(actor, definition, deps.catalog),
    { ability: "str", skill: "athletics" },
    deps.names ? { names: deps.names } : {}
  );
  const plan: CheckPlan = {
    ...base,
    modifier: base.modifier + (ram ? RAM_BONUS : 0),
    rollMode: helper
      ? {
          mode: base.rollMode.disadvantage.length > 0 ? "normal" : "advantage",
          advantage: [...base.rollMode.advantage, `${helper.name} helps with the ram`],
          disadvantage: base.rollMode.disadvantage
        }
      : base.rollMode
  };
  const label = ram ? "Break down a door with a ram" : "Force a door";
  const roll = rollFor(state, actor, plan, label, input.visibility, initiator, deps);
  const dc = Math.max(0, ...holding.map(forceDcOf));
  if (holding.length > 0 && roll.total < dc)
    return { text: `${actor.name} fails to force the door.`, opened: false, total: roll.total };
  writeDoor(state, wall.id, (current) => ({ ...withoutFastenings(current, holding), open: true }));
  return { text: `${actor.name} forces the door open.`, opened: true, total: roll.total };
}

/** The Strength check a woodworker's or smith's tool makes, proficiency coming from the tool. */
function toolCheck(
  state: GameState,
  actor: Actor,
  definition: ActorDefinition | undefined,
  tool: string,
  label: string,
  visibility: RollVisibility,
  initiator: Initiator,
  deps: DoorUseDeps
) {
  const plan = checkPlan(
    actor,
    definition,
    deriveEquipment(actor, definition, deps.catalog),
    { ability: "str", tool },
    deps.names ? { names: deps.names } : {}
  );
  return rollFor(state, actor, plan, label, visibility, initiator, deps);
}

/** SRD Carpenter's Tools and Smith's Tools: "Pry open a door or container (DC 20)". Whatever holds the door shut gives
 *  way, but Stone Shape's seal and an Arcane Lock don't. */
function pryDoor(
  state: GameState,
  wall: VisionWall,
  actor: Actor,
  definition: ActorDefinition | undefined,
  visibility: RollVisibility,
  initiator: Initiator,
  deps: DoorUseDeps,
  spend: Spend
): DoorUseResult {
  const tools = carried(actor, CARPENTERS_TOOLS) ?? carried(actor, SMITHS_TOOLS);
  if (!tools) throw new CommandRejectedError(`${actor.name} needs Carpenter's or Smith's Tools to pry a door open.`);
  const door = wall.door;
  if (door?.fastenings.some((fastening) => fastening.kind === "sealed"))
    throw new CommandRejectedError("The door is sealed shut. Break it down or shape the stone again.");
  if (door && arcaneLockBars(state, door, actor.id))
    throw new CommandRejectedError("The door won't move: magic holds it shut. Break it down or dispel the magic.");
  spend("Pry the door open");
  const roll = toolCheck(state, actor, definition, catalogIdOf(tools), "Pry a door open", visibility, initiator, deps);
  if (roll.total < TOOL_DOOR_DC)
    return { text: `${actor.name} fails to pry the door open.`, opened: false, total: roll.total };
  const holding = door ? fasteningsAgainst(door, actor.id) : [];
  writeDoor(state, wall.id, (current) => ({ ...withoutFastenings(current, holding), open: true }));
  return { text: `${actor.name} pries the door open.`, opened: true, total: roll.total };
}

/** SRD Carpenter's Tools: "Seal ... a door or container (DC 20)". It is forced or pried open at that DC. */
function sealDoor(
  state: GameState,
  wall: VisionWall,
  actor: Actor,
  definition: ActorDefinition | undefined,
  visibility: RollVisibility,
  initiator: Initiator,
  deps: DoorUseDeps,
  spend: Spend
): DoorUseResult {
  if (wall.open === true) throw new CommandRejectedError("Close the door before sealing it.");
  if (!carried(actor, CARPENTERS_TOOLS))
    throw new CommandRejectedError(`${actor.name} needs Carpenter's Tools to seal a door.`);
  spend("Seal the door");
  const roll = toolCheck(state, actor, definition, CARPENTERS_TOOLS, "Seal a door", visibility, initiator, deps);
  if (roll.total < TOOL_DOOR_DC)
    return { text: `${actor.name} fails to seal the door.`, opened: false, total: roll.total };
  writeDoor(state, wall.id, (current) => ({
    ...current,
    door: {
      ...(current.door ?? { fastenings: [] }),
      fastenings: [...(current.door?.fastenings ?? []), { kind: "stuck" as const, dc: TOOL_DOOR_DC }].slice(-6)
    }
  }));
  return { text: `${actor.name} seals the door shut.`, opened: false, total: roll.total };
}

/** SRD Spikes, Iron: "As a Utilize action, you can use a blunt object ... to hammer a spike into wood ... to jam a door
 *  shut." The door must be closed; one spike of the bundle is used. */
function jamDoor(state: GameState, wall: VisionWall, actor: Actor, spend: Spend): DoorUseResult {
  if (wall.open === true) throw new CommandRejectedError("Close the door before jamming it.");
  const spikes = carried(actor, IRON_SPIKES);
  if (!spikes) throw new CommandRejectedError(`${actor.name} needs Iron Spikes to jam a door.`);
  spend("Jam the door");
  useOneSpike(actor, spikes);
  writeDoor(state, wall.id, (current) => ({
    ...current,
    door: {
      ...(current.door ?? { fastenings: [] }),
      fastenings: [...(current.door?.fastenings ?? []), { kind: "jammed" as const, dc: FORCE_DC }].slice(-6)
    }
  }));
  return { text: `${actor.name} jams the door shut with an iron spike.`, opened: false };
}

/** Takes one spike from a bundle row, counting what is left as a bundle of ammunition counts its pieces. */
function useOneSpike(actor: Actor, row: InventoryItem): void {
  const left = (row.ammunitionLeft ?? row.quantity * SPIKES_PER_BUNDLE) - 1;
  const quantity = Math.ceil(Math.max(0, left) / SPIKES_PER_BUNDLE);
  actor.inventory = actor.inventory.flatMap((candidate) => {
    if (candidate !== row) return [candidate];
    if (left <= 0) return [];
    const next: InventoryItem = { ...candidate, quantity };
    if (left === quantity * SPIKES_PER_BUNDLE) delete next.ammunitionLeft;
    else next.ammunitionLeft = left;
    return [next];
  });
}

/** The Strength (Athletics) check that forces a fastening: a lock's `forceDc`, the others' own DC. */
const forceDcOf = (fastening: DoorFastening) =>
  fastening.kind === "lock" ? (fastening.forceDc ?? 0) : (fastening.dc ?? FORCE_DC);

function withoutFastenings(wall: VisionWall, gone: readonly DoorFastening[]): VisionWall {
  const door = wall.door;
  if (!door) return wall;
  return { ...wall, door: { ...door, fastenings: door.fastenings.filter((fastening) => !gone.includes(fastening)) } };
}

/**
 * SRD Knock: "A target that is held shut by a mundane lock or that is stuck or barred becomes unlocked, unstuck, or
 * unbarred. If the object has multiple locks, only one of them is unlocked. If the target is held shut by Arcane Lock,
 * that spell is suppressed for 10 minutes." A sealed door isn't held by any of these, so it stays shut. Returns the line
 * the table reads.
 */
export function knockOn(state: GameState, wallId: string): string {
  const wall = requireDoor(state, wallId);
  const door = wall.door;
  const opened = door?.fastenings.find((fastening) => fastening.kind !== "sealed");
  const lock = door?.arcaneLock;
  const minute = clockMinutesOf(state) + KNOCK_MINUTES;
  writeDoor(state, wallId, (current) => {
    const now = current.door;
    if (!now) return current;
    return {
      ...current,
      door: {
        ...now,
        fastenings: now.fastenings.filter((fastening) => fastening !== opened),
        ...(lock
          ? {
              arcaneLock: {
                ...lock,
                suppressed: {
                  ...(state.combat.active ? { untilRound: state.combat.round + KNOCK_MINUTES * 10 - 1 } : {}),
                  untilMinute: minute
                }
              }
            }
          : {})
      }
    };
  });
  return "A loud knock sounds from the door.";
}

/** SRD Arcane Lock: the touched closed door "is locked for the duration", and only the caster and the creatures it
 *  designates open it. */
export function arcaneLock(state: GameState, wallId: string, casterId: string, allowedIds: readonly string[]): void {
  const wall = requireDoor(state, wallId);
  if (wall.open === true) throw new CommandRejectedError("Arcane Lock takes a closed door. Close it first.");
  writeDoor(state, wallId, (current) => ({
    ...current,
    door: {
      ...(current.door ?? { fastenings: [] }),
      arcaneLock: { casterId, allowedIds: [...new Set(allowedIds)].slice(0, 20) }
    }
  }));
}
