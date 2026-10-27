import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  currentHref,
  gmTabForPath,
  isGmOnlyPath,
  isKnownPath,
  isPlayerOnlyPath,
  lastLocation,
  lastLocationForSection,
  lastLocationForTab,
  layerOf,
  litGmSection,
  litPlayerSection,
  PLAYER_LOG_PATH,
  PREP_PAGES,
  prepPageFor,
  litGmTab,
  litPlayerTab,
  navigate,
  pathForGmTab,
  redirectForRetiredPath,
  SOUND_BOARD_PATH,
  registerNavigationGuard,
  rememberLocation,
  replaceQuery,
  resumeTarget,
  useRoute,
  withQuery
} from "./router";
import { codexSectionOf } from "./codex/routes";
import { goTo } from "../test/route";

/**
 * The routing table is the app's address space. Two classes of bug live here: an address resolving
 * to the wrong surface, and an address a player can reach and shouldn't.
 */

afterEach(() => {
  goTo("/");
});

describe("The address table", () => {
  it("addresses the Viewer tab /viewer-controls, because the server reserves GET /viewer", () => {
    // `GET /viewer` is a 307 to the standalone TV viewer, so the SPA can never receive that address.
    expect(pathForGmTab("viewer")).toBe("/viewer-controls");
    expect(gmTabForPath("/viewer-controls")).toBe("viewer");
    expect(gmTabForPath("/viewer")).toBeNull();
  });

  it("gives the sound board its own address in the Shared screen tab, for the GM only", () => {
    expect(SOUND_BOARD_PATH).toBe("/viewer-controls/sound");
    expect(gmTabForPath(SOUND_BOARD_PATH)).toBe("viewer");
    expect(isKnownPath(SOUND_BOARD_PATH)).toBe(true);
    expect(isKnownPath("/viewer-controls/sound/extra")).toBe(false);
    expect(isKnownPath("/viewer-controls/music")).toBe(false);
    expect(isGmOnlyPath(SOUND_BOARD_PATH)).toBe(true);
  });

  it("round-trips every GM tab through its address", () => {
    for (const tab of ["scenes", "table", "roster", "codex", "compendium", "viewer", "replay", "settings"] as const) {
      expect(gmTabForPath(pathForGmTab(tab))).toBe(tab);
    }
  });

  it("reads the tab off the FIRST segment, so a deep link inside a tab still resolves to it", () => {
    expect(gmTabForPath("/codex/pages/abc")).toBe("codex");
  });

  /**
   * `/characters/<id>` and `/builder` are layers open over a tab, and the lit tab is the one they
   * belong to (the Roster, for the GM). Otherwise the shell would fall back to "table" under an
   * open sheet.
   */
  it("lights the Roster for the layers that belong to it, and nothing for a layer with no tab", () => {
    expect(litGmTab("/characters/a1")).toBe("roster");
    expect(litGmTab("/characters/a1/level")).toBe("roster");
    expect(litGmTab("/builder")).toBe("roster");
    expect(litGmTab("/scenes/maps")).toBe("scenes");
    expect(litGmTab("/replays/12")).toBe("replay");
    expect(litGmTab("/nonsense")).toBeNull();
    // A player's own sheet, its level page and the builder belong to My character.
    expect(litPlayerTab("/characters/a1")).toBe("mine");
    expect(litPlayerTab("/characters/a1/level")).toBe("mine");
    expect(litPlayerTab("/builder")).toBe("mine");
    expect(litPlayerTab("/me")).toBe("mine");
    expect(litPlayerTab("/codex/pages/p1")).toBe("codex");
    expect(litPlayerTab("/replays/12")).toBe("table");
    expect(litPlayerTab("/table")).toBe("table");
  });

  it("reads each layer back off its address", () => {
    expect(layerOf("/characters/a1")).toEqual({ kind: "sheet", actorId: "a1" });
    expect(layerOf("/characters/a1/level")).toEqual({ kind: "level", actorId: "a1" });
    expect(layerOf("/builder")).toEqual({ kind: "builder" });
    expect(layerOf("/replays/12")).toEqual({ kind: "replay", archiveId: 12 });
    expect(layerOf("/scenes/maps")).toEqual({ kind: "scenes", view: { view: "maps" } });
    expect(layerOf("/scenes/list")).toEqual({ kind: "scenes", view: { view: "scenes" } });
    expect(layerOf("/scenes/new")).toEqual({ kind: "scenes", view: { view: "scene", sceneId: null, step: "map" } });
    expect(layerOf("/scenes/s1")).toEqual({ kind: "scenes", view: { view: "scene", sceneId: "s1", step: null } });
    expect(layerOf("/scenes/s1", new URLSearchParams("step=light"))).toEqual({
      kind: "scenes",
      view: { view: "scene", sceneId: "s1", step: "light" }
    });
    expect(layerOf("/scenes/maps/m1")).toEqual({ kind: "scenes", view: { view: "map", mapId: "m1", step: null } });
    expect(layerOf("/scenes/maps/new")).toEqual({
      kind: "scenes",
      view: { view: "map", mapId: null, step: "upload" }
    });
    // A tab's own address is not a layer, or every tab would render one.
    expect(layerOf("/table")).toBeNull();
    expect(layerOf("/replays")).toBeNull();
    expect(layerOf("/settings")).toBeNull();
  });

  /**
   * A retired address redirects (no 404), so old bookmarks land somewhere true.
   */
  it("redirects the addresses that moved, and nothing else", () => {
    expect(redirectForRetiredPath("/encounter", new URLSearchParams())).toBe("/table");
    expect(redirectForRetiredPath("/setup", new URLSearchParams())).toBe("/settings");
    expect(redirectForRetiredPath("/homebrew", new URLSearchParams())).toBe("/compendium");
    expect(redirectForRetiredPath("/scenes", new URLSearchParams("view=maps"))).toBe("/scenes/maps");
    // The map library's one-map address lands on that map's grid step, still knowing to go back to the table.
    expect(redirectForRetiredPath("/scenes/maps", new URLSearchParams("map=m1&from=table"))).toBe(
      "/scenes/maps/m1?step=grid&back=%2Ftable"
    );
    expect(redirectForRetiredPath("/scenes/maps", new URLSearchParams())).toBeNull();
    expect(redirectForRetiredPath("/scenes", new URLSearchParams())).toBeNull();
    expect(redirectForRetiredPath("/table", new URLSearchParams())).toBeNull();
    expect(redirectForRetiredPath("/codex/pages", new URLSearchParams())).toBeNull();
  });
});

describe("Which addresses exist", () => {
  it("knows the codex sections, and rejects a section that does not exist", () => {
    expect(isKnownPath("/codex")).toBe(true);
    for (const section of [
      "search",
      "pages",
      "atlas",
      "story",
      "timeline",
      "sessions",
      "quests",
      "relationships",
      "templates",
      "backup",
      "settings"
    ]) {
      expect(isKnownPath(`/codex/${section}`)).toBe(true);
    }
    expect(isKnownPath("/codex/notebook")).toBe(false); // the retired word
  });

  it("still answers the addresses from before the remaster, which the shells redirect", () => {
    for (const section of ["graph", "journal", "calendar", "downtime", "audit"]) {
      expect(isKnownPath(`/codex/${section}`)).toBe(true);
    }
  });

  it("allows a record id only on the sections that HAVE records", () => {
    expect(isKnownPath("/codex/pages/p1")).toBe(true);
    expect(isKnownPath("/codex/sessions/s1")).toBe(true);
    expect(isKnownPath("/codex/quests/q1")).toBe(true);
    expect(isKnownPath("/codex/atlas/m1")).toBe(true);
    expect(isKnownPath("/codex/templates/t1")).toBe(true);
    // The chronicle focuses an entry with `?entry=` and no path segment; the other shape must not work.
    expect(isKnownPath("/codex/story/j1")).toBe(false);
    expect(isKnownPath("/codex/search/x")).toBe(false);
    expect(isKnownPath("/codex/settings/anything")).toBe(false);
  });

  it("requires a tag address to actually name a tag", () => {
    expect(isKnownPath("/codex/tags/dark-gift")).toBe(true);
    expect(isKnownPath("/codex/tags")).toBe(false);
  });

  it("does not accept a fourth segment anywhere", () => {
    expect(isKnownPath("/codex/pages/p1/edit")).toBe(false);
  });

  /**
   * "Does this address exist" and "what does it render" must be the same answer: `isKnownPath` asks
   * `codexSectionOf`, and this pins them together over the whole codex space.
   */
  it("answers 'exists' and 'renders' identically for every codex address shape", () => {
    const addresses = [
      "/codex",
      "/codex/pages",
      "/codex/pages/p1",
      "/codex/pages/p1/edit",
      "/codex/atlas",
      "/codex/atlas/m1",
      "/codex/sessions/s1",
      "/codex/quests/q1",
      "/codex/journal",
      "/codex/journal/j1",
      "/codex/calendar",
      "/codex/calendar/x",
      "/codex/downtime",
      "/codex/graph",
      "/codex/graph/g1",
      "/codex/audit",
      "/codex/search",
      "/codex/search/x",
      "/codex/story",
      "/codex/story/x",
      "/codex/timeline",
      "/codex/templates",
      "/codex/templates/t1",
      "/codex/backup",
      "/codex/settings",
      "/codex/settings/anything",
      "/codex/tags",
      "/codex/tags/dark-gift",
      "/codex/tags/a/b",
      "/codex/lore",
      "/codex/notebook",
      "/codex/relationships"
    ];
    for (const address of addresses) {
      const renders = codexSectionOf(address.split("/").filter(Boolean)) !== null;
      expect(isKnownPath(address), `${address}: router says ${isKnownPath(address)}, shell says ${renders}`).toBe(
        renders
      );
    }
  });
});

describe("Which addresses a player may reach (viewer safety)", () => {
  /**
   * The client half of the GM-only rule. The server refuses a player token anyway, but a player who
   * reaches the address has already learned the surface exists; the not-found view prevents that.
   */
  it("marks the GM menu's codex addresses and the retired audit GM-only, and only those", () => {
    expect(isGmOnlyPath("/codex/audit")).toBe(true);
    expect(isGmOnlyPath("/codex/templates")).toBe(true);
    expect(isGmOnlyPath("/codex/templates/t1")).toBe(true);
    expect(isGmOnlyPath("/codex/backup")).toBe(true);
    expect(isGmOnlyPath("/codex/settings")).toBe(true);
    for (const section of [
      "search",
      "pages",
      "atlas",
      "story",
      "timeline",
      "relationships",
      "sessions",
      "quests",
      "graph",
      "journal",
      "calendar",
      "downtime"
    ]) {
      expect(isGmOnlyPath(`/codex/${section}`)).toBe(false);
    }
    expect(isGmOnlyPath("/codex")).toBe(false);
  });

  it("keeps the GM's own tabs GM-only", () => {
    expect(isGmOnlyPath("/scenes")).toBe(true);
    expect(isGmOnlyPath("/scenes/maps")).toBe(true);
    expect(isGmOnlyPath("/roster")).toBe(true);
    expect(isGmOnlyPath("/compendium")).toBe(true);
    expect(isGmOnlyPath("/compendium/spells/hb-brine-burst-a1b2c3")).toBe(true);
    expect(isGmOnlyPath("/viewer-controls")).toBe(true);
    expect(isGmOnlyPath("/codex")).toBe(false);
  });

  /**
   * These addresses are player-reachable; whether a player may see the thing there is a data guard
   * (their claim, the GM's share, the builder policy) that renders the same not-found view on failure.
   */
  it("lets a player reach the table, settings, replays, their sheet and the builder", () => {
    expect(isGmOnlyPath("/table")).toBe(false);
    expect(isGmOnlyPath("/settings")).toBe(false);
    expect(isGmOnlyPath("/replays")).toBe(false);
    expect(isGmOnlyPath("/replays/12")).toBe(false);
    expect(isGmOnlyPath("/characters/a1")).toBe(false);
    expect(isGmOnlyPath("/characters/a1/level")).toBe(false);
    expect(isGmOnlyPath("/builder")).toBe(false);
  });

  /**
   * `/settings` and its Device section are shared (a player gets Device alone) while every other section is
   * GM-only; a player asking for one gets the not-found view.
   */
  it("keeps /settings and its Device section shared and the other sections GM-only", () => {
    expect(isGmOnlyPath("/settings")).toBe(false);
    expect(isGmOnlyPath("/settings/device")).toBe(false);
    for (const section of ["players", "fights", "characters", "access", "api"])
      expect(isGmOnlyPath(`/settings/${section}`), section).toBe(true);
    expect(isGmOnlyPath("/settings/api")).toBe(true);
    expect(isGmOnlyPath("/settings/api/listIntegrationCredentials")).toBe(true);
  });

  /**
   * The one address a GM may not reach: My character is about the character you claimed, and the GM
   * claims nobody.
   */
  it("marks the My Character tab player-only, and nothing else", () => {
    expect(isPlayerOnlyPath("/me")).toBe(true);
    for (const path of [
      "/table",
      "/settings",
      "/settings/api",
      "/codex",
      "/replays",
      "/characters/a1",
      "/builder",
      "/"
    ]) {
      expect(isPlayerOnlyPath(path), `${path} must not be player-only`).toBe(false);
    }
    // Not GM-only either: the two answers are independent.
    expect(isGmOnlyPath("/me")).toBe(false);
  });
});

describe("The addresses D29 added", () => {
  it("answers the new heads, and only in the shapes they take", () => {
    expect(isKnownPath("/table")).toBe(true);
    expect(isKnownPath("/settings")).toBe(true);
    expect(isKnownPath("/builder")).toBe(true);
    expect(isKnownPath("/characters/a1")).toBe(true);
    expect(isKnownPath("/characters/a1/level")).toBe(true);
    expect(isKnownPath("/scenes")).toBe(true);
    expect(isKnownPath("/scenes/new")).toBe(true);
    expect(isKnownPath("/scenes/maps")).toBe(true);
    expect(isKnownPath("/scenes/s1")).toBe(true);
    expect(isKnownPath("/scenes/list")).toBe(true);
    expect(isKnownPath("/scenes/maps/new")).toBe(true);
    expect(isKnownPath("/scenes/maps/m1")).toBe(true);
    expect(isKnownPath("/scenes/s1/more")).toBe(false);
    expect(isKnownPath("/scenes/maps/m1/more")).toBe(false);
    expect(isKnownPath("/replays")).toBe(true);
    expect(isKnownPath("/replays/12")).toBe(true);
    expect(isKnownPath("/me")).toBe(true);
    expect(isKnownPath("/settings/api")).toBe(true);
    expect(litGmTab("/settings/api")).toBe("settings");

    // Not addresses: a sheet with no id, a third segment other than the level flow, a builder with a
    // tail, and a replay id that is not an archive row id.
    expect(isKnownPath("/characters")).toBe(false);
    expect(isKnownPath("/characters/a1/edit")).toBe(false);
    expect(isKnownPath("/builder/new")).toBe(false);
    expect(isKnownPath("/replays/abc")).toBe(false);
    expect(isKnownPath("/settings/table")).toBe(false);
    // A section by its id, and an operation of the API reference by its operation id; a length check would open
    // every shape.
    expect(isKnownPath("/settings/fights")).toBe(true);
    expect(isKnownPath("/settings/api/listIntegrationCredentials")).toBe(true);
    expect(isKnownPath("/settings/fights/rules")).toBe(false);
    expect(isKnownPath("/settings/api/keys/1")).toBe(false);
    expect(isKnownPath("/settings/api/%20")).toBe(false);
    expect(isKnownPath("/me/anything")).toBe(false);
    // The Compendium's views, and each record at its kind's address.
    expect(isKnownPath("/compendium")).toBe(true);
    expect(isKnownPath("/compendium/tables/spells")).toBe(true);
    expect(isKnownPath("/compendium/sources")).toBe(true);
    expect(isKnownPath("/compendium/spells/hb-brine-burst-a1b2c3")).toBe(true);
    expect(isKnownPath("/compendium/tables/dragons")).toBe(false);
    expect(isKnownPath("/compendium/spells/fireball/extra")).toBe(false);
    // Retired addresses no longer exist, so a stale stored location self-heals.
    expect(isKnownPath("/encounter")).toBe(false);
    expect(isKnownPath("/setup")).toBe(false);
    expect(isKnownPath("/homebrew")).toBe(false);
  });
});

describe("Navigating", () => {
  it("pushes a history entry and republishes the address", async () => {
    goTo("/codex");
    navigate("/codex/pages/p1");
    // `navigate` is fire-and-forget (guards may prompt), so the address lands on a microtask.
    await vi.waitFor(() => expect(window.location.pathname).toBe("/codex/pages/p1"));
  });

  it("is a no-op for the address already open, so a re-tap cannot stack history", () => {
    goTo("/codex/pages?tag=x");
    const before = window.history.length;
    navigate("/codex/pages?tag=x");
    expect(window.history.length).toBe(before);
  });

  it("carries the query in `currentHref`, because a prepared destination lives there", () => {
    goTo("/codex/atlas/m1?pin=k9");
    expect(currentHref()).toBe("/codex/atlas/m1?pin=k9");
  });

  it("clears a landed-on parameter WITHOUT a history entry (the ?pin= handshake)", () => {
    goTo("/codex/atlas/m1?pin=k9");
    const before = window.history.length;
    replaceQuery((query) => query.delete("pin"));
    expect(currentHref()).toBe("/codex/atlas/m1");
    expect(window.history.length).toBe(before);
  });

  it("drops empty parameters when building an address, so no URL ever carries `?tag=`", () => {
    expect(withQuery("/codex/atlas", { pin: null })).toBe("/codex/atlas");
    expect(withQuery("/codex/atlas", { pin: "" })).toBe("/codex/atlas");
    expect(withQuery("/codex/atlas", { pin: "k1" })).toBe("/codex/atlas?pin=k1");
  });
});

describe("Navigation guards (D6: autosave off, draft dirty)", () => {
  /**
   * Flush past the guard chain before asserting a non-navigation: `mayLeave()` awaits each guard, so
   * the push lands several microtasks after `navigate()` returns. A macrotask boundary is past all of
   * them.
   */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("lets a navigation through when the guard says yes", async () => {
    goTo("/codex/pages/p1");
    const unregister = registerNavigationGuard(() => true);
    navigate("/codex/journal");
    await vi.waitFor(() => expect(window.location.pathname).toBe("/codex/journal"));
    unregister();
  });

  it("leaves the URL exactly as it was when the guard says no", async () => {
    goTo("/codex/pages/p1");
    const unregister = registerNavigationGuard(() => false);
    navigate("/codex/journal");
    // A vetoed navigation must not half-apply: the address stands, so the editor keeps its draft.
    await settle();
    expect(window.location.pathname).toBe("/codex/pages/p1");
    unregister();
  });

  it("stops at the FIRST refusal rather than prompting twice", async () => {
    goTo("/codex/pages/p1");
    const second = vi.fn(() => true);
    const off1 = registerNavigationGuard(() => false);
    const off2 = registerNavigationGuard(second);
    navigate("/codex/journal");
    await settle();
    expect(second).not.toHaveBeenCalled();
    off1();
    off2();
  });

  it("unregisters cleanly, so an unmounted editor cannot veto anything", async () => {
    goTo("/codex/pages/p1");
    registerNavigationGuard(() => false)();
    navigate("/codex/journal");
    await vi.waitFor(() => expect(window.location.pathname).toBe("/codex/journal"));
  });
});

/**
 * Back is a navigation too: without a guard on popstate, the browser Back button or the Android
 * back gesture would leave a dirty editor with no prompt. Uses jsdom's real `history.back()`, so the
 * address is really put back.
 */
describe("Back and forward are guarded too (mobile parity)", () => {
  // Released in `afterEach`: a guard left registered by a failing assertion would veto the next test.
  const registered: Array<() => void> = [];
  const guardWith = (answer: boolean) => {
    const guard = vi.fn(() => answer);
    registered.push(registerNavigationGuard(guard));
    return guard;
  };
  afterEach(() => {
    for (const release of registered.splice(0)) release();
  });

  it("asks the guard before honouring a Back, and puts the address back when it says no", async () => {
    goTo("/codex/pages/p1");
    navigate("/codex/journal");
    await vi.waitFor(() => expect(window.location.pathname).toBe("/codex/journal"));

    const guard = guardWith(false);
    window.history.back();

    await vi.waitFor(() => expect(guard).toHaveBeenCalledTimes(1));
    // The pop has already moved the browser, so "vetoed" means "put back".
    await vi.waitFor(() => expect(window.location.pathname).toBe("/codex/journal"));
    // And it stays put back.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(window.location.pathname).toBe("/codex/journal");
  });

  it("lets a Back through when the guard says yes, and republishes the address it landed on", async () => {
    goTo("/codex/pages/p1");
    navigate("/codex/journal");
    await vi.waitFor(() => expect(window.location.pathname).toBe("/codex/journal"));

    const route = renderHook(() => useRoute());
    guardWith(true);
    window.history.back();

    await vi.waitFor(() => expect(window.location.pathname).toBe("/codex/pages/p1"));
    // The store must publish too, or the app keeps rendering the section it left.
    await vi.waitFor(() => expect(route.result.current.path).toBe("/codex/pages/p1"));
    route.unmount();
  });

  it("does not consult a guard that is not there, so a plain Back is not slowed by the check", async () => {
    goTo("/codex/pages/p1");
    navigate("/codex/journal");
    await vi.waitFor(() => expect(window.location.pathname).toBe("/codex/journal"));
    window.history.back();
    await vi.waitFor(() => expect(window.location.pathname).toBe("/codex/pages/p1"));
  });
});

describe("Resume-last-location", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("resumes only from the bare root: a deep link always wins", () => {
    rememberLocation("gm", "/codex/quests");
    expect(resumeTarget("gm", "/codex/pages/p1")).toBeNull();
    expect(resumeTarget("gm", "/")).toBe("/codex/quests");
  });

  it("keeps the GM's and the player's last location apart", () => {
    rememberLocation("gm", "/codex/audit");
    rememberLocation("player", "/codex/journal");
    expect(lastLocation("gm")).toBe("/codex/audit");
    expect(resumeTarget("player", "/")).toBe("/codex/journal");
  });

  it("falls back per role when nothing was stored", () => {
    expect(resumeTarget("gm", "/")).toBe("/table");
    expect(resumeTarget("player", "/")).toBe("/table");
  });

  it("refuses to resume onto an address that no longer exists", () => {
    // A stored retired address must not strand the GM on the not-found view.
    rememberLocation("gm", "/codex/notebook");
    expect(resumeTarget("gm", "/")).toBe("/table");
  });

  it("resumes an address WITH its query, and validates only the path half", () => {
    rememberLocation("gm", "/codex/atlas/m1?pin=k9");
    expect(resumeTarget("gm", "/")).toBe("/codex/atlas/m1?pin=k9");
  });

  it("never resumes to `/`, which would be a loop", () => {
    rememberLocation("gm", "/");
    expect(resumeTarget("gm", "/")).toBe("/table");
  });

  /**
   * Locations are remembered per tab, so leaving the Codex for the Table and coming back returns to
   * the record that was open, where the tab's front door would otherwise be.
   */
  describe("per tab", () => {
    it("returns to the record that was open in that tab, not to the tab's front door", () => {
      rememberLocation("gm", "/codex/pages/p1?tag=x");
      rememberLocation("gm", "/table");
      expect(lastLocationForTab("gm", "codex")).toBe("/codex/pages/p1?tag=x");
      expect(lastLocationForTab("gm", "table")).toBe("/table");
    });

    it("keeps the tabs apart: leaving one does not overwrite where you were in another", () => {
      rememberLocation("gm", "/codex/quests/q1");
      rememberLocation("gm", "/scenes?view=maps");
      expect(lastLocationForTab("gm", "codex")).toBe("/codex/quests/q1");
      expect(lastLocationForTab("gm", "scenes")).toBe("/scenes?view=maps");
    });

    it("has nothing to say about a tab never visited", () => {
      expect(lastLocationForTab("gm", "compendium")).toBeNull();
    });

    it("refuses an address that no longer exists, so a deleted record cannot strand a tab", () => {
      rememberLocation("gm", "/codex/notebook");
      expect(lastLocationForTab("gm", "codex")).toBeNull();
    });

    it("never returns a GM-only address to a player, the same rule resume follows", () => {
      rememberLocation("player", "/codex/audit");
      expect(lastLocationForTab("player", "codex")).toBeNull();
      rememberLocation("player", "/codex/journal?entry=e1");
      expect(lastLocationForTab("player", "codex")).toBe("/codex/journal?entry=e1");
    });

    it("keeps the GM's and the player's per-tab memory apart", () => {
      rememberLocation("gm", "/codex/settings");
      rememberLocation("player", "/codex/quests/q9");
      expect(lastLocationForTab("gm", "codex")).toBe("/codex/settings");
      expect(lastLocationForTab("player", "codex")).toBe("/codex/quests/q9");
    });
  });
});

describe("The sections the redesign groups addresses under", () => {
  it("lights Play for the table, Prep for each of its pages, and no section for the utilities", () => {
    expect(litGmSection("/table")).toBe("play");
    for (const path of ["/scenes", "/scenes/list", "/scenes/new", "/roster", "/characters/a1", "/builder"])
      expect(litGmSection(path), path).toBe("prep");
    for (const path of ["/scenes/maps", "/scenes/maps/m1", "/prep/tokens", "/viewer-controls/sound", "/replays/3"])
      expect(litGmSection(path), path).toBe("prep");
    expect(litGmSection("/codex/pages/abc")).toBe("codex");
    expect(litGmSection("/compendium/monsters")).toBe("compendium");
    expect(litGmSection("/viewer-controls")).toBeNull();
    expect(litGmSection("/settings/device")).toBeNull();
  });

  it("names each Prep page for its address, keeping every existing address", () => {
    expect(PREP_PAGES.map((page) => page.label)).toEqual(["Scenes", "Party", "Maps", "Tokens", "Sound", "Replays"]);
    expect(prepPageFor("/scenes/s1?step=tokens")).toBe("scenes");
    expect(prepPageFor("/scenes/maps/new")).toBe("maps");
    expect(prepPageFor("/characters/a1/level")).toBe("party");
    expect(prepPageFor("/viewer-controls")).toBeNull();
    expect(prepPageFor("/table")).toBeNull();
  });

  it("adds /prep/tokens for the GM alone, and sends a bare /prep to Scenes", () => {
    expect(isKnownPath("/prep/tokens")).toBe(true);
    expect(isKnownPath("/prep/other")).toBe(false);
    expect(gmTabForPath("/prep/tokens")).toBe("tokens");
    expect(isGmOnlyPath("/prep/tokens")).toBe(true);
    expect(isGmOnlyPath("/prep")).toBe(true);
    expect(redirectForRetiredPath("/prep", new URLSearchParams())).toBe("/scenes");
  });

  it("keeps the old redirects", () => {
    expect(redirectForRetiredPath("/scenes", new URLSearchParams("view=maps"))).toBe("/scenes/maps");
    expect(redirectForRetiredPath("/encounter", new URLSearchParams())).toBe("/table");
    expect(redirectForRetiredPath("/homebrew", new URLSearchParams())).toBe("/compendium");
  });

  it("lights a player's Log for the table's log address, and the Table otherwise", () => {
    const at = (href: string) => {
      const [path, search] = href.split("?");
      return { path: path!, query: new URLSearchParams(search ?? "") };
    };
    expect(PLAYER_LOG_PATH).toBe("/table?panel=log");
    expect(litPlayerSection(at(PLAYER_LOG_PATH))).toBe("log");
    expect(litPlayerSection(at("/table"))).toBe("table");
    expect(litPlayerSection(at("/me"))).toBe("sheet");
    expect(litPlayerSection(at("/replays"))).toBe("table");
    expect(litPlayerSection(at("/settings"))).toBeNull();
  });

  it("returns to where the GM was in a section, never to a page outside it", () => {
    localStorage.clear();
    expect(lastLocationForSection("prep")).toBeNull();
    rememberLocation("gm", "/scenes/maps?map=m1");
    expect(lastLocationForSection("prep")).toBe("/scenes/maps?map=m1");
    rememberLocation("gm", "/prep/tokens");
    expect(lastLocationForSection("prep")).toBe("/prep/tokens");
    localStorage.setItem("vtt.gm-last-location.section.prep", "/codex");
    expect(lastLocationForSection("prep")).toBeNull();
  });
});
