import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ActorDefinitionSchema } from "@vtt/schemas";
import {
  assetIdOf,
  emit,
  GOBLIN,
  HERO,
  hiddenTable,
  mentionsGoblin,
  ORC,
  settle,
  wall
} from "./hidden-creature-fixtures.js";
import { png } from "./image-fixtures.js";

// Rules decisions and refusals never give away a creature hidden from the player by sight or the fog (ADR-0023). Each
// case below is one way they could.

/** The goblin behind a wall down the middle of the map; Borin on the other side. */
const behindTheWall = {
  positions: { [HERO]: { x: 75, y: 275 }, [GOBLIN]: { x: 425, y: 275 } },
  vision: { enabled: true, ambient: "bright" as const, walls: [wall({ x: 250, y: 0 }, { x: 250, y: 600 })] }
};

describe("rules and refusals with a creature hidden by sight or the fog", () => {
  it("doesn't name a hidden creature whose turn it is when Borin acts out of turn", async () => {
    const table = await hiddenTable({ ...behindTheWall, order: [GOBLIN, HERO] });
    expect(mentionsGoblin(table.latest())).toBe(false);
    expect(table.latest().combat.hiddenTurn).toBe(true);
    const dodge = await emit(table.player, "action:resolve", { actorId: HERO, actionId: "dodge" });
    expect(dodge).toMatchObject({ ok: false, code: "economy.not-your-turn" });
    expect(dodge.message).toBe("Not your turn yet - wait for your turn.");
  });

  it("gives Borin's shot no Disadvantage, and no name, from an unseen enemy beside Borin", async () => {
    const table = await hiddenTable({
      order: [HERO, GOBLIN, ORC],
      positions: { [HERO]: { x: 75, y: 275 }, [GOBLIN]: { x: 125, y: 275 }, [ORC]: { x: 575, y: 275 } },
      vision: { enabled: true, ambient: "bright" },
      actors: { [HERO]: { definitionId: "scout" }, [GOBLIN]: { conditions: [{ id: "invisible" }] } }
    });
    expect(mentionsGoblin(table.latest())).toBe(false);
    const shot = await emit(table.player, "action:resolve", { actorId: HERO, actionId: "longbow", targetIds: [ORC] });
    expect(shot).toMatchObject({ ok: true });
    expect(mentionsGoblin(shot)).toBe(false);
    const rollMode = (shot.resolution as { rollMode?: { disadvantage: string[] } }).rollMode;
    expect(rollMode?.disadvantage ?? []).toEqual([]);
  });

  it("gives a wolf no Pack Tactics from an ally the table can't see", async () => {
    // The wolf is in plain sight beside Borin; the Invisible goblin beside Borin is its ally.
    const table = await hiddenTable({
      order: [ORC, HERO, GOBLIN],
      positions: { [HERO]: { x: 75, y: 275 }, [GOBLIN]: { x: 125, y: 275 }, [ORC]: { x: 75, y: 225 } },
      vision: { enabled: true, ambient: "bright" },
      actors: { [ORC]: { name: "Wolf", definitionId: "wolf" }, [GOBLIN]: { conditions: [{ id: "invisible" }] } }
    });
    expect(mentionsGoblin(table.latest())).toBe(false);
    const bite = await emit(table.gm, "action:resolve", { actorId: ORC, actionId: "bite", targetIds: [HERO] });
    expect(bite).toMatchObject({ ok: true });
    await settle();
    // The bite's public roll is one d20: Advantage would have shown the goblin is there.
    const rolled = table.latest().rolls.filter((roll) => roll.actorId === ORC && roll.purpose === "attack");
    expect(rolled).toHaveLength(1);
    expect(rolled[0]!.dice.filter((die) => die.sides === 20)).toHaveLength(1);
  });

  it("refuses Hide without naming an enemy wholly under the fog", async () => {
    const table = await hiddenTable({
      order: [HERO, GOBLIN],
      positions: { [HERO]: { x: 75, y: 275 }, [GOBLIN]: { x: 175, y: 275 } },
      reveals: [{ x: 50, y: 250, width: 50, height: 50 }],
      vision: { enabled: true, ambient: "bright" }
    });
    expect(mentionsGoblin(table.latest())).toBe(false);
    const hide = await emit(table.player, "action:resolve", { actorId: HERO, actionId: "hide" });
    expect(mentionsGoblin(hide)).toBe(false);
  });

  it("draws a hidden creature's cone for the GM alone", async () => {
    const breath = ActorDefinitionSchema.parse({
      schemaId: "vtt.actor-monster",
      schemaVersion: 1,
      source: { name: "Test", version: "1", externalId: "breather" },
      name: "Breather",
      size: "small",
      abilityScores: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 },
      proficiencyBonus: 2,
      armorClass: 13,
      hitPoints: { maximum: 10 },
      speedFeet: 30,
      actions: [
        {
          id: "breath",
          name: "Fire Breath",
          activation: "action",
          description: "A test action.",
          save: { ability: "dex", dc: 12, successDamage: "half" },
          damage: [{ formula: "2d6", type: "fire" }],
          area: { shape: "cone", sizeFeet: 15, widthFeet: null }
        }
      ]
    });
    const table = await hiddenTable({
      order: [GOBLIN, HERO],
      positions: { [HERO]: { x: 75, y: 275 }, [GOBLIN]: { x: 125, y: 275 } },
      vision: { enabled: true, ambient: "dark" },
      definitions: [{ id: "def-breather", definition: breath }],
      actors: { [GOBLIN]: { definitionId: "def-breather" } }
    });
    expect(mentionsGoblin(table.latest())).toBe(false);
    expect(
      await emit(table.gm, "action:resolve", {
        actorId: GOBLIN,
        actionId: "breath",
        template: { shape: "cone", origin: { x: 125, y: 275 }, target: { x: 25, y: 275 } }
      })
    ).toMatchObject({ ok: true });
    await settle();
    // Borin owes the save from "A hidden threat", and sees no shape pointing back at the goblin.
    expect(table.latest().combat.pendingSaves).toHaveLength(1);
    expect(table.latest().combat.annotations).toEqual([]);
    expect(table.server.store.snapshot.combat.annotations).toHaveLength(1);
  });

  it("serves a token image only for a creature the player may know of", async () => {
    const goblinImage = png(64, 64);
    const orcImage = png(48, 48);
    const [goblinAsset, orcAsset] = [await assetIdOf(goblinImage), await assetIdOf(orcImage)];
    const table = await hiddenTable({
      ...behindTheWall,
      positions: { ...behindTheWall.positions, [ORC]: { x: 125, y: 275 } },
      order: [HERO, GOBLIN, ORC],
      actors: { [GOBLIN]: { tokenAssetId: goblinAsset }, [ORC]: { tokenAssetId: orcAsset } }
    });
    for (const image of [goblinImage, orcImage]) {
      const upload = await table.http("/api/v1/token-assets?filename=token.png", table.gmToken, {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body: image
      });
      expect(upload.status).toBeLessThan(300);
    }
    const read = (id: string) => table.http(`/api/v1/token-assets/${id}/content`, table.playerToken);
    expect((await read(orcAsset)).status).toBe(200);
    expect((await read(goblinAsset)).status).toBe(403);
  });

  it("answers a creature id that doesn't exist and one that isn't Borin's the same way", async () => {
    const table = await hiddenTable({ ...behindTheWall, order: [HERO, GOBLIN] });
    const ask = (event: string, actorId: string) =>
      event === "action:resolve"
        ? emit(table.player, event, { actorId, actionId: "dodge" })
        : new Promise<Record<string, unknown>>((resolve) =>
            (table.player.emit as (...args: unknown[]) => void)(event, { actorId }, resolve)
          );
    for (const event of ["action:resolve", "actor:movement", "actor:available-actions"]) {
      const missing = await ask(event, randomUUID());
      const hidden = await ask(event, GOBLIN);
      expect(missing).toMatchObject({ ok: false });
      expect({ code: hidden.code, message: hidden.message }).toEqual({ code: missing.code, message: missing.message });
    }
  });
});
