import { describe, expect, it } from "vitest";
import { AMBUSH, CAMP, CHASE, IDS, MAPS, gmView, mapAsset } from "../../test/scenes-fakes";
import {
  DEFAULT_MAP_SORT,
  MAP_SORT_KEYS,
  NO_MAP_FILTERS,
  filterMaps,
  readMapFilters,
  sortMaps,
  writeMapFilters
} from "../maps/mapList";
import { backPathOf, pathForMap, pathForScene } from "./routes";
import { drawnLine, factsOf, lightLine, needsOf, tokensLine } from "./sceneFacts";
import {
  DEFAULT_SCENE_SORT,
  NO_SCENE_FILTERS,
  SCENE_SORT_KEYS,
  activeFilterCount,
  filterScenes,
  readSceneFilters,
  readSort,
  sortParam,
  sortScenes,
  writeSceneFilters
} from "./sceneList";

// What the scene and map tables say, filter and sort on, worked out without a screen.

const view = gmView();
const facts = [AMBUSH, CHASE, CAMP].map((scene) => factsOf(view, scene, MAPS));
const [ambush, chase, camp] = facts as [(typeof facts)[0], (typeof facts)[0], (typeof facts)[0]];
const none = { linked: () => false, hasSound: () => false };

describe("a scene's facts", () => {
  it("counts who is in it, who waits in the tray and what is drawn", () => {
    expect(tokensLine(ambush)).toBe("4 tokens · 1 in the tray");
    expect(tokensLine(camp)).toBe("Nobody yet");
    expect(drawnLine(ambush)).toBe("1 wall · 1 door");
    expect(drawnLine(chase)).toBe("No walls or lights drawn");
    expect(lightLine(ambush)).toBe("Vision on · dim · 1 wall · 1 door");
    expect(lightLine(chase)).toBe("Vision off");
  });

  it("names what each scene still needs, with the step that answers it", () => {
    expect(needsOf(ambush).map((need) => [need.id, need.step])).toEqual([["waiting", "tokens"]]);
    expect(needsOf(chase).map((need) => need.text)).toEqual([
      "Old tunnels has no grid yet, so tokens won't snap to squares.",
      "2 tokens wait in the tray, off the map."
    ]);
    expect(needsOf(camp).map((need) => need.text)).toEqual(["Nobody is in this scene yet."]);
  });

  it("reads the live scene from the table, since its own slot is empty", () => {
    const live = gmView(undefined, IDS.ambush);
    const scene = live.combat.scenes.find((candidate) => candidate.id === IDS.ambush)!;
    const liveFacts = factsOf(live, scene, MAPS);
    expect(liveFacts.state).toBe("live");
    expect(tokensLine(liveFacts)).toBe("4 tokens · 1 in the tray");
    // A live scene's tray is the GM's business at the table, so it is not a need here.
    expect(needsOf(liveFacts)).toEqual([]);
  });
});

describe("filtering and sorting scenes", () => {
  it("keeps the states ticked, and the scenes the flyout's filters match", () => {
    expect(filterScenes(facts, { ...NO_SCENE_FILTERS, states: ["live"] }, none)).toEqual([]);
    expect(filterScenes(facts, { ...NO_SCENE_FILTERS, waiting: true }, none).map((row) => row.scene.name)).toEqual([
      "Crypt ambush",
      "Tunnel chase"
    ]);
    expect(filterScenes(facts, { ...NO_SCENE_FILTERS, vision: "on" }, none).map((row) => row.scene.name)).toEqual([
      "Crypt ambush"
    ]);
    const linked = { ...none, linked: (sceneId: string) => sceneId === IDS.chase };
    expect(filterScenes(facts, { ...NO_SCENE_FILTERS, codex: "unlinked" }, linked)).toHaveLength(2);
    expect(filterScenes(facts, { ...NO_SCENE_FILTERS, mapIds: [IDS.crypt] }, none)).toHaveLength(2);
  });

  it("keeps the scenes changed inside the Modified range", () => {
    const filters = { ...NO_SCENE_FILTERS, from: "2026-10-17", to: "2026-10-17" };
    expect(filterScenes(facts, filters, none)).toHaveLength(3);
    expect(filterScenes(facts, { ...filters, from: "2026-10-18", to: null }, none)).toEqual([]);
  });

  it("sorts by each level in turn, with the GM's order breaking ties", () => {
    const order = [IDS.ambush, IDS.chase, IDS.camp];
    const names = (rows: readonly (typeof facts)[0][]) => rows.map((row) => row.scene.name);
    expect(names(sortScenes(facts, DEFAULT_SCENE_SORT, order))).toEqual([
      "Crypt ambush",
      "Tunnel chase",
      "Camp at the ford"
    ]);
    expect(
      names(
        sortScenes(
          facts,
          [
            { key: "map", direction: "asc" },
            { key: "tokens", direction: "desc" }
          ],
          order
        )
      )
    ).toEqual(["Tunnel chase", "Crypt ambush", "Camp at the ford"]);
    expect(names(sortScenes(facts, [{ key: "modified", direction: "desc" }], order))[0]).toBe("Camp at the ford");
  });

  it("writes the filters into the address and reads the same filters back", () => {
    const filters = {
      ...NO_SCENE_FILTERS,
      states: ["prepared", "parked"] as const,
      mapIds: [IDS.crypt, IDS.tunnels],
      codex: "linked" as const,
      waiting: true,
      fog: "off" as const,
      from: "2026-10-01"
    };
    const query = new URLSearchParams("sort=name:asc");
    writeSceneFilters(query, filters);
    expect(query.toString()).toBe(
      `sort=name%3Aasc&state=prepared%2Cparked&map=${IDS.crypt}&map=${IDS.tunnels}&codex=linked&tray=1&fog=off&from=2026-10-01`
    );
    expect(readSceneFilters(query)).toEqual(filters);
    expect(activeFilterCount(filters)).toBe(4);

    writeSceneFilters(query, NO_SCENE_FILTERS);
    expect(query.toString()).toBe("sort=name%3Aasc");
  });

  it("reads a sort from the address, dropping columns it does not know and repeats", () => {
    const query = new URLSearchParams("sort=name:desc,bogus:asc,name:asc,modified:desc");
    expect(readSort(query, SCENE_SORT_KEYS, DEFAULT_SCENE_SORT)).toEqual([
      { key: "name", direction: "desc" },
      { key: "modified", direction: "desc" }
    ]);
    expect(readSort(new URLSearchParams(), SCENE_SORT_KEYS, DEFAULT_SCENE_SORT)).toBe(DEFAULT_SCENE_SORT);
    expect(sortParam(DEFAULT_SCENE_SORT, DEFAULT_SCENE_SORT)).toBeNull();
    expect(sortParam([{ key: "state", direction: "asc" }], DEFAULT_SCENE_SORT)).toBe("state:asc");
  });
});

describe("filtering and sorting maps", () => {
  const usedIn = (mapId: string) => view.combat.scenes.filter((scene) => scene.mapAssetId === mapId).length;

  it("keeps the types ticked, and the maps the flyout's filters match", () => {
    const names = (filters: typeof NO_MAP_FILTERS) => filterMaps(MAPS, filters, usedIn).map((map) => map.name);
    expect(names({ ...NO_MAP_FILTERS, kinds: ["regional"] })).toEqual(["Saltmere"]);
    expect(names({ ...NO_MAP_FILTERS, grid: "none" })).toEqual(["Old tunnels", "Saltmere"]);
    expect(names({ ...NO_MAP_FILTERS, folders: [""] })).toEqual(["Saltmere"]);
    expect(names({ ...NO_MAP_FILTERS, used: "unused" })).toEqual(["Saltmere"]);
  });

  it("sorts newest first by default, and by several columns when asked", () => {
    expect(sortMaps(MAPS, DEFAULT_MAP_SORT, usedIn).map((map) => map.name)).toEqual([
      "Sunken crypt",
      "Old tunnels",
      "Saltmere"
    ]);
    const spare = mapAsset("20000000-0000-5000-8000-0000000000f1", "Archive", { folder: "Dungeons" });
    expect(
      sortMaps(
        [...MAPS, spare],
        [
          { key: "folder", direction: "desc" },
          { key: "used", direction: "asc" }
        ],
        usedIn
      ).map((map) => map.name)
    ).toEqual(["Archive", "Old tunnels", "Sunken crypt", "Saltmere"]);
  });

  it("writes the filters into the address, with the maps in no folder as an empty folder", () => {
    const filters = {
      ...NO_MAP_FILTERS,
      kinds: ["battlemap"] as const,
      folders: ["Dungeons", ""],
      used: "used" as const
    };
    const query = new URLSearchParams();
    writeMapFilters(query, filters);
    expect(query.toString()).toBe("type=battlemap&folder=Dungeons&folder=&used=used");
    expect(readMapFilters(query)).toEqual(filters);
    expect(readSort(new URLSearchParams("sort=grid:asc"), MAP_SORT_KEYS, DEFAULT_MAP_SORT)).toEqual([
      { key: "grid", direction: "asc" }
    ]);
  });
});

describe("the Scenes tab's addresses", () => {
  it("gives every scene, map and step its own link", () => {
    expect(pathForScene(IDS.ambush)).toBe(`/scenes/${IDS.ambush}`);
    expect(pathForScene(IDS.ambush, "light")).toBe(`/scenes/${IDS.ambush}?step=light`);
    expect(pathForMap(IDS.crypt, "grid", "/table")).toBe(`/scenes/maps/${IDS.crypt}?step=grid&back=%2Ftable`);
  });

  it("goes back only into the app's own table or Scenes tab", () => {
    expect(backPathOf(new URLSearchParams("back=/table"))).toBe("/table");
    expect(backPathOf(new URLSearchParams(`back=/scenes/${IDS.ambush}`))).toBe(`/scenes/${IDS.ambush}`);
    expect(backPathOf(new URLSearchParams("back=https://example.com"))).toBeNull();
    expect(backPathOf(new URLSearchParams("back=/settings"))).toBeNull();
  });
});
