import { describe, expect, it } from "vitest";
import { BuilderPolicySchema, type GameState } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { rebuildActorDefinition } from "../src/actor-roster.js";
import { breathesWater } from "../src/breath.js";
import { type CharacterCreateRequestInput } from "../src/character-build.js";
import { deriveEquipment } from "../src/equipment-derivation.js";
import { rechoicesOf, rechooseInLedger } from "../src/ledger-rechoice.js";
import { readComponents } from "../src/resolution/components.js";
import { applyDamageDetailed } from "../src/hit-points.js";
import { applyRest } from "../src/rests.js";
import { specialSpeedsOf } from "../src/speed.js";
import { generateCharacterRequest } from "../src/character-generate.js";
import { ALLY, build, catalog, fight, FOE, FOE2, heroTurnAgain, view, warlockInput } from "./spell-casters.js";

// SRD 5.2.1 Eldritch Invocation Options, each by its own text.

type Row = CharacterCreateRequestInput["choices"][number];
const POLICY = BuilderPolicySchema.parse({});

/** A Warlock 5 (CHA 15, Soldier) whose invocations are swapped as named, with the rows given added. */
function warlockWith(swaps: Readonly<Record<string, string>>, extra: readonly Row[] = []): ActorDefinition {
  const input = warlockInput(["hex", "hellish-rebuke", "hold-person", "misty-step"]);
  const dropped = new Set(Object.keys(swaps));
  const choices = input.choices.flatMap((row) => {
    if (row.kind === "eldritch-invocation" && swaps[row.id]) return [{ ...row, id: swaps[row.id]! }];
    if (row.kind === "cantrip" && dropped.has(String(row.payload?.featureId))) return [];
    return [row];
  });
  return build({ ...input, choices: [...choices, ...extra] } as CharacterCreateRequestInput);
}

const thrown = (make: () => unknown): string => {
  try {
    make();
  } catch (error) {
    return (error as Error).message;
  }
  return "";
};

describe("Gift of the Depths", () => {
  it("gives a Swim Speed equal to the Warlock's Speed, and breathing underwater", () => {
    const sheet = warlockWith({ "eldritch-spear": "gift-of-the-depths" });
    const { hero } = fight(sheet);
    const speeds = specialSpeedsOf(hero, sheet, deriveEquipment(hero, sheet, catalog));
    expect(speeds.swim).toBe(hero.speedFeet);
    expect(breathesWater(hero, sheet)).toBe(true);
    const without = warlockWith({});
    const plain = fight(without).hero;
    expect(specialSpeedsOf(plain, without, deriveEquipment(plain, without, catalog)).swim ?? 0).toBe(0);
    expect(breathesWater(plain, without)).toBe(false);
  });
});

// Pact of the Tome: "you conjure forth a book in your hand at the end of a Short or Long Rest ... choose three
// cantrips, and choose two level 1 spells that have the Ritual tag. The spells can be from any class's spell list, and
// they must be spells you don't already have prepared. While the book is on your person, you have the chosen spells
// prepared ... You can use the book as a Spellcasting Focus."
describe("Pact of the Tome", () => {
  const bookRows = (cantrips: readonly string[], rituals: readonly string[]): Row[] => [
    ...cantrips.map((id) => ({ level: 2, kind: "cantrip", id, payload: { featureId: "pact-of-the-tome" } }) as Row),
    ...rituals.map((id) => ({ level: 2, kind: "spell", id, payload: { featureId: "pact-of-the-tome" } }) as Row)
  ];
  const tome = (
    cantrips: readonly string[] = ["fire-bolt", "guidance", "sacred-flame"],
    rituals: readonly string[] = ["alarm", "floating-disk"]
  ) => warlockWith({ "eldritch-mind": "pact-of-the-tome" }, bookRows(cantrips, rituals));
  const spellOf = (sheet: ActorDefinition, id: string) => sheet.spellcasting?.spells.find((spell) => spell.id === id);
  const carriesBook = (inventory: ReadonlyArray<{ id: string }> | undefined) =>
    (inventory ?? []).some((row) => row.id === "book-of-shadows");

  it("prepares three cantrips and two level 1 Ritual spells from any class's list, as Warlock spells", () => {
    const sheet = tome();
    for (const id of ["fire-bolt", "guidance", "sacred-flame"])
      expect(spellOf(sheet, id)).toMatchObject({ level: 0, prepared: true, classId: "warlock" });
    for (const id of ["alarm", "floating-disk"])
      expect(spellOf(sheet, id)).toMatchObject({ level: 1, prepared: true, classId: "warlock" });
    expect(carriesBook(sheet.startingInventory)).toBe(true);
    expect(carriesBook(warlockWith({}).startingInventory)).toBe(false);
  });

  it("refuses a spell without the Ritual tag, one already prepared, and a book short of its picks", () => {
    expect(thrown(() => tome(undefined, ["alarm", "shield"]))).toMatch(/shield/);
    // Chill Touch is one of the Warlock's own cantrips.
    expect(thrown(() => tome(["chill-touch", "guidance", "sacred-flame"]))).toMatch(
      /"chill-touch" is already prepared/
    );
    expect(thrown(() => tome(undefined, ["alarm"]))).toMatch(/"Pact of the Tome" needs 2 pick\(s\) of kind "spell"/);
    expect(thrown(() => tome(["fire-bolt", "guidance", "sacred-flame", "light"]))).toMatch(
      /exceeds what this build may choose/
    );
  });

  it("casts the book's spells only while the book is carried", () => {
    const { state, hero, resolve } = fight(tome());
    state.combat = { ...state.combat, ruleExceptions: { slots: "strict" } };
    expect(() => resolve("spell-fire-bolt", {}, [15, 5])).not.toThrow();
    heroTurnAgain(state);
    hero.inventory = hero.inventory.filter((row) => row.id !== "book-of-shadows");
    expect(thrown(() => resolve("spell-fire-bolt", {}, [15, 5]))).toMatch(
      /Fire Bolt is prepared from Vex's Book of Shadows, which isn't on Vex/
    );
  });

  it("serves as a Spellcasting Focus", () => {
    const sheet = tome();
    const { hero } = fight(sheet);
    // Hex's Material component, with the kit's Arcane Focus put away: the book alone serves.
    hero.inventory = hero.inventory.filter((row) => !row.id.startsWith("arcane-focus") && row.id !== "component-pouch");
    const gaps = () =>
      readComponents({
        attacker: hero,
        action: { id: "spell-hex", spellId: "hex" } as never,
        spell: view.spellRecord("hex"),
        definition: sheet,
        catalog,
        targetCount: 1
      }).gaps;
    expect(gaps()).toEqual([]);
    hero.inventory = hero.inventory.filter((row) => row.id !== "book-of-shadows");
    expect(gaps().map((gap) => gap.rule)).toEqual(["spell.no-material"]);
  });

  it("is conjured anew at the end of a rest, when its spells may be chosen again", () => {
    const { state, hero } = fight(tome(), { combat: false });
    const sheet = () => state.definitions.find((entry) => entry.id === hero.definitionId)!.definition;
    hero.inventory = hero.inventory.filter((row) => row.id !== "book-of-shadows");
    const lines = applyRest(state, hero.id, "short", () => sheet(), catalog);
    expect(lines.map((line) => line.text)).toContain("Vex conjures a Book of Shadows.");
    expect(hero.inventory.filter((row) => row.id === "book-of-shadows")).toHaveLength(1);

    const offers = rechoicesOf(hero, sheet(), view);
    const cantrips = offers.find((offer) => offer.offer === "feature:pact-of-the-tome")!;
    const rituals = offers.find((offer) => offer.offer === "feature:pact-of-the-tome/2")!;
    expect(cantrips).toMatchObject({
      label: "Pact of the Tome: cantrips",
      per: "short-rest",
      held: ["fire-bolt", "guidance", "sacred-flame"],
      swaps: 3
    });
    expect(cantrips.options.map((option) => option.id)).toContain("light");
    expect(cantrips.options.map((option) => option.id)).not.toContain("alarm");
    expect(rituals).toMatchObject({ label: "Pact of the Tome: spells", held: ["alarm", "floating-disk"], swaps: 2 });
    expect(rituals.options.map((option) => option.id)).toContain("identify");
    expect(rituals.options.map((option) => option.id)).not.toContain("shield");

    const deps = { library: view, policy: POLICY, catalog };
    rechooseInLedger(state, hero.id, "feature:pact-of-the-tome", "light", deps, "guidance", "cantrip");
    rechooseInLedger(state, hero.id, "feature:pact-of-the-tome/2", "identify", deps, "alarm", "spell");
    const ids = (sheet().spellcasting?.spells ?? []).map((spell) => spell.id);
    expect(ids).toEqual(expect.arrayContaining(["light", "identify", "fire-bolt", "floating-disk"]));
    expect(ids).not.toContain("guidance");
    expect(ids).not.toContain("alarm");
  });

  it("goes with the invocation when a rebuild gives it up", () => {
    const { state, hero } = fight(tome(), { combat: false });
    rebuildActorDefinition(state, hero.id, warlockWith({}), catalog);
    expect(carriesBook(hero.inventory)).toBe(false);
  });
});

/** A Warlock 9 with Pact of the Tome and Gift of the Protectors, its other invocations ones that ask nothing more. */
function protector(): ActorDefinition {
  const { request } = generateCharacterRequest(
    { classId: "warlock", level: 9, speciesId: "human", backgroundId: "soldier" },
    view,
    POLICY,
    () => 1
  );
  const invocations = request.choices.filter((row) => row.kind === "eldritch-invocation");
  const dropped = new Set(invocations.map((row) => row.id));
  const kept = ["devils-sight", "eldritch-mind", "armor-of-shadows", "mask-of-many-faces", "misty-visions"];
  const ids = [...kept.slice(0, invocations.length - 2), "pact-of-the-tome", "gift-of-the-protectors"];
  const choices = [
    ...request.choices.filter(
      (row) => row.kind !== "eldritch-invocation" && !dropped.has(String(row.payload?.featureId))
    ),
    ...invocations.map((row, index) => ({ ...row, id: ids[index]! })),
    ...["fire-bolt", "guidance", "sacred-flame"].map(
      (id) => ({ level: 9, kind: "cantrip", id, payload: { featureId: "pact-of-the-tome" } }) as Row
    ),
    ...["alarm", "floating-disk"].map(
      (id) => ({ level: 9, kind: "spell", id, payload: { featureId: "pact-of-the-tome" } }) as Row
    )
  ];
  return build({ ...request, choices } as CharacterCreateRequestInput);
}

// Gift of the Protectors (Level 9+ Warlock, Pact of the Tome): "With your permission, a creature can take an action to
// write its name on that page, which can contain a number of names equal to your Charisma modifier (minimum of one
// name). When any creature whose name is on the page is reduced to 0 Hit Points but not killed outright, the creature
// magically drops to 1 Hit Point instead. Once this magic is triggered, no creature can benefit from it until you finish
// a Long Rest."
describe("Gift of the Protectors", () => {
  const damage = (state: GameState, actorId: string, amount: number) =>
    applyDamageDetailed(state, actorId, { parts: [{ amount, type: "slashing" }], amount }, { role: "gm" }).events.map(
      (event) => event.text
    );

  it("holds as many names as the Charisma modifier, each once", () => {
    // Charisma 14: two names.
    const built = protector();
    const { resolve } = fight({ ...built, abilityScores: { ...built.abilityScores, cha: 14 } }, { ally: true });
    resolve("gift-of-the-protectors", { targetIds: [ALLY] });
    resolve("gift-of-the-protectors", { targetIds: [FOE] });
    expect(thrown(() => resolve("gift-of-the-protectors", { targetIds: [ALLY] }))).toMatch(
      /Bran's name is already on .*'s page/
    );
    expect(thrown(() => resolve("gift-of-the-protectors", { targetIds: [FOE2] }))).toMatch(
      /page holds 2 names \(the Charisma modifier\), and it is full/
    );
  });

  it("drops a named creature to 1 Hit Point once, until the Warlock's Long Rest", () => {
    const sheet = protector();
    const { state, hero, resolve } = fight(sheet, { ally: true });
    resolve("gift-of-the-protectors", { targetIds: [ALLY] });
    const ally = state.actors.find((actor) => actor.id === ALLY)!;
    expect(damage(state, ALLY, 250)).toContain(
      `Bran drops to 1 Hit Point instead (${hero.name}'s Gift of the Protectors).`
    );
    expect(ally.hp.current).toBe(1);
    expect(hero.actionUses["gift-of-the-protectors-page"]).toBe(1);
    // Spent: the next fall is a fall.
    damage(state, ALLY, 5);
    expect(ally.hp.current).toBe(0);
  });

  it("does nothing against damage that kills outright, and its page is blank in a new book", () => {
    const sheet = protector();
    const { state, hero, resolve } = fight(sheet, { ally: true, combat: true });
    resolve("gift-of-the-protectors", { targetIds: [ALLY] });
    const ally = state.actors.find((actor) => actor.id === ALLY)!;
    // 200 Hit Points, and 400 more past 0: the maximum or more is death outright.
    damage(state, ALLY, 600);
    expect(ally.hp.current).toBe(0);
    expect(hero.actionUses["gift-of-the-protectors-page"] ?? 0).toBe(0);
    state.combat = { ...state.combat, active: false };
    applyRest(state, hero.id, "short", () => sheet, catalog);
    expect(
      state.actors.some((actor) => actor.effects.some((effect) => effect.tags.includes("gift-of-the-protectors")))
    ).toBe(false);
  });
});
