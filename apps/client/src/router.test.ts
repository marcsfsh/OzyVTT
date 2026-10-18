import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  currentHref,
  discardTransient,
  gmTabForPath,
  isGmOnlyPath,
  isKnownPath,
  isPlayerOnlyPath,
  lastLocation,
  lastLocationForTab,
  layerOf,
  litGmTab,
  litPlayerTab,
  navigate,
  pathForGmTab,
  redirectForRetiredPath,
  SOUND_BOARD_PATH,
  popTransient,
  pushTransient,
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
    for (const tab of ["scenes", "table", "roster", "codex", "homebrew", "viewer", "replay", "settings"] as const) {
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
      "pages",
      "atlas",
      "graph",
      "sessions",
      "quests",
      "journal",
      "calendar",
      "downtime",
      "audit",
      "backup",
      "settings"
    ]) {
      expect(isKnownPath(`/codex/${section}`)).toBe(true);
    }
    expect(isKnownPath("/codex/relationships")).toBe(false); // the retired name
    expect(isKnownPath("/codex/notebook")).toBe(false); // the retired word
  });

  it("allows a record id only on the sections that HAVE records", () => {
    expect(isKnownPath("/codex/pages/p1")).toBe(true);
    expect(isKnownPath("/codex/sessions/s1")).toBe(true);
    expect(isKnownPath("/codex/quests/q1")).toBe(true);
    expect(isKnownPath("/codex/atlas/m1")).toBe(true);
    // The journal focuses an entry with `?entry=` and no path segment; the other shape must not work.
    expect(isKnownPath("/codex/journal/j1")).toBe(false);
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
  it("marks the three GM-only codex addresses, and only those three", () => {
    expect(isGmOnlyPath("/codex/audit")).toBe(true);
    expect(isGmOnlyPath("/codex/backup")).toBe(true);
    expect(isGmOnlyPath("/codex/settings")).toBe(true);
    for (const section of ["pages", "atlas", "graph", "sessions", "quests", "journal", "calendar", "downtime"]) {
      expect(isGmOnlyPath(`/codex/${section}`)).toBe(false);
    }
    expect(isGmOnlyPath("/codex")).toBe(false);
  });

  it("keeps the GM's own tabs GM-only", () => {
    expect(isGmOnlyPath("/scenes")).toBe(true);
    expect(isGmOnlyPath("/scenes/maps")).toBe(true);
    expect(isGmOnlyPath("/roster")).toBe(true);
    expect(isGmOnlyPath("/homebrew")).toBe(true);
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
   * `/settings` is shared (a player gets the Mine group) while `/settings/api` is GM-only; a player
   * asking for it gets the not-found view.
   */
  it("keeps /settings shared and /settings/api GM-only", () => {
    expect(isGmOnlyPath("/settings")).toBe(false);
    expect(isGmOnlyPath("/settings/api")).toBe(true);
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
    // `/settings/api` is the one two-segment settings address; a length check would open all of them.
    expect(isKnownPath("/settings/api/keys")).toBe(false);
    expect(isKnownPath("/me/anything")).toBe(false);
    // Retired addresses no longer exist, so a stale stored location self-heals.
    expect(isKnownPath("/encounter")).toBe(false);
    expect(isKnownPath("/setup")).toBe(false);
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

describe("Transient history (the phone nav drawer)", () => {
  it("closes the drawer on back instead of leaving the section", () => {
    goTo("/codex/pages");
    const onPop = vi.fn();
    pushTransient("nav-drawer", onPop);
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    expect(onPop).toHaveBeenCalledTimes(1);
    // The address is untouched.
    expect(window.location.pathname).toBe("/codex/pages");
  });

  it("withdraws its entry when the drawer is closed by its own X, so back still means back", () => {
    goTo("/codex/pages");
    const onPop = vi.fn();
    pushTransient("nav-drawer", onPop);
    popTransient("nav-drawer");
    // Withdrawn, so the next pop is a real navigation and the handler is not called again.
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    expect(onPop).not.toHaveBeenCalled();
  });

  it("ignores popTransient for a key that was never pushed", () => {
    goTo("/codex/pages");
    expect(() => popTransient("never-opened")).not.toThrow();
  });

  /**
   * `discardTransient` exists because `popTransient` cannot serve a caller about to navigate: in a
   * browser `history.back()` is a task and `navigate`'s push is a microtask, so closing then
   * navigating would push the destination and immediately go back off it.
   */
  it("discardTransient forgets the entry WITHOUT going back, and says one was stranded", () => {
    goTo("/codex/pages");
    const onPop = vi.fn();
    pushTransient("nav-drawer", onPop);
    const at = window.location.pathname;

    expect(discardTransient("nav-drawer")).toBe(true);
    // No history movement: the caller overwrites the entry itself.
    expect(window.location.pathname).toBe(at);
    // The handler is gone, so a later pop is a real navigation.
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    expect(onPop).not.toHaveBeenCalled();
  });

  it("discardTransient reports false when nothing was open, so the caller does not replace by mistake", () => {
    // No drawer, so the navigation must push; replacing would eat the entry the GM came from.
    goTo("/codex/pages");
    expect(discardTransient("nav-drawer")).toBe(false);
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
      expect(lastLocationForTab("gm", "homebrew")).toBeNull();
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
