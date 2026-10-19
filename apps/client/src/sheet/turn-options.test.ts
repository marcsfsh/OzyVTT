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
    expect(optionsWith([row({ id: "item-rope-knot", name: "Tie a knot", targeting: null })])).toEqual([]);
  });
});
