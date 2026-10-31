import { describe, expect, it } from "vitest";
import { loadActorFixture } from "@vtt/test-fixtures";
import { ActorDefinitionSchema } from "@vtt/schemas";
import type { ContentActionSummary } from "@vtt/domain";
import { NO_FACTS, turnOptions } from "./turn-options";

// The Play tab's list takes an item's rows from the server: a cast the server resolves is a tap there, though it rolls
// nothing and has no charges (a Hat of Disguise's Disguise Self, at will).

const definition = { ...ActorDefinitionSchema.parse(loadActorFixture("player-character")), actions: [] };

const row = (over: Partial<ContentActionSummary>): ContentActionSummary =>
  ({
    activation: "action",
    description: "",
    attackBonus: null,
    saveAbility: null,
    saveDc: null,
    damage: [],
    usesLimit: null,
    usesPer: null,
    usesPool: null,
    healing: null,
    darts: null,
    ...over
  }) as unknown as ContentActionSummary;

const optionsWith = (extraActions: readonly ContentActionSummary[]) =>
  turnOptions({
    definition,
    actor: null,
    ownSummaries: new Map(),
    extraActions,
    facts: NO_FACTS,
    spellReference: new Map(),
    characterLevel: 1
  });

describe("an item's rows in the turn list", () => {
  it("offers a Hat of Disguise's at-will cast as a Magic action", () => {
    const hat = row({
      id: "item-hat-of-disguise-cast-disguise-self",
      name: "Hat of Disguise: Disguise Self",
      targeting: "none"
    });
    expect(optionsWith([hat]).map((option) => [option.id, option.cost])).toEqual([[hat.id, "magic"]]);
  });

  it("leaves out a row with nothing the server resolves", () => {
    expect(optionsWith([row({ id: "item-rope-knot", name: "Tie a knot" })])).toEqual([]);
  });
});

describe("the action table's columns", () => {
  const columns = (option: ReturnType<typeof optionsWith>[number] | undefined) =>
    option ? { range: option.range, hitOrDc: option.hitOrDc, damage: option.damage } : null;

  it("reads a weapon's range, attack bonus and damage", () => {
    const dagger = row({
      id: "item-dagger",
      name: "Dagger",
      attackBonus: 5,
      reachFeet: 5,
      rangeNormalFeet: 20,
      rangeFeet: 60,
      damage: [{ formula: "1d4+2", type: "piercing" }]
    });
    expect(columns(optionsWith([dagger])[0])).toEqual({
      range: "reach 5 ft, 20/60 ft",
      hitOrDc: "+5",
      damage: { dice: "1d4+2", type: "piercing" }
    });
  });

  it("reads a spell attack's bonus and damage", () => {
    const bolt = row({
      id: "item-wand-cast-fire-bolt",
      name: "Fire Bolt",
      attackBonus: 7,
      rangeFeet: 120,
      damage: [{ formula: "2d10", type: "fire" }]
    });
    expect(columns(optionsWith([bolt])[0])).toEqual({
      range: "120 ft",
      hitOrDc: "+7",
      damage: { dice: "2d10", type: "fire" }
    });
  });

  it("reads a save spell's DC and ability", () => {
    const fireball = row({
      id: "item-necklace-cast-fireball",
      name: "Fireball",
      saveAbility: "dex",
      saveDc: 15,
      rangeFeet: 150,
      damage: [{ formula: "8d6", type: "fire" }]
    });
    expect(columns(optionsWith([fireball])[0])).toEqual({
      range: "150 ft",
      hitOrDc: "DC 15 Dex",
      damage: { dice: "8d6", type: "fire" }
    });
  });

  it("reads a heal as its dice and the word healing", () => {
    const potion = row({
      id: "item-potion-of-healing-drink",
      name: "Drink Potion of Healing",
      usesLimit: 1,
      healing: { formula: "2d4+2" }
    } as Partial<ContentActionSummary>);
    expect(columns(optionsWith([potion])[0])).toEqual({
      range: null,
      hitOrDc: null,
      damage: { dice: "2d4+2", type: "healing" }
    });
  });
});
