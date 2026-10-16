import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema } from "@vtt/domain";
import { InventoryItemSchema, type ActorDefinition } from "@vtt/schemas";
import { checkRollMode } from "../src/ability-checks.js";
import { importActorDefinition, reconcileArmorClasses, storedArmorClass } from "../src/actor-roster.js";
import { initiativeRollMode } from "../src/encounter.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { RulesBlockedError } from "../src/game-store.js";
import { setInventoryItem } from "../src/inventory.js";
import { projectPlayerView } from "../src/projections.js";
import { saveRollSources } from "../src/saving-throws.js";
import { createServer } from "../src/server.js";
import { currentSpeedFeet } from "../src/speed.js";
import {
  catalog,
  catalogRow,
  edit,
  fight,
  fighterInput,
  IDS,
  library,
  resolveAt,
  tableOf,
  wizardInput,
  write
} from "./equipment-table.js";

// Armor Class and what armor costs (SRD 5.2.1 Armor, Armor Training, Fighting Style: Defense).

describe("a built character's Armor Class follows what is worn now", () => {
  it("drops to 10 + Dex when the chain mail comes off, and Defense goes with it", () => {
    // Fighter A: Chain Mail 16, Dex 13 (+1, not added to heavy armor), Defense +1.
    const table = tableOf({ [IDS.fighter]: fighterInput("fighter-a") });
    expect(table.actor(IDS.fighter).armorClass).toBe(17);
    write(table, IDS.fighter, edit(table, IDS.fighter, "chain-mail", { equipped: false }));
    expect(table.actor(IDS.fighter).armorClass).toBe(11);
    write(table, IDS.fighter, edit(table, IDS.fighter, "chain-mail", { equipped: true }));
    expect(table.actor(IDS.fighter).armorClass).toBe(17);
  });

  it("gains Defense on armor bought after the build", () => {
    // Fighter C took the gold: no armor at build, so AC 11, and no Defense yet.
    const table = tableOf({ [IDS.fighter]: fighterInput("fighter-c") });
    expect(table.actor(IDS.fighter).armorClass).toBe(11);
    write(table, IDS.fighter, catalogRow("chain-mail"));
    expect(table.actor(IDS.fighter).armorClass).toBe(17);
  });

  it("re-derives a sheet built before, whose bag still carries the build-time Defense", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput("fighter-a") });
    const stored = table.state.definitions.find((entry) => entry.id === `import-${IDS.fighter}`)!;
    const extension = stored.definition.extensions["open5e.srd-2024"] as Record<string, unknown>;
    stored.definition = {
      ...stored.definition,
      extensions: { ...stored.definition.extensions, "open5e.srd-2024": { ...extension, armorClassBonus: 1 } }
    };
    const fighter = table.actor(IDS.fighter);
    fighter.inventory = fighter.inventory.map((item) =>
      item.id === "chain-mail" ? { ...item, equipped: false } : item
    );
    fighter.armorClass = 17;
    // Loading the campaign re-derives every stored AC.
    expect(reconcileArmorClasses(table.state, table.resolve, catalog)).toBe(true);
    expect(fighter.armorClass).toBe(11);
  });

  it("gives a Shield's +2 only to a bearer trained with Shields", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput("fighter-c"), [IDS.wizard]: wizardInput() });
    // Wizard: 10 + Dex 2, no Shield training.
    expect(table.actor(IDS.wizard).armorClass).toBe(12);
    write(table, IDS.wizard, catalogRow("shield"));
    expect(table.actor(IDS.wizard).armorClass).toBe(12);
    write(table, IDS.fighter, catalogRow("shield"));
    expect(table.actor(IDS.fighter).armorClass).toBe(13);
  });
});

describe("an imported sheet's printed Armor Class", () => {
  const ACTOR = "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d30";
  /** A D&D Beyond import: printed AC 20 (Plate and a Shield), Dex 10, the two rows unequipped. */
  function imported() {
    const state = GameStateSchema.parse({ schemaVersion: 1 });
    const definition = {
      schemaId: "vtt.actor-character",
      schemaVersion: 1,
      source: { name: "D&D Beyond PDF (2024)", version: "1" },
      name: "Sir Imported",
      size: "medium",
      abilityScores: { str: 16, dex: 10, con: 14, int: 10, wis: 12, cha: 16 },
      proficiencyBonus: 3,
      armorClass: 20,
      hitPoints: { maximum: 44 },
      initiativeBonus: 0,
      speedFeet: 30,
      actions: [],
      token: { disposition: "friendly", footprint: { width: 1, height: 1 } },
      startingInventory: [
        { id: "plate-armor", name: "Plate", quantity: 1 },
        { id: "shield", name: "Shield", quantity: 1 }
      ]
    } as unknown as ActorDefinition;
    importActorDefinition(state, definition, ACTOR, "public", catalog);
    const resolve = (id: string) => state.definitions.find((entry) => entry.id === id)?.definition;
    const equip = (id: string, equipped: boolean) => {
      const row = state.actors[0].inventory.find((item) => item.id === id)!;
      setInventoryItem(state, ACTOR, { ...row, equipped }, resolve, { catalog, role: "player" });
      return state.actors[0].armorClass;
    };
    return { state, equip };
  }

  it("keeps the printed total when the player taps Equip on the Shield it already counts", () => {
    const { state, equip } = imported();
    expect(state.actors[0].armorClass).toBe(20);
    expect(equip("shield", true)).toBe(20);
  });

  it("derives once body armor is equipped: Plate 18 and the Shield's 2", () => {
    const { equip } = imported();
    expect(equip("plate-armor", true)).toBe(18);
    expect(equip("shield", true)).toBe(20);
  });
});

describe("the GM sets an Armor Class by hand", () => {
  it("replaces the derived AC until cleared, and live effects still add to it", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    const wizard = table.actor(IDS.wizard);
    wizard.armorClassOverride = 15; // Mage Armor: 13 + Dex 2
    expect(storedArmorClass(wizard, table.definition(IDS.wizard), catalog)).toBe(15);
    // An inventory write re-derives, and the override still wins.
    write(table, IDS.wizard, catalogRow("dagger"));
    expect(wizard.armorClass).toBe(15);
    delete wizard.armorClassOverride;
    write(table, IDS.wizard, catalogRow("dagger", { quantity: 2 }));
    expect(wizard.armorClass).toBe(12);
  });
});

describe("what body armor costs", () => {
  it("takes 10 feet off a wearer below the armor's Strength score", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput("fighter-c"), [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("plate-armor"));
    write(table, IDS.fighter, catalogRow("plate-armor"));
    const speed = (actorId: string) =>
      currentSpeedFeet(table.actor(actorId), deriveEquipment(table.actor(actorId), table.definition(actorId), catalog));
    expect(speed(IDS.wizard)).toBe(20); // Strength 10 < 15
    expect(speed(IDS.fighter)).toBe(30); // Strength 19
  });

  it("puts Stealth Disadvantage and item Advantage on the check roll-mode riders a check reads", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput("fighter-a") });
    const derivation = () => deriveEquipment(table.actor(IDS.fighter), table.definition(IDS.fighter), catalog);
    const stealth = { ability: "dex", skill: "stealth" } as const;
    // Chain Mail: Disadvantage on Dexterity (Stealth), and only Stealth.
    expect(checkRollMode(derivation(), stealth)).toMatchObject({
      mode: "disadvantage",
      disadvantage: ["Chain Mail (Stealth)"]
    });
    expect(checkRollMode(derivation(), { ability: "dex", skill: "acrobatics" }).mode).toBe("normal");
    // Boots of Elvenkind's Advantage cancels it (SRD: one of each is a normal roll).
    write(table, IDS.fighter, catalogRow("boots-of-elvenkind"));
    expect(checkRollMode(derivation(), stealth)).toMatchObject({
      mode: "normal",
      advantage: ["Boots of Elvenkind"],
      disadvantage: ["Chain Mail (Stealth)"]
    });
    write(table, IDS.fighter, edit(table, IDS.fighter, "chain-mail", { equipped: false }));
    expect(checkRollMode(derivation(), stealth)).toMatchObject({
      mode: "advantage",
      advantage: ["Boots of Elvenkind"]
    });
  });

  it("without training: Disadvantage on Strength and Dexterity D20 Tests, and no spellcasting", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    write(table, IDS.wizard, catalogRow("chain-shirt"));
    const wizard = table.actor(IDS.wizard);
    const derivation = deriveEquipment(wizard, table.definition(IDS.wizard), catalog);
    expect(derivation.untrainedArmor).toEqual({ itemId: "chain-shirt", name: "Chain Shirt" });
    const label = "Chain Shirt (no armor training)";
    expect(saveRollSources(wizard, "dex", derivation).disadvantage.map((claim) => claim.label)).toEqual([label]);
    expect(saveRollSources(wizard, "wis", derivation).disadvantage).toEqual([]);
    expect(checkRollMode(derivation, { ability: "str", skill: "athletics" }).mode).toBe("disadvantage");
    expect(checkRollMode(derivation, { ability: "int", skill: "arcana" }).mode).toBe("normal");
    // Initiative is a Dexterity check.
    expect(initiativeRollMode(table.state, IDS.wizard, table.resolve, catalog)).toBe("disadvantage");

    fight(table, IDS.wizard);
    const blocked = (() => {
      try {
        resolveAt(table, IDS.wizard, "spell-fire-bolt", [15, 4]);
        return null;
      } catch (error) {
        return error instanceof RulesBlockedError ? error.rule : String(error);
      }
    })();
    expect(blocked).toBe("spell.untrained-armor");
    // A dagger thrust is a Dexterity attack roll.
    const thrust = resolveAt(table, IDS.wizard, "item-dagger", [15, 3, 4]);
    expect(thrust.rollMode?.disadvantage).toEqual([label]);
  });

  it("a trained wearer pays none of it", () => {
    const table = tableOf({ [IDS.fighter]: fighterInput("fighter-a") });
    const derivation = deriveEquipment(table.actor(IDS.fighter), table.definition(IDS.fighter), catalog);
    expect(derivation.untrainedArmor).toBeNull();
    // Remarkable Athlete's Advantage, and no armor Disadvantage to cancel it.
    expect(initiativeRollMode(table.state, IDS.fighter, table.resolve, catalog)).toBe("advantage");
  });
});

describe("what can be worn together", () => {
  it("wears only one of each thing the SRD lists, and lets a player wear the rest side by side", () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() });
    // Gloves and bracers, a cloak and a robe, two neck pieces, lenses and a helm, a third ring.
    for (const id of [
      "bracers-of-defense",
      "gloves-of-thievery",
      "cloak-of-protection",
      "robe-of-stars",
      "amulet-of-health",
      "periapt-of-wound-closure",
      "eyes-of-charming",
      "helm-of-telepathy",
      "ring-of-protection",
      "ring-of-evasion",
      "ring-of-resistance"
    ])
      expect(() => write(table, IDS.wizard, catalogRow(id)), id).not.toThrow();
    // A second cloak, pair of boots or helm is still refused.
    expect(() => write(table, IDS.wizard, catalogRow("cloak-of-elvenkind"))).toThrow(/occupies the shoulders slot/);
    write(table, IDS.wizard, catalogRow("boots-of-elvenkind"));
    expect(() => write(table, IDS.wizard, catalogRow("winged-boots"))).toThrow(/occupies the feet slot/);
    expect(() => write(table, IDS.wizard, catalogRow("hat-of-disguise"))).toThrow(/occupies the head slot/);
  });
});

describe("attunement", () => {
  const ROGUE = "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d40";
  function thief(level: number) {
    const state = GameStateSchema.parse({ schemaVersion: 1 });
    const definition = {
      schemaId: "vtt.actor-character",
      schemaVersion: 1,
      source: { name: "OzyVTT Character Builder", version: "1" },
      name: "Nim",
      size: "small",
      abilityScores: { str: 8, dex: 18, con: 12, int: 14, wis: 10, cha: 12 },
      proficiencyBonus: 5,
      armorClass: 14,
      hitPoints: { maximum: 80 },
      initiativeBonus: 4,
      speedFeet: 30,
      actions: [],
      token: { disposition: "friendly", footprint: { width: 1, height: 1 } },
      character: {
        classes: [{ id: "rogue", name: "Rogue", level, subclass: { id: "thief", name: "Thief" } }],
        feats: [],
        features: level >= 13 ? [{ id: "use-magic-device", kind: "subclass", sourceId: "thief" }] : []
      }
    } as unknown as ActorDefinition;
    importActorDefinition(state, definition, ROGUE, "public", catalog);
    const resolve = (id: string) => state.definitions.find((entry) => entry.id === id)?.definition;
    const attune = (id: string) => {
      const record = library.equipmentRecord(id)!;
      setInventoryItem(
        state,
        ROGUE,
        InventoryItemSchema.parse({ id, name: record.name, category: record.category, equipped: true, attuned: true }),
        resolve,
        { catalog, role: "player" }
      );
    };
    return { state, attune };
  }
  const MAGIC = ["cloak-of-protection", "ring-of-protection", "brooch-of-shielding", "boots-of-the-winterlands"];

  it("lets Use Magic Device attune a fourth magic item, and no fifth", () => {
    const { attune } = thief(13);
    for (const id of MAGIC) attune(id);
    expect(() => attune("ring-of-evasion")).toThrow(/Already attuned to 4 items/);
  });

  it("holds anyone else to three", () => {
    const { attune } = thief(9);
    for (const id of MAGIC.slice(0, 3)) attune(id);
    expect(() => attune(MAGIC[3])).toThrow(/Already attuned to 3 items/);
  });

  it("counts only items that need attunement, and marks a catalog magic item for the sheet's Attune control", () => {
    const { state, attune } = thief(9);
    for (const id of MAGIC.slice(0, 3)) attune(id);
    // A mundane dagger marked attuned takes none of the three.
    expect(() => attune("dagger")).not.toThrow();
    const row = (id: string) => state.actors[0].inventory.find((item) => item.id === id)!;
    expect(row("cloak-of-protection").magic).toEqual({ isMagic: true, attunementRequired: true, slot: "shoulders" });
    expect(row("dagger").magic).toBeUndefined();
  });
});

describe("actor.set-armor-class over the API", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("lets the GM set and clear an AC, shows players it was set, and refuses a player", async () => {
    const table = tableOf({ [IDS.wizard]: wizardInput() }, false);
    const directory = await mkdtemp(join(tmpdir(), "vtt-set-ac-"));
    const server = createServer({
      authPath: join(directory, "auth.json"),
      databasePath: join(directory, "vtt.sqlite"),
      integrationCredentialsPath: join(directory, "integrations.sqlite"),
      mapAssetsPath: join(directory, "map-assets"),
      webDist: join(directory, "dist"),
      useDevelopmentClient: true,
      developmentClientPort: 5173,
      initialGameState: table.state
    });
    await server.initialize();
    await server.auth.bootstrap("a sufficiently long GM password");
    const gmToken = (await server.auth.login("a sufficiently long GM password"))!;
    const playerToken = server.auth.issuePlayerSession();
    await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
    cleanups.push(async () => {
      server.close();
      await rm(directory, { recursive: true, force: true });
    });
    const address = server.httpServer.address();
    if (!address || typeof address === "string") throw new Error("The server did not bind.");
    const setArmorClass = (token: string, armorClass: number | null) =>
      fetch(`http://127.0.0.1:${address.port}${GAME_PATHS.actorArmorClass.replace("{actorId}", IDS.wizard)}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ armorClass })
      });
    const wizard = () => server.store.snapshot.actors.find((actor) => actor.id === IDS.wizard)!;
    expect(wizard().armorClass).toBe(12);

    expect((await setArmorClass(gmToken, 15)).status).toBeLessThan(300); // Mage Armor: 13 + Dex 2
    expect(wizard()).toMatchObject({ armorClass: 15, armorClassOverride: 15 });
    const seen = projectPlayerView(server.store.snapshot, undefined, () => "offline").actors.find(
      (actor) => actor.id === IDS.wizard
    );
    expect(seen).toMatchObject({ armorClass: 15, armorClassOverride: 15 });

    expect((await setArmorClass(playerToken, 20)).status).toBe(403);
    expect((await setArmorClass(gmToken, null)).status).toBeLessThan(300);
    expect(wizard().armorClass).toBe(12);
    expect(wizard().armorClassOverride).toBeUndefined();
  });
});
