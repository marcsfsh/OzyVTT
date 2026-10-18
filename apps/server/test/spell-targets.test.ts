import { describe, expect, it } from "vitest";
import type { GameState } from "@vtt/domain";
import type { ActorAction } from "@vtt/schemas";
import { resolveDefinitionAction, type ResolveInput } from "../src/action-resolution.js";
import { ContentLibrary } from "../src/content-library.js";
import { castAreaOf } from "../src/item-actions.js";
import { castRangeFeet } from "../src/resolution/spell-targets.js";
import { ALLY, build, castOf, catalog, clericInput, fight, FOE, FOE2, HERO, view } from "./spell-casters.js";

// SRD 5.2.1 Spells, "Targets" and "Range": the server checks each spell's targets itself. No more than it names, of a
// type it can target, one the caster can see where it says so, within range, and all in one area where the caster
// picks them among an area's creatures.

const library = new ContentLibrary();
const monster = (slug: string) => library.monsterForInstance(slug);

/** A cast of `spellId` at fixed numbers, as a sheet's action carries it: its spell id, and its area unless picked. */
function spellAction(spellId: string): ActorAction {
  const spell = view.spellRecord(spellId)!;
  const cast = castOf(spellId);
  return { ...cast, id: `spell-${spellId}`, spellId, ...castAreaOf(spell, cast) };
}

/** Resolves `spellId` for the hero in a fight whose foes are a Goblin and an Orc stat block, each `distance` away. */
function cast(
  state: GameState,
  spellId: string,
  input: Partial<ResolveInput>,
  distance: ((a: string, b: string) => number) | null = null
) {
  return resolveDefinitionAction(
    state,
    spellAction(spellId),
    { actorId: HERO, targetIds: [FOE], commandId: `cmd-${spellId}-${Math.random()}`, ...input },
    {
      random: () => 3,
      newRollId: () => crypto.randomUUID(),
      gmSessionId: "30000000-0000-4000-8000-00000000000a",
      now: () => "2026-10-16T00:00:00.000Z",
      catalog,
      resolveDefinition: monster,
      ...(distance ? { distanceFeet: distance } : {})
    }
  );
}

const cleric = build(clericInput(["bless", "cure-wounds"]));
/** A fight with a Wolf (a Beast) as the first foe and a Bandit (a Humanoid) as the second. */
function beasts() {
  const setup = fight(cleric, { ally: true });
  const foe = setup.state.actors.find((actor) => actor.id === FOE)!;
  const foe2 = setup.state.actors.find((actor) => actor.id === FOE2)!;
  Object.assign(foe, { name: "Wolf", definitionId: "wolf" });
  Object.assign(foe2, { name: "Bandit", definitionId: "bandit" });
  setup.state.combat = { ...setup.state.combat, ruleExceptions: { targeting: "strict" } };
  return setup;
}

describe("how many creatures a spell targets", () => {
  it("caps Power Word Heal, Heal and Regenerate at one creature, and Mass Suggestion at twelve", () => {
    for (const spellId of ["power-word-heal", "heal", "regenerate"]) {
      const { state } = beasts();
      expect(() => cast(state, spellId, { targetIds: [HERO, ALLY] }), spellId).toThrowError(/targets one creature/);
    }
    expect(view.spellRecord("mass-suggestion")!.effect?.targets).toEqual({ count: 12 });
  });

  it("lets Slow pick up to six creatures of the caster's choice, and no more", () => {
    expect(view.spellRecord("slow")!.effect).toMatchObject({ targets: { count: 6 }, picksInArea: true });
    // The caster picks them, so the cast places no template that would catch everyone.
    expect(spellAction("slow").area).toBeUndefined();
  });
});

describe("the creature types a spell targets", () => {
  it("refuses Hold Person at a Beast, and takes a Humanoid", () => {
    const { state } = beasts();
    expect(() => cast(state, "hold-person", { targetIds: [FOE] })).toThrowError(
      /Hold Person targets a Humanoid, and Wolf isn't one/
    );
    const resolution = cast(state, "hold-person", { targetIds: [FOE2] });
    expect(resolution.save?.targets).toEqual([expect.objectContaining({ targetName: "Bandit" })]);
  });

  it("refuses Animal Friendship at a Humanoid, and Charm Person at a Beast", () => {
    expect(() => cast(beasts().state, "animal-friendship", { targetIds: [FOE2] })).toThrowError(
      /Animal Friendship targets a Beast, and Bandit isn't one/
    );
    expect(() => cast(beasts().state, "charm-person", { targetIds: [FOE] })).toThrowError(
      /Charm Person targets a Humanoid, and Wolf isn't one/
    );
  });

  it("leaves a creature of another type out of an area that affects only one type", () => {
    const { state } = beasts();
    const resolution = cast(state, "calm-emotions", { targetIds: [FOE, FOE2], areaPlaced: true });
    expect(resolution.save?.targets.map((target) => target.targetName)).toEqual(["Bandit"]);
    expect(resolution.warnings).toContain(
      "Wolf isn't affected by Calm Emotions, which affects only humanoid creatures."
    );
  });
});

describe("a creature the caster can see", () => {
  it("refuses Hold Person at a Humanoid behind a wall, with the map's vision on", () => {
    const { state } = beasts();
    const at = (x: number) => ({ x, y: 300 });
    state.combat = {
      ...state.combat,
      tokens: state.combat.tokens.map((token) => ({
        ...token,
        position: token.actorId === HERO ? at(100) : token.actorId === FOE2 ? at(500) : at(700),
        sizePx: 41,
        gridSizePx: 50
      })),
      vision: {
        enabled: true,
        ambient: "bright",
        walls: [
          { id: "50000000-0000-4000-8000-000000000001", kind: "wall", a: { x: 300, y: 0 }, b: { x: 300, y: 600 } }
        ],
        lights: [],
        measure: { width: 1000, height: 600, pixelsPerFoot: 10 }
      } as never
    };
    expect(() => cast(state, "hold-person", { targetIds: [FOE2] })).toThrowError(
      /Mira can't see Bandit, and Hold Person needs a target Mira can see/
    );
  });
});

describe("a spell's range", () => {
  it("lets Mass Cure Wounds reach creatures in a 30-foot sphere centered within 60 feet, all in one sphere", () => {
    const apart: Record<string, number> = { [`${HERO}|${ALLY}`]: 85, [`${HERO}|${FOE}`]: 95, [`${ALLY}|${FOE}`]: 70 };
    const distance = (a: string, b: string) => apart[`${a}|${b}`] ?? apart[`${b}|${a}`] ?? 0;
    expect(() => cast(beasts().state, "mass-cure-wounds", { targetIds: [ALLY] }, distance)).not.toThrow();
    expect(() => cast(beasts().state, "mass-cure-wounds", { targetIds: [FOE] }, distance)).toThrowError(
      /Wolf is 95 ft away, beyond the 30-foot sphere Mass Cure Wounds centers within 60 ft/
    );
    const both: Record<string, number> = { ...apart, [`${HERO}|${FOE}`]: 40 };
    const close = (a: string, b: string) => both[`${a}|${b}`] ?? both[`${b}|${a}`] ?? 0;
    expect(() => cast(beasts().state, "mass-cure-wounds", { targetIds: [ALLY, FOE] }, close)).toThrowError(
      /Bran and Wolf are 70 ft apart, too far for one 30-foot sphere of Mass Cure Wounds/
    );
  });

  it("measures a Touch spell at 5 feet, and doubles Spare the Dying's range at levels 5, 11 and 17", () => {
    expect(() => cast(beasts().state, "cure-wounds", { targetIds: [ALLY] }, () => 10)).toThrowError(
      /Bran is 10 ft away, beyond Cure Wounds's touch/
    );
    const spare = view.spellRecord("spare-the-dying")!;
    expect([1, 5, 11, 17].map((level) => castRangeFeet(spare, level))).toEqual([15, 30, 60, 120]);
  });

  it("keeps Chain Lightning's bolts within 30 feet of its first target", () => {
    const apart: Record<string, number> = { [`${FOE}|${FOE2}`]: 45 };
    const distance = (a: string, b: string) => apart[`${a}|${b}`] ?? apart[`${b}|${a}`] ?? 10;
    expect(() => cast(beasts().state, "chain-lightning", { targetIds: [FOE, FOE2] }, distance)).toThrowError(
      /Bandit is 45 ft from Wolf, and Chain Lightning leaps only 30 ft from its first target/
    );
  });
});

describe("a save the engine applies nothing of", () => {
  it("tells the GM and the save card that the GM applies it", () => {
    const { state } = beasts();
    const resolution = cast(state, "levitate", { targetIds: [FOE2] });
    expect(resolution.warnings).toContain(
      "The server applies nothing of Levitate's save. Apply what a failure or a success does from the spell's text."
    );
    const pending = state.combat.pendingSaves.find((save) => save.targetActorId === FOE2)!;
    expect(pending.gmApplies).toBe(true);
    // Hold Person's save applies its Paralyzed, so it carries no such mark.
    const other = beasts().state;
    cast(other, "hold-person", { targetIds: [FOE2] });
    expect(other.combat.pendingSaves.some((save) => save.gmApplies)).toBe(false);
  });
});
