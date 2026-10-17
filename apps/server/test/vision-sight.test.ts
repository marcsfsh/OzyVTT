import { describe, expect, it } from "vitest";
import type { ActorDefinition } from "@vtt/schemas";
import { ContentLibrary } from "../src/content-library.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { sceneSight } from "../src/vision/sight.js";
import { carriedLightOf, sensesOf, type SightContent } from "../src/vision/senses.js";
import { cell, DIVIDER, GOBLIN, HERO, visionGame, wall } from "./vision-fixtures.js";

// SRD 5.2.1 Rules Glossary: Darkvision, Blindsight, Tremorsense, Truesight, Bright Light, Dim Light, Darkness, and the
// Invisible and Blinded conditions, as the sight engine reads them.

const catalog = equipmentCatalogOf(new ContentLibrary().forAudience("gm"));

/** A stat block printing `senses`, served as bundled content would be. */
function withSenses(senses: readonly string[]): SightContent {
  const definition = { extensions: { "open5e.srd-2024": { senses } } } as unknown as ActorDefinition;
  return { definition: (id) => (id === "sensing" ? definition : undefined), catalog };
}
const sensing = { definitionId: "sensing" };

describe("dynamic vision: walls and doors", () => {
  it("hides a creature behind a wall and shows it once the wall is gone", () => {
    expect(sceneSight(visionGame({ walls: [DIVIDER()] })).perceives(HERO, GOBLIN)).toBe(false);
    expect(sceneSight(visionGame({ walls: [] })).perceives(HERO, GOBLIN)).toBe(true);
  });

  it("lets a window and an open door show what is beyond, and a closed door hide it", () => {
    const line = (kind: "door" | "window", open?: boolean) =>
      visionGame({ walls: [wall({ x: 250, y: 0 }, { x: 250, y: 600 }, kind, open)] });
    expect(sceneSight(line("window")).perceives(HERO, GOBLIN)).toBe(true);
    expect(sceneSight(line("door", true)).perceives(HERO, GOBLIN)).toBe(true);
    expect(sceneSight(line("door", false)).perceives(HERO, GOBLIN)).toBe(false);
  });

  it("does nothing while the scene's vision is off", () => {
    const sight = sceneSight(visionGame({ enabled: false, walls: [DIVIDER()] }));
    expect(sight.enabled).toBe(false);
  });
});

describe("dynamic vision: light and darkness", () => {
  it("leaves a creature in Darkness unseen by eyes alone, and seen in Dim Light", () => {
    expect(sceneSight(visionGame({ ambient: "dark" })).perceives(HERO, GOBLIN)).toBe(false);
    expect(sceneSight(visionGame({ ambient: "dim" })).perceives(HERO, GOBLIN)).toBe(true);
  });

  it("sees in the dark as far as Darkvision reaches", () => {
    // The goblin is 7 cells (35 ft) away.
    const darkvision = (feet: number) =>
      sceneSight(visionGame({ ambient: "dark", actors: { [HERO]: sensing } }), withSenses([`darkvision ${feet} ft.`]));
    expect(darkvision(60).perceives(HERO, GOBLIN)).toBe(true);
    expect(darkvision(30).perceives(HERO, GOBLIN)).toBe(false);
  });

  it("reads a species' Darkvision from its traits", () => {
    const elf = {
      character: { features: [{ id: "elf-darkvision", kind: "species", sourceId: "elf" }] },
      extensions: {}
    } as unknown as ActorDefinition;
    const state = visionGame({ actors: { [HERO]: { definitionId: "elf-sheet" } } });
    const senses = sensesOf(state, state.actors[0]!, { definition: () => elf, catalog });
    expect(senses.darkvision).toBe(60);
  });

  it("lights the way with a placed light, unless a wall stands between it and the creature", () => {
    const torchLight = (walls: ReturnType<typeof wall>[]) =>
      visionGame({
        ambient: "dark",
        walls,
        lights: [
          { id: "50000000-0000-4000-8000-0000000000f1", position: cell(9, 5), actorId: null, brightFeet: 10, dimFeet: 10 }
        ]
      });
    expect(sceneSight(torchLight([])).perceives(HERO, GOBLIN)).toBe(true);
    // A short wall between the light and the goblin leaves the goblin dark, though the hero still has a clear line.
    const shade = wall({ x: 450, y: 225 }, { x: 450, y: 325 });
    expect(sceneSight(torchLight([shade])).perceives(HERO, GOBLIN)).toBe(false);
  });

  it("lights a carried Torch while it is equipped", () => {
    const torch = (equipped: boolean) => ({
      inventory: [{ id: "torch", name: "Torch", quantity: 1, equipped, attuned: false }]
    });
    // The goblin stands 3 cells (15 ft) from the hero, inside a Torch's 40 feet.
    const near = { positions: { [GOBLIN]: cell(4, 5) }, ambient: "dark" as const };
    const lit = visionGame({ ...near, actors: { [HERO]: torch(true) } });
    const unlit = visionGame({ ...near, actors: { [HERO]: torch(false) } });
    expect(carriedLightOf(lit.actors[0]!, { catalog })).toEqual({ brightFeet: 20, dimFeet: 20 });
    expect(sceneSight(lit, { catalog }).perceives(HERO, GOBLIN)).toBe(true);
    expect(sceneSight(unlit, { catalog }).perceives(HERO, GOBLIN)).toBe(false);
  });
});

describe("dynamic vision: the special senses and conditions", () => {
  it("sees an Invisible creature only with Blindsight or Truesight in range", () => {
    const invisible = { [GOBLIN]: { conditions: [{ id: "invisible" }] } };
    expect(sceneSight(visionGame({ actors: invisible })).perceives(HERO, GOBLIN)).toBe(false);
    const truesight = visionGame({ actors: { ...invisible, [HERO]: sensing } });
    expect(sceneSight(truesight, withSenses(["truesight 60 ft."])).perceives(HERO, GOBLIN)).toBe(true);
    // Faerie Fire's outline cancels the condition.
    const outlined = visionGame({
      actors: {
        [GOBLIN]: {
          conditions: [{ id: "invisible" }],
          effects: [
            {
              id: "outline",
              name: "Faerie Fire",
              sourceActorId: null,
              sourceName: "Faerie Fire",
              tags: ["outlined"],
              startedRound: 1,
              duration: { type: "manual" }
            }
          ]
        }
      }
    });
    expect(sceneSight(outlined).perceives(HERO, GOBLIN)).toBe(true);
  });

  it("sees with Blindsight in Darkness and while Blinded, but not through a wall", () => {
    const blind = { [HERO]: { ...sensing, conditions: [{ id: "blinded" }] } };
    const content = withSenses(["blindsight 60 ft."]);
    expect(sceneSight(visionGame({ ambient: "dark", actors: blind }), content).perceives(HERO, GOBLIN)).toBe(true);
    expect(sceneSight(visionGame({ actors: blind, walls: [DIVIDER()] }), content).perceives(HERO, GOBLIN)).toBe(false);
  });

  it("sees nothing while Blinded without Blindsight", () => {
    expect(sceneSight(visionGame({ actors: { [HERO]: { conditions: [{ id: "blinded" }] } } })).perceives(HERO, GOBLIN)).toBe(
      false
    );
  });

  it("pinpoints a creature through a wall by Tremorsense, without seeing it", () => {
    const sight = sceneSight(
      visionGame({ walls: [DIVIDER()], actors: { [HERO]: sensing } }),
      withSenses(["tremorsense 60 ft."])
    );
    expect(sight.perceives(HERO, GOBLIN)).toBe(true);
    expect(sight.sees(HERO, GOBLIN)).toBe(false);
  });

  it("draws the area a creature sees in the dark as far as its Darkvision", () => {
    const sight = sceneSight(
      visionGame({ ambient: "dark", actors: { [HERO]: sensing } }),
      withSenses(["darkvision 60 ft."])
    );
    const area = sight.areaOf([HERO]);
    expect(area).toHaveLength(1);
    const xs = area[0]!.map((point) => point.x);
    // 60 feet is 600 pixels from the hero at x = 75.
    expect(Math.max(...xs)).toBeLessThanOrEqual(75 + 600 + 0.01);
    expect(Math.max(...xs)).toBeGreaterThan(75 + 590);
  });
});
