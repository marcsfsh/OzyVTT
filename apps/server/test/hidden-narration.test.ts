import { describe, expect, it } from "vitest";
import { ActorDefinitionSchema } from "@vtt/schemas";
import {
  emit,
  GOBLIN,
  GOBLIN_NAME,
  HERO,
  hiddenTable,
  mentionsGoblin,
  ORC,
  sentSince,
  settle,
  wall
} from "./hidden-creature-fixtures.js";

// The table's lines (feed rows, toasts) and a player's refusals never name a creature hidden from them by sight or the
// fog (ADR-0023). Each case first checks the goblin really is hidden, then does one ordinary thing.

/** A goblin in the dark beside Borin, who has no Darkvision and no light. */
const inTheDark = {
  order: [GOBLIN, HERO],
  positions: { [HERO]: { x: 75, y: 275 }, [GOBLIN]: { x: 125, y: 275 } },
  vision: { enabled: true, ambient: "dark" as const }
};

const grappledByGoblin = {
  conditions: [{ id: "grappled" }],
  effects: [
    {
      id: "grapple-1",
      name: `Grappled by ${GOBLIN_NAME}`,
      tags: ["grapple"],
      sourceActorId: GOBLIN,
      sourceName: GOBLIN_NAME,
      duration: { type: "manual" },
      linkedConditionIds: ["grappled"],
      escapeDc: 1,
      endsWhenSourceDefeated: true
    }
  ]
};

describe("the table's lines about a creature hidden by sight or the fog", () => {
  it("masks the attacker when the GM applies a hidden creature's hit", async () => {
    const table = await hiddenTable(inTheDark);
    expect(mentionsGoblin(table.latest())).toBe(false);
    const mark = table.mark();
    // The payload the GM's attack card sends on "Apply to Borin".
    expect(
      await emit(table.gm, "actor:apply-damage", {
        actorId: HERO,
        amount: 3,
        parts: [{ amount: 3, type: "slashing" }],
        sourceActorId: GOBLIN,
        sourceName: `${GOBLIN_NAME}'s Scimitar`
      })
    ).toMatchObject({ ok: true });
    await settle();
    const sent = sentSince(table.received, mark);
    expect(sent.filter((line) => line.includes(GOBLIN_NAME))).toEqual([]);
    expect(sent.some((line) => line.includes("A hidden threat hit Borin for 3 damage."))).toBe(true);
  });

  it("masks a hidden source in the turn reminder", async () => {
    const table = await hiddenTable({ ...inTheDark, actors: { [HERO]: grappledByGoblin } });
    expect(mentionsGoblin(table.latest())).toBe(false);
    const mark = table.mark();
    expect(await emit(table.gm, "initiative:next", {})).toMatchObject({ ok: true });
    await settle();
    const sent = sentSince(table.received, mark);
    expect(sent.filter(mentionsGoblin)).toEqual([]);
    expect(sent.some((line) => line.includes("Borin: Grappled by A hidden threat"))).toBe(true);
  });

  it("masks a hidden grappler when Borin tries to end the hold and when Borin escapes it", async () => {
    const table = await hiddenTable({ ...inTheDark, order: [HERO, GOBLIN], actors: { [HERO]: grappledByGoblin } });
    expect(mentionsGoblin(table.latest())).toBe(false);
    const refused = await emit(table.player, "effect:end", { actorId: HERO, effectId: "grapple-1" });
    expect(refused).toMatchObject({ ok: false, code: "condition.imposed" });
    expect(String(refused.message)).toContain("Grappled by A hidden threat wasn't Borin's own doing");
    const mark = table.mark();
    const escape = await emit(table.player, "action:resolve", { actorId: HERO, actionId: "escape-grapple" });
    await settle();
    expect(escape).toMatchObject({ ok: true });
    expect(mentionsGoblin(escape)).toBe(false);
    const sent = sentSince(table.received, mark);
    expect(sent.filter(mentionsGoblin)).toEqual([]);
    expect(sent.some((line) => line.includes("Grappled by A hidden threat ended on Borin."))).toBe(true);
  });

  it("keeps a hidden creature out of the roster and the feed when the GM takes it out of the fight", async () => {
    const table = await hiddenTable({
      order: [HERO, GOBLIN],
      positions: { [HERO]: { x: 75, y: 275 }, [GOBLIN]: { x: 425, y: 275 } },
      vision: { enabled: true, ambient: "bright", walls: [wall({ x: 250, y: 0 }, { x: 250, y: 600 })] }
    });
    expect(mentionsGoblin(table.latest())).toBe(false);
    const mark = table.mark();
    expect(await emit(table.gm, "encounter:remove-combatant", { actorId: GOBLIN })).toMatchObject({ ok: true });
    await settle();
    expect(sentSince(table.received, mark).filter(mentionsGoblin)).toEqual([]);
    // The GM still reads it, and the goblin is the GM's alone from now on.
    expect(JSON.stringify(table.gmLog)).toContain(`${GOBLIN_NAME} left the fight.`);
    expect(table.server.store.snapshot.actors.find((actor) => actor.id === GOBLIN)?.visibility).toBe("gm-only");
  });

  it("keeps a hidden creature unknown when a new fight leaves it out", async () => {
    const table = await hiddenTable({
      order: [HERO, GOBLIN],
      positions: { [HERO]: { x: 75, y: 275 }, [GOBLIN]: { x: 425, y: 275 } },
      vision: { enabled: true, ambient: "bright", walls: [wall({ x: 250, y: 0 }, { x: 250, y: 600 })] }
    });
    expect(await emit(table.gm, "encounter:end", {})).toMatchObject({ ok: true });
    const mark = table.mark();
    expect(
      await emit(table.gm, "encounter:start", { mapAssetId: table.mapAssetId, entries: [{ actorId: HERO, score: 10 }] })
    ).toMatchObject({ ok: true });
    await settle();
    expect(sentSince(table.received, mark).filter(mentionsGoblin)).toEqual([]);
  });

  it("says only where a creature is now when it steps out of hiding", async () => {
    const table = await hiddenTable({
      order: [GOBLIN, HERO],
      positions: { [HERO]: { x: 75, y: 275 }, [GOBLIN]: { x: 425, y: 175 } },
      vision: { enabled: true, ambient: "bright", walls: [wall({ x: 250, y: 0 }, { x: 250, y: 350 })] }
    });
    expect(mentionsGoblin(table.latest())).toBe(false);
    const mark = table.mark();
    expect(await emit(table.gm, "token:move", { actorId: GOBLIN, position: { x: 425, y: 475 } })).toMatchObject({
      ok: true
    });
    await settle();
    const lines = sentSince(table.received, mark).filter((line) => line.startsWith("log:entry"));
    expect(lines.some((line) => line.includes(`${GOBLIN_NAME} came into view - Borin 35 ft.`))).toBe(true);
    // No distance walked and no range from where it hid.
    expect(lines.filter((line) => line.includes("→") || line.includes("moved"))).toEqual([]);
  });

  it("masks a held creature that has gone unseen when Borin drags it along", async () => {
    const table = await hiddenTable({
      order: [HERO, GOBLIN],
      positions: { [HERO]: { x: 75, y: 275 }, [GOBLIN]: { x: 125, y: 275 } },
      vision: { enabled: true, ambient: "bright" },
      actors: {
        [GOBLIN]: {
          conditions: [{ id: "grappled" }, { id: "invisible" }],
          effects: [
            {
              id: "held-1",
              name: "Grappled by Borin",
              tags: ["grapple"],
              sourceActorId: HERO,
              sourceName: "Borin",
              duration: { type: "manual" },
              linkedConditionIds: ["grappled"],
              escapeDc: 12,
              endsWhenSourceDefeated: true
            }
          ]
        }
      }
    });
    expect(mentionsGoblin(table.latest())).toBe(false);
    const mark = table.mark();
    expect(await emit(table.player, "token:move", { actorId: HERO, position: { x: 75, y: 375 } })).toMatchObject({
      ok: true
    });
    await settle();
    const sent = sentSince(table.received, mark);
    expect(sent.filter(mentionsGoblin)).toEqual([]);
    expect(sent.some((line) => line.includes("Borin drags A hidden threat along."))).toBe(true);
  });

  it("masks a hidden caster's name when its strike-back line reaches the table", async () => {
    // The GM's own creature (an unclaimed ally) is hit by the goblin in the dark; its prompt is the GM's, the line
    // the table's.
    const brute = ActorDefinitionSchema.parse({
      schemaId: "vtt.actor-monster",
      schemaVersion: 1,
      source: { name: "Test", version: "1", externalId: "ally" },
      name: "Ally",
      size: "medium",
      abilityScores: { str: 16, dex: 14, con: 14, int: 10, wis: 10, cha: 10 },
      proficiencyBonus: 2,
      armorClass: 14,
      hitPoints: { maximum: 20 },
      speedFeet: 30,
      token: { disposition: "friendly" },
      actions: [
        {
          id: "retaliation",
          name: "Retaliation",
          activation: "reaction",
          description: "A test action.",
          damage: [],
          reaction: { trigger: "damaged-by-creature", response: "melee-attack", rangeFeet: 5 }
        }
      ]
    });
    // A small light shows the ally to Borin; the goblin beside it stays in the dark.
    const table = await hiddenTable({
      ...inTheDark,
      vision: {
        ...inTheDark.vision,
        lights: [
          {
            id: "60000000-0000-4000-8000-000000000001",
            position: { x: 175, y: 225 },
            actorId: null,
            brightFeet: 3,
            dimFeet: 0
          }
        ]
      },
      positions: { ...inTheDark.positions, [ORC]: { x: 175, y: 225 } },
      order: [GOBLIN, HERO, ORC],
      definitions: [{ id: "def-ally", definition: brute }],
      actors: { [ORC]: { kind: "npc", name: "Ally", definitionId: "def-ally" } }
    });
    expect(mentionsGoblin(table.latest())).toBe(false);
    const mark = table.mark();
    expect(
      await emit(table.gm, "actor:apply-damage", {
        actorId: ORC,
        amount: 3,
        sourceActorId: GOBLIN
      })
    ).toMatchObject({ ok: true });
    await settle();
    const sent = sentSince(table.received, mark);
    expect(sent.filter(mentionsGoblin)).toEqual([]);
    expect(sent.some((line) => line.includes("Ally may use Retaliation against A hidden threat."))).toBe(true);
  });
});
