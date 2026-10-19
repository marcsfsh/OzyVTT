import { describe, expect, it } from "vitest";
import type { VisionArea, VisionLight } from "@vtt/domain";
import type { ActorDefinition } from "@vtt/schemas";
import { ContentLibrary } from "../src/content-library.js";
import { equipmentCatalogOf } from "../src/equipment-derivation.js";
import { sceneSight } from "../src/vision/sight.js";
import { sensesOf, type SightContent } from "../src/vision/senses.js";
import { cell, DIVIDER, GOBLIN, HERO, visionGame } from "./vision-fixtures.js";

// SRD 5.2.1 Rules Glossary: Bright Light, Dim Light, Darkness, Lightly Obscured, Heavily Obscured, Darkvision,
// Truesight, and the Darkness spell's magical Darkness, as the sight engine reads them. The hero stands at cell (1,5)
// and the goblin 35 feet away at cell (8,5), on 5-foot cells of 50 pixels.

const catalog = equipmentCatalogOf(new ContentLibrary().forAudience("gm"));

function withSenses(senses: readonly string[]): SightContent {
  const definition = { extensions: { "open5e.srd-2024": { senses } } } as unknown as ActorDefinition;
  return { definition: (id) => (id === "sensing" ? definition : undefined), catalog };
}
const sensing = { definitionId: "sensing" };

let ids = 0;
const uuid = () => `50000000-0000-4000-8000-${String(++ids).padStart(12, "0")}`;

const light = (at: { x: number; y: number }, brightFeet: number, dimFeet: number, extra: Partial<VisionLight> = {}) =>
  ({ id: uuid(), position: at, actorId: null, brightFeet, dimFeet, ...extra }) as VisionLight;

const rectArea = (kind: VisionArea["kind"], x: number, y: number, width: number, height: number): VisionArea => ({
  id: uuid(),
  kind,
  shape: { type: "rect", x, y, width, height }
});
const circleArea = (kind: VisionArea["kind"], at: { x: number; y: number }, radiusFeet: number): VisionArea => ({
  id: uuid(),
  kind,
  shape: { type: "circle", x: at.x, y: at.y, radiusFeet }
});

const effect = (fields: Record<string, unknown>) => ({
  id: `effect-${++ids}`,
  name: "Effect",
  sourceActorId: null,
  sourceName: null,
  tags: [],
  startedRound: 1,
  duration: { type: "manual" },
  ...fields
});

describe("light levels", () => {
  it("reads the scene's ambient light at every point", () => {
    expect(sceneSight(visionGame({ ambient: "bright" })).lightAt(cell(3, 3)).level).toBe("bright");
    expect(sceneSight(visionGame({ ambient: "dim" })).lightAt(cell(3, 3)).level).toBe("dim");
    expect(sceneSight(visionGame({ ambient: "dark" })).lightAt(cell(3, 3)).level).toBe("dark");
  });

  it("gives a light's Bright Light out to its bright radius and Dim Light beyond it", () => {
    // A light at the goblin's square: 20 feet of Bright Light and 10 more of Dim.
    const sight = sceneSight(visionGame({ ambient: "dark", lights: [light(cell(8, 5), 20, 10)] }));
    expect(sight.lightAt(cell(5, 5)).level).toBe("bright");
    expect(sight.lightAt(cell(3, 5)).level).toBe("dim");
    expect(sight.lightAt(cell(0, 5)).level).toBe("dark");
  });

  it("treats Dim Light as Lightly Obscured and Darkness as Heavily Obscured", () => {
    const sight = sceneSight(visionGame({ ambient: "dark", lights: [light(cell(8, 5), 20, 10)] }));
    expect(sight.obscurementAt(cell(8, 5))).toBe("none");
    expect(sight.obscurementAt(cell(3, 5))).toBe("light");
    expect(sight.obscurementAt(cell(0, 5))).toBe("heavy");
  });

  it("keeps a painted dark cellar dark in daylight, and hides a creature in it from eyes alone", () => {
    const cellar = rectArea("dark", 350, 200, 150, 150);
    const state = visionGame({ areas: [cellar] });
    expect(sceneSight(state).lightAt(cell(8, 5)).level).toBe("dark");
    expect(sceneSight(state).perceives(HERO, GOBLIN)).toBe(false);
    // Darkvision sees into it, and a light inside it shows the goblin.
    const darkvision = visionGame({ areas: [cellar], actors: { [HERO]: sensing } });
    expect(sceneSight(darkvision, withSenses(["darkvision 60 ft."])).perceives(HERO, GOBLIN)).toBe(true);
    const lit = visionGame({ areas: [cellar], lights: [light(cell(8, 5), 5, 5)] });
    expect(sceneSight(lit).perceives(HERO, GOBLIN)).toBe(true);
  });

  it("lights a painted room in a dark dungeon", () => {
    const room = rectArea("bright", 350, 200, 150, 150);
    const sight = sceneSight(visionGame({ ambient: "dark", areas: [room] }));
    expect(sight.lightAt(cell(8, 5)).level).toBe("bright");
    expect(sight.perceives(HERO, GOBLIN)).toBe(true);
  });

  it("marks sunlight: the scene's daylight, a sunlit area, and a light whose Bright Light is sunlight", () => {
    expect(sceneSight(visionGame({ sunlight: true })).lightAt(cell(3, 3)).sunlight).toBe(true);
    expect(sceneSight(visionGame()).lightAt(cell(3, 3)).sunlight).toBe(false);
    const daylight = sceneSight(
      visionGame({ ambient: "dark", lights: [light(cell(8, 5), 20, 20, { sunlight: true })] })
    );
    expect(daylight.lightAt(cell(7, 5))).toMatchObject({ level: "bright", sunlight: true });
    // Its Dim Light beyond the Sphere is no sunlight.
    expect(daylight.lightAt(cell(3, 5))).toMatchObject({ level: "dim", sunlight: false });
  });
});

describe("obscuring areas", () => {
  it("blocks sight into and through Heavily Obscured fog", () => {
    // A Fog Cloud of 20-foot radius around cell (5,5), between the hero and the goblin.
    const fog = circleArea("heavily-obscured", cell(5, 5), 10);
    const sight = sceneSight(visionGame({ areas: [fog] }));
    expect(sight.obscurementAt(cell(5, 5))).toBe("heavy");
    expect(sight.perceives(HERO, GOBLIN)).toBe(false);
    // A creature inside the fog sees nothing out of it.
    const inside = sceneSight(visionGame({ areas: [fog], positions: { [HERO]: cell(5, 5) } }));
    expect(inside.sees(HERO, GOBLIN)).toBe(false);
  });

  it("lets Blindsight perceive through fog, and Truesight not", () => {
    const fog = circleArea("heavily-obscured", cell(5, 5), 10);
    const state = visionGame({ areas: [fog], actors: { [HERO]: sensing } });
    expect(sceneSight(state, withSenses(["blindsight 60 ft."])).perceives(HERO, GOBLIN)).toBe(true);
    expect(sceneSight(state, withSenses(["truesight 60 ft."])).perceives(HERO, GOBLIN)).toBe(false);
  });

  it("marks a Lightly Obscured area without blocking sight", () => {
    const foliage = rectArea("lightly-obscured", 350, 200, 150, 150);
    const sight = sceneSight(visionGame({ areas: [foliage] }));
    expect(sight.obscurementAt(cell(8, 5))).toBe("light");
    expect(sight.perceives(HERO, GOBLIN)).toBe(true);
  });

  it("fills magical Darkness that no light illuminates and Darkvision can't see into", () => {
    const darkness = circleArea("magical-darkness", cell(8, 5), 15);
    const state = (senses: string[] = []) =>
      sceneSight(
        visionGame({ areas: [darkness], lights: [light(cell(8, 5), 20, 20)], actors: { [HERO]: sensing } }),
        withSenses(senses)
      );
    expect(state().lightAt(cell(8, 5))).toMatchObject({ level: "dark", magical: true });
    expect(state().perceives(HERO, GOBLIN)).toBe(false);
    expect(state(["darkvision 120 ft."]).perceives(HERO, GOBLIN)).toBe(false);
    expect(state(["truesight 60 ft."]).perceives(HERO, GOBLIN)).toBe(true);
    expect(state(["blindsight 60 ft."]).perceives(HERO, GOBLIN)).toBe(true);
  });

  it("lets Devil's Sight see into magical Darkness", () => {
    const darkness = circleArea("magical-darkness", cell(8, 5), 15);
    const option = {
      id: "devils-sight",
      name: "Devil's Sight",
      modifiers: [{ type: "sense", sense: "devils-sight", feet: 120 }]
    };
    const warlock = {
      character: { features: [{ id: "devils-sight", kind: "option", sourceId: "warlock" }] },
      extensions: {}
    } as unknown as ActorDefinition;
    const content: SightContent = {
      definition: () => warlock,
      catalog: {
        ...catalog,
        featureRecord: (ref) => (ref.id === "devils-sight" ? (option as never) : catalog.featureRecord?.(ref))
      }
    };
    const state = visionGame({ areas: [darkness], actors: { [HERO]: { definitionId: "warlock-sheet" } } });
    expect(sensesOf(state, state.actors[0]!, content).devilsSight).toBe(120);
    expect(sceneSight(state, content).perceives(HERO, GOBLIN)).toBe(true);
  });

  it("follows a spell's placed template as the template moves", () => {
    const annotation = (x: number) => ({
      id: "60000000-0000-4000-8000-000000000a01",
      kind: "shape",
      shape: "circle",
      geometry: { origin: { x, y: 275 }, target: { x: x + 100, y: 275 }, sizeFeet: 10 },
      ownerSessionId: "30000000-0000-4000-8000-00000000000a",
      createdByRole: "gm",
      createdAt: 0
    });
    const fog: VisionArea = {
      id: uuid(),
      kind: "heavily-obscured",
      shape: { type: "template", annotationId: "60000000-0000-4000-8000-000000000a01", widthFeet: null }
    };
    expect(sceneSight(visionGame({ areas: [fog], annotations: [annotation(275)] })).perceives(HERO, GOBLIN)).toBe(
      false
    );
    expect(sceneSight(visionGame({ areas: [fog], annotations: [annotation(800)] })).perceives(HERO, GOBLIN)).toBe(true);
  });

  it("moves an Emanation with the creature it surrounds", () => {
    // A darkmantle's 15-foot Emanation of magical Darkness round the goblin.
    const aura: VisionArea = {
      id: uuid(),
      kind: "magical-darkness",
      shape: { type: "emanation", actorId: GOBLIN, radiusFeet: 15 }
    };
    const sight = sceneSight(visionGame({ areas: [aura] }));
    expect(sight.perceives(HERO, GOBLIN)).toBe(false);
    expect(sight.lightAt(cell(8, 2)).magical).toBe(true);
    expect(sight.lightAt(cell(8, 0)).magical).toBe(false);
  });
});

describe("lights creatures carry", () => {
  it("lights a creature whose effect sheds light (Faerie Fire's outline, Produce Flame)", () => {
    const glowing = visionGame({
      ambient: "dark",
      actors: { [GOBLIN]: { effects: [effect({ light: { brightFeet: 0, dimFeet: 10 } })] } }
    });
    expect(sceneSight(glowing).perceives(HERO, GOBLIN)).toBe(true);
    expect(sceneSight(visionGame({ ambient: "dark" })).perceives(HERO, GOBLIN)).toBe(false);
  });

  it("aims a Bullseye Lantern's Cone where its bearer faces", () => {
    const lantern = (facingDegrees: number) =>
      visionGame({
        ambient: "dark",
        actors: {
          [HERO]: {
            inventory: [
              {
                id: "bullseye-lantern",
                name: "Lantern, Bullseye",
                quantity: 1,
                equipped: true,
                attuned: false,
                lit: true,
                facingDegrees
              }
            ]
          }
        }
      });
    // The goblin is due right (0 degrees); facing down (90) leaves it dark.
    expect(sceneSight(lantern(0), { catalog }).perceives(HERO, GOBLIN)).toBe(true);
    expect(sceneSight(lantern(90), { catalog }).perceives(HERO, GOBLIN)).toBe(false);
  });

  it("dims a Hooded Lantern to 5 feet of Dim Light with its hood down", () => {
    const lantern = (hoodLowered: boolean) =>
      visionGame({
        ambient: "dark",
        positions: { [GOBLIN]: cell(4, 5) },
        actors: {
          [HERO]: {
            inventory: [
              {
                id: "hooded-lantern",
                name: "Lantern, Hooded",
                quantity: 1,
                equipped: true,
                attuned: false,
                lit: true,
                ...(hoodLowered ? { hoodLowered: true } : {})
              }
            ]
          }
        }
      });
    expect(sceneSight(lantern(false), { catalog }).perceives(HERO, GOBLIN)).toBe(true);
    expect(sceneSight(lantern(true), { catalog }).perceives(HERO, GOBLIN)).toBe(false);
    expect(sceneSight(lantern(true), { catalog }).lightAt(cell(1, 5)).level).toBe("dim");
  });
});

describe("senses from effects and items", () => {
  const invisibleGoblin = { conditions: [{ id: "invisible" }] };

  it("gives Truesight from a live effect (True Seeing) that sees an Invisible creature", () => {
    const seeing = visionGame({
      actors: {
        [GOBLIN]: invisibleGoblin,
        [HERO]: { effects: [effect({ modifiers: [{ type: "sense", sense: "truesight", feet: 120 }] })] }
      }
    });
    expect(sceneSight(seeing).perceives(HERO, GOBLIN)).toBe(true);
  });

  it("sees an Invisible creature with See Invisibility only where there is light to see it by", () => {
    const seeInvisibility = effect({ modifiers: [{ type: "sense", sense: "see-invisibility", feet: 0 }] });
    const state = (ambient: "bright" | "dark") =>
      visionGame({ ambient, actors: { [GOBLIN]: invisibleGoblin, [HERO]: { effects: [seeInvisibility] } } });
    expect(sceneSight(state("bright")).perceives(HERO, GOBLIN)).toBe(true);
    expect(sceneSight(state("dark")).perceives(HERO, GOBLIN)).toBe(false);
  });

  it("adds Goggles of Night's 60 feet to Darkvision the wearer has", () => {
    const goggles = { id: "goggles-of-night", name: "Goggles of Night", quantity: 1, equipped: true, attuned: false };
    const state = visionGame({ actors: { [HERO]: { ...sensing, inventory: [goggles] } } });
    const record = catalog.equipmentRecord("goggles-of-night");
    expect(record?.modifiers).toContainEqual(expect.objectContaining({ type: "darkvision", feet: 60, extends: true }));
    expect(sensesOf(state, state.actors[0]!, withSenses(["darkvision 60 ft."])).darkvision).toBe(120);
    expect(sensesOf(state, state.actors[0]!, withSenses([])).darkvision).toBe(60);
  });

  it("sees an Invisible creature in a Lantern of Revealing's Bright Light", () => {
    const lantern = {
      id: "lantern-of-revealing",
      name: "Lantern of Revealing",
      quantity: 1,
      equipped: true,
      attuned: false,
      lit: true
    };
    const state = visionGame({
      positions: { [GOBLIN]: cell(4, 5) },
      actors: { [GOBLIN]: invisibleGoblin, [HERO]: { inventory: [lantern] } }
    });
    expect(sceneSight(state, { catalog }).perceives(HERO, GOBLIN)).toBe(true);
  });

  it("sees through a wall within a Ring of X-ray Vision's 30 feet", () => {
    const xray = effect({ modifiers: [{ type: "sense", sense: "x-ray", feet: 30 }] });
    const near = { positions: { [GOBLIN]: cell(6, 5) }, walls: [DIVIDER()] };
    expect(sceneSight(visionGame({ ...near, actors: { [HERO]: { effects: [xray] } } })).sees(HERO, GOBLIN)).toBe(true);
    expect(sceneSight(visionGame(near)).sees(HERO, GOBLIN)).toBe(false);
  });
});

describe("what a player's view draws", () => {
  it("leaves out the inside of fog and paints nothing dim in a bright scene", () => {
    const fog = circleArea("heavily-obscured", cell(8, 5), 10);
    const sight = sceneSight(visionGame({ areas: [fog] }));
    expect(sight.brightOf([HERO])).toBeNull();
    const area = sight.areaOf([HERO]);
    // The fog's far side (beyond x = 525) is cut from what the hero sees along its row.
    const reachesBehind = area.some((polygon) => polygon.some((point) => point.x > 540 && Math.abs(point.y - 275) < 5));
    expect(reachesBehind).toBe(false);
  });

  it("marks the Bright Light in sight in a dim scene", () => {
    const sight = sceneSight(visionGame({ ambient: "dim", lights: [light(cell(8, 5), 10, 10)] }));
    const bright = sight.brightOf([HERO]);
    expect(bright).not.toBeNull();
    const xs = bright!.flatMap((polygon) => polygon.map((point) => point.x));
    // The Bright Light reaches 10 feet (100 pixels) either side of the light at x = 425.
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(324);
    expect(Math.max(...xs)).toBeLessThanOrEqual(526);
  });
});
