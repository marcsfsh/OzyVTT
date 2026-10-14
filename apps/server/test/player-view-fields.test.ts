import { describe, expect, it } from "vitest";
import { GameStateSchema } from "@vtt/domain";
import { projectPlayerView } from "../src/projections.js";

const me = "b539ef5e-16e6-46ce-bf33-3ed4b02997c1";
const other = "65cc7d6b-1150-41c4-aa9f-390439313f53";
const noPresence = () => null;

// Every optional field set, so the projection has a chance to leak each one.
const filled = {
  visibility: "public",
  hp: { current: 30, maximum: 40, temporary: 2 },
  armorClass: 17,
  initiative: 3,
  notes: "GM notes",
  definitionId: "adult-red-dragon",
  size: "large",
  sizeCells: 2,
  tokenAssetId: "7d1f7a52-5d3b-4f8e-9b35-0d5f1c1d2a11",
  conditions: [{ id: "prone" }],
  actionUses: { breath: 1 },
  conditionImmunities: ["charmed"],
  speedFeet: 40,
  legendary: { actionsPerRound: 3, resistancesPerDay: 3 },
  hitDice: { die: "d10", maximum: 5, remaining: 3, entries: [{ die: "d10", maximum: 5, remaining: 3 }] },
  healthDisplay: { style: "bar", audience: "gm" },
  lastUsedAt: 1700000000000,
  spellSlots: [{ level: 1, remaining: 2 }],
  pactSlots: { level: 1, remaining: 1 },
  preparedSpellIds: ["shield"],
  inventory: [{ id: "rope", name: "Rope", quantity: 1, equipped: false }],
  currency: { gp: 12 }
};

const state = GameStateSchema.parse({
  schemaVersion: 1,
  actors: [
    { ...filled, id: "11111111-1111-4111-8111-111111111111", name: "Monster", kind: "monster", ownerSessionId: null },
    {
      ...filled,
      id: "22222222-2222-4222-8222-222222222222",
      name: "Theirs",
      kind: "player-character",
      ownerSessionId: other
    },
    {
      ...filled,
      id: "33333333-3333-4333-8333-333333333333",
      name: "Mine",
      kind: "player-character",
      ownerSessionId: me
    }
  ]
});

const COMMON = [
  "id",
  "name",
  "kind",
  "visibility",
  "size",
  "sizeCells",
  "tokenAssetId",
  "conditions",
  "deathSaves",
  "hp",
  "effects",
  "claimStatus",
  "presence"
];
const PARTY = ["armorClass", "initiative", "speedFeet", "definitionId"];
const OWNER = [
  "actionUses",
  "choiceOverrides",
  "hitDice",
  "spellSlots",
  "pactSlots",
  "preparedSpellIds",
  "inventory",
  "currency"
];

function keysOf(name: string, partyVisibility = "name-and-class") {
  const view = projectPlayerView({ ...state, partyVisibility } as typeof state, me, noPresence);
  const actor = view.actors.find((entry) => entry.name === name);
  if (!actor) throw new Error(`${name} missing from the player view`);
  return Object.keys(actor).sort();
}

describe("player view actor fields", () => {
  it("gives a monster only table-level fields", () => {
    expect(keysOf("Monster")).toEqual([...COMMON].sort());
  });

  it("adds party fields on another player's character", () => {
    expect(keysOf("Theirs")).toEqual([...COMMON, ...PARTY].sort());
  });

  it("adds owner resources on the player's own character", () => {
    expect(keysOf("Mine")).toEqual([...COMMON, ...PARTY, ...OWNER].sort());
  });

  it("never sends GM-only values", () => {
    const serialized = JSON.stringify(projectPlayerView(state, me, noPresence));
    for (const secret of ["GM notes", "charmed", "resistancesPerDay", "lastUsedAt", other])
      expect(serialized).not.toContain(secret);
  });
});

describe("player view pending prompts", () => {
  const mine = "33333333-3333-4333-8333-333333333333";
  const hidden = "44444444-4444-4444-8444-444444444444";
  const prompts = GameStateSchema.parse({
    ...state,
    actors: [
      ...state.actors,
      {
        id: hidden,
        name: "Vashkar",
        kind: "monster",
        visibility: "gm-only",
        hp: { current: 9, maximum: 9, temporary: 0 }
      }
    ],
    combat: {
      ...state.combat,
      pendingSaves: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          targetActorId: mine,
          ability: "con",
          dc: 14,
          sourceActorId: hidden,
          sourceName: "Vashkar",
          actionName: "Grab",
          createdAt: 1,
          endsEffects: [{ actorId: hidden, effectId: "concentration" }],
          onFailEffect: {
            name: "Grappled by Vashkar",
            sourceActorId: hidden,
            sourceName: "Vashkar",
            linkedConditionIds: ["grappled"]
          }
        }
      ],
      pendingReactions: [
        {
          id: "66666666-6666-4666-8666-666666666666",
          actorId: mine,
          actionId: "shield",
          actionName: "Shield",
          sourceActorId: hidden,
          sourceName: "Vashkar",
          triggerCommandId: "77777777-7777-4777-8777-777777777777",
          createdAt: 1
        }
      ],
      pendingRuleAsks: [
        {
          id: "88888888-8888-4888-8888-888888888888",
          actorId: mine,
          rule: "economy.not-your-turn",
          message: "Not your turn.",
          command: { type: "action.resolve", payload: { targetIds: [hidden] } },
          createdAt: "2026-01-01T00:00:00.000Z"
        }
      ]
    }
  });
  const combat = projectPlayerView(prompts, me, noPresence).combat;

  it("sends only allow-listed fields", () => {
    expect(Object.keys(combat.pendingSaves[0]).sort()).toEqual(
      [
        "id",
        "targetActorId",
        "ability",
        "dc",
        "actionName",
        "proposedDamage",
        "halfOnSuccess",
        "conditionId",
        "saveBonus",
        "createdAt",
        "sourceName",
        "onFailEffect"
      ].sort()
    );
    expect(Object.keys(combat.pendingReactions[0]).sort()).toEqual(
      [
        "id",
        "kind",
        "actorId",
        "actionId",
        "actionName",
        "targetActorId",
        "triggerCommandId",
        "proposedDamage",
        "proposedDamageParts",
        "critical",
        "createdAt",
        "sourceName"
      ].sort()
    );
    expect(Object.keys(combat.pendingRuleAsks[0]).sort()).toEqual(
      ["id", "actorId", "rule", "family", "message", "createdAt"].sort()
    );
  });

  it("never names or identifies a hidden source", () => {
    const serialized = JSON.stringify(combat);
    expect(serialized).not.toContain("Vashkar");
    expect(serialized).not.toContain(hidden);
    expect(combat.pendingSaves[0].onFailEffect?.name).toBe("Grappled by A hidden threat");
  });
});
