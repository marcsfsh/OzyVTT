import { describe, expect, it } from "vitest";
import type { DoorState, GameState } from "@vtt/domain";
import { arcaneLock, heldShutAgainst, knockOn, setDoorState, useDoor, type DoorUseDeps } from "../src/doors.js";
import { nextInitiativeTurn } from "../src/encounter.js";
import { visionOf } from "../src/vision/audience.js";
import { cell, FRIEND, HERO, visionGame, wall } from "./vision-fixtures.js";

// SRD 5.2.1 Lock, Thieves' Tools, Ram Portable, Spikes Iron, Knock and Arcane Lock: what keeps a door shut, who it
// still opens for, and how a creature beside it picks, forces or jams it.

let ids = 0;
const nextId = () => `40000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;
const GM = { role: "gm" } as const;
const PLAYER_A = { role: "player", sessionId: "30000000-0000-4000-8000-0000000000a1" } as const;

function deps(faces: number[]): DoorUseDeps {
  return {
    random: (sides) => Math.min(sides, faces.shift() ?? 1),
    newId: nextId,
    commandId: nextId(),
    sessionId: PLAYER_A.sessionId,
    now: () => "2026-10-19T00:00:00.000Z",
    resolveDefinition: () => undefined
  };
}

/** A door between column 4 and column 5 at row 5; Borin stands beside it at (4,5), Mirena at (4,4). */
function doorway(door: DoorState | undefined, inventory: unknown[] = []) {
  const entrance = { ...wall({ x: 250, y: 250 }, { x: 250, y: 300 }, "door", false), ...(door ? { door } : {}) };
  const state = visionGame({
    walls: [wall({ x: 250, y: 0 }, { x: 250, y: 250 }), entrance, wall({ x: 250, y: 300 }, { x: 250, y: 600 })],
    positions: { [HERO]: cell(4, 5), [FRIEND]: cell(4, 4) },
    actors: { [HERO]: { inventory } }
  });
  const doorOf = (current: GameState) => current.combat.vision.walls.find((candidate) => candidate.id === entrance.id)!;
  return { state, door: entrance, doorOf };
}

const row = (id: string, name: string, quantity = 1) => ({ id, name, quantity, equipped: false, attuned: false });

describe("who a fastened door opens for", () => {
  it("stays shut against a creature without the key and opens for the one that holds it", () => {
    const { state, door } = doorway({ fastenings: [{ kind: "lock", keyHolderIds: [FRIEND] }] });
    expect(heldShutAgainst(state, door, HERO)).toBe("The door is locked.");
    expect(heldShutAgainst(state, door, FRIEND)).toBeNull();
  });

  it("says what holds a door stuck, barred, jammed or sealed", () => {
    for (const [kind, said] of [
      ["stuck", "The door is stuck."],
      ["barred", "The door is barred."],
      ["jammed", "The door is jammed shut."],
      ["sealed", "The door is sealed shut."]
    ] as const) {
      const { state, door } = doorway({ fastenings: [{ kind }] });
      expect(heldShutAgainst(state, door, HERO)).toBe(said);
    }
  });

  it("lets an Arcane Lock's caster and the creatures it names through, and no one else", () => {
    const { state, door, doorOf } = doorway(undefined);
    arcaneLock(state, door.id, FRIEND, []);
    expect(heldShutAgainst(state, doorOf(state), FRIEND)).toBeNull();
    expect(heldShutAgainst(state, doorOf(state), HERO)).toBe("The door is locked.");
    arcaneLock(state, door.id, FRIEND, [HERO]);
    expect(heldShutAgainst(state, doorOf(state), HERO)).toBeNull();
  });

  it("clears the door's state when the GM sets nothing", () => {
    const { state, door, doorOf } = doorway({ fastenings: [{ kind: "stuck", dc: 12 }] });
    setDoorState(state, door.id, { fastenings: [] });
    expect(doorOf(state).door).toBeUndefined();
  });
});

describe("Knock", () => {
  it("unlocks one of several locks, then the next", () => {
    const { state, door, doorOf } = doorway({ fastenings: [{ kind: "lock" }, { kind: "barred", dc: 18 }] });
    knockOn(state, door.id);
    expect(doorOf(state).door?.fastenings).toEqual([{ kind: "barred", dc: 18 }]);
    knockOn(state, door.id);
    expect(heldShutAgainst(state, doorOf(state), HERO)).toBeNull();
  });

  it("suppresses an Arcane Lock for 10 minutes, 100 rounds in an encounter, and then it holds again", () => {
    const { state, door, doorOf } = doorway(undefined);
    arcaneLock(state, door.id, FRIEND, []);
    knockOn(state, door.id);
    expect(heldShutAgainst(state, doorOf(state), HERO)).toBeNull();
    state.combat.round = 100;
    expect(heldShutAgainst(state, doorOf(state), HERO)).toBeNull();
    state.combat.round = 101;
    state.rest.clockMinutes = 10;
    expect(heldShutAgainst(state, doorOf(state), HERO)).toBe("The door is locked.");
  });

  it("leaves a door Stone Shape sealed", () => {
    const { state, door, doorOf } = doorway({ fastenings: [{ kind: "sealed" }] });
    knockOn(state, door.id);
    expect(heldShutAgainst(state, doorOf(state), HERO)).toBe("The door is sealed shut.");
  });
});

describe("picking a lock", () => {
  it("needs Thieves' Tools", () => {
    const { state, door } = doorway({ fastenings: [{ kind: "lock" }] });
    expect(() =>
      useDoor(state, { wallId: door.id, actorId: HERO, how: "pick", visibility: "public" }, PLAYER_A, deps([20]))
    ).toThrowError("Borin needs Thieves' Tools to pick a lock.");
  });

  it("unlocks the door on a DC 15 Dexterity (Sleight of Hand) check, and takes the Utilize action", () => {
    const { state, door, doorOf } = doorway({ fastenings: [{ kind: "lock" }] }, [
      row("thieves-tools", "Thieves' Tools")
    ]);
    const missed = useDoor(
      state,
      { wallId: door.id, actorId: HERO, how: "pick", visibility: "public" },
      PLAYER_A,
      deps([14])
    );
    expect(missed).toMatchObject({ total: 14, text: "Borin fails to pick the lock." });
    expect(state.combat.turn.actionUsed).toBe(true);
    nextInitiativeTurn(state);
    while (state.combat.turnActorId !== HERO) nextInitiativeTurn(state);
    const picked = useDoor(
      state,
      { wallId: door.id, actorId: HERO, how: "pick", visibility: "public" },
      PLAYER_A,
      deps([15])
    );
    expect(picked.text).toBe("Borin picks the lock.");
    expect(heldShutAgainst(state, doorOf(state), HERO)).toBeNull();
  });

  it("can't pick an Arcane Lock", () => {
    const { state, door } = doorway(undefined, [row("thieves-tools", "Thieves' Tools")]);
    arcaneLock(state, door.id, FRIEND, []);
    expect(() =>
      useDoor(state, { wallId: door.id, actorId: HERO, how: "pick", visibility: "public" }, PLAYER_A, deps([20]))
    ).toThrowError("The lock doesn't yield to Thieves' Tools.");
  });

  it("refuses a door out of reach as one that isn't there", () => {
    const { state, door } = doorway({ fastenings: [{ kind: "lock" }] }, [row("thieves-tools", "Thieves' Tools")]);
    state.combat.tokens = state.combat.tokens.map((token) =>
      token.actorId === HERO ? { ...token, position: cell(1, 5) } : token
    );
    expect(() =>
      useDoor(state, { wallId: door.id, actorId: HERO, how: "pick", visibility: "public" }, PLAYER_A, deps([20]))
    ).toThrowError("Move your character next to the door to work on it.");
  });
});

describe("forcing a door", () => {
  it("bursts a stuck door open on a Strength (Athletics) check at its DC", () => {
    const { state, door, doorOf } = doorway({ fastenings: [{ kind: "stuck", dc: 12 }] });
    const forced = useDoor(
      state,
      { wallId: door.id, actorId: HERO, how: "force", visibility: "public" },
      GM,
      deps([12])
    );
    expect(forced).toMatchObject({ opened: true, text: "Borin forces the door open." });
    expect(doorOf(state)).toMatchObject({ open: true, door: { fastenings: [] } });
  });

  it("adds 4 with a Portable Ram, and a helper on the ram gives Advantage", () => {
    const ram = [row("portable-ram", "Ram, Portable")];
    const { state, door } = doorway({ fastenings: [{ kind: "barred", dc: 20 }] }, ram);
    // 16 + 4 meets DC 20.
    expect(
      useDoor(state, { wallId: door.id, actorId: HERO, how: "force", visibility: "public" }, GM, deps([16])).total
    ).toBe(20);
    const helped = doorway({ fastenings: [{ kind: "barred", dc: 20 }] }, ram);
    // Advantage: the better of 5 and 17, plus 4.
    const result = useDoor(
      helped.state,
      { wallId: helped.door.id, actorId: HERO, how: "force", helperId: FRIEND, visibility: "public" },
      GM,
      deps([5, 17])
    );
    expect(result).toMatchObject({ total: 21, opened: true });
  });

  it("can't force a lock with no DC to break it, nor an Arcane Lock", () => {
    const { state, door } = doorway({ fastenings: [{ kind: "lock" }] });
    expect(() =>
      useDoor(state, { wallId: door.id, actorId: HERO, how: "force", visibility: "public" }, GM, deps([20]))
    ).toThrowError("The door is locked. Pick the lock or break the door down.");
    const warded = doorway(undefined);
    arcaneLock(warded.state, warded.door.id, FRIEND, []);
    expect(() =>
      useDoor(
        warded.state,
        { wallId: warded.door.id, actorId: HERO, how: "force", visibility: "public" },
        GM,
        deps([20])
      )
    ).toThrowError("The door won't move: magic holds it shut. Break it down or dispel the magic.");
  });
});

describe("Iron Spikes", () => {
  it("jam a closed door shut with one spike of the ten", () => {
    const { state, door, doorOf } = doorway(undefined, [row("iron-spikes", "Spikes, Iron (10)")]);
    const jammed = useDoor(
      state,
      { wallId: door.id, actorId: HERO, how: "jam", visibility: "public" },
      PLAYER_A,
      deps([])
    );
    expect(jammed.text).toBe("Borin jams the door shut with an iron spike.");
    expect(heldShutAgainst(state, doorOf(state), FRIEND)).toBe("The door is jammed shut.");
    const spikes = state.actors.find((actor) => actor.id === HERO)!.inventory[0]!;
    expect(spikes).toMatchObject({ quantity: 1, ammunitionLeft: 9 });
  });
});

describe("Carpenter's and Smith's Tools", () => {
  // SRD Carpenter's Tools: "Seal or pry open a door or container (DC 20)"; Smith's Tools: "Pry open a door or
  // container (DC 20)".
  const use = (state: GameState, wallId: string, how: "pry" | "seal", face: number) =>
    useDoor(state, { wallId, actorId: HERO, how, visibility: "public" }, PLAYER_A, deps([face]));

  it("pry a barred door open on a DC 20 Strength check, and fail below it", () => {
    const shut = doorway({ fastenings: [{ kind: "barred", dc: 12 }] }, [row("smiths-tools", "Smith's Tools")]);
    expect(use(shut.state, shut.door.id, "pry", 10).opened).toBe(false);
    expect(shut.doorOf(shut.state).open).toBe(false);
    const pried = doorway({ fastenings: [{ kind: "barred", dc: 12 }] }, [row("smiths-tools", "Smith's Tools")]);
    expect(use(pried.state, pried.door.id, "pry", 20).text).toBe("Borin pries the door open.");
    expect(pried.doorOf(pried.state).open).toBe(true);
    expect(pried.doorOf(pried.state).door?.fastenings).toEqual([]);
  });

  it("need the tools, and can't pry a door Stone Shape sealed", () => {
    const bare = doorway({ fastenings: [{ kind: "stuck" }] });
    expect(() => use(bare.state, bare.door.id, "pry", 20)).toThrowError(
      "Borin needs Carpenter's or Smith's Tools to pry a door open."
    );
    const sealed = doorway({ fastenings: [{ kind: "sealed" }] }, [row("carpenters-tools", "Carpenter's Tools")]);
    expect(() => use(sealed.state, sealed.door.id, "pry", 20)).toThrowError(
      "The door is sealed shut. Break it down or shape the stone again."
    );
  });

  it("seal a closed door with Carpenter's Tools, which then forces open only at DC 20", () => {
    const { state, door, doorOf } = doorway(undefined, [row("carpenters-tools", "Carpenter's Tools")]);
    expect(use(state, door.id, "seal", 20).text).toBe("Borin seals the door shut.");
    expect(doorOf(state).door?.fastenings).toEqual([{ kind: "stuck", dc: 20 }]);
    expect(heldShutAgainst(state, doorOf(state), FRIEND)).toBe("The door is stuck.");
  });
});

describe("what players learn of a door", () => {
  it("sends a secret door as wall, and no lock at all", () => {
    const { state, door } = doorway({ fastenings: [{ kind: "lock", dc: 18 }], hidden: true });
    const vision = visionOf(state, [HERO], { definition: () => undefined });
    if (!vision.enabled) throw new Error("vision is on");
    const shown = vision.walls.find((candidate) => candidate.id === door.id);
    expect(shown).toEqual({ id: door.id, kind: "wall", a: door.a, b: door.b });
  });

  it("sends a locked door as a door, with nothing of its lock", () => {
    const { state, door } = doorway({ fastenings: [{ kind: "lock", dc: 18, keyHolderIds: [FRIEND] }] });
    const vision = visionOf(state, [HERO], { definition: () => undefined });
    if (!vision.enabled) throw new Error("vision is on");
    expect(vision.walls.find((candidate) => candidate.id === door.id)).toEqual({
      id: door.id,
      kind: "door",
      a: door.a,
      b: door.b,
      open: false
    });
  });

  it("sends a wall with a gap cut in it as the parts that stand", () => {
    const cut = { ...wall({ x: 250, y: 0 }, { x: 250, y: 600 }), openings: [{ from: 0.5, to: 0.75 }] };
    const state = visionGame({ walls: [cut], positions: { [HERO]: cell(4, 5) } });
    const vision = visionOf(state, [HERO], { definition: () => undefined });
    if (!vision.enabled) throw new Error("vision is on");
    expect(vision.walls.map((piece) => [piece.a, piece.b])).toEqual([
      [
        { x: 250, y: 0 },
        { x: 250, y: 300 }
      ],
      [
        { x: 250, y: 450 },
        { x: 250, y: 600 }
      ]
    ]);
  });
});
