import { describe, expect, it } from "vitest";
import { GameStateSchema, type RollRecord, type RollVisibility } from "@vtt/domain";
import { projectGmView, projectPlayerView } from "../src/projections.js";
import { addPing } from "../src/annotations.js";

const playerA = "b539ef5e-16e6-46ce-bf33-3ed4b02997c1";
const playerB = "65cc7d6b-1150-41c4-aa9f-390439313f53";
const noPresence = () => null;
function roll(visibility: RollVisibility, index: number): RollRecord {
  return { id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, commandId: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`, initiatorSessionId: playerA, initiatorRole: "player", initiatorLabel: "A player", actorId: null, purpose: "manual", visibility, formula: "1d20", normalizedFormula: "1d20", dice: [{ group: 0, sides: 20, face: 12, kept: true, sign: 1 }], modifiers: [], total: 12, createdAt: "2026-07-15T12:00:00.000Z" };
}

describe("recipient-specific roll projections", () => {
  const state = GameStateSchema.parse({ schemaVersion: 1, rolls: [roll("public", 1), roll("self-only", 2), roll("blind", 3), roll("gm-only", 4)] });
  it("shows a player public and their own self-only rolls, without private session IDs", () => {
    const view = projectPlayerView(state, playerA, noPresence);
    expect(view.rolls.map(({ visibility }) => visibility)).toEqual(["public", "self-only"]);
    expect(view.rolls.every((entry) => !("initiatorSessionId" in entry))).toBe(true);
  });
  it("does not show another player self-only, blind, or GM-only rolls", () => { expect(projectPlayerView(state, playerB, noPresence).rolls.map(({ visibility }) => visibility)).toEqual(["public"]); });
  it("shows the GM every roll", () => { expect(projectGmView(state, noPresence).rolls).toHaveLength(4); });
});

describe("player-safe character claim projections", () => {
  const actors = [
    { id: "60a6e172-9ff5-44a3-8a8b-93f836f0d16b", name: "Available", kind: "player-character", visibility: "public", hp: { current: 10, maximum: 10, temporary: 0 }, ownerSessionId: null, notes: "GM only" },
    { id: "60a6e172-9ff5-44a3-8a8b-93f836f0d16c", name: "Mine", kind: "player-character", visibility: "public", hp: { current: 10, maximum: 10, temporary: 0 }, ownerSessionId: playerA, notes: "GM only" },
    { id: "60a6e172-9ff5-44a3-8a8b-93f836f0d16d", name: "Claimed", kind: "player-character", visibility: "public", hp: { current: 10, maximum: 10, temporary: 0 }, ownerSessionId: playerB, notes: "GM only" }
  ];
  const state = GameStateSchema.parse({ schemaVersion: 1, actors });

  it("reports safe claim states without owner IDs or notes", () => {
    const projected = projectPlayerView(state, playerA, noPresence);
    expect(projected.actors.map(({ claimStatus }) => claimStatus)).toEqual(["available", "mine", "claimed"]);
    expect(projected.actors.every((actor) => !("ownerSessionId" in actor) && !("notes" in actor))).toBe(true);
  });

  it("never sends a session ID, token, socket ID, or address for any actor, presence included", () => {
    const projected = projectPlayerView(state, playerA, noPresence);
    const serialized = JSON.stringify(projected);
    expect(serialized).not.toContain(playerA);
    expect(serialized).not.toContain(playerB);
  });
});

describe("owner-only character-sheet resources", () => {
  const owned = {
    id: "60a6e172-9ff5-44a3-8a8b-93f836f0d16c", name: "Mine", kind: "player-character", visibility: "public",
    hp: { current: 10, maximum: 10, temporary: 0 }, ownerSessionId: playerA,
    spellSlots: [{ level: 1, remaining: 2 }], pactSlots: { level: 1, remaining: 1 }, preparedSpellIds: ["magic-missile"],
    inventory: [{ id: "secret-blade", name: "Secret Blade of Testing", quantity: 1, equipped: true }],
    currency: { cp: 0, sp: 0, ep: 0, gp: 42, pp: 0 }
  };
  const state = GameStateSchema.parse({ schemaVersion: 1, actors: [owned] });

  it("sends spell slots, prepared spells, inventory, and currency to the owning player only", () => {
    const mine = projectPlayerView(state, playerA, noPresence).actors[0];
    expect(mine.spellSlots).toEqual([{ level: 1, remaining: 2 }]);
    expect(mine.pactSlots).toEqual({ level: 1, remaining: 1 });
    expect(mine.preparedSpellIds).toEqual(["magic-missile"]);
    expect(mine.inventory).toHaveLength(1);
    expect(mine.currency).toMatchObject({ gp: 42 });
  });

  it("never leaks another player's sheet resources (viewer safety / role boundary)", () => {
    const theirs = projectPlayerView(state, playerB, noPresence).actors[0];
    for (const field of ["spellSlots", "pactSlots", "preparedSpellIds", "inventory", "currency"]) expect(field in theirs, `leaked ${field}`).toBe(false);
    expect(JSON.stringify(projectPlayerView(state, playerB, noPresence))).not.toContain("Secret Blade of Testing");
  });

  it("gives the GM the full live resources", () => {
    const gm = projectGmView(state, noPresence).actors[0];
    expect(gm.inventory).toHaveLength(1);
    expect(gm.currency).toMatchObject({ gp: 42 });
    expect(gm.spellSlots).toEqual([{ level: 1, remaining: 2 }]);
  });
});

describe("archived characters (v4 #10, GM management)", () => {
  const archived = { id: "60a6e172-9ff5-44a3-8a8b-93f836f0d16c", name: "Retired Hero", kind: "player-character", visibility: "public", hp: { current: 10, maximum: 10, temporary: 0 }, ownerSessionId: null, archived: true };
  const active = { id: "70a6e172-9ff5-44a3-8a8b-93f836f0d16c", name: "Active Hero", kind: "player-character", visibility: "public", hp: { current: 8, maximum: 8, temporary: 0 }, ownerSessionId: null };
  const state = GameStateSchema.parse({ schemaVersion: 1, actors: [archived, active] });

  it("hides archived characters from players entirely, and never leaks the archived flag", () => {
    const view = projectPlayerView(state, playerA, noPresence);
    expect(view.actors.map((actor) => actor.name)).toEqual(["Active Hero"]);
    expect(JSON.stringify(view)).not.toContain("Retired Hero");
    // The KEY, not the substring: `archivedCharacters` (the shared-keepsake door, empty here) is a
    // legitimate player-facing field, so a bare "archived" search would now match itself. What must
    // never appear is the management FLAG on an actor - or its sheet-sharing sibling.
    expect(JSON.stringify(view)).not.toContain("\"archived\":");
    expect(JSON.stringify(view)).not.toContain("sheetPreview");
    expect(view.archivedCharacters).toEqual([]);
  });

  it("offers an archived character's name only after the GM shares its sheet, and nothing else about them", () => {
    const shared = GameStateSchema.parse({ schemaVersion: 1, actors: [{ ...archived, sheetPreview: true, notes: "GM plot notes" }, active] });
    const view = projectPlayerView(shared, playerA, noPresence);
    expect(view.archivedCharacters).toEqual([{ id: archived.id, name: "Retired Hero" }]);
    // The door carries id and name. It must not become a second, quieter actor projection.
    expect(Object.keys(view.archivedCharacters[0]).sort()).toEqual(["id", "name"]);
    expect(view.actors.map((actor) => actor.name)).toEqual(["Active Hero"]);
    expect(JSON.stringify(view)).not.toContain("GM plot notes");
  });

  it("keeps a shared archived character hidden while it is gm-only", () => {
    const hidden = GameStateSchema.parse({ schemaVersion: 1, actors: [{ ...archived, sheetPreview: true, visibility: "gm-only" }, active] });
    expect(projectPlayerView(hidden, playerA, noPresence).archivedCharacters).toEqual([]);
  });

  it("does not advertise an archived character the GM has not shared", () => {
    expect(projectPlayerView(GameStateSchema.parse({ schemaVersion: 1, actors: [archived, active] }), playerA, noPresence).archivedCharacters).toEqual([]);
  });

  it("keeps archived characters in the GM view (so the roster tab can manage them)", () => {
    const gm = projectGmView(state, noPresence);
    expect(gm.actors.map((actor) => actor.name).sort()).toEqual(["Active Hero", "Retired Hero"]);
    expect(gm.actors.find((actor) => actor.name === "Retired Hero")?.archived).toBe(true);
  });
});

describe("player-hit damage proposals stay GM-only (viewer safety / role boundary)", () => {
  const attacker = "60000000-0000-4000-8000-000000000001";
  const target = "60000000-0000-4000-8000-000000000002";
  const proposal = { id: "80000000-0000-4000-8000-000000000001", sourceActorId: attacker, sourceName: "Alpha", actionName: "Claw", targetActorId: target, targetName: "Goblin", proposedDamageParts: [{ amount: 7, type: "slashing" }], proposedTotal: 7, critical: false, createdAt: 1000 };
  const state = GameStateSchema.parse({
    schemaVersion: 1,
    actors: [
      { id: attacker, name: "Alpha", kind: "player-character", visibility: "public", hp: { current: 20, maximum: 20 }, ownerSessionId: playerA },
      { id: target, name: "Goblin", kind: "monster", visibility: "public", hp: { current: 15, maximum: 15 } }
    ],
    combat: { active: true, round: 1, turnActorId: attacker, mapAssetId: "70000000-0000-5000-8000-000000000001", initiative: [{ actorId: attacker, score: 20 }, { actorId: target, score: 5 }], playerDamageMode: "proposal", pendingDamage: [proposal] }
  });

  it("never sends pendingDamage to the acting player, another player, or an anonymous viewer", () => {
    for (const session of [playerA, playerB, undefined]) {
      const view = projectPlayerView(state, session, noPresence);
      expect("pendingDamage" in view.combat).toBe(false);
    }
  });

  it("exposes only the harmless playerDamageMode policy to players (so the runner can label the outcome)", () => {
    expect(projectPlayerView(state, playerA, noPresence).combat.playerDamageMode).toBe("proposal");
  });

  it("gives the GM the full pendingDamage list", () => {
    const gm = projectGmView(state, noPresence);
    expect(gm.combat.pendingDamage).toHaveLength(1);
    expect(gm.combat.pendingDamage[0]).toMatchObject({ targetActorId: target, proposedTotal: 7 });
  });

  it("defaults playerDamageMode to proposal and pendingDamage to empty on a pre-existing combat (additive schema)", () => {
    const legacy = GameStateSchema.parse({ schemaVersion: 1, combat: { active: false, round: 1, turnActorId: null, mapAssetId: null, initiative: [], tokens: [], annotations: [] } });
    expect(legacy.combat.playerDamageMode).toBe("proposal");
    expect(legacy.combat.pendingDamage).toEqual([]);
  });
});

describe("presence projection", () => {
  const actors = [
    { id: "60a6e172-9ff5-44a3-8a8b-93f836f0d16b", name: "Unclaimed", kind: "player-character", visibility: "public", hp: { current: 10, maximum: 10, temporary: 0 }, ownerSessionId: null, notes: "" },
    { id: "60a6e172-9ff5-44a3-8a8b-93f836f0d16c", name: "Online owner", kind: "player-character", visibility: "public", hp: { current: 10, maximum: 10, temporary: 0 }, ownerSessionId: playerA, notes: "" },
    { id: "60a6e172-9ff5-44a3-8a8b-93f836f0d16d", name: "Reconnecting owner", kind: "player-character", visibility: "public", hp: { current: 10, maximum: 10, temporary: 0 }, ownerSessionId: playerB, notes: "" }
  ];
  const state = GameStateSchema.parse({ schemaVersion: 1, actors });
  const presenceFor = (sessionId: string) => (sessionId === playerA ? ("online" as const) : sessionId === playerB ? ("reconnecting" as const) : null);

  it("attaches presence per owner in the player view without exposing the owning session ID", () => {
    const projected = projectPlayerView(state, "someone-else", presenceFor);
    expect(projected.actors.map((actor) => actor.presence)).toEqual([null, "online", "reconnecting"]);
    expect(JSON.stringify(projected)).not.toContain(playerA);
    expect(JSON.stringify(projected)).not.toContain(playerB);
  });

  it("attaches presence per owner in the GM view alongside the owning session ID it already carries", () => {
    const projected = projectGmView(state, presenceFor);
    expect(projected.actors.map((actor) => actor.presence)).toEqual([null, "online", "reconnecting"]);
  });

  it("reports null presence for an unclaimed actor even if the lookup would otherwise resolve", () => {
    const alwaysOnline = () => "online" as const;
    const projected = projectPlayerView(state, undefined, alwaysOnline);
    expect(projected.actors[0].presence).toBeNull();
  });
});

describe("GM view drops expired ephemeral annotations", () => {
  const calibration = { kind: "square" as const, origin: { x: 0, y: 0 }, cellSizePx: 50, rotationRadians: 0, distancePerCell: 5 };
  const geometry = { width: 1000, height: 1000, calibration };
  const gmActor = { sessionId: playerA, role: "gm" as const };
  const combatant = "60000000-0000-4000-8000-000000000001";
  function twoPings() {
    const state = GameStateSchema.parse({
      schemaVersion: 1,
      actors: [{ id: combatant, name: "Hero", kind: "player-character", hp: { current: 10, maximum: 10 } }],
      combat: { active: true, round: 1, turnActorId: combatant, mapAssetId: "70000000-0000-5000-8000-000000000001", initiative: [{ actorId: combatant, score: 20 }] }
    });
    addPing(state, { id: "20000000-0000-4000-8000-000000000001", point: { x: 100, y: 100 }, label: "GM", actor: gmActor, now: 1000 }, geometry); // expires 5000
    addPing(state, { id: "20000000-0000-4000-8000-000000000002", point: { x: 150, y: 150 }, label: "GM", actor: gmActor, now: 2000 }, geometry); // expires 6000
    return state;
  }

  // Regression: the GM projection used to spread state verbatim, so an expired ping only vanished on
  // the next add (not on the scheduled expiry re-broadcast) - pings lingered on the GM's own screen.
  it("hides a ping past its expiry while keeping a still-live one", () => {
    const view = projectGmView(twoPings(), noPresence, 5500);
    expect(view.combat.annotations.map((annotation) => annotation.id)).toEqual(["20000000-0000-4000-8000-000000000002"]);
  });
  it("keeps both pings before either expires", () => {
    expect(projectGmView(twoPings(), noPresence, 4000).combat.annotations).toHaveLength(2);
  });
});
