// Party visibility is a projection decision: a withheld field must never reach the wire, so every
// assertion reads the projected (and for the sheet, the serialized) payload. The per-tier field
// table lives above `projectPlayerView` in `apps/server/src/projections.ts`.
import { describe, expect, it } from "vitest";
import { GameStateSchema, type GameState, type PartyVisibility } from "@vtt/domain";
import { ACTOR_DEFINITION_SCHEMA_VERSION, ActorDefinitionSchema, type ActorDefinition } from "@vtt/schemas";
import { projectPlayerView } from "../src/projections.js";

const MINE = "40000000-0000-4000-8000-0000000000a1";
const THEIRS = "40000000-0000-4000-8000-0000000000a2";
const FREE = "40000000-0000-4000-8000-0000000000a3";
const GOBLIN = "40000000-0000-4000-8000-0000000000a4";
const ME = "30000000-0000-4000-8000-0000000000b1";
const THEM = "30000000-0000-4000-8000-0000000000b2";

/** A distinctive string per sheet, so "did this sheet cross the wire?" is a substring question. */
const definitionOf = (name: string, className: string, level: number, secret: string): ActorDefinition =>
  ActorDefinitionSchema.parse({
    schemaId: "vtt.actor-character",
    schemaVersion: ACTOR_DEFINITION_SCHEMA_VERSION,
    source: { name: "test", version: "1" },
    name,
    size: "medium",
    armorClass: 14,
    proficiencyBonus: 3,
    initiativeBonus: 0,
    speedFeet: 30,
    abilityScores: { str: 10, dex: 14, con: 12, int: 16, wis: 10, cha: 8 },
    hitPoints: { maximum: 30 },
    extensions: {},
    token: { disposition: "friendly" },
    // Two actions sharing one pool plus a solo one: the shared ceiling is the max over its members.
    actions: [
      {
        id: "divine-spark",
        name: "Channel Divinity: Divine Spark",
        activation: "action",
        description: "A surge of divine energy.",
        uses: { limit: 2, per: "short-rest", pool: "channel-divinity" }
      },
      {
        id: "preserve-life",
        name: "Channel Divinity: Preserve Life",
        activation: "action",
        description: "You restore the wounded.",
        uses: { limit: 1, per: "short-rest", pool: "channel-divinity" }
      },
      {
        id: "second-wind",
        name: "Second Wind",
        activation: "bonus-action",
        description: "You catch your breath.",
        uses: { limit: 3, per: "short-rest" }
      }
    ],
    character: {
      classes: [{ id: className.toLowerCase(), name: className, level }],
      feats: [],
      background: { id: "sage", name: secret }
    }
  });

function tableAt(partyVisibility: PartyVisibility): GameState {
  const pc = (id: string, name: string, owner: string | null, definitionId: string) => ({
    id,
    name,
    kind: "player-character",
    visibility: "public",
    hp: { current: 20, maximum: 30 },
    ownerSessionId: owner,
    definitionId,
    spellSlots: [{ level: 1, remaining: 2 }],
    preparedSpellIds: ["fireball"],
    inventory: [{ id: "rod", name: "Rod of Tellings" }],
    currency: { gp: 12 },
    actionUses: { "second-wind": 1 },
    hitDice: { die: "d8", maximum: 5, remaining: 3, entries: [{ die: "d8", maximum: 5, remaining: 3 }] }
  });
  return GameStateSchema.parse({
    schemaVersion: 1,
    partyVisibility,
    actors: [
      pc(MINE, "My Hero", ME, "import-mine"),
      pc(THEIRS, "Their Hero", THEM, "import-theirs"),
      pc(FREE, "Nobody's Hero", null, "import-free"),
      { id: GOBLIN, name: "Goblin", kind: "monster", visibility: "public", hp: { current: 3, maximum: 7 } }
    ],
    definitions: [
      { id: "import-mine", definition: definitionOf("My Hero", "Cleric", 3, "MINE-SECRET") },
      { id: "import-theirs", definition: definitionOf("Their Hero", "Wizard", 7, "THEIRS-SECRET") },
      { id: "import-free", definition: definitionOf("Nobody's Hero", "Bard", 2, "FREE-SECRET") }
    ],
    combat: { active: false }
  });
}

const viewAt = (tier: PartyVisibility) => projectPlayerView(tableAt(tier), ME, () => null);
const actorIn = (tier: PartyVisibility, id: string) => viewAt(tier).actors.find((actor) => actor.id === id);

const RESOURCES = [
  "actionUses",
  "pools",
  "hitDice",
  "spellSlots",
  "pactSlots",
  "preparedSpellIds",
  "inventory",
  "currency"
] as const;
const TIERS: readonly PartyVisibility[] = ["off", "name-and-class", "full-sheet", "sheet-and-resources"];

describe("party visibility: the tier is enforced in projectPlayerView, on the server", () => {
  it("defaults to name-and-class for a save written before the field existed (additive parse)", () => {
    expect(GameStateSchema.parse({ schemaVersion: 1 }).partyVisibility).toBe("name-and-class");
  });

  it("projects the applied tier onto PlayerView so the client renders the shape it was given", () => {
    for (const tier of TIERS) expect(viewAt(tier).partyVisibility).toBe(tier);
  });

  it("at off, another player keeps their base entry and loses the whole party surface", () => {
    const theirs = actorIn("off", THEIRS);
    expect(theirs, "off removed the actor entry - it subtracts fields, never combatants").toBeDefined();
    // The base entry the map and the turn order need is intact...
    expect(theirs!.name).toBe("Their Hero");
    expect(theirs!.claimStatus).toBe("claimed");
    expect(theirs!.hp).toEqual({ kind: "exact", current: 20, maximum: 30, temporary: 0 });
    // ...and nothing a sheet is made of survives.
    expect(theirs!.classLine).toBeUndefined();
    expect(theirs!.definition).toBeUndefined();
    for (const field of RESOURCES) expect(field in theirs!, `${field} leaked at off`).toBe(false);
    expect(JSON.stringify(viewAt("off"))).not.toContain("THEIRS-SECRET");
  });

  // `partyVisibility` does not govern `projectPlayerCombat`, so dropping an ally's actor entry would
  // leave them named in the turn order with no actor to resolve their token. The fight must stay coherent.
  it("keeps the encounter coherent at every tier: the turn order, the tokens and the actor list agree", () => {
    for (const tier of TIERS) {
      const state = tableAt(tier);
      state.combat = {
        ...state.combat,
        active: true,
        turnActorId: MINE,
        mapAssetId: "50000000-0000-5000-8000-000000000001",
        initiative: [
          { actorId: MINE, score: 18, tieBreaker: 0 },
          { actorId: THEIRS, score: 13, tieBreaker: 0 },
          { actorId: GOBLIN, score: 9, tieBreaker: 0 }
        ],
        tokens: [MINE, THEIRS, GOBLIN].map((actorId) => ({
          actorId,
          position: { x: 10, y: 10 },
          sizePx: 40,
          sizeCells: 1,
          gridSizePx: 50,
          gridRotationRadians: 0
        }))
      };
      const view = projectPlayerView(GameStateSchema.parse(state), ME, () => null);
      const ids = new Set(view.actors.map((actor) => actor.id));
      expect(
        view.combat.initiative.some((entry) => entry.actorId === THEIRS),
        `ally missing from the turn order at ${tier}`
      ).toBe(true);
      expect(
        view.combat.tokens.some((token) => token.actorId === THEIRS),
        `ally's token missing at ${tier}`
      ).toBe(true);
      // Every combatant the player is shown must resolve to an actor they were also given, or the map
      // renders an empty square where a teammate is standing.
      for (const token of view.combat.tokens)
        expect(ids.has(token.actorId), `token ${token.actorId} has no actor at tier ${tier}`).toBe(true);
      for (const entry of view.combat.initiative)
        expect(ids.has(entry.actorId), `initiative entry ${entry.actorId} has no actor at tier ${tier}`).toBe(true);
    }
  });

  it("never gates the requesting player's OWN character on the tier - the mine branch is untouched", () => {
    for (const tier of TIERS) {
      const mine = actorIn(tier, MINE);
      expect(mine, `own character missing at tier ${tier}`).toBeDefined();
      expect(mine!.definition?.name, `own sheet withheld at tier ${tier}`).toBe("My Hero");
      for (const field of RESOURCES) expect(field in mine!, `own ${field} withheld at tier ${tier}`).toBe(true);
      // The class line is not duplicated onto your own character; you hold the whole definition.
      expect(mine!.classLine).toBeUndefined();
    }
  });

  it("at name-and-class, another player is the identity card: a class line and no sheet at all", () => {
    const theirs = actorIn("name-and-class", THEIRS)!;
    expect(theirs.classLine).toBe("Wizard 7");
    expect(theirs.definition).toBeUndefined();
    for (const field of RESOURCES) expect(field in theirs, `${field} leaked at name-and-class`).toBe(false);
    expect(JSON.stringify(viewAt("name-and-class"))).not.toContain("THEIRS-SECRET");
  });

  it("at full-sheet, another player's sheet arrives and their live resources still do not", () => {
    const theirs = actorIn("full-sheet", THEIRS)!;
    expect(theirs.classLine).toBe("Wizard 7");
    expect(theirs.definition?.name).toBe("Their Hero");
    for (const field of RESOURCES) expect(field in theirs, `${field} leaked at full-sheet`).toBe(false);
  });

  it("at sheet-and-resources, another player's live resources arrive too - and are copies, never live references", () => {
    const state = tableAt("sheet-and-resources");
    const theirs = projectPlayerView(state, ME, () => null).actors.find((actor) => actor.id === THEIRS)!;
    expect(theirs.definition?.name).toBe("Their Hero");
    for (const field of RESOURCES) expect(field in theirs, `${field} withheld at sheet-and-resources`).toBe(true);
    expect(theirs.inventory).toEqual([
      { id: "rod", name: "Rod of Tellings", quantity: 1, equipped: false, attuned: false }
    ]);
    const source = state.actors.find((actor) => actor.id === THEIRS)!;
    expect(theirs.inventory).not.toBe(source.inventory);
    expect(theirs.spellSlots).not.toBe(source.spellSlots);
    expect(theirs.hitDice!.entries).not.toBe(source.hitDice!.entries);
  });

  it("governs claimed party members only: an unclaimed character and a monster are unchanged at every tier", () => {
    for (const tier of TIERS) {
      const free = actorIn(tier, FREE);
      const goblin = actorIn(tier, GOBLIN);
      expect(free, `unclaimed character dropped at tier ${tier}`).toBeDefined();
      expect(goblin, `monster dropped at tier ${tier}`).toBeDefined();
      // Neither ever gains a sheet or resources, however permissive the tier is. The unclaimed character carries
      // its class line at every tier, for the claim picker: anyone may claim it and read the whole sheet.
      expect(free!.definition, `unclaimed sheet leaked at tier ${tier}`).toBeUndefined();
      expect(free!.classLine, `unclaimed class line at tier ${tier}`).toBe("Bard 2");
      expect(goblin!.classLine).toBeUndefined();
      expect(goblin!.definition).toBeUndefined();
      for (const field of RESOURCES) expect(field in free!, `unclaimed ${field} leaked at tier ${tier}`).toBe(false);
      expect(JSON.stringify(viewAt(tier)), `unclaimed sheet serialized at tier ${tier}`).not.toContain("FREE-SECRET");
    }
  });

  it("never lets any tier widen what is GM-only for everyone", () => {
    for (const tier of TIERS) {
      for (const actor of viewAt(tier).actors) {
        for (const field of [
          "notes",
          "ownerSessionId",
          "conditionImmunities",
          "legendary",
          "lastUsedAt",
          "archived",
          "sheetPreview"
        ]) {
          expect(field in actor, `${field} reached a player at tier ${tier}`).toBe(false);
        }
      }
      expect(JSON.stringify(viewAt(tier))).not.toContain(THEM);
    }
  });

  it("omits classLine rather than sending an empty string when a sheet records no class", () => {
    const state = tableAt("name-and-class");
    state.definitions = state.definitions.filter((entry) => entry.id !== "import-theirs");
    const theirs = projectPlayerView(state, ME, () => null).actors.find((actor) => actor.id === THEIRS)!;
    expect("classLine" in theirs).toBe(false);
  });
});

// `pools` names the pools behind `actionUses` (spent counts) and their ceilings. It is a pure function
// of the definition's actions computed at projection time, so there is nothing to store or sync.
describe("pools: the shape a resource tracker binds to", () => {
  it("names every pool, keyed by the exact actionUses key, with the ceiling the engine enforces", () => {
    const mine = actorIn("sheet-and-resources", MINE)!;
    expect(mine.pools).toEqual([
      // The shared pool: keyed on `uses.pool`, ceiling 2 (the max over its members, above Preserve Life's
      // printed 1), and named from the slug.
      { id: "channel-divinity", name: "Channel Divinity", limit: 2, per: "short-rest" },
      // The solo pool: keyed on the action id and named from that action.
      { id: "second-wind", name: "Second Wind", limit: 3, per: "short-rest" }
    ]);
  });

  it("uses the same keys actionUses is indexed by, so a tracker can join the two", () => {
    // Pool ids and `actionUses` keys must share one namespace, or a ceiling would sit beside the wrong count.
    const mine = actorIn("sheet-and-resources", MINE)!;
    for (const key of Object.keys(mine.actionUses!)) {
      expect(
        mine.pools!.some((pool) => pool.id === key),
        `actionUses key "${key}" has no pool entry`
      ).toBe(true);
    }
    expect(mine.actionUses).toEqual({ "second-wind": 1 });
  });

  it("reaches a player under the SAME gate as actionUses, and no wider", () => {
    // `pools` derives from `definition.actions[].uses`, and the definition already ships one tier lower
    // (`full-sheet`), so pools never reveal a limit that was not already knowable.
    for (const tier of TIERS) {
      const theirs = actorIn(tier, THEIRS)!;
      expect("pools" in theirs, `pools at ${tier}`).toBe(tier === "sheet-and-resources");
      expect("pools" in theirs).toBe("actionUses" in theirs);
      // Where the sheet is visible, every ceiling pools reports is already readable off it.
      if ("definition" in theirs) {
        expect(theirs.definition!.actions.map((action) => action.uses?.limit)).toEqual([2, 1, 3]);
      }
    }
  });

  it("is absent on a monster and on an unclaimed character, which carry no sheet at all", () => {
    const view = viewAt("sheet-and-resources");
    expect("pools" in view.actors.find((actor) => actor.id === GOBLIN)!).toBe(false);
    expect("pools" in view.actors.find((actor) => actor.id === FREE)!).toBe(false);
  });

  it("names an unclaimed character's species and class for the claim picker, and drops them once it is claimed", async () => {
    const { createInitialGameState } = await import("../src/initial-game-state.js");
    const state = createInitialGameState();
    const picker = projectPlayerView(state, ME, () => null).actors;
    expect(picker.map((actor) => [actor.species, actor.classLine])).toEqual([
      ["Dwarf", "Fighter 7"],
      ["Human", "Cleric 7"],
      ["Elf", "Wizard 7"]
    ]);
    for (const actor of picker) expect(actor.definition).toBeUndefined();
    state.partyVisibility = "off";
    state.actors[0]!.ownerSessionId = "40000000-0000-4000-8000-0000000000ff";
    const claimed = projectPlayerView(state, ME, () => null).actors[0]!;
    expect(claimed.species).toBeUndefined();
    expect(claimed.classLine).toBeUndefined();
  });
});
