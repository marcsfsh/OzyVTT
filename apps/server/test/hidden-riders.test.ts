import { describe, expect, it } from "vitest";
import { loadActorFixture } from "@vtt/test-fixtures";
import { ActorDefinitionSchema, type ActorDefinition } from "@vtt/schemas";
import { makeEffect } from "../src/effects.js";
import { bardInput, build, fight, FOE, HERO as BARD } from "./spell-casters.js";
import {
  emit,
  FRIEND,
  GOBLIN,
  GOBLIN_NAME,
  HERO,
  hiddenTable,
  mentionsGoblin,
  ORC,
  sentSince,
  settle,
  type HiddenTableSetup
} from "./hidden-creature-fixtures.js";

// The rules Phase 1 added on the paths the shared hidden check (ADR-0023) covers: a failed save's push, a spell's hit
// that slows, a Paladin's auras, a refusal that names an effect and a Slow-failed spell. A creature wholly under the fog
// reaches Borin's player by none of them. Each case first checks the creature really is hidden.

/** Borin's player sees only a band at the left of the map, where Borin stands. */
const BAND = [{ x: 0, y: 200, width: 200, height: 200 }];

const character = (name: string, actions: unknown[] = [], extra: Record<string, unknown> = {}): ActorDefinition => {
  const base = loadActorFixture("player-character") as ActorDefinition;
  return ActorDefinitionSchema.parse({ ...base, name, actions: [...base.actions, ...actions], ...extra });
};

const monster = (name: string, actions: unknown[], extra: Record<string, unknown> = {}): ActorDefinition =>
  ActorDefinitionSchema.parse({
    schemaId: "vtt.actor-monster",
    schemaVersion: 1,
    source: { name: "Test", version: "1", externalId: name.toLowerCase().replace(/ /g, "-") },
    name,
    size: "small",
    abilityScores: { str: 10, dex: 14, con: 10, int: 10, wis: 10, cha: 10 },
    proficiencyBonus: 2,
    armorClass: 13,
    hitPoints: { maximum: 20 },
    speedFeet: 30,
    actions,
    ...extra
  });

const THUNDERWAVE = {
  id: "thunderwave",
  name: "Thunderwave",
  activation: "action",
  description: "A wave of thunderous force.",
  save: { ability: "con", dc: 13, successDamage: "half", failurePush: { feet: 10 } },
  damage: [{ formula: "2d8", type: "thunder" }],
  area: { shape: "cube", sizeFeet: 15, widthFeet: null }
};

const savesOf = (table: Awaited<ReturnType<typeof hiddenTable>>, actorId: string) =>
  table.server.store.snapshot.combat.pendingSaves.filter((save) => save.targetActorId === actorId);

const positionOf = (table: Awaited<ReturnType<typeof hiddenTable>>, actorId: string) =>
  table.server.store.snapshot.combat.tokens.find((token) => token.actorId === actorId)?.position;

describe("Phase 1's rules with a creature hidden under the fog", () => {
  it("pushes a goblin Borin's Thunderwave caught under the fog without naming it to Borin's player", async () => {
    const table = await hiddenTable({
      order: [HERO, ORC, GOBLIN],
      // The orc stands in the band, so the cube holds a creature Borin's player can see.
      positions: { [HERO]: { x: 75, y: 275 }, [ORC]: { x: 175, y: 325 }, [GOBLIN]: { x: 225, y: 275 } },
      reveals: BAND,
      definitions: [{ id: "def-borin", definition: character("Borin", [THUNDERWAVE]) }],
      actors: { [HERO]: { definitionId: "def-borin" } }
    });
    expect(mentionsGoblin(table.latest())).toBe(false);
    const mark = table.mark();
    const cast = await emit(table.player, "action:resolve", {
      actorId: HERO,
      actionId: "thunderwave",
      template: { shape: "square", origin: { x: 100, y: 250 }, target: { x: 250, y: 400 } }
    });
    expect(cast).toMatchObject({ ok: true });
    expect(mentionsGoblin(cast)).toBe(false);
    const [save] = savesOf(table, GOBLIN);
    expect(save).toBeDefined();
    // The goblin fails, and the push moves it 10 feet further from Borin, still under the fog.
    expect(await emit(table.gm, "save:answer", { saveId: save!.id, method: "manual", total: 1 })).toMatchObject({
      ok: true
    });
    await settle();
    expect(positionOf(table, GOBLIN)).toEqual({ x: 325, y: 275 });
    expect(sentSince(table.received, mark).filter(mentionsGoblin)).toEqual([]);
    expect(JSON.stringify(table.gmLog)).toContain(`${GOBLIN_NAME} is pushed 10 ft straight away from Borin.`);
  });

  it("names a hidden goblin that pushes Borin as a hidden threat", async () => {
    const repulse = {
      id: "repulse",
      name: "Repulse",
      activation: "action",
      description: "A shove of force.",
      save: { ability: "str", dc: 13, successDamage: "none", failurePush: { feet: 10 } },
      damage: []
    };
    const table = await hiddenTable({
      order: [GOBLIN, HERO],
      positions: { [HERO]: { x: 275, y: 275 }, [GOBLIN]: { x: 375, y: 275 } },
      reveals: [{ x: 150, y: 200, width: 200, height: 200 }],
      definitions: [{ id: "def-goblin", definition: monster(GOBLIN_NAME, [repulse]) }],
      actors: { [GOBLIN]: { definitionId: "def-goblin" } }
    });
    expect(mentionsGoblin(table.latest())).toBe(false);
    const mark = table.mark();
    expect(
      await emit(table.gm, "action:resolve", { actorId: GOBLIN, actionId: "repulse", targetIds: [HERO] })
    ).toMatchObject({ ok: true });
    const [save] = savesOf(table, HERO);
    expect(await emit(table.gm, "save:answer", { saveId: save!.id, method: "manual", total: 1 })).toMatchObject({
      ok: true
    });
    await settle();
    const sent = sentSince(table.received, mark);
    expect(sent.filter(mentionsGoblin)).toEqual([]);
    expect(sent.some((line) => line.includes("Borin is pushed 10 ft straight away from A hidden threat."))).toBe(true);
  });

  it("slows a goblin under the fog with Ray of Frost without naming it to Borin's player", async () => {
    const rayOfFrost = {
      id: "ray-of-frost",
      name: "Ray of Frost",
      activation: "action",
      description: "A frigid beam.",
      attack: { bonus: 5, rangeFeet: 60 },
      damage: [{ formula: "1d8", type: "cold" }],
      grants: {
        name: "Ray of Frost",
        tags: ["ray-of-frost"],
        target: "target",
        onHit: true,
        modifiers: [{ type: "speed", amount: -10 }],
        duration: { type: "until-source-next-turn" }
      }
    };
    const table = await hiddenTable({
      order: [FRIEND, HERO, GOBLIN],
      positions: { [HERO]: { x: 75, y: 275 }, [FRIEND]: { x: 75, y: 325 }, [GOBLIN]: { x: 325, y: 275 } },
      reveals: BAND,
      definitions: [{ id: "def-mirena", definition: character("Mirena", [rayOfFrost]) }],
      actors: { [FRIEND]: { definitionId: "def-mirena" }, [GOBLIN]: { armorClass: 12 } }
    });
    expect(mentionsGoblin(table.latest())).toBe(false);
    const mark = table.mark();
    const cast = await emit(table.gm, "action:resolve", {
      actorId: FRIEND,
      actionId: "ray-of-frost",
      targetIds: [GOBLIN],
      attackTotal: 30
    });
    expect(cast).toMatchObject({ ok: true });
    await settle();
    // It landed: the goblin is slowed, which only the GM reads.
    const goblin = table.server.store.snapshot.actors.find((actor) => actor.id === GOBLIN)!;
    expect(goblin.effects.map((effect) => effect.name)).toContain("Ray of Frost");
    expect(JSON.stringify(table.gmLog)).toContain(`${GOBLIN_NAME} is Ray of Frost.`);
    expect(sentSince(table.received, mark).filter(mentionsGoblin)).toEqual([]);
  });

  it("refuses Borin's Magic action without naming the hidden goblin whose effect forbids it", async () => {
    const table = await hiddenTable({
      order: [HERO, GOBLIN],
      positions: { [HERO]: { x: 75, y: 275 }, [GOBLIN]: { x: 325, y: 275 } },
      reveals: BAND,
      actors: {
        [HERO]: {
          effects: [
            {
              id: "befuddled-1",
              name: `Befuddled by ${GOBLIN_NAME}`,
              tags: ["no-spells"],
              sourceActorId: GOBLIN,
              sourceName: GOBLIN_NAME,
              duration: { type: "manual" }
            }
          ]
        }
      }
    });
    expect(mentionsGoblin(table.latest())).toBe(false);
    const refused = await emit(table.player, "action:resolve", { actorId: HERO, actionId: "magic" });
    expect(refused).toMatchObject({ ok: false, code: "condition.no-spells" });
    expect(String(refused.message)).toBe(
      "Borin can't cast spells or take the Magic action while Befuddled by A hidden threat lasts."
    );
  });
});

describe("effects that end as their bearer acts, from a source hidden under the fog", () => {
  it("names the hidden source of the effects Borin's attack ends as a hidden threat", async () => {
    // Effect names that carry their source's name, as an authored one can: Invisibility's "until it acts" and Vicious
    // Mockery's "until its own attack".
    const sourced = (id: string, name: string, tag: string) => ({
      id,
      name: `${name} ${GOBLIN_NAME}`,
      tags: [tag],
      sourceActorId: GOBLIN,
      sourceName: GOBLIN_NAME,
      duration: { type: "manual" }
    });
    const table = await hiddenTable({
      order: [HERO, ORC, GOBLIN],
      positions: { [HERO]: { x: 75, y: 275 }, [ORC]: { x: 125, y: 275 }, [GOBLIN]: { x: 325, y: 275 } },
      reveals: BAND,
      actors: {
        [HERO]: {
          effects: [sourced("veil-1", "Veiled by", "until-it-acts"), sourced("mock-1", "Mocked by", "until-own-attack")]
        },
        [ORC]: { armorClass: 10 }
      }
    });
    expect(mentionsGoblin(table.latest())).toBe(false);
    const mark = table.mark();
    const swing = await emit(table.player, "action:resolve", {
      actorId: HERO,
      actionId: "unarmed-strike",
      targetIds: [ORC]
    });
    expect(swing).toMatchObject({ ok: true });
    await settle();
    expect(table.server.store.snapshot.actors.find((actor) => actor.id === HERO)?.effects).toEqual([]);
    expect(mentionsGoblin(swing)).toBe(false);
    const sent = sentSince(table.received, mark);
    expect(sent.filter(mentionsGoblin)).toEqual([]);
    expect(sent.some((line) => line.includes("Veiled by A hidden threat ended on Borin."))).toBe(true);
    expect(sent.some((line) => line.includes("Mocked by A hidden threat ended on Borin."))).toBe(true);
  });

  it("names the hidden caster of a Slow that fails a spell as a hidden threat", () => {
    const { state, resolve } = fight(build(bardInput(["charm-person"])));
    const bard = state.actors.find((actor) => actor.id === BARD)!;
    bard.effects = [
      makeEffect({
        id: "slow-1",
        name: "Slowed by Goblin",
        tags: ["slowed"],
        sourceActorId: FOE,
        sourceName: "Goblin",
        duration: { type: "manual" }
      })
    ];
    // The bard in a revealed corner of the map, the goblin across it under the fog.
    const token = (actorId: string, x: number) => ({
      actorId,
      position: { x, y: 75 },
      sizePx: 41,
      gridSizePx: 50,
      gridRotationRadians: null,
      sizeCells: 1
    });
    state.combat.tokens = [token(BARD, 75), token(FOE, 575)];
    state.combat.fog = {
      ...state.combat.fog,
      enabled: true,
      shapes: [
        { kind: "rect", id: "70000000-0000-4000-8000-000000000009", op: "reveal", x: 0, y: 0, width: 200, height: 200 }
      ]
    };
    const failed = resolve("spell-charm-person", { targetIds: [FOE] }, [1]);
    expect(failed.tableNarration?.map((line) => line.text)).toEqual([
      "Ysolde's Charm Person fails, its gestures made too slowly under Slowed by A hidden threat."
    ]);
  });
});

/** A Paladin NPC on Borin's side, 10 feet from Borin, with Aura of Protection and Aura of Courage. */
const paladin = (name: string) =>
  character(name, [], {
    abilityScores: { str: 16, dex: 10, con: 14, int: 10, wis: 12, cha: 16 },
    character: {
      classes: [{ id: "paladin", name: "Paladin", level: 10 }],
      feats: [],
      features: ["aura-of-protection", "aura-of-courage"].map((id) => ({ id, kind: "class", sourceId: "paladin" }))
    }
  });

/** Borin, Frightened, beside the orc he fights, and the Paladin NPC Sir Vael two squares off, under the fog or not. */
function auraTable(fogged: boolean): HiddenTableSetup {
  return {
    order: [HERO, ORC, FRIEND],
    positions: { [HERO]: { x: 75, y: 275 }, [ORC]: { x: 125, y: 275 }, [FRIEND]: { x: 75, y: 375 } },
    reveals: fogged ? [{ x: 0, y: 200, width: 200, height: 150 }] : BAND,
    definitions: [{ id: "def-vael", definition: paladin("Sir Vael") }],
    actors: {
      [HERO]: { conditions: [{ id: "frightened" }] },
      [FRIEND]: { kind: "npc", name: "Sir Vael", definitionId: "def-vael" }
    }
  };
}

const mentionsVael = (payload: unknown) => JSON.stringify(payload).includes("Sir Vael");

describe("a Paladin's auras from a Paladin hidden under the fog", () => {
  it("gives Borin's save no bonus and his attack no relief from the hidden Paladin", async () => {
    const hidden = await hiddenTable(auraTable(true));
    expect(mentionsVael(hidden.latest())).toBe(false);
    const save = await emit(hidden.player, "save:roll", { actorId: HERO, ability: "wis", face: 10 });
    expect(save).toMatchObject({ ok: true, route: "loose", outcome: { total: 10 } });
    const swing = await emit(hidden.player, "action:resolve", {
      actorId: HERO,
      actionId: "unarmed-strike",
      targetIds: [ORC],
      commit: false
    });
    expect(JSON.stringify(swing)).toContain("Attacker is Frightened");
    expect(mentionsVael(save) || mentionsVael(swing)).toBe(false);

    // In view, the same Paladin's auras reach Borin.
    const seen = await hiddenTable(auraTable(false));
    expect(await emit(seen.player, "save:roll", { actorId: HERO, ability: "wis", face: 10 })).toMatchObject({
      outcome: { total: 13 }
    });
    const relieved = await emit(seen.player, "action:resolve", {
      actorId: HERO,
      actionId: "unarmed-strike",
      targetIds: [ORC],
      commit: false
    });
    expect(JSON.stringify(relieved)).not.toContain("Attacker is Frightened");
  });

  /** A hostile Paladin with Holy Nimbus up, two squares from Borin, whose turn comes next. */
  const nimbusTable = (fogged: boolean): HiddenTableSetup => ({
    order: [ORC, HERO, FRIEND],
    positions: { [HERO]: { x: 75, y: 275 }, [ORC]: { x: 125, y: 275 }, [FRIEND]: { x: 75, y: 375 } },
    reveals: fogged ? [{ x: 0, y: 200, width: 200, height: 150 }] : BAND,
    definitions: [
      {
        id: "def-knight",
        definition: monster("Dread Knight", [], {
          abilityScores: { str: 16, dex: 10, con: 14, int: 10, wis: 12, cha: 16 },
          token: { disposition: "hostile" }
        })
      }
    ],
    actors: {
      [FRIEND]: {
        kind: "npc",
        name: "Dread Knight",
        definitionId: "def-knight",
        effects: [
          {
            id: "nimbus-1",
            name: "Holy Nimbus",
            tags: ["holy-nimbus"],
            sourceActorId: FRIEND,
            sourceName: "Dread Knight",
            duration: { type: "manual" }
          }
        ]
      }
    }
  });

  it("burns Borin with no hidden Paladin's Holy Nimbus as Borin's turn starts", async () => {
    const hidden = await hiddenTable(nimbusTable(true));
    expect(JSON.stringify(hidden.latest())).not.toContain("Dread Knight");
    const mark = hidden.mark();
    expect(await emit(hidden.gm, "initiative:next", {})).toMatchObject({ ok: true });
    await settle();
    expect(hidden.server.store.snapshot.actors.find((actor) => actor.id === HERO)?.hp.current).toBe(20);
    expect(sentSince(hidden.received, mark).filter((line) => line.includes("Holy Nimbus"))).toEqual([]);

    // In view, the nimbus burns: Cha +3 and Proficiency Bonus +2.
    const seen = await hiddenTable(nimbusTable(false));
    expect(await emit(seen.gm, "initiative:next", {})).toMatchObject({ ok: true });
    await settle();
    expect(seen.server.store.snapshot.actors.find((actor) => actor.id === HERO)?.hp.current).toBe(15);
  });

  it("gives Borin's Holy Ward no Advantage against an undead the fog hides", async () => {
    const drain = {
      id: "dread-gaze",
      name: "Dread Gaze",
      activation: "action",
      description: "A withering stare.",
      save: { ability: "wis", dc: 12, successDamage: "none" },
      damage: []
    };
    const setup = (fogged: boolean): HiddenTableSetup => ({
      order: [GOBLIN, HERO],
      positions: { [HERO]: { x: 75, y: 275 }, [GOBLIN]: { x: fogged ? 325 : 175, y: 275 } },
      reveals: BAND,
      definitions: [
        {
          id: "def-ghoul",
          definition: monster(GOBLIN_NAME, [drain], { extensions: { "open5e.srd-2024": { type: "Undead" } } })
        }
      ],
      actors: {
        [GOBLIN]: { definitionId: "def-ghoul" },
        [HERO]: {
          effects: [
            {
              id: "nimbus-2",
              name: "Holy Nimbus",
              tags: ["holy-nimbus"],
              sourceActorId: HERO,
              sourceName: "Borin",
              duration: { type: "manual" }
            }
          ]
        }
      }
    });
    const answer = async (fogged: boolean) => {
      const table = await hiddenTable(setup(fogged));
      expect(mentionsGoblin(table.latest())).toBe(!fogged);
      expect(
        await emit(table.gm, "action:resolve", { actorId: GOBLIN, actionId: "dread-gaze", targetIds: [HERO] })
      ).toMatchObject({ ok: true });
      const [save] = savesOf(table, HERO);
      // The server throws the die, so the reply says what shaped it.
      return emit(table.player, "save:answer", { saveId: save!.id, method: "roll" });
    };
    expect(JSON.stringify(await answer(true))).not.toContain("Holy Ward");
    expect(JSON.stringify(await answer(false))).toContain("Holy Nimbus (Holy Ward)");
  });
});
