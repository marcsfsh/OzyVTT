import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema } from "@vtt/domain";
import { GAME_PATHS } from "@vtt/api-contract";
import { ActorDefinitionSchema, type ActorDefinition } from "@vtt/schemas";
import { STANDARD_ARRAY, statPriorityFor } from "@vtt/rules-5e";
import { buildCharacterDefinition, storedHitPointRolls } from "../src/character-build.js";
import { computeServerOffers, levelOfPick } from "../src/character-offers.js";
import { generateCharacterRequest } from "../src/character-generate.js";
import { ContentLibrary } from "../src/content-library.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { actionPools, effectiveActions } from "../src/effective-actions.js";
import { equipmentCatalogOf, isItemActionId } from "../src/equipment-derivation.js";
import { createServer } from "../src/server.js";

// The random character generator, for twelve classes at levels 1, 5, 11 and 20 against the real
// content bundles. Each character must:
//   1. parse as a canonical `ActorDefinition`;
//   2. rebuild to an identical definition from its own choice ledger via `buildCharacterDefinition`,
//      which only holds if every answer was a legal answer to a real offer;
//   3. have class content to use on its turn, checked through `effectiveActions` on an imported actor
//      because weapons derive from `deriveEquipment` at read time.

const contentLibrary = new ContentLibrary();
const library = contentLibrary.forAudience("gm");
const catalog = equipmentCatalogOf(library);
const defaultPolicy = BuilderPolicySchema.parse({});
const ACTOR_ID = "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10";

/** A seeded stand-in for `context.random` (1..sides), using mulberry32 so runs are reproducible. */
function seeded(seed: number): (sides: number) => number {
  let state = seed >>> 0;
  return (sides: number) => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return (((mixed ^ (mixed >>> 14)) >>> 0) % sides) + 1;
  };
}

const CLASS_IDS = library.classSummaries().map((entry) => entry.id);
const LEVELS = [1, 5, 11, 20] as const;

/** The definition a generated request assembles to, and the actions its owner can take on a turn. */
function assemble(definition: ActorDefinition) {
  const state = GameStateSchema.parse({ schemaVersion: 1 });
  importActorDefinition(state, definition, ACTOR_ID, "public", catalog);
  const actor = state.actors.find((entry) => entry.id === ACTOR_ID)!;
  return { actor, actions: effectiveActions(definition, actor, catalog) };
}

// One thing each class gives a character, named by the id the engine rolls or spends: a non-item
// action or a tracked pool (`uses.pool ?? action.id`). A starting weapon alone would satisfy a looser
// check. `atOne: null` means the class tracks nothing of its own at level 1 (Cleric, Druid, Paladin,
// Warlock).
const CLASS_SIGNATURE: Readonly<Record<string, Readonly<{ atOne: string | null; later: string }>>> = {
  barbarian: { atOne: "rage", later: "reckless-attack" },
  bard: { atOne: "bardic-inspiration", later: "cutting-words" },
  cleric: { atOne: null, later: "channel-divinity" },
  druid: { atOne: null, later: "wild-shape" },
  fighter: { atOne: "second-wind", later: "action-surge" },
  monk: { atOne: "unarmed-strike", later: "flurry-of-blows" },
  paladin: { atOne: null, later: "channel-divinity" },
  ranger: { atOne: "favored-enemy", later: "favored-enemy" },
  rogue: { atOne: "sneak-attack", later: "uncanny-dodge" },
  sorcerer: { atOne: "innate-sorcery", later: "sorcery-points" },
  warlock: { atOne: null, later: "magical-cunning" },
  wizard: { atOne: "arcane-recovery", later: "arcane-recovery" }
};

/** Everything on the effective list this character owns rather than carries: actions and pools, minus item-derived ones. */
const ownContent = (actions: readonly ActorDefinition["actions"][number][]): Set<string> =>
  new Set([
    ...actions.filter((action) => !isItemActionId(action.id)).map((action) => action.id),
    ...actionPools(actions).map((pool) => pool.id)
  ]);

describe("random character generator - the far end", () => {
  it("rolls all twelve classes at levels 1/5/11/20, and each one round-trips through its own ledger", () => {
    expect(CLASS_IDS).toHaveLength(12);
    // A thirteenth class must name what it owes rather than sliding through unchecked.
    expect([...CLASS_IDS].sort()).toEqual(Object.keys(CLASS_SIGNATURE).sort());
    const failures: string[] = [];
    for (const classId of CLASS_IDS) {
      for (const level of LEVELS) {
        const seed = CLASS_IDS.indexOf(classId) * 100 + level;
        try {
          const generated = generateCharacterRequest({ classId, level }, library, defaultPolicy, seeded(seed));
          const definition = buildCharacterDefinition(generated.request, library, defaultPolicy);
          ActorDefinitionSchema.parse(definition);

          // The stored ledger is the build input: hand it back with the hit-point dice recovered by the shipped
          // reader, and the definition must come out identical.
          const ledger = definition.character!.choices!;
          const rolls = storedHitPointRolls(ledger, level);
          expect(rolls, `${classId} L${level} recorded no hit-point rolls`).not.toBeNull();
          const rebuilt = buildCharacterDefinition(
            { ...generated.request, choices: ledger, hp: { mode: "entries", entries: rolls! } },
            library,
            defaultPolicy
          );
          expect(rebuilt, `${classId} L${level} did not round-trip`).toEqual(definition);

          // The class's primary ability got the good number: the standard array's top value is 15 (+2) and the
          // background spread can only add to it.
          const primary = statPriorityFor(classId, library.classProgressionTable())[0];
          expect(
            definition.abilityScores[primary],
            `${classId} L${level} put ${primary.toUpperCase()} at ${definition.abilityScores[primary]}`
          ).toBeGreaterThanOrEqual(15);

          // Something to do on its turn, and something its own class gave it.
          const { actions } = assemble(definition);
          const onTurn = actions.filter(
            (action) => action.activation === "action" || action.activation === "bonus-action"
          );
          expect(onTurn.length, `${classId} L${level} has no action to take on its turn`).toBeGreaterThan(0);
          const owed = level === 1 ? CLASS_SIGNATURE[classId].atOne : CLASS_SIGNATURE[classId].later;
          const own = ownContent(actions);
          if (owed !== null) {
            expect(
              own.has(owed),
              `${classId} L${level} has no "${owed}" of its own - it holds ${[...own].sort().join(", ") || "nothing"}`
            ).toBe(true);
          }
        } catch (error) {
          failures.push(`${classId} L${level}: ${(error as Error).message}`);
        }
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("distributes the standard array by the class's own stat priority, and aims the background spread the same way", () => {
    for (const classId of CLASS_IDS) {
      const { request } = generateCharacterRequest({ classId, level: 5 }, library, defaultPolicy, seeded(7));
      const priority = statPriorityFor(classId, library.classProgressionTable());
      // Exactly the standard array, in priority order: 15 on what the class needs most.
      expect(
        [...Object.values(request.baseScores)].sort((a, b) => b - a),
        classId
      ).toEqual([...STANDARD_ARRAY]);
      expect(
        priority.map((ability) => request.baseScores[ability]),
        classId
      ).toEqual([...STANDARD_ARRAY]);
      // The background's printed +2/+1 goes to the best two abilities that background may raise.
      const background = library.backgroundRecord(request.backgroundId)!;
      const allowed = background.abilityOptions?.from ?? [];
      const ranked = [...allowed].sort((left, right) => priority.indexOf(left) - priority.indexOf(right));
      expect(
        request.backgroundBonusAllocation.map((entry) => entry.ability),
        `${classId}/${request.backgroundId}`
      ).toEqual(ranked.slice(0, request.backgroundBonusAllocation.length));
      expect(request.backgroundBonusAllocation.map((entry) => entry.amount)).toEqual([2, 1]);
    }
  });

  it("is deterministic in its injected random, and only in that", () => {
    const once = generateCharacterRequest({ classId: "wizard", level: 11 }, library, defaultPolicy, seeded(2026));
    const twice = generateCharacterRequest({ classId: "wizard", level: 11 }, library, defaultPolicy, seeded(2026));
    expect(twice).toEqual(once);
    const other = generateCharacterRequest({ classId: "wizard", level: 11 }, library, defaultPolicy, seeded(2027));
    // A different character, not just a different name (same class by request, everything else drawn).
    expect(JSON.stringify(other.request.choices)).not.toEqual(JSON.stringify(once.request.choices));
  });

  it("draws the class too when none is asked for, and names the character from its own species", () => {
    const drawn = new Set<string>();
    for (let seed = 1; seed <= 40; seed += 1)
      drawn.add(generateCharacterRequest({ level: 3 }, library, defaultPolicy, seeded(seed)).request.classId);
    expect(drawn.size).toBeGreaterThan(1);
    const generated = generateCharacterRequest({ level: 3 }, library, defaultPolicy, seeded(11));
    const bundle = library.nameBundles().find((entry) => entry.speciesId === generated.request.speciesId)!;
    const pool = bundle.pools.flatMap((entry) => entry.names);
    expect(generated.request.name.split(" ").every((word) => pool.includes(word))).toBe(true);
    // A requested name is used verbatim.
    expect(
      generateCharacterRequest({ level: 3, name: "  Bramblefoot  " }, library, defaultPolicy, seeded(11)).request.name
    ).toBe("Bramblefoot");
  });

  it("only ever picks expertise in a skill it is already proficient in", () => {
    // The three classes whose Expertise draws on the whole skills catalog; the build rejects Expertise in
    // a skill the character does not hold, so this pick is the most error-prone.
    for (const classId of ["rogue", "bard", "ranger"]) {
      for (let seed = 1; seed <= 12; seed += 1) {
        const { request } = generateCharacterRequest({ classId, level: 11 }, library, defaultPolicy, seeded(seed));
        const definition = buildCharacterDefinition(request, library, defaultPolicy);
        const expertise = definition.proficiencies?.skills?.filter((skill) => skill.proficiency === "expertise") ?? [];
        expect(expertise.length, `${classId} seed ${seed}`).toBeGreaterThan(0);
      }
    }
  });

  // A generated character must level up like a hand-built one: `level-ledger.ts` matches a stored row to
  // a wizard offer on `(level, kind, classId, featureId)`, so every generated row must carry that tuple.
  it("stamps every row with the tuple the level-up flow matches on", () => {
    // The subclass row must carry `payload.featureId`. Checked against the offer the build has, since
    // "<class>-subclass" is the wizard's convention, not a law.
    const misses: string[] = [];
    for (const classId of CLASS_IDS) {
      for (const level of LEVELS) {
        for (const seed of [1, 7, 11]) {
          const { request } = generateCharacterRequest({ classId, level }, library, defaultPolicy, seeded(seed));
          const ledger = buildCharacterDefinition(request, library, defaultPolicy).character!.choices!;
          for (const offer of computeServerOffers(request, library, defaultPolicy).offers) {
            for (const [index, id] of offer.taken.entries()) {
              const want = {
                level: levelOfPick(offer, index),
                kind: offer.kind,
                classId: offer.classId,
                featureId: offer.featureId
              };
              const found = ledger.some(
                (row) =>
                  row.id === id &&
                  row.level === want.level &&
                  row.kind === want.kind &&
                  (row.classId ?? null) === want.classId &&
                  ((row.payload?.featureId as string | undefined) ?? null) === want.featureId
              );
              if (!found)
                misses.push(`${classId} L${level} s${seed}: no row answers ${JSON.stringify(want)} with "${id}"`);
            }
          }
        }
      }
    }
    expect(misses, misses.slice(0, 8).join("\n")).toEqual([]);
  });

  it("records a chosen feat's own picks at the ASI that took it, not at the first one", () => {
    // A feat's own picks must sit at the level the feat was taken, not at the first ASI level. A generated
    // cleric 11 takes Grappler at the level-8 ASI.
    const cleric = generateCharacterRequest(
      { classId: "cleric", level: 11 },
      library,
      defaultPolicy,
      seeded(11)
    ).request;
    const ledger = buildCharacterDefinition(cleric, library, defaultPolicy).character!.choices!;
    expect(ledger.find((row) => row.kind === "asi-or-feat" && row.id === "grappler")).toMatchObject({
      level: 8,
      classId: "cleric"
    });
    expect(ledger.find((row) => row.payload?.featureId === "grappler")).toMatchObject({
      level: 8,
      kind: "ability-score"
    });
    // ...and the subclass row.
    expect(ledger.find((row) => row.kind === "subclass")).toMatchObject({
      level: 3,
      classId: "cleric",
      id: "life-domain",
      payload: { featureId: "cleric-subclass" }
    });

    // Across the sweep, every row a chosen feat's own pick wrote sits at that feat's level.
    // `ability-score-improvement` is excluded: the class feature shares its id with the catalog feat, so
    // `payload.featureId` cannot tell one instance's picks from another's.
    let checked = 0;
    const misses: string[] = [];
    for (const classId of CLASS_IDS) {
      for (const level of [11, 20] as const) {
        for (const seed of [1, 7, 11]) {
          const { request } = generateCharacterRequest({ classId, level }, library, defaultPolicy, seeded(seed));
          const rows = buildCharacterDefinition(request, library, defaultPolicy).character!.choices!;
          for (const feat of rows.filter(
            (row) => row.kind === "asi-or-feat" && row.id !== "asi" && row.id !== "ability-score-improvement"
          )) {
            for (const own of rows.filter((row) => row.payload?.featureId === feat.id)) {
              checked += 1;
              if (own.level !== feat.level)
                misses.push(
                  `${classId} L${level} s${seed}: ${feat.id} taken at ${feat.level}, its ${own.kind} "${own.id}" filed at ${own.level}`
                );
            }
          }
        }
      }
    }
    // The sweep must reach feats taken at a later improvement, or it proves nothing.
    expect(checked, "the sweep found no chosen feat with picks of its own").toBeGreaterThan(0);
    expect(misses, misses.slice(0, 8).join("\n")).toEqual([]);
  });

  it("refuses when the table has withdrawn the standard array, and says which setting to change", () => {
    const noArray = BuilderPolicySchema.parse({ allowedAbilityMethods: ["point-buy"] });
    expect(() => generateCharacterRequest({ classId: "cleric", level: 3 }, library, noArray, seeded(1))).toThrow(
      /standard array/i
    );
  });
});

// The role gate, over HTTP.

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function boot() {
  const directory = await mkdtemp(join(tmpdir(), "vtt-generate-"));
  const server = createServer({
    authPath: join(directory, "auth.json"),
    databasePath: join(directory, "vtt.sqlite"),
    integrationCredentialsPath: join(directory, "integrations.sqlite"),
    mapAssetsPath: join(directory, "map-assets"),
    webDist: join(directory, "dist"),
    useDevelopmentClient: true,
    developmentClientPort: 5173
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

const post = (base: string, path: string, token: string, body: unknown) =>
  fetch(base + path, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body)
  });

describe("random character generator - the role gate", () => {
  it("is closed to players by default, opens on the GM's setting, and auto-claims what a player rolls", async () => {
    const { base, server, gmToken } = await boot();
    const playerToken = server.auth.issuePlayerSession();

    // Deny by default, unlike `playerBuilder`, which ships open.
    expect(server.store.snapshot.builderPolicy.playerRandom).toBe("gm-only");
    const denied = await post(base, GAME_PATHS.charactersRandom, playerToken, { commandId: randomUUID(), level: 3 });
    expect(denied.status).toBe(403);

    // The GM always may, whatever the setting says.
    const byGm = await post(base, GAME_PATHS.charactersRandom, gmToken, {
      commandId: randomUUID(),
      level: 3,
      classId: "cleric"
    });
    expect(byGm.status).toBe(200);
    const gmActorId = (await byGm.json()).data.actorId as string;
    const gmActor = server.store.snapshot.actors.find((actor) => actor.id === gmActorId)!;
    expect(gmActor.ownerSessionId).toBeNull(); // nobody's yet: the GM rolled it for someone
    expect(gmActor.definitionId).toBe(`import-${gmActorId}`);

    // The GM opens the door...
    const opened = await post(base, GAME_PATHS.builderPolicy, gmToken, {
      commandId: randomUUID(),
      allowedAbilityMethods: ["standard-array", "point-buy", "roll", "custom"],
      playerRandom: "open"
    });
    expect(opened.status).toBe(200);

    // ...and now the same player call lands, auto-claimed by its roller.
    const allowed = await post(base, GAME_PATHS.charactersRandom, playerToken, { commandId: randomUUID(), level: 3 });
    expect(allowed.status).toBe(200);
    const actorId = (await allowed.json()).data.actorId as string;
    const mine = server.store.snapshot.actors.find((actor) => actor.id === actorId)!;
    expect(mine.ownerSessionId).not.toBeNull();
    expect(mine.ownerSessionId).not.toBe(gmActor.ownerSessionId);

    // One character per player: the claim rule the builder already enforces holds here too.
    const second = await post(base, GAME_PATHS.charactersRandom, playerToken, { commandId: randomUUID(), level: 3 });
    expect(second.status).toBe(409);

    // The table's level cap is enforced against the stored policy, not the caller's word.
    const capped = await post(base, GAME_PATHS.builderPolicy, gmToken, {
      commandId: randomUUID(),
      allowedAbilityMethods: ["standard-array"],
      maxLevel: 5
    });
    expect(capped.status).toBe(200);
    const tooHigh = await post(base, GAME_PATHS.charactersRandom, gmToken, { commandId: randomUUID(), level: 9 });
    expect(tooHigh.status).toBe(409);
  });

  it("throws its hit-point dice into the table feed, and is idempotent on the commandId", async () => {
    const { base, server, gmToken } = await boot();
    const commandId = randomUUID();
    const first = await post(base, GAME_PATHS.charactersRandom, gmToken, { commandId, level: 5, classId: "fighter" });
    expect(first.status).toBe(200);
    const actorId = (await first.json()).data.actorId as string;

    // Four levels above the first, so four d10 in one public roll, attributed to the new character.
    const roll = server.store.snapshot.rolls.find((entry) => entry.commandId === commandId);
    expect(roll, "the generated hit-point dice never reached the feed").toBeTruthy();
    expect(roll!.formula).toBe("4d10");
    expect(roll!.dice).toHaveLength(4);
    expect(roll!.actorId).toBe(actorId);
    expect(roll!.visibility).toBe("public");

    // A retried delivery acks the same actor and does not roll a second character.
    const before = server.store.snapshot.actors.length;
    const retry = await post(base, GAME_PATHS.charactersRandom, gmToken, { commandId, level: 5, classId: "fighter" });
    expect(retry.status).toBe(200);
    expect((await retry.json()).data.actorId).toBe(actorId);
    expect(server.store.snapshot.actors).toHaveLength(before);
  });
});
