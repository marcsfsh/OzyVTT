import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import {
  BackgroundReferenceSchema,
  ClassReferenceSchema,
  EquipmentReferenceSchema,
  FeatReferenceSchema,
  SpeciesReferenceSchema,
  SpellListReferenceSchema,
  SpellReferenceSchema,
  SubclassReferenceSchema,
  loadSpells
} from "@vtt/content-srd-5.2.1";
import { ActorDefinitionSchema, type ActorDefinition } from "@vtt/schemas";
import { CombatLogStore } from "../src/combat-log.js";
import {
  ContentLibrary,
  type ContentAudience,
  type HomebrewCatalogSlice,
  type HomebrewContentSource
} from "../src/content-library.js";
import { GameAccessDeniedError } from "../src/authorization.js";
import {
  createGameCommands,
  type CommandContext,
  type GameCommands,
  type GamePrincipal
} from "../src/commands/index.js";
import { GameStore } from "../src/game-store.js";
import { HomebrewStore } from "../src/homebrew-store.js";

// Every content read must respect the caller's audience once homebrew merges in. Against a fake
// `HomebrewContentSource`: drafts reach no catalog, published-but-hidden records reach only the GM, and
// every `content*` operation is classified as player-readable or GM-only.

// ---------- The fake homebrew source ----------

/** The three states a homebrew record can be in, as marker strings that appear in every id and name. */
const TIERS = ["draftonly", "gmonly", "playersafe"] as const;
type Tier = (typeof TIERS)[number];

const titled = (tier: Tier) => `${tier[0].toUpperCase()}${tier.slice(1)}`;

/** A minimal but schema-valid record of every authorable type, tagged with its tier in id and name. */
const levelTable = Array.from({ length: 20 }, (_, index) => ({
  level: index + 1,
  proficiencyBonus: 2 + Math.floor(index / 4)
}));

function sliceFor(tier: Tier): HomebrewCatalogSlice {
  const name = titled(tier);
  return {
    classes: [
      ClassReferenceSchema.parse({
        id: `hb-${tier}-class`,
        name: `${name} Class`,
        source: "homebrew",
        // A distinctive hit die and ASI spread: the progression-table assertion below reads them back.
        hitDie: "d12",
        statPriority: ["str", "con", "dex", "wis", "int", "cha"],
        primaryAbilities: ["str"],
        savingThrows: ["str", "con"],
        skillChoices: { choose: 2, from: ["athletics", "perception"] },
        asiLevels: [4, 8, 12, 16, 19],
        subclassLevel: 3,
        levelTable
      })
    ],
    subclasses: [
      SubclassReferenceSchema.parse({
        id: `hb-${tier}-subclass`,
        name: `${name} Subclass`,
        source: "homebrew",
        classId: `hb-${tier}-class`
      })
    ],
    species: [
      SpeciesReferenceSchema.parse({
        id: `hb-${tier}-species`,
        name: `${name} Species`,
        source: "homebrew",
        speedFeet: 30
      })
    ],
    backgrounds: [
      BackgroundReferenceSchema.parse({ id: `hb-${tier}-background`, name: `${name} Background`, source: "homebrew" })
    ],
    feats: [
      FeatReferenceSchema.parse({
        id: `hb-${tier}-feat`,
        name: `${name} Feat`,
        source: "homebrew",
        feature: { id: `hb-${tier}-feat-feature`, name: `${name} Feat`, description: "A homebrew feat." }
      })
    ],
    spells: [
      SpellReferenceSchema.parse({
        // `source` defaults to "srd", so the fake must set it or it would assert homebrew is bundled content.
        id: `hb-${tier}-spell`,
        name: `${name} Spell`,
        source: "homebrew",
        level: 1,
        school: "evocation",
        castingTime: "1 action",
        reactionCondition: null,
        range: { distance: 30, unit: "feet", text: "30 feet" },
        components: { verbal: true, somatic: false, material: false, materialText: null, materialConsumed: false },
        duration: "Instantaneous",
        concentration: false,
        ritual: false,
        attackRoll: false,
        damage: { roll: null, types: [] },
        save: null,
        target: { type: null, count: null },
        shape: null,
        classes: [],
        description: "A homebrew spell.",
        higherLevel: null,
        castingOptions: []
      })
    ],
    equipment: [
      EquipmentReferenceSchema.parse({
        id: `hb-${tier}-item`,
        name: `${name} Item`,
        source: "homebrew",
        category: "wondrous",
        costGp: null,
        weightLb: null,
        description: null
      })
    ],
    monsters: [monsterFor(tier)],
    // A membership overlay: it stamps this tier's list id into the tier's own spell, so an overlay that
    // crossed the audience boundary shows up as a leaked id in a player-visible spell's `classes`.
    spellLists: [
      SpellListReferenceSchema.parse({
        id: `hb-${tier}-list`,
        name: `${name} List`,
        source: "homebrew",
        add: [`hb-${tier}-spell`]
      })
    ]
  };
}

function monsterFor(tier: Tier): ActorDefinition {
  return ActorDefinitionSchema.parse({
    schemaId: "vtt.actor-monster",
    schemaVersion: 1,
    source: { name: "Homebrew", version: "1", externalId: `hb-m-${tier}` },
    name: `${titled(tier)} Monster`,
    size: "medium",
    abilityScores: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    armorClass: 12,
    hitPoints: { maximum: 10 },
    speedFeet: 30,
    actions: [
      {
        id: "smash",
        name: "Smash",
        activation: "action",
        description: "It smashes.",
        damage: [{ formula: "1d6", type: "bludgeoning" }]
      }
    ]
  });
}

const SLICES: Readonly<Record<Tier, HomebrewCatalogSlice>> = {
  draftonly: sliceFor("draftonly"),
  gmonly: sliceFor("gmonly"),
  playersafe: sliceFor("playersafe")
};

const concatSlices = (...slices: readonly HomebrewCatalogSlice[]): HomebrewCatalogSlice => ({
  classes: slices.flatMap((slice) => slice.classes),
  subclasses: slices.flatMap((slice) => slice.subclasses),
  species: slices.flatMap((slice) => slice.species),
  backgrounds: slices.flatMap((slice) => slice.backgrounds),
  feats: slices.flatMap((slice) => slice.feats),
  spells: slices.flatMap((slice) => slice.spells),
  equipment: slices.flatMap((slice) => slice.equipment),
  monsters: slices.flatMap((slice) => slice.monsters),
  spellLists: slices.flatMap((slice) => slice.spellLists)
});

// The contract the real store must satisfy: `publishedFor` never returns a draft to either audience,
// and the GM's slice is the player's plus the published-but-invisible records.
function fakeHomebrew(revision = 1): HomebrewContentSource {
  const byExternalId = new Map(TIERS.map((tier) => [`hb-m-${tier}`, SLICES[tier].monsters[0]]));
  return {
    revision,
    publishedFor: (audience: ContentAudience) =>
      audience === "gm" ? concatSlices(SLICES.gmonly, SLICES.playersafe) : SLICES.playersafe,
    // Status-blind, including drafts: the live-instance lookup.
    monsterForInstance: (id: string) => byExternalId.get(id)
  };
}

// ---------- The reads under test ----------

const GM: GamePrincipal = { kind: "gm", sessionId: "11111111-1111-4111-8111-111111111111" };
const PLAYER: GamePrincipal = { kind: "player", sessionId: "22222222-2222-4222-8222-222222222222" };
const INTEGRATION: GamePrincipal = {
  kind: "integration",
  credentialId: "33333333-3333-4333-8333-333333333333",
  name: "Overlay"
};

/** Content reads touch neither persistence nor projections, so everything else in the context is an unused stub. */
function readsWith(contentLibrary: ContentLibrary): GameCommands {
  const unused = () => {
    throw new Error("a content read must not touch this");
  };
  return createGameCommands({
    // Never initialized, so nothing is written: `snapshot` still serves the parsed default state.
    store: new GameStore(join(tmpdir(), "vtt-homebrew-visibility-unused.sqlite")),
    combatLog: new CombatLogStore(join(tmpdir(), "vtt-homebrew-visibility-unused-log.sqlite")),
    contentLibrary,
    mapCatalog: { get: () => undefined },
    tokenCatalog: { get: () => undefined, touchLastUsed: () => {}, rememberForDefinition: () => {} },
    tokenGeometryFor: unused,
    publishGameState: async () => {},
    presentSceneMap: async () => {},
    broadcastTableEvent: () => {},
    appendLog: () => {},
    logTurnBegin: () => {},
    logTimelineOutcome: () => {},
    scheduleAnnotationExpiry: () => {},
    gmView: unused,
    playerView: unused,
    random: () => 1,
    newId: () => "44444444-4444-4444-8444-444444444444"
  } as unknown as CommandContext);
}

// The classification every `content:*` read must appear in. These two lists are checked against the read
// table itself, so a new content read cannot be added without a decision here.
const PLAYER_READABLE_CONTENT_READS = [
  "content:conditions",
  "content:skills",
  "content:languages",
  "content:spells",
  "content:equipment",
  "content:classes",
  "content:subclasses",
  "content:species",
  "content:backgrounds",
  "content:feats",
  "content:names"
] as const;
/** The bestiary and stat blocks: GM-grade only, and that gate is asserted below rather than assumed. */
const GM_ONLY_CONTENT_READS = ["content:monsters", "content:monster-actions", "content:monster-sheet"] as const;

const readAs = (game: GameCommands, event: string, principal: GamePrincipal) =>
  game.read(
    game.reads.find((read) => read.event === event)!,
    principal,
    { definitionId: "hb-m-playersafe" }
  );

// Markers are matched over the serialized payload, so it works for any catalog shape. Reduced to a
// boolean so a failure does not print a 300-spell catalog.
const carries = (payload: unknown, marker: string) => JSON.stringify(payload).toLowerCase().includes(marker);

describe("homebrew never reaches an audience it was not published to", () => {
  it("classifies every content operation, and the GM-only ones really are gated", () => {
    const game = readsWith(new ContentLibrary(fakeHomebrew()));
    const declared = new Set<string>([...PLAYER_READABLE_CONTENT_READS, ...GM_ONLY_CONTENT_READS]);
    const actual = game.reads.map((read) => read.event).filter((event) => event.startsWith("content:"));
    // Set equality both ways: an uncovered new content read fails here, and a stale entry fails too.
    expect(new Set(actual)).toEqual(declared);

    for (const name of GM_ONLY_CONTENT_READS) {
      expect(() => readAs(game, name, PLAYER), name).toThrow(GameAccessDeniedError);
    }
    for (const name of PLAYER_READABLE_CONTENT_READS) {
      expect(() => readAs(game, name, PLAYER), name).not.toThrow();
    }
  });

  it("keeps a DRAFT out of both audiences' catalogs", () => {
    const game = readsWith(new ContentLibrary(fakeHomebrew()));
    for (const principal of [GM, INTEGRATION, PLAYER]) {
      const reachable =
        principal === PLAYER
          ? PLAYER_READABLE_CONTENT_READS
          : [...PLAYER_READABLE_CONTENT_READS, ...GM_ONLY_CONTENT_READS];
      for (const name of reachable) {
        if (name === "content:monster-sheet") continue; // resolves a live instance regardless of status; covered separately below
        expect(
          carries(readAs(game, name, principal), "draftonly"),
          `${name} served a DRAFT to a ${principal.kind}`
        ).toBe(false);
      }
    }
  });

  it("keeps a PUBLISHED but player-invisible record out of every player-readable catalog", () => {
    const game = readsWith(new ContentLibrary(fakeHomebrew()));
    for (const name of PLAYER_READABLE_CONTENT_READS) {
      expect(
        carries(readAs(game, name, PLAYER), "gmonly"),
        `${name} served a GM-only homebrew record to a player`
      ).toBe(false);
    }
    // ...while the GM and the GM's integration credential see it.
    for (const principal of [GM, INTEGRATION]) {
      expect(carries(readAs(game, "content:classes", principal), "gmonly"), principal.kind).toBe(true);
      expect(carries(readAs(game, "content:monsters", principal), "gmonly"), principal.kind).toBe(true);
    }
  });

  it("serves the player-visible homebrew record to players, so the merge is really happening", () => {
    const game = readsWith(new ContentLibrary(fakeHomebrew()));
    // Each builder catalog plus spells and equipment carries its own homebrew record, so the merge is
    // shown to happen and the not-contain checks are not vacuous.
    expect(carries(readAs(game, "content:classes", PLAYER), "playersafe class")).toBe(true);
    expect(carries(readAs(game, "content:subclasses", PLAYER), "playersafe subclass")).toBe(true);
    expect(carries(readAs(game, "content:species", PLAYER), "playersafe species")).toBe(true);
    expect(carries(readAs(game, "content:backgrounds", PLAYER), "playersafe background")).toBe(true);
    expect(carries(readAs(game, "content:feats", PLAYER), "playersafe feat")).toBe(true);
    expect(carries(readAs(game, "content:spells", PLAYER), "playersafe spell")).toBe(true);
    expect(carries(readAs(game, "content:equipment", PLAYER), "playersafe item")).toBe(true);
    // Monsters are GM-only to browse regardless of publication state.
    expect(carries(readAs(game, "content:monsters", GM), "playersafe monster")).toBe(true);
  });

  it("lands a homebrew class in the summaries, the record map AND the progression table", () => {
    // The progression table is derived from the class list independently of the summaries, so a merge
    // that skipped it would give homebrew classes SRD-default hit dice, ASI levels and caster progression.
    const gm = new ContentLibrary(fakeHomebrew()).forAudience("gm");
    expect(gm.classSummaries().some((entry) => entry.id === "hb-gmonly-class")).toBe(true);
    expect(gm.classRecord("hb-gmonly-class")?.hitDie).toBe("d12");
    expect(gm.classProgressionTable()["hb-gmonly-class"]).toMatchObject({
      hitDie: "d12",
      asiLevels: [4, 8, 12, 16, 19]
    });

    const player = new ContentLibrary(fakeHomebrew()).forAudience("player");
    expect(player.classRecord("hb-gmonly-class")).toBeUndefined();
    expect(player.classProgressionTable()["hb-gmonly-class"]).toBeUndefined();
    expect(player.classProgressionTable()["hb-playersafe-class"]).toBeDefined();
    expect(player.classProgressionTable().wizard).toEqual(gm.classProgressionTable().wizard);
  });

  it("resolves an unpublished monster for a LIVE instance while never offering it to browse", () => {
    // Actions, typed defences and recharge are read from the definition per use, so a status-aware
    // play-time lookup would disarm every token of a creature the GM drafted, unpublished or deleted mid-fight.
    const library = new ContentLibrary(fakeHomebrew());
    expect(library.monsterForInstance("hb-m-draftonly")?.actions).toHaveLength(1);
    expect(library.forAudience("gm").monster("hb-m-draftonly")).toBeUndefined();
    expect(library.forAudience("player").monster("hb-m-gmonly")).toBeUndefined();
    expect(library.monsterForInstance("goblin-warrior")?.name).toBe("Goblin Warrior");
    expect(library.forAudience("player").monster("goblin-warrior")?.name).toBe("Goblin Warrior");
  });

  it("rebuilds its cached views when the homebrew revision moves, and not otherwise", () => {
    let revision = -1; // what an uninitialized store reports
    let builds = 0;
    const source: HomebrewContentSource = {
      get revision() {
        return revision;
      },
      publishedFor: (audience) => {
        builds += 1;
        return audience === "gm" ? concatSlices(SLICES.gmonly, SLICES.playersafe) : SLICES.playersafe;
      },
      monsterForInstance: () => undefined
    };
    const library = new ContentLibrary(source);
    library.forAudience("player");
    library.forAudience("player");
    expect(builds, "a repeat read at the same revision is served from cache").toBe(1);
    revision = 1;
    expect(carries(library.forAudience("player").classSummaries(), "playersafe class")).toBe(true);
    expect(builds).toBe(2);
  });

  it("costs nothing and shares one catalog when no homebrew source is wired in", () => {
    // The path every existing table takes: both audiences resolve to the same SRD-only catalog.
    const library = new ContentLibrary();
    expect(library.forAudience("gm").classSummaries()).toBe(library.forAudience("player").classSummaries());
    expect(
      library
        .forAudience("player")
        .classSummaries()
        .every((entry) => entry.source === "srd")
    ).toBe(true);
  });
});

// The same guarantee, driven by the real store.

// The fake above pins the contract; these pin `HomebrewStore` as an implementation of it. A store
// that filtered nothing would pass the fake-driven suite.
describe("HomebrewStore.publishedFor, end to end through the content operations", () => {
  const directories: string[] = [];
  const stores: HomebrewStore[] = [];
  afterEach(async () => {
    while (stores.length) stores.pop()!.close();
    while (directories.length) await rm(directories.pop()!, { recursive: true, force: true });
  });

  async function seededStore() {
    const directory = await mkdtemp(join(tmpdir(), "vtt-homebrew-visibility-"));
    directories.push(directory);
    const store = new HomebrewStore(join(directory, "vtt.sqlite"));
    stores.push(store);
    await store.initialize();
    // One class and one monster per tier, taken through the real GM transitions.
    const ids: Record<Tier, { classId: string; monsterId: string }> = {} as never;
    for (const tier of TIERS) {
      const created = store.create({
        type: "class",
        body: SLICES[tier].classes[0] as unknown as Record<string, unknown>
      });
      const monster = store.create({
        type: "monster",
        body: SLICES[tier].monsters[0] as unknown as Record<string, unknown>
      });
      if (tier !== "draftonly") {
        store.setState(created.id, "published", undefined);
        store.setState(monster.id, "published", undefined);
      }
      if (tier === "playersafe") {
        store.setVisibility(created.id, true, undefined);
        store.setVisibility(monster.id, true, undefined);
      }
      ids[tier] = { classId: created.id, monsterId: monster.id };
    }
    return { store, ids };
  }

  it("keeps a draft out of both catalogs, a published-invisible record out of the player's, and serves the visible one", async () => {
    const { store } = await seededStore();
    const game = readsWith(new ContentLibrary(store));

    // The draft is in no merged catalog for any principal.
    for (const principal of [GM, INTEGRATION, PLAYER]) {
      expect(
        carries(readAs(game, "content:classes", principal), "draftonly class"),
        `${principal.kind} saw a draft`
      ).toBe(false);
    }
    expect(carries(readAs(game, "content:monsters", GM), "draftonly monster")).toBe(false);

    // Published without player visibility is the GM's alone.
    expect(carries(readAs(game, "content:classes", PLAYER), "gmonly class")).toBe(false);
    expect(carries(readAs(game, "content:classes", GM), "gmonly class")).toBe(true);
    expect(carries(readAs(game, "content:classes", INTEGRATION), "gmonly class")).toBe(true);

    expect(carries(readAs(game, "content:classes", PLAYER), "playersafe class")).toBe(true);
    expect(carries(readAs(game, "content:monsters", GM), "playersafe monster")).toBe(true);
  });

  it("drops a record from both catalogs on soft delete while its live tokens keep resolving", async () => {
    const { store, ids } = await seededStore();
    const library = new ContentLibrary(store);
    expect(library.forAudience("gm").monster(ids.playersafe.monsterId)?.actions).toHaveLength(1);

    store.softDelete(ids.playersafe.monsterId);
    expect(library.forAudience("gm").monster(ids.playersafe.monsterId)).toBeUndefined();
    expect(library.forAudience("player").monster(ids.playersafe.monsterId)).toBeUndefined();
    // Play-time lookup is status-blind: actions, typed defences and recharge are re-read per use, so
    // filtering here would disarm tokens already on the table.
    expect(library.monsterForInstance(ids.playersafe.monsterId)?.actions).toHaveLength(1);
    expect(library.monsterForInstance(ids.draftonly.monsterId)?.actions).toHaveLength(1);
  });

  it("applies a published spell list to the audience that can see it, and to no other", async () => {
    const { store } = await seededStore();
    const spell = store.create({
      type: "spell",
      body: SLICES.playersafe.spells[0] as unknown as Record<string, unknown>
    });
    store.setState(spell.id, "published", undefined);
    store.setVisibility(spell.id, true, undefined);
    // The list is published but not player-visible: its id must never appear in a player-visible spell's
    // `classes`, or the list's existence leaks through /v1/content/spells.
    const list = store.create({ type: "spell-list", body: { name: "Secret Order", add: [spell.id, "fireball"] } });
    store.setState(list.id, "published", undefined);

    const library = new ContentLibrary(store);
    const gmSpell = library
      .forAudience("gm")
      .spellSummaries()
      .find((entry) => entry.id === spell.id);
    const playerSpell = library
      .forAudience("player")
      .spellSummaries()
      .find((entry) => entry.id === spell.id);
    expect(gmSpell?.classes).toContain(list.id);
    expect(playerSpell?.classes).not.toContain(list.id);
    // An SRD spell joins the list too; membership is an overlay, never an edit to the bundle.
    expect(
      library
        .forAudience("gm")
        .spellSummaries()
        .find((entry) => entry.id === "fireball")?.classes
    ).toContain(list.id);
    expect(
      library
        .forAudience("player")
        .spellSummaries()
        .find((entry) => entry.id === "fireball")?.classes
    ).not.toContain(list.id);
    // The loader caches parsed rows by identity, so mutating the bundle would corrupt every later reader.
    expect(loadSpells().find((entry) => entry.id === "fireball")?.classes).not.toContain(list.id);
  });

  it("treats a slice holding ONLY a spell list as non-empty, or the overlay would never be applied", async () => {
    // A spell-list overlay carries no records of its own; an emptiness check that counted records would
    // take the SRD-only path and the list would do nothing.
    const directory = await mkdtemp(join(tmpdir(), "vtt-homebrew-listonly-"));
    directories.push(directory);
    const store = new HomebrewStore(join(directory, "vtt.sqlite"));
    stores.push(store);
    await store.initialize();
    const list = store.create({ type: "spell-list", body: { name: "Only A List", add: ["fireball"] } });
    store.setState(list.id, "published", undefined);
    store.setVisibility(list.id, true, undefined);

    const library = new ContentLibrary(store);
    expect(
      library
        .forAudience("player")
        .spellSummaries()
        .find((entry) => entry.id === "fireball")?.classes
    ).toContain(list.id);
  });

  it("drops a published row that no longer parses instead of taking down every catalog", async () => {
    const { store } = await seededStore();
    const good = store.create({
      type: "class",
      body: SLICES.playersafe.classes[0] as unknown as Record<string, unknown>
    });
    store.setState(good.id, "published", undefined);
    store.setVisibility(good.id, true, undefined);
    // A body the schema refuses, as stored data looks after a schema tightens. It cannot be published
    // through the router, so this reaches past the store's API; one bad row must not blank the catalogs.
    const rotten = store.create({ type: "class", body: { name: "Half-Formed", hitDie: "d10" } });
    store.setState(rotten.id, "published", undefined);
    store.setVisibility(rotten.id, true, undefined);

    const summaries = new ContentLibrary(store).forAudience("player").classSummaries();
    expect(summaries.some((entry) => entry.id === rotten.id)).toBe(false);
    expect(summaries.some((entry) => entry.id === good.id)).toBe(true);
    expect(summaries.some((entry) => entry.id === "wizard")).toBe(true);
  });

  it("forces a monster's content id to its row id, so a live token always resolves back", async () => {
    const { store } = await seededStore();
    // `source.externalId` has no regex on `ActorDefinitionSchema` and is written unparsed into
    // `Actor.definitionId`; an arbitrary value would save and then fail `GameStateSchema.parse` on boot.
    const created = store.create({
      type: "monster",
      body: {
        ...(SLICES.playersafe.monsters[0] as unknown as Record<string, unknown>),
        source: { name: "Homebrew", version: "1", externalId: "not:a:slug" }
      }
    });
    expect((created.body.source as { externalId: string }).externalId).toBe(created.id);
    expect(new ContentLibrary(store).monsterForInstance(created.id)?.name).toContain("Monster");
  });
});
