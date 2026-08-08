import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { BuilderPolicySchema, GameStateSchema } from "@vtt/domain";
import { GAME_PATHS } from "@vtt/api-contract";
import { ActorDefinitionSchema, type ActorDefinition } from "@vtt/schemas";
import { STANDARD_ARRAY, statPriorityFor } from "@vtt/rules-5e";
import { buildCharacterDefinition, computeServerOffers, levelOfPick, storedHitPointRolls } from "../src/character-build.js";
import { generateCharacterRequest } from "../src/character-generate.js";
import { ContentLibrary } from "../src/content-library.js";
import { importActorDefinition } from "../src/actor-roster.js";
import { actionPools, effectiveActions } from "../src/effective-actions.js";
import { equipmentCatalogOf, isItemActionId } from "../src/equipment-derivation.js";
import { createServer } from "../src/server.js";

/**
 * THE RANDOM CHARACTER GENERATOR (issue `2d`) at the FAR END.
 *
 * Twelve classes at levels 1, 5, 11 and 20 - forty-eight characters, built against the REAL content
 * bundles, and each one asked three questions:
 *
 *   1. does it parse as a canonical `ActorDefinition`;
 *   2. does re-submitting its OWN choice ledger through `buildCharacterDefinition` produce an
 *      IDENTICAL definition - the real proof, because it can only hold if the generator answered
 *      legal offers with legal answers and nothing else;
 *   3. does the character have something to DO on its turn.
 *
 * (3) is not decoration. Four mechanisms this area built typechecked perfectly and reached zero
 * content; a generator that runs and produces a sheet with no usable action would be that failure
 * wearing a new hat, and `definition.actions.length > 0` would not catch it either - the weapons a
 * character swings come from `deriveEquipment` at read time, so the assertion has to go through
 * `effectiveActions` on an IMPORTED actor, which is what the sheet itself renders from.
 */

const contentLibrary = new ContentLibrary();
const library = contentLibrary.forAudience("gm");
const catalog = equipmentCatalogOf(library);
const defaultPolicy = BuilderPolicySchema.parse({});
const ACTOR_ID = "7a4b1a58-0f6c-4a52-9a51-2f60cf6f9d10";

/**
 * A seeded stand-in for `context.random`, same contract: 1..sides. mulberry32, so a seed is a
 * character and this file's numbers are reproducible by anyone who runs it.
 */
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

/**
 * ONE THING EACH CLASS OWES A CHARACTER, named by the id the engine really rolls or spends - either a
 * non-item action or a tracked pool (`actionPools`, which is `uses.pool ?? action.id`).
 *
 * This replaces `actions.some((action) => action.attack || action.damage.length > 0)`, which was
 * near-vacuous: every character carries a starting weapon and `deriveEquipment` turns it into an
 * attack, so the assertion passed with ZERO class content. Measured, a generated Druid L1 satisfied
 * it on a Sickle for 1d4 - 1.
 *
 * `atOne: null` is a FACT, not an exemption: Cleric, Druid, Paladin and Warlock are spells and prose
 * at level 1 and the engine tracks nothing of their own. Saying so beats a bar low enough to include
 * them. Every id here was confirmed present in all 15 seeds at that level.
 */
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

/** Everything on the effective list this character owns RATHER THAN CARRIES - actions and pools, minus the item-derived ones. */
const ownContent = (actions: readonly ActorDefinition["actions"][number][]): Set<string> => new Set([
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

          // THE ROUND TRIP. The stored ledger IS the build input (D14) - hand it straight back,
          // with the hit-point dice recovered from it by the shipped reader, and the definition
          // must come out byte-identical. A generator that answered an offer it invented, or wrote
          // a row the validator merely tolerated, cannot survive this.
          const ledger = definition.character!.choices!;
          const rolls = storedHitPointRolls(ledger, level);
          expect(rolls, `${classId} L${level} recorded no hit-point rolls`).not.toBeNull();
          const rebuilt = buildCharacterDefinition(
            { ...generated.request, choices: ledger, hp: { mode: "entries", entries: rolls! } }, library, defaultPolicy);
          expect(rebuilt, `${classId} L${level} did not round-trip`).toEqual(definition);

          // Playable: the class's own primary ability actually got the good number. The standard
          // array's top value is 15 (+2), and the background spread can only add to it - so a
          // generated caster whose spell DC reads 8+prof+0 is a character nobody would play.
          const primary = statPriorityFor(classId, library.classProgressionTable())[0];
          expect(definition.abilityScores[primary], `${classId} L${level} put ${primary.toUpperCase()} at ${definition.abilityScores[primary]}`)
            .toBeGreaterThanOrEqual(15);

          // Playable: something to do on its turn, and something its own CLASS gave it.
          const { actions } = assemble(definition);
          const onTurn = actions.filter((action) => action.activation === "action" || action.activation === "bonus-action");
          expect(onTurn.length, `${classId} L${level} has no action to take on its turn`).toBeGreaterThan(0);
          const owed = level === 1 ? CLASS_SIGNATURE[classId].atOne : CLASS_SIGNATURE[classId].later;
          const own = ownContent(actions);
          if (owed !== null) {
            expect(own.has(owed), `${classId} L${level} has no "${owed}" of its own - it holds ${[...own].sort().join(", ") || "nothing"}`).toBe(true);
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
      // Exactly the standard array, and in priority order - 15 on what the class needs most.
      expect([...Object.values(request.baseScores)].sort((a, b) => b - a), classId).toEqual([...STANDARD_ARRAY]);
      expect(priority.map((ability) => request.baseScores[ability]), classId).toEqual([...STANDARD_ARRAY]);
      // The background's printed +2/+1 goes to the best two abilities that background may raise.
      const background = library.backgroundRecord(request.backgroundId)!;
      const allowed = background.abilityOptions?.from ?? [];
      const ranked = [...allowed].sort((left, right) => priority.indexOf(left) - priority.indexOf(right));
      expect(request.backgroundBonusAllocation.map((entry) => entry.ability), `${classId}/${request.backgroundId}`)
        .toEqual(ranked.slice(0, request.backgroundBonusAllocation.length));
      expect(request.backgroundBonusAllocation.map((entry) => entry.amount)).toEqual([2, 1]);
    }
  });

  it("is deterministic in its injected random, and only in that", () => {
    const once = generateCharacterRequest({ classId: "wizard", level: 11 }, library, defaultPolicy, seeded(2026));
    const twice = generateCharacterRequest({ classId: "wizard", level: 11 }, library, defaultPolicy, seeded(2026));
    expect(twice).toEqual(once);
    const other = generateCharacterRequest({ classId: "wizard", level: 11 }, library, defaultPolicy, seeded(2027));
    // Not merely a different name: a different character. (Same class by request, everything else drawn.)
    expect(JSON.stringify(other.request.choices)).not.toEqual(JSON.stringify(once.request.choices));
  });

  it("draws the class too when none is asked for, and names the character from its own species", () => {
    const drawn = new Set<string>();
    for (let seed = 1; seed <= 40; seed += 1) drawn.add(generateCharacterRequest({ level: 3 }, library, defaultPolicy, seeded(seed)).request.classId);
    expect(drawn.size).toBeGreaterThan(1);
    const generated = generateCharacterRequest({ level: 3 }, library, defaultPolicy, seeded(11));
    const bundle = library.nameBundles().find((entry) => entry.speciesId === generated.request.speciesId)!;
    const pool = bundle.pools.flatMap((entry) => entry.names);
    expect(generated.request.name.split(" ").every((word) => pool.includes(word))).toBe(true);
    // A name that was ASKED for is used verbatim - the generator names, it does not rename.
    expect(generateCharacterRequest({ level: 3, name: "  Bramblefoot  " }, library, defaultPolicy, seeded(11)).request.name).toBe("Bramblefoot");
  });

  it("only ever picks expertise in a skill it is already proficient in", () => {
    // The three classes that print Expertise over the WHOLE skills catalog; step 8 rejects the build
    // outright for a skill the character does not hold, so this is the pick most able to go wrong.
    for (const classId of ["rogue", "bard", "ranger"]) {
      for (let seed = 1; seed <= 12; seed += 1) {
        const { request } = generateCharacterRequest({ classId, level: 11 }, library, defaultPolicy, seeded(seed));
        const definition = buildCharacterDefinition(request, library, defaultPolicy);
        const expertise = definition.proficiencies?.skills?.filter((skill) => skill.proficiency === "expertise") ?? [];
        expect(expertise.length, `${classId} seed ${seed}`).toBeGreaterThan(0);
      }
    }
  });

  /**
   * A GENERATED CHARACTER MUST LEVEL UP LIKE A HAND-BUILT ONE, which is the claim `ChoiceOffer.levels`
   * makes in its own docstring: `level-ledger.ts` matches a stored row to a wizard offer on the tuple
   * `(level, kind, classId, featureId)`, "so it can prefill a generated character's level-up exactly
   * as it prefills a hand-built one". It was false as shipped, twice over, and a generated cleric L11
   * left `feature:cleric-subclass` and `feature:grappler` unfilled while a hand-built one left nothing.
   */
  it("stamps every row with the tuple the level-up flow matches on", () => {
    // The FIRST bug: the subclass row was hand-written without `payload.featureId`, so no offer ever
    // claimed it. Checked against the offer the build really has rather than against a spelled-out
    // string, because "<class>-subclass" being the id is the wizard's convention, not a law.
    const misses: string[] = [];
    for (const classId of CLASS_IDS) {
      for (const level of LEVELS) {
        for (const seed of [1, 7, 11]) {
          const { request } = generateCharacterRequest({ classId, level }, library, defaultPolicy, seeded(seed));
          const ledger = buildCharacterDefinition(request, library, defaultPolicy).character!.choices!;
          for (const offer of computeServerOffers(request, library, defaultPolicy).offers) {
            for (const [index, id] of offer.taken.entries()) {
              const want = { level: levelOfPick(offer, index), kind: offer.kind, classId: offer.classId, featureId: offer.featureId };
              const found = ledger.some((row) => row.id === id
                && row.level === want.level && row.kind === want.kind
                && (row.classId ?? null) === want.classId
                && ((row.payload?.featureId as string | undefined) ?? null) === want.featureId);
              if (!found) misses.push(`${classId} L${level} s${seed}: no row answers ${JSON.stringify(want)} with "${id}"`);
            }
          }
        }
      }
    }
    expect(misses, misses.slice(0, 8).join("\n")).toEqual([]);
  });

  it("records a chosen feat's own picks at the ASI that took it, not at the first one", () => {
    // The SECOND bug: a feat's own picks inherited the whole ASI offer's `levels` array, so
    // `levelOfPick(offer, 0)` filed them at the FIRST improvement whichever one really took the feat.
    // Measured on the task's own example - a generated cleric 11 takes Grappler at the level-8 ASI.
    const cleric = generateCharacterRequest({ classId: "cleric", level: 11 }, library, defaultPolicy, seeded(11)).request;
    const ledger = buildCharacterDefinition(cleric, library, defaultPolicy).character!.choices!;
    expect(ledger.find((row) => row.kind === "asi-or-feat" && row.id === "grappler"))
      .toMatchObject({ level: 8, classId: "cleric" });
    expect(ledger.find((row) => row.payload?.featureId === "grappler"))
      .toMatchObject({ level: 8, kind: "ability-score" });
    // ...and the subclass row the same character used to write bare.
    expect(ledger.find((row) => row.kind === "subclass"))
      .toMatchObject({ level: 3, classId: "cleric", id: "life-domain", payload: { featureId: "cleric-subclass" } });

    // The rule, across the sweep: every row a chosen feat's OWN pick wrote sits at that feat's level.
    // (`ability-score-improvement` is excluded because the class FEATURE shares its id with the
    // catalog feat, so `payload.featureId` cannot tell one instance's picks from another's.)
    let checked = 0;
    const misses: string[] = [];
    for (const classId of CLASS_IDS) {
      for (const level of [11, 20] as const) {
        for (const seed of [1, 7, 11]) {
          const { request } = generateCharacterRequest({ classId, level }, library, defaultPolicy, seeded(seed));
          const rows = buildCharacterDefinition(request, library, defaultPolicy).character!.choices!;
          for (const feat of rows.filter((row) => row.kind === "asi-or-feat" && row.id !== "asi" && row.id !== "ability-score-improvement")) {
            for (const own of rows.filter((row) => row.payload?.featureId === feat.id)) {
              checked += 1;
              if (own.level !== feat.level) misses.push(`${classId} L${level} s${seed}: ${feat.id} taken at ${feat.level}, its ${own.kind} "${own.id}" filed at ${own.level}`);
            }
          }
        }
      }
    }
    // The sweep has to actually reach feats taken at a LATER improvement, or it proves nothing.
    expect(checked, "the sweep found no chosen feat with picks of its own").toBeGreaterThan(0);
    expect(misses, misses.slice(0, 8).join("\n")).toEqual([]);
  });

  it("refuses when the table has withdrawn the standard array, and says which setting to change", () => {
    const noArray = BuilderPolicySchema.parse({ allowedAbilityMethods: ["point-buy"] });
    expect(() => generateCharacterRequest({ classId: "cleric", level: 3 }, library, noArray, seeded(1)))
      .toThrow(/standard array/i);
  });
});

// ---------------------------------------------------------------------------------------------
// The role gate, over the real HTTP door.
// ---------------------------------------------------------------------------------------------

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

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
  cleanups.push(async () => { server.close(); await rm(directory, { recursive: true, force: true }); });
  return { base: `http://127.0.0.1:${address.port}`, server, gmToken };
}

const post = (base: string, path: string, token: string, body: unknown) =>
  fetch(base + path, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });

describe("random character generator - the role gate", () => {
  it("is closed to players by default, opens on the GM's setting, and auto-claims what a player rolls", async () => {
    const { base, server, gmToken } = await boot();
    const playerToken = server.auth.issuePlayerSession();

    // DENY BY DEFAULT - the whole difference from `playerBuilder`, which ships open.
    expect(server.store.snapshot.builderPolicy.playerRandom).toBe("gm-only");
    const denied = await post(base, GAME_PATHS.charactersRandom, playerToken, { commandId: randomUUID(), level: 3 });
    expect(denied.status).toBe(403);

    // The GM always may, whatever the setting says.
    const byGm = await post(base, GAME_PATHS.charactersRandom, gmToken, { commandId: randomUUID(), level: 3, classId: "cleric" });
    expect(byGm.status).toBe(200);
    const gmActorId = (await byGm.json()).data.actorId as string;
    const gmActor = server.store.snapshot.actors.find((actor) => actor.id === gmActorId)!;
    expect(gmActor.ownerSessionId).toBeNull(); // nobody's yet - the GM rolled it FOR someone
    expect(gmActor.definitionId).toBe(`import-${gmActorId}`);

    // The GM opens the door...
    const opened = await post(base, GAME_PATHS.builderPolicy, gmToken,
      { commandId: randomUUID(), allowedAbilityMethods: ["standard-array", "point-buy", "roll", "custom"], playerRandom: "open" });
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

    // The table's level cap is enforced against the STORED policy, not the caller's word.
    const capped = await post(base, GAME_PATHS.builderPolicy, gmToken,
      { commandId: randomUUID(), allowedAbilityMethods: ["standard-array"], maxLevel: 5 });
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
