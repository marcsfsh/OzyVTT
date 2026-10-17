import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GAME_PATHS } from "@vtt/api-contract";
import { GameStateSchema } from "@vtt/domain";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

// Ability-score rolls for the builder go through the server's dice and record one public roll in the
// table feed. While the table keeps players' dice on the server, a player's rolled scores must be that
// roll's six totals and their hit points are thrown by the server; the GM, and players at a table that
// lets them type their dice (the default), may submit physical dice within the formula's bounds.

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

const bearer = (token: string) => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const post = (base: string, path: string, token: string, body: unknown = {}) =>
  fetch(base + path, { method: "POST", headers: bearer(token), body: JSON.stringify(body) });

async function boot() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-builder-rolls-"));
  const server = createServer({
    authPath: join(directory, "auth.json"),
    databasePath: join(directory, "vtt.sqlite"),
    integrationCredentialsPath: join(directory, "integrations.sqlite"),
    mapAssetsPath: join(directory, "map-assets"),
    webDist: join(directory, "dist"),
    useDevelopmentClient: true,
    developmentClientPort: 5173,
    initialGameState: GameStateSchema.parse({ schemaVersion: 1 })
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
  return { base: `http://127.0.0.1:${address.port}`, server, gmToken, playerToken: server.auth.issuePlayerSession() };
}

const ALL_METHODS = ["standard-array", "point-buy", "roll", "custom"];

describe("builder.roll-abilities", () => {
  it("rolls six scores server-side, in range, and records one public roll in the feed", async () => {
    const { base, server, gmToken } = await boot();
    const response = await post(base, GAME_PATHS.builderRollAbilities, gmToken, { method: "roll" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.scores).toHaveLength(6);
    // 4d6kh3: never below 3, never above 18, and the kept dice ride along for the wizard to show.
    for (const score of body.data.scores) {
      expect(score).toBeGreaterThanOrEqual(3);
      expect(score).toBeLessThanOrEqual(18);
    }
    expect(body.data.dice).toHaveLength(6);
    expect(body.data.dice[0]).toHaveLength(4);

    const roll = server.store.snapshot.rolls.find((entry) => entry.id === body.data.rollId)!;
    expect(roll).toMatchObject({ label: "Ability scores", purpose: "manual", visibility: "public", actorId: null });
    expect(roll.dice).toHaveLength(24);
  });

  it("honours the table's allowed methods and the GM's custom formula", async () => {
    const { base, gmToken } = await boot();
    await post(base, GAME_PATHS.builderPolicy, gmToken, { allowedAbilityMethods: ["standard-array"] });
    expect((await post(base, GAME_PATHS.builderRollAbilities, gmToken, { method: "roll" })).status).toBe(409);

    // "custom" without a formula is refused rather than silently falling back to the SRD dice.
    await post(base, GAME_PATHS.builderPolicy, gmToken, { allowedAbilityMethods: ["custom"] });
    expect((await post(base, GAME_PATHS.builderRollAbilities, gmToken, { method: "custom" })).status).toBe(409);

    await post(base, GAME_PATHS.builderPolicy, gmToken, { allowedAbilityMethods: ["custom"], customFormula: "3d6" });
    const custom = await post(base, GAME_PATHS.builderRollAbilities, gmToken, { method: "custom" });
    expect(custom.status).toBe(200);
    for (const score of (await custom.json()).data.scores) {
      expect(score).toBeGreaterThanOrEqual(3);
      expect(score).toBeLessThanOrEqual(18);
    }
  });

  it("follows the same player-builder gate the wizard itself does", async () => {
    const { base, gmToken, playerToken } = await boot();
    await post(base, GAME_PATHS.builderPolicy, gmToken, {
      allowedAbilityMethods: ALL_METHODS,
      playerBuilder: "gm-only"
    });
    expect((await post(base, GAME_PATHS.builderRollAbilities, playerToken, { method: "roll" })).status).toBe(403);

    await post(base, GAME_PATHS.builderPolicy, gmToken, { allowedAbilityMethods: ALL_METHODS, playerBuilder: "open" });
    expect((await post(base, GAME_PATHS.builderRollAbilities, playerToken, { method: "roll" })).status).toBe(200);
  });
});

/** A level-3 Fighter create, rolled scores and all, as a player's wizard sends it. */
const fighterCreate = (over: Record<string, unknown> = {}) => ({
  commandId: randomUUID(),
  name: "Brin",
  speciesId: "dwarf",
  backgroundId: "soldier",
  classId: "fighter",
  level: 3,
  subclassId: "champion",
  abilityMethod: "roll",
  baseScores: { str: 16, dex: 14, con: 14, int: 8, wis: 12, cha: 10 },
  backgroundBonusAllocation: [
    { ability: "str", amount: 2 },
    { ability: "con", amount: 1 }
  ],
  hp: { mode: "average" },
  choices: [
    { level: 1, kind: "language", id: "elvish" },
    { level: 1, kind: "language", id: "giant" },
    { level: 1, classId: "fighter", kind: "skill", id: "survival" },
    { level: 1, classId: "fighter", kind: "skill", id: "perception" },
    { level: 1, classId: "fighter", kind: "fighting-style", id: "defense", payload: { featureId: "fighting-style" } },
    { level: 1, classId: "fighter", kind: "weapon-mastery", id: "greatsword" },
    { level: 1, classId: "fighter", kind: "weapon-mastery", id: "flail" },
    { level: 1, classId: "fighter", kind: "weapon-mastery", id: "longbow" },
    { level: 3, classId: "fighter", kind: "subclass", id: "champion" },
    { level: 1, kind: "tool", id: "gaming-set-dice" },
    { level: 1, kind: "equipment", id: "fighter-a" },
    { level: 1, kind: "equipment", id: "soldier-a" }
  ],
  ...over
});

/** The six rolled totals in sheet order, assigned top to bottom. */
const assigned = (scores: readonly number[]) => ({
  str: scores[0],
  dex: scores[1],
  con: scores[2],
  int: scores[3],
  wis: scores[4],
  cha: scores[5]
});

describe("a player's rolled dice are the table's", () => {
  it("refuses typed scores from a player at a server-rolled table, and takes the six the server rolled", async () => {
    const { base, server, gmToken, playerToken } = await boot();
    await post(base, GAME_PATHS.builderPolicy, gmToken, {
      commandId: randomUUID(),
      allowedAbilityMethods: ALL_METHODS,
      typedRolls: "gm-only"
    });
    const typed = await post(base, GAME_PATHS.characters, playerToken, fighterCreate());
    expect(typed.status).toBe(409);
    expect((await typed.json()).error.message).toMatch(/Roll them in the builder/);

    const roll = (await (await post(base, GAME_PATHS.builderRollAbilities, playerToken, { method: "roll" })).json())
      .data;
    // Swapped scores are refused: they are not the six the table rolled.
    const forged = await post(
      base,
      GAME_PATHS.characters,
      playerToken,
      fighterCreate({
        abilityRollId: roll.rollId,
        baseScores: assigned(roll.scores.map((score: number) => Math.min(18, score + 1)))
      })
    );
    expect(forged.status).toBe(409);

    const honest = await post(
      base,
      GAME_PATHS.characters,
      playerToken,
      fighterCreate({ abilityRollId: roll.rollId, baseScores: assigned(roll.scores) })
    );
    expect(honest.status).toBe(200);
    const actorId = (await honest.json()).data.actorId as string;
    const definition = server.store.snapshot.definitions.find((entry) => entry.id === `import-${actorId}`)!.definition;
    expect(definition.character?.choices?.find((row) => row.kind === "ability-scores")).toMatchObject({
      id: "roll",
      payload: { baseScores: assigned(roll.scores) }
    });

    // Levelling up re-sends the values the sheet recorded, in any order, with no new roll; other values need one.
    const levelFour = (baseScores: Record<string, number>) =>
      post(base, GAME_PATHS.characterRebuild.replace("{actorId}", actorId), playerToken, {
        ...fighterCreate({ level: 4, baseScores }),
        name: undefined,
        actorId,
        choices: [
          ...fighterCreate().choices,
          { level: 4, classId: "fighter", kind: "weapon-mastery", id: "rapier" },
          {
            level: 4,
            classId: "fighter",
            kind: "asi-or-feat",
            id: "asi",
            payload: { increases: [{ ability: "int", amount: 2 }] }
          }
        ]
      });
    const raised = assigned(roll.scores.map((score: number) => (score === 18 ? 3 : score + 1)));
    expect((await levelFour(raised)).status).toBe(409);
    const swapped = assigned(roll.scores);
    [swapped.str, swapped.dex] = [swapped.dex, swapped.str];
    // ...even once the GM stops allowing rolled scores for new characters.
    await post(base, GAME_PATHS.builderPolicy, gmToken, {
      commandId: randomUUID(),
      allowedAbilityMethods: ["standard-array"]
    });
    expect((await levelFour(swapped)).status).toBe(200);
  });

  it("lets a sheet that recorded no scores re-send the ones its totals imply, and nothing else", async () => {
    const { base, server, gmToken, playerToken } = await boot();
    const roll = (await (await post(base, GAME_PATHS.builderRollAbilities, playerToken, { method: "roll" })).json())
      .data;
    const created = await post(
      base,
      GAME_PATHS.characters,
      playerToken,
      fighterCreate({ abilityRollId: roll.rollId, baseScores: assigned(roll.scores) })
    );
    expect(created.status).toBe(200);
    const actorId = (await created.json()).data.actorId as string;
    // A sheet built before the ledger kept its scores: the same sheet with that row gone.
    await server.store.execute({ id: randomUUID(), type: "test.forget-scores" }, (state) => {
      const stored = state.definitions.find((entry) => entry.id === `import-${actorId}`)!.definition;
      stored.character!.choices = stored.character!.choices!.filter((row) => row.kind !== "ability-scores");
    });
    await post(base, GAME_PATHS.builderPolicy, gmToken, {
      commandId: randomUUID(),
      allowedAbilityMethods: ["standard-array"]
    });
    const stored = server.store.snapshot.definitions.find((entry) => entry.id === `import-${actorId}`)!.definition;
    const draft = {
      speciesId: "dwarf",
      backgroundId: "soldier",
      classId: "fighter",
      level: 4,
      choices: stored.character!.choices,
      sheet: { level: 3, abilityScores: stored.abilityScores }
    };
    const offers = await fetch(
      `${base}${GAME_PATHS.builderOffers}?draft=${encodeURIComponent(JSON.stringify(draft))}`,
      {
        headers: bearer(playerToken)
      }
    );
    const abilities = (await offers.json()).data.abilities;
    // Base scores and a Soldier's +2/+1 that add up to the sheet's totals. How they were made is not recorded, so any
    // method and spread that rebuild the same totals will do (rolled values can also be a legal point buy).
    expect(abilities.derived).toBe(true);
    expect(["roll", "point-buy", "standard-array"]).toContain(abilities.abilityMethod);
    for (const ability of ["str", "dex", "con", "int", "wis", "cha"] as const) {
      const raised = abilities.backgroundBonusAllocation.find(
        (entry: { ability: string; amount: number }) => entry.ability === ability
      );
      expect(abilities.baseScores[ability] + (raised?.amount ?? 0)).toBe(stored.abilityScores[ability]);
    }
    const levelFour = (baseScores: Record<string, number>) =>
      post(base, GAME_PATHS.characterRebuild.replace("{actorId}", actorId), playerToken, {
        ...fighterCreate({
          level: 4,
          abilityMethod: abilities.abilityMethod,
          baseScores,
          backgroundBonusAllocation: abilities.backgroundBonusAllocation
        }),
        name: undefined,
        actorId,
        choices: [
          ...fighterCreate().choices,
          { level: 4, classId: "fighter", kind: "weapon-mastery", id: "rapier" },
          {
            level: 4,
            classId: "fighter",
            kind: "asi-or-feat",
            id: "asi",
            payload: { increases: [{ ability: "int", amount: 2 }] }
          }
        ]
      });
    // At a standard-array table only the sheet's own scores pass under another method.
    const lowered = Object.fromEntries(
      Object.entries(abilities.baseScores as Record<string, number>).map(([ability, score]) => [ability, score - 1])
    );
    expect((await levelFour(lowered)).status).toBe(409);
    const kept = await levelFour(abilities.baseScores);
    expect(kept.status).toBe(200);
    const rebuilt = server.store.snapshot.definitions.find((entry) => entry.id === `import-${actorId}`)!.definition;
    // From here on the ledger records them.
    expect(rebuilt.character?.choices?.find((row) => row.kind === "ability-scores")).toMatchObject({
      id: abilities.abilityMethod,
      payload: { baseScores: abilities.baseScores }
    });
  });

  it("refuses a player's typed hit points at a server-rolled table, and rolls them on the server instead", async () => {
    const { base, server, gmToken, playerToken } = await boot();
    await post(base, GAME_PATHS.builderPolicy, gmToken, {
      commandId: randomUUID(),
      allowedAbilityMethods: ALL_METHODS,
      typedRolls: "gm-only"
    });
    const standard = {
      abilityMethod: "standard-array",
      baseScores: { str: 15, dex: 14, con: 13, int: 8, wis: 12, cha: 10 }
    };
    const typed = await post(
      base,
      GAME_PATHS.characters,
      playerToken,
      fighterCreate({ ...standard, hp: { mode: "entries", entries: [10, 10] } })
    );
    expect(typed.status).toBe(409);
    expect((await typed.json()).error.message).toMatch(/Roll on the table/);

    const rolled = await post(
      base,
      GAME_PATHS.characters,
      playerToken,
      fighterCreate({ ...standard, hp: { mode: "roll" } })
    );
    expect(rolled.status).toBe(200);
    const actorId = (await rolled.json()).data.actorId as string;
    const feed = server.store.snapshot.rolls.find(
      (entry) => entry.actorId === actorId && entry.label?.startsWith("Hit points")
    )!;
    expect(feed.dice).toHaveLength(2);
    const definition = server.store.snapshot.definitions.find((entry) => entry.id === `import-${actorId}`)!.definition;
    const rows = definition.character!.choices!.filter((row) => row.kind === "hp-roll");
    expect(rows.map((row) => row.payload?.roll)).toEqual(feed.dice.map((die) => die.face));
  });

  it("lets players type their own dice by default, and the GM always", async () => {
    const { base, gmToken, playerToken } = await boot();
    await post(base, GAME_PATHS.builderPolicy, gmToken, {
      commandId: randomUUID(),
      allowedAbilityMethods: ALL_METHODS,
      typedRolls: "gm-only"
    });
    const byGm = await post(
      base,
      GAME_PATHS.characters,
      gmToken,
      fighterCreate({ hp: { mode: "entries", entries: [9, 2] } })
    );
    expect(byGm.status).toBe(200);
    const refused = await post(
      base,
      GAME_PATHS.characters,
      playerToken,
      fighterCreate({ hp: { mode: "entries", entries: [9, 2] } })
    );
    expect(refused.status).toBe(409);

    // A fresh table lets players type what their dice show.
    const fresh = await boot();
    const byPlayer = await post(
      fresh.base,
      GAME_PATHS.characters,
      fresh.playerToken,
      fighterCreate({ hp: { mode: "entries", entries: [9, 2] } })
    );
    expect(byPlayer.status).toBe(200);
  });
});
