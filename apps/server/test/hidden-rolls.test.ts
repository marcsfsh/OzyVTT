import { describe, expect, it } from "vitest";
import { ENCOUNTER_ARCHIVE_PATHS, GAME_PATHS } from "@vtt/api-contract";
import {
  emit,
  GOBLIN,
  GOBLIN_NAME,
  HERO,
  hiddenTable,
  mentionsGoblin,
  sentSince,
  settle,
  wall
} from "./hidden-creature-fixtures.js";

// Dice and the feed's record of them: a roll made by a creature hidden from the table stays the GM's for good, the
// fog hides a creature not yet on the map, and the feed's ids don't count the lines a player isn't sent (ADR-0023).

/** A wall from the top of the map down to y = 350 on x = 250; Borin west of it. */
const shortWall = {
  order: [GOBLIN, HERO],
  vision: { enabled: true, ambient: "bright" as const, walls: [wall({ x: 250, y: 0 }, { x: 250, y: 350 })] }
};
const STEALTH = { formula: "1d20+6", purpose: "check", visibility: "public", label: "Stealth", actorId: GOBLIN };

describe("rolls and the feed with a creature hidden by sight or the fog", () => {
  it("keeps a roll made while hidden from players after the creature steps into view", async () => {
    const table = await hiddenTable({
      ...shortWall,
      positions: { [HERO]: { x: 75, y: 275 }, [GOBLIN]: { x: 425, y: 175 } }
    });
    expect(mentionsGoblin(table.latest())).toBe(false);
    expect(await emit(table.gm, "dice:roll", STEALTH)).toMatchObject({ ok: true });
    expect(await emit(table.gm, "token:move", { actorId: GOBLIN, position: { x: 425, y: 475 } })).toMatchObject({
      ok: true
    });
    await settle();
    // The goblin is in view now, and still none of its rolls from behind the wall are.
    expect(table.latest().combat.tokens.map((token) => token.actorId)).toContain(GOBLIN);
    expect(table.latest().rolls.filter((roll) => roll.label === "Stealth")).toEqual([]);
  });

  it("leaves a roll made after the creature hid out of the shared replay", async () => {
    // In view as the fight and its turn start, then behind the wall, where it rolls.
    const table = await hiddenTable({
      ...shortWall,
      active: false,
      positions: { [HERO]: { x: 75, y: 275 }, [GOBLIN]: { x: 425, y: 475 } }
    });
    expect(
      await emit(table.gm, "encounter:start", {
        mapAssetId: table.mapAssetId,
        entries: [
          { actorId: GOBLIN, score: 20 },
          { actorId: HERO, score: 10 }
        ]
      })
    ).toMatchObject({ ok: true });
    await settle();
    expect(mentionsGoblin(table.latest())).toBe(true);
    expect(await emit(table.gm, "token:move", { actorId: GOBLIN, position: { x: 425, y: 175 } })).toMatchObject({
      ok: true
    });
    expect(await emit(table.gm, "dice:roll", STEALTH)).toMatchObject({ ok: true });
    expect(await emit(table.gm, "initiative:next", {})).toMatchObject({ ok: true });
    expect(await emit(table.gm, "encounter:end", {})).toMatchObject({ ok: true });
    const archives = (await (await table.http(ENCOUNTER_ARCHIVE_PATHS.collection, table.gmToken)).json()) as {
      data: { encounters: Array<{ id: number }> };
    };
    const archiveId = String(archives.data.encounters[0]!.id);
    const share = await table.http(ENCOUNTER_ARCHIVE_PATHS.visibility.replace("{id}", archiveId), table.gmToken, {
      method: "POST",
      body: JSON.stringify({ playerVisible: true })
    });
    expect(share.status).toBe(200);
    const replay = (await (
      await table.http(ENCOUNTER_ARCHIVE_PATHS.byId.replace("{id}", archiveId), table.playerToken)
    ).json()) as { data: { document: { rolls: Array<{ label?: string }> } } };
    expect(replay.data.document.rolls.filter((roll) => roll.label === "Stealth")).toEqual([]);
  });

  it("with fog alone, keeps a creature not yet placed out of the turn order and its initiative out of the feed", async () => {
    const table = await hiddenTable({
      active: false,
      order: [HERO],
      positions: { [HERO]: { x: 75, y: 275 } },
      reveals: [{ x: 50, y: 250, width: 50, height: 50 }]
    });
    const mark = table.mark();
    expect(
      await emit(table.gm, "encounter:start", {
        mapAssetId: table.mapAssetId,
        entries: [{ actorId: HERO, score: 20 }, { actorId: GOBLIN }]
      })
    ).toMatchObject({ ok: true });
    await settle();
    expect(sentSince(table.received, mark).filter(mentionsGoblin)).toEqual([]);
    // Set down under the fog it stays hidden; nothing about it was ever written to the player's feed.
    expect(await emit(table.gm, "token:move", { actorId: GOBLIN, position: { x: 425, y: 275 } })).toMatchObject({
      ok: true
    });
    const log = await (await table.http(`${GAME_PATHS.log}?limit=1000`, table.playerToken)).json();
    expect(mentionsGoblin(log)).toBe(false);
    expect(JSON.stringify(table.gmLog)).toContain(GOBLIN_NAME);
  });

  it("gives players feed ids that don't count the GM-only lines between them", async () => {
    const table = await hiddenTable({
      ...shortWall,
      positions: { [HERO]: { x: 75, y: 275 }, [GOBLIN]: { x: 425, y: 175 } }
    });
    // Two public lines with the goblin's GM-only rolls between them.
    expect(
      await emit(table.gm, "dice:roll", { formula: "1d20", purpose: "check", visibility: "public" })
    ).toMatchObject({ ok: true });
    for (let roll = 0; roll < 3; roll++) expect(await emit(table.gm, "dice:roll", STEALTH)).toMatchObject({ ok: true });
    expect(
      await emit(table.gm, "dice:roll", { formula: "1d20", purpose: "check", visibility: "public" })
    ).toMatchObject({ ok: true });
    await settle();
    const ids = (lines: unknown[]) => lines.map((line) => (line as { id: number }).id);
    const playerIds = ids(table.received.filter((entry) => entry.event === "log:entry").map((entry) => entry.payload));
    const gmIds = ids(table.gmLog);
    expect(playerIds).toHaveLength(2);
    expect(gmIds).toHaveLength(5);
    // The GM's rows run 1 to 5; the player's two are neither those numbers nor four apart.
    expect(playerIds.some((id) => gmIds.includes(id))).toBe(false);
    expect(Math.abs(playerIds[1]! - playerIds[0]!)).not.toBe(4);
    // The backfill gives the same ids as the live lines, so the client can match them.
    const log = (await (await table.http(`${GAME_PATHS.log}?limit=1000`, table.playerToken)).json()) as {
      data: { entries: Array<{ id: number }> };
    };
    expect(ids(log.data.entries)).toEqual(playerIds);
  });
});
