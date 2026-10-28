import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GAME_PATHS } from "@vtt/api-contract";
import { loadSpells } from "@vtt/content-srd-5.2.1";
import { GameStateSchema } from "@vtt/domain";
import { ActorDefinitionSchema } from "@vtt/schemas";
import { withDefinitionProseFacts } from "../src/actor-roster.js";
import { withMonsterSpells } from "../src/monster-spells.js";
import { createServer } from "../src/server.js";

// A stat block brought in by the GM casts its Spellcasting list as the SRD bundle's do: its "At Will" and "1/Day"
// spells become cast actions at the numbers it prints, whether it is imported now or was stored before.

const definition = ActorDefinitionSchema.parse({
  schemaId: "vtt.actor-monster",
  schemaVersion: 1,
  source: { name: "Imported", version: "1" },
  name: "Hedge Mage",
  size: "medium",
  abilityScores: { str: 9, dex: 14, con: 11, int: 17, wis: 12, cha: 11 },
  proficiencyBonus: 3,
  armorClass: 12,
  hitPoints: { maximum: 40 },
  speedFeet: 30,
  actions: [
    {
      id: "spellcasting",
      name: "Spellcasting",
      activation: "action",
      description:
        "The mage casts one of the following spells, using Intelligence as the spellcasting ability (spell save DC 14, +6 to hit with spell attacks):\n\n- **At Will:** Fire Bolt, Light\n- **1/Day Each:** Fireball"
    }
  ],
  extensions: { "open5e.srd-2024": { challengeRating: 3, type: "humanoid" } }
});

const STORED = "10000000-0000-4000-8000-0000000000e1";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function boot() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-import-spells-"));
  const server = createServer({
    authPath: join(directory, "auth.json"),
    databasePath: join(directory, "vtt.sqlite"),
    integrationCredentialsPath: join(directory, "integrations.sqlite"),
    mapAssetsPath: join(directory, "map-assets"),
    webDist: join(directory, "dist"),
    useDevelopmentClient: true,
    developmentClientPort: 5173,
    // One imported before its spells were read: its definition has no casts yet.
    initialGameState: GameStateSchema.parse({
      schemaVersion: 1,
      actors: [
        {
          id: STORED,
          name: "Hedge Mage",
          kind: "monster",
          hp: { current: 40, maximum: 40 },
          definitionId: `import-${STORED}`
        }
      ],
      definitions: [{ id: `import-${STORED}`, definition }]
    })
  });
  await server.initialize();
  await server.auth.bootstrap("a sufficiently long GM password");
  const gmToken = (await server.auth.login("a sufficiently long GM password"))!;
  await new Promise<void>((resolve) => server.httpServer.listen(0, "127.0.0.1", resolve));
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("Server did not bind.");
  cleanups.push(async () => {
    server.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${address.port}`, server, gmToken };
}

const actionsOf = async (base: string, token: string, actorId: string) => {
  const response = await fetch(base + GAME_PATHS.actorAvailableActions.replace("{actorId}", actorId), {
    headers: { authorization: `Bearer ${token}` }
  });
  const body = (await response.json()) as { data: { actions: Array<{ id: string; name: string }> } };
  return body.data.actions;
};

describe("an imported stat block's spells", () => {
  it("casts each spell of its list as its own action at the printed numbers", async () => {
    const { base, server, gmToken } = await boot();
    const response = await fetch(base + GAME_PATHS.definitionsImport, {
      method: "POST",
      headers: { authorization: `Bearer ${gmToken}`, "content-type": "application/json" },
      body: JSON.stringify({ commandId: randomUUID(), definition })
    });
    expect(response.status, await response.clone().text()).toBe(200);
    const imported = server.store.snapshot.actors.find((actor) => actor.id !== STORED)!;
    const stored = server.store.snapshot.definitions.find((entry) => entry.id === imported.definitionId)!;
    expect(stored.definition.actions[0]!.castsSpells).toMatchObject({
      ability: "int",
      saveDc: 14,
      attackBonus: 6,
      spells: [
        { id: "spellcasting-fire-bolt", spellId: "fire-bolt" },
        { id: "spellcasting-light", spellId: "light" },
        { id: "spellcasting-fireball", spellId: "fireball", perDay: 1 }
      ]
    });
    const names = (await actionsOf(base, gmToken, imported.id)).map((action) => action.name);
    expect(names).toEqual(expect.arrayContaining(["Fire Bolt", "Light", "Fireball"]));
  });

  it("reads the list of a stat block stored before its spells were read", async () => {
    const { base, server, gmToken } = await boot();
    const stored = server.store.snapshot.definitions.find((entry) => entry.id === `import-${STORED}`)!;
    expect(stored.definition.actions[0]!.castsSpells?.spells.map((entry) => entry.spellId)).toEqual([
      "fire-bolt",
      "light",
      "fireball"
    ]);
    const names = (await actionsOf(base, gmToken, STORED)).map((action) => action.name);
    expect(names).toEqual(expect.arrayContaining(["Fire Bolt", "Fireball"]));
  });
});

describe("a stat block whose casting action has a long id", () => {
  it("stores its casts so the campaign loads them again", () => {
    // An imported action's id comes from its own text and has no length limit, and each spell an action casts a choice
    // of becomes a cast that names that action (\`partOf\`). A stored copy of the cast stat block (a form taken, a
    // summon, a replay) must read back when the server starts.
    const actionId = `divine-aid-${"of-the-hedge-mage-".repeat(8)}choice`;
    const long = {
      ...definition,
      actions: [
        {
          id: actionId,
          name: "Divine Aid",
          activation: "bonus-action" as const,
          description:
            "The mage casts Cure Wounds, Lesser Restoration or Remove Curse, using Wisdom as the spellcasting ability (spell save DC 14).",
          damage: [],
          // Its casts share its use, under a pool named for it.
          uses: { limit: 1, per: "long-rest" as const }
        }
      ]
    };
    const spells = loadSpells();
    const cast = withMonsterSpells(withDefinitionProseFacts(long), (id) => spells.find((spell) => spell.id === id));
    expect(actionId.length).toBeGreaterThan(120);
    expect(cast.actions.filter((action) => action.partOf === actionId)).toHaveLength(3);
    const saved = GameStateSchema.safeParse({
      schemaVersion: 1,
      definitions: [{ id: "form-hedge-mage", definition: cast }]
    });
    expect(saved.success, saved.error?.message).toBe(true);
  });
});
