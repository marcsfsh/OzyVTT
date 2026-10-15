import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { io as connect } from "socket.io-client";
import { Ajv2020 } from "ajv/dist/2020.js";
import { GAME_PATHS } from "@vtt/api-contract";
import { openApiDocument } from "../src/openapi/document.js";
import {
  BuilderPolicySchema,
  GameStateSchema,
  type BuilderOffer,
  type BuilderOffersReply,
  type BuilderOffersRequest
} from "@vtt/domain";
import { ABILITIES, STANDARD_ARRAY } from "@vtt/rules-5e";
import { builderOffers } from "../src/builder-offers.js";
import { buildCharacterDefinition } from "../src/character-build.js";
import { ContentLibrary } from "../src/content-library.js";
import { createServer } from "../src/server.js";

// The wizard's offers come from the survey `character.create` validates against. These cases hold the
// two together on the real bundles, and pin what the wizard relies on: budgets raised by features,
// a chosen option's own pick, one card per grant level, answers pruned when the build changes shape, and
// a stored ledger reading back onto the same cards.

const view = new ContentLibrary().forAudience("gm");
const policy = BuilderPolicySchema.parse({});

const offers = (request: BuilderOffersRequest) => builderOffers(request, view);
const offerNamed = (reply: BuilderOffersReply, key: string) => reply.offers.find((offer) => offer.key === key);
const capacityOf = (reply: BuilderOffersReply, key: string) => offerNamed(reply, key)?.capacity;
const ids = (offer: BuilderOffer | undefined) => offer?.options.map((option) => option.id) ?? [];

/** The create a finished draft sends: the standard array down the six abilities, Soldier's +2/+1. */
const createFrom = (identity: { classId: string; level: number }, reply: BuilderOffersReply) =>
  buildCharacterDefinition(
    {
      name: "Survey",
      speciesId: "human",
      backgroundId: "soldier",
      ...identity,
      ...(reply.subclassId ? { subclassId: reply.subclassId } : {}),
      abilityMethod: "standard-array",
      baseScores: Object.fromEntries(ABILITIES.map((ability, index) => [ability, STANDARD_ARRAY[index]])) as never,
      backgroundBonusAllocation: [
        { ability: "str", amount: 2 },
        { ability: "con", amount: 1 }
      ],
      hp: { mode: "average" },
      choices: reply.choices
    },
    view,
    policy
  );

const filled = (offer: BuilderOffer, picks: BuilderOffersReply["picks"]) =>
  offer.unresolvable !== null || (picks[offer.key] ?? []).length === offer.capacity;

/**
 * Answers the first open offer with the first options it still allows, as the wizard's path opens, until
 * nothing is open. Ability-score picks rotate so the 20 cap is not what is tested. Unanswerable offers are
 * collected, not thrown, so a failure names them.
 */
function fillGreedily(classId: string, level: number) {
  const identity = { speciesId: "human", backgroundId: "soldier", classId, level };
  let picks: Record<string, readonly string[]> = {};
  const unfillable: string[] = [];
  let rotation = 0;
  for (let guard = 0; guard < 200; guard += 1) {
    const reply = offers({ ...identity, picks });
    picks = { ...reply.picks };
    const open = reply.offers.find((offer) => !filled(offer, picks) && !unfillable.includes(offer.key));
    if (!open) return { reply, unfillable };
    const usable = open.options.filter((option) => !open.unavailable?.[option.id]);
    const room = open.capacity - (picks[open.key] ?? []).length;
    const fresh = usable.filter((option) => !(picks[open.key] ?? []).includes(option.id));
    if (fresh.length < room) {
      unfillable.push(open.key);
      continue;
    }
    const answer =
      open.kind === "ability-score"
        ? Array.from({ length: room }, (_, index) => fresh[(rotation + index) % fresh.length].id)
        : fresh.slice(0, room).map((option) => option.id);
    rotation += room;
    picks = { ...picks, [open.key]: [...(picks[open.key] ?? []), ...answer] };
  }
  throw new Error(`The greedy fill did not settle for ${classId} ${level}.`);
}

describe("every SRD class, answered through the offers, is a character the server creates", () => {
  const classIds = view
    .classSummaries()
    .map((entry) => entry.id)
    .sort();
  const cases = classIds.flatMap((classId) => [1, 3, 5, 11, 16, 20].map((level) => [classId, level] as const));

  it("sweeps all twelve classes", () => {
    expect(classIds).toHaveLength(12);
  });

  it.each(cases)("%s %i", (classId, level) => {
    const { reply, unfillable } = fillGreedily(classId, level);
    expect(unfillable, "offers the player cannot fill").toEqual([]);
    const overfull = reply.offers.filter(
      (offer) => offer.unresolvable === null && offer.capacity > offer.options.length
    );
    expect(overfull.map((offer) => offer.key)).toEqual([]);
    const definition = createFrom({ classId, level }, reply);
    expect(definition.character?.classes?.[0]).toMatchObject({ id: classId, level });
  });
});

describe("features that raise a budget", () => {
  const cleric = (picks: Record<string, readonly string[]>) =>
    offers({ speciesId: "human", backgroundId: "acolyte", classId: "cleric", level: 1, picks });

  it("adds Thaumaturge's extra cantrip, and only Thaumaturge's", () => {
    expect(capacityOf(cleric({ "feature:divine-order": ["thaumaturge"] }), "class-cantrips")).toBe(4);
    expect(capacityOf(cleric({ "feature:divine-order": ["protector"] }), "class-cantrips")).toBe(3);
    expect(capacityOf(cleric({}), "class-cantrips")).toBe(3);
  });

  it("drops the fourth cantrip when the role changes, from the answers and from the ledger", () => {
    const four = ["guidance", "light", "mending", "resistance"];
    const kept = cleric({ "feature:divine-order": ["thaumaturge"], "class-cantrips": four });
    expect(kept.picks["class-cantrips"]).toEqual(four);
    expect(kept.choices.filter((row) => row.kind === "cantrip")).toHaveLength(4);
    const swapped = cleric({ "feature:divine-order": ["protector"], "class-cantrips": four });
    expect(swapped.picks["class-cantrips"]).toEqual(four.slice(0, 3));
    expect(swapped.choices.filter((row) => row.kind === "cantrip")).toHaveLength(3);
  });

  it("reads a raise off a feature that asks for no pick of its own (Primal Knowledge)", () => {
    const barbarian = (level: number) =>
      offers({ speciesId: "human", backgroundId: "soldier", classId: "barbarian", level });
    expect(capacityOf(barbarian(3), "class-skills")).toBe((capacityOf(barbarian(2), "class-skills") ?? 0) + 1);
  });

  it("grows a scaling budget with the printed column (Weapon Mastery)", () => {
    const fighter = (level: number) =>
      offers({ speciesId: "human", backgroundId: "soldier", classId: "fighter", level });
    expect(capacityOf(fighter(1), "feature:weapon-mastery")).toBe(3);
    expect(capacityOf(fighter(4), "feature:weapon-mastery")).toBe(4);
  });
});

describe("a chosen option's own pick", () => {
  const paladin = (picks: Record<string, readonly string[]>) =>
    offers({ speciesId: "human", backgroundId: "soldier", classId: "paladin", level: 2, picks });

  it("appears once Blessed Warrior is chosen, offering two Cleric cantrips beneath the Fighting Style", () => {
    expect(offerNamed(paladin({}), "feature:blessed-warrior")).toBeUndefined();
    const reply = paladin({ "feature:fighting-style": ["blessed-warrior"] });
    const nested = offerNamed(reply, "feature:blessed-warrior");
    expect(nested).toMatchObject({ capacity: 2, featureId: "blessed-warrior", step: "features" });
    expect(nested!.options.length).toBeGreaterThan(0);
    expect(nested!.options.every((option) => option.level === 0)).toBe(true);
    const keys = reply.offers.map((offer) => offer.key);
    expect(keys.indexOf("feature:blessed-warrior")).toBe(keys.indexOf("feature:fighting-style") + 1);
  });

  it("keeps the option's answers in the same request that chooses the option", () => {
    // A resumed draft sends both at once; the option's offer only exists once the option is surveyed.
    const reply = paladin({
      "feature:fighting-style": ["blessed-warrior"],
      "feature:blessed-warrior": ["guidance", "light"]
    });
    expect(reply.picks["feature:blessed-warrior"]).toEqual(["guidance", "light"]);
    expect(reply.choices).toContainEqual(
      expect.objectContaining({ kind: "cantrip", id: "guidance", payload: { featureId: "blessed-warrior" } })
    );
  });

  it("offers Agonizing Blast only the damaging cantrips this Warlock knows, and waits until there is one", () => {
    const warlock = (cantrips: readonly string[]) =>
      offers({
        speciesId: "human",
        backgroundId: "soldier",
        classId: "warlock",
        level: 2,
        picks: { "feature:eldritch-invocations": ["agonizing-blast"], "class-cantrips": cantrips }
      });
    expect(offerNamed(warlock([]), "feature:agonizing-blast")?.unresolvable).toMatch(/deals damage/);
    const blast = offerNamed(warlock(["eldritch-blast", "prestidigitation"]), "feature:agonizing-blast");
    expect(blast?.unresolvable).toBeNull();
    expect(ids(blast)).toEqual(["eldritch-blast"]);
  });
});

describe("one card per decision", () => {
  it("gives each Ability Score Improvement level its own card, stamped with that level", () => {
    const reply = offers({ speciesId: "human", backgroundId: "acolyte", classId: "cleric", level: 8 });
    const asi = reply.offers.filter((offer) => offer.kind === "asi-or-feat");
    expect(asi.map((offer) => [offer.key, offer.level, offer.capacity])).toEqual([
      ["feature:ability-score-improvement@4", 4, 1],
      ["feature:ability-score-improvement@8", 8, 1]
    ]);
  });

  it("splits a repeated grant and greys a later grant's options the earlier one took", () => {
    const reply = offers({
      speciesId: "human",
      backgroundId: "soldier",
      classId: "rogue",
      level: 6,
      picks: {
        "class-skills": ["stealth", "perception", "acrobatics", "insight"],
        "feature:expertise": ["stealth", "perception"]
      }
    });
    const [first, second] = reply.offers.filter((offer) => offer.kind === "expertise");
    expect([first.key, first.level, second.key, second.level]).toEqual([
      "feature:expertise",
      1,
      "feature:expertise#2",
      6
    ]);
    expect(second.unavailable?.stealth).toMatch(/already chosen for Expertise at level 1/);
    // Expertise needs the proficiency: a skill this rogue lacks is greyed with that reason.
    expect(second.unavailable?.arcana).toBe("not one of your proficiencies");
  });

  it("greys a proficiency the background already grants, saying so", () => {
    const reply = offers({ speciesId: "human", backgroundId: "soldier", classId: "fighter", level: 1 });
    expect(offerNamed(reply, "class-skills")?.unavailable?.athletics).toBe("already granted by Soldier");
    // Every fixed source the build refuses a repeat of greys too: the species' own language here.
    const languages = reply.offers.find((offer) => offer.kind === "language");
    expect(languages?.unavailable?.common).toMatch(/^already granted by /);
  });
});

describe("answers follow the build", () => {
  it("drops a Fighter's skills when the class becomes Wizard", () => {
    const fighter = offers({
      speciesId: "human",
      backgroundId: "soldier",
      classId: "fighter",
      level: 1,
      picks: { "class-skills": ["acrobatics", "perception"] }
    });
    expect(fighter.picks["class-skills"]).toEqual(["acrobatics", "perception"]);
    const wizard = offers({
      speciesId: "human",
      backgroundId: "soldier",
      classId: "wizard",
      level: 1,
      picks: fighter.picks
    });
    expect(wizard.picks["class-skills"]).toBeUndefined();
  });

  it("offers each step's picks before the rest of the identity is chosen", () => {
    const reply = offers({ speciesId: "elf", level: 1 });
    expect(reply.offers.every((offer) => offer.step === "species")).toBe(true);
    expect(ids(offerNamed(reply, "feature:elf-keen-senses"))).toEqual(["insight", "perception", "survival"]);
  });

  it("reads a stored ledger back onto the same cards", () => {
    const { reply } = fillGreedily("fighter", 8);
    const reread = offers({
      speciesId: "human",
      backgroundId: "soldier",
      classId: "fighter",
      level: 8,
      choices: reply.choices
    });
    expect(reread.picks).toEqual(reply.picks);
    expect(reread.subclassId).toBe(reply.subclassId);
    // Read back at a lower level, only what that level owns survives.
    const lower = offers({
      speciesId: "human",
      backgroundId: "soldier",
      classId: "fighter",
      level: 2,
      choices: reply.choices
    });
    expect(lower.choices.every((row) => row.level <= 2)).toBe(true);
    expect(lower.subclassId).toBeNull();
  });
});

describe("the builder:offers read", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function boot() {
    const directory = await mkdtemp(join(tmpdir(), "vtt-builder-offers-"));
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
    const base = `http://127.0.0.1:${address.port}`;
    cleanups.push(async () => {
      server.close();
      await rm(directory, { recursive: true, force: true });
    });
    return { base, server, gmToken };
  }
  const get = (base: string, token: string, draft: unknown) =>
    fetch(`${base}${GAME_PATHS.builderOffers}?draft=${encodeURIComponent(JSON.stringify(draft))}`, {
      headers: { authorization: `Bearer ${token}` }
    });

  it("answers over HTTP and the socket alike, to the GM and to a player while the table lets players build", async () => {
    const { base, server, gmToken } = await boot();
    const draft = { speciesId: "elf", level: 1 };
    const overHttp = await get(base, gmToken, draft);
    expect(overHttp.status).toBe(200);
    const body = await overHttp.json();
    expect(body.data.offers.map((offer: BuilderOffer) => offer.key)).toContain("feature:elf-keen-senses");
    // The served shape is the documented one, for a draft far enough along to fill every field.
    const ajv = new Ajv2020({ strict: false });
    ajv.addSchema(openApiDocument as unknown as Record<string, unknown>, "openapi");
    const documented = (component: string) => ajv.compile({ $ref: `openapi#/components/schemas/${component}` });
    const full = {
      speciesId: "human",
      backgroundId: "acolyte",
      classId: "cleric",
      level: 4,
      picks: { "class-skills": ["history"] }
    };
    const fullBody = await (await get(base, gmToken, full)).json();
    const response = documented("BuilderOffersResponse");
    expect(response(fullBody), ajv.errorsText(response.errors)).toBe(true);
    const request = documented("BuilderOffersDraft");
    expect(request(full), ajv.errorsText(request.errors)).toBe(true);
    expect(request({ ...full, choices: fullBody.data.choices, picks: undefined }), ajv.errorsText(request.errors)).toBe(
      true
    );

    const playerToken = server.auth.issuePlayerSession();
    expect((await get(base, playerToken, draft)).status).toBe(200);
    const socket = connect(base, { transports: ["websocket"], reconnection: false, forceNew: true });
    cleanups.push(async () => {
      socket.disconnect();
    });
    await new Promise<void>((resolve) => socket.once("connect", () => resolve()));
    await new Promise((resolve) => socket.emit("session:join", { token: playerToken }, resolve));
    const ack = await new Promise<{ ok: boolean; offers?: BuilderOffer[] }>((resolve) =>
      socket.emit("builder:offers", draft, resolve)
    );
    expect(ack.ok).toBe(true);
    expect(ack.offers?.map((offer) => offer.key)).toContain("feature:elf-keen-senses");

    // A malformed draft is a 400 with the read's own refusal.
    const malformed = await fetch(`${base}${GAME_PATHS.builderOffers}?draft=not-json`, {
      headers: { authorization: `Bearer ${gmToken}` }
    });
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).error.message).toBe("The builder draft is malformed.");

    // Once the GM builds the characters, a player is refused and the GM is not.
    const closed = await fetch(`${base}${GAME_PATHS.builderPolicy}`, {
      method: "POST",
      headers: { authorization: `Bearer ${gmToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        commandId: "50000000-0000-4000-8000-000000000001",
        allowedAbilityMethods: ["standard-array"],
        playerBuilder: "gm-only"
      })
    });
    expect(closed.status).toBe(200);
    const refused = await get(base, playerToken, draft);
    expect(refused.status).toBe(403);
    expect((await refused.json()).error.details.reason).toBe("forbidden");
    expect((await get(base, gmToken, draft)).status).toBe(200);
  });
});
