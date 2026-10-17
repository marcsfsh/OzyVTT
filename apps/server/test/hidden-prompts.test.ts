import { describe, expect, it } from "vitest";
import { ActorDefinitionSchema } from "@vtt/schemas";
import { emit, GOBLIN, HERO, hiddenTable, mentionsGoblin, sentSince, settle } from "./hidden-creature-fixtures.js";

// Reaction prompts and the replies to them never point a player at a creature hidden from them by sight or the fog
// (ADR-0023).

function definition(name: string, actions: readonly object[]) {
  return ActorDefinitionSchema.parse({
    schemaId: "vtt.actor-monster",
    schemaVersion: 1,
    source: { name: "Test", version: "1", externalId: name.toLowerCase() },
    name,
    size: "medium",
    abilityScores: { str: 16, dex: 14, con: 14, int: 12, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    armorClass: 12,
    hitPoints: { maximum: 20 },
    speedFeet: 30,
    actions
  });
}

const greataxe = {
  id: "greataxe",
  name: "Greataxe",
  activation: "action",
  description: "A test action.",
  attack: { bonus: 5, reachFeet: 5 },
  damage: [{ formula: "1d12 + 3", type: "slashing" }]
};

describe("prompts against a creature hidden by sight or the fog", () => {
  it.each([false, true])(
    "opens no opportunity attack for Borin against a creature wholly under the fog (vision %s)",
    async (visionOn) => {
      // The fog reveals only Borin's square; the goblin stands in the next one.
      const table = await hiddenTable({
        order: [GOBLIN, HERO],
        positions: { [HERO]: { x: 75, y: 275 }, [GOBLIN]: { x: 125, y: 275 } },
        reveals: [{ x: 50, y: 250, width: 50, height: 50 }],
        vision: { enabled: visionOn, ambient: "bright" }
      });
      expect(mentionsGoblin(table.latest())).toBe(false);
      const mark = table.mark();
      expect(await emit(table.gm, "token:move", { actorId: GOBLIN, position: { x: 425, y: 275 } })).toMatchObject({
        ok: true
      });
      await settle();
      expect(sentSince(table.received, mark).filter(mentionsGoblin)).toEqual([]);
      expect(table.latest().combat.pendingReactions).toEqual([]);
    }
  );

  it("opens no strike-back for Borin against an attacker Borin can't see", async () => {
    const table = await hiddenTable({
      order: [GOBLIN, HERO],
      positions: { [HERO]: { x: 75, y: 275 }, [GOBLIN]: { x: 125, y: 275 } },
      vision: { enabled: true, ambient: "dark" },
      definitions: [
        {
          id: "def-borin",
          definition: definition("Borin", [
            greataxe,
            {
              id: "retaliation",
              name: "Retaliation",
              activation: "reaction",
              description: "A test action.",
              damage: [],
              reaction: { trigger: "damaged-by-creature", response: "melee-attack", rangeFeet: 5 }
            }
          ])
        }
      ],
      actors: { [HERO]: { definitionId: "def-borin" } }
    });
    expect(mentionsGoblin(table.latest())).toBe(false);
    const mark = table.mark();
    expect(
      await emit(table.gm, "actor:apply-damage", {
        actorId: HERO,
        amount: 3,
        parts: [{ amount: 3, type: "slashing" }],
        sourceActorId: GOBLIN
      })
    ).toMatchObject({ ok: true });
    await settle();
    expect(sentSince(table.received, mark).filter(mentionsGoblin)).toEqual([]);
    expect(table.latest().combat.pendingReactions).toEqual([]);
  });

  it("tells Borin only whether the hidden attacker's blow landed after Shield", async () => {
    const table = await hiddenTable({
      order: [GOBLIN, HERO],
      positions: { [HERO]: { x: 75, y: 275 }, [GOBLIN]: { x: 125, y: 275 } },
      vision: { enabled: true, ambient: "dark" },
      definitions: [
        {
          id: "def-borin",
          definition: definition("Borin", [
            {
              id: "spell-shield",
              name: "Shield",
              activation: "reaction",
              description: "A test action.",
              damage: [],
              spellSlot: { level: 1 },
              spellId: "shield",
              reaction: { trigger: "hit-by-attack", response: "ac-bonus", amount: 5, untilNextTurn: true }
            }
          ])
        }
      ],
      actors: {
        [HERO]: { definitionId: "def-borin", armorClass: 12, spellSlots: [{ level: 1, remaining: 2 }] },
        [GOBLIN]: { definitionId: "goblin-warrior" }
      }
    });
    expect(mentionsGoblin(table.latest())).toBe(false);
    // The GM's goblin swings for 14 against AC 12: Shield's +5 would turn it into a miss, so Borin is asked.
    expect(
      await emit(table.gm, "action:resolve", {
        actorId: GOBLIN,
        actionId: "scimitar",
        targetIds: [HERO],
        attackTotal: 14
      })
    ).toMatchObject({ ok: true });
    await settle();
    const prompt = table.latest().combat.pendingReactions.find((entry) => entry.kind === "attack-would-hit");
    expect(prompt).toBeDefined();
    const answer = await emit(table.player, "reaction:answer", { reactionId: prompt!.id, use: true });
    expect(answer).toMatchObject({ ok: true, outcome: { resolution: { actionName: "An attack" } } });
    const resolution = (answer.outcome as { resolution: Record<string, unknown> }).resolution;
    // What the engine noted about the goblin's attack stays with the GM.
    expect(resolution).not.toHaveProperty("warnings");
    expect(resolution).not.toHaveProperty("rollMode");
    expect(resolution).not.toHaveProperty("componentsRemaining");
    expect(mentionsGoblin(answer)).toBe(false);
  });
});
