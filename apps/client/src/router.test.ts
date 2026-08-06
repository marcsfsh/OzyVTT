import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  currentHref, discardTransient, gmTabForPath, isGmOnlyPath, isKnownPath, isPlayerOnlyPath, lastLocation, lastLocationForTab, layerOf, litGmTab, navigate, pathForGmTab, redirectForRetiredPath,
  popTransient, pushTransient, registerNavigationGuard, rememberLocation, replaceQuery, resumeTarget, useRoute, withQuery
} from "./router";
import { codexSectionOf } from "./codex/routes";
import { goTo } from "../test/route";

/**
 * D3's history layer, tested as a unit because every surface in the app now depends on it.
 *
 * The routing table is the app's address space written down once. Two whole classes of bug live here and
 * nowhere else: an address that resolves to the wrong surface, and an address that a *player* can reach
 * and shouldn't. Both are cheap to catch here and expensive to catch in a browser.
 */

afterEach(() => { goTo("/"); });

describe("The address table (D3)", () => {
  it("addresses the Viewer tab /viewer-controls, because the server reserves GET /viewer", () => {
    // Not cosmetic: `GET /viewer` is a 307 to the standalone TV viewer in prod AND dev, so the SPA can
    // never receive that address. A tab addressed /viewer would be a link out of the app.
    expect(pathForGmTab("viewer")).toBe("/viewer-controls");
    expect(gmTabForPath("/viewer-controls")).toBe("viewer");
    expect(gmTabForPath("/viewer")).toBeNull();
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
   * D29 — the layer addresses. `/characters/<id>` and `/builder` are not tabs; they are things OPEN on
   * top of a tab, and the tab that stays lit is the one whose kind of thing they are (the Roster, for
   * the GM). Without this the shell fell back to "table" and painted the Table under an open sheet —
   * the lit-tab lie one level up from where D1 killed it.
   */
  it("lights the Roster for the layers that belong to it, and nothing for a layer with no tab", () => {
    expect(litGmTab("/characters/a1")).toBe("roster");
    expect(litGmTab("/characters/a1/level")).toBe("roster");
    expect(litGmTab("/builder")).toBe("roster");
    expect(litGmTab("/scenes/maps")).toBe("scenes");
    expect(litGmTab("/replays/12")).toBe("replay");
    expect(litGmTab("/nonsense")).toBeNull();
  });

  it("reads each layer back off its address", () => {
    expect(layerOf("/characters/a1")).toEqual({ kind: "sheet", actorId: "a1" });
    expect(layerOf("/characters/a1/level")).toEqual({ kind: "level", actorId: "a1" });
    expect(layerOf("/builder")).toEqual({ kind: "builder" });
    expect(layerOf("/replays/12")).toEqual({ kind: "replay", archiveId: 12 });
    expect(layerOf("/scenes/maps")).toEqual({ kind: "maps" });
    expect(layerOf("/scenes/new")).toEqual({ kind: "scene-prep", sceneId: null });
    expect(layerOf("/scenes/s1")).toEqual({ kind: "scene-prep", sceneId: "s1" });
    // A tab's own address is not a layer, or every tab would render one.
    expect(layerOf("/table")).toBeNull();
    expect(layerOf("/replays")).toBeNull();
    expect(layerOf("/settings")).toBeNull();
  });

  /**
   * A retired address REDIRECTS rather than 404s: someone's bookmark from the previous build has to
   * land somewhere true. The three that moved are the three that are checked.
   */
  it("redirects the addresses that moved, and nothing else", () => {
    expect(redirectForRetiredPath("/encounter", new URLSearchParams())).toBe("/table");
    expect(redirectForRetiredPath("/setup", new URLSearchParams())).toBe("/settings");
    expect(redirectForRetiredPath("/scenes", new URLSearchParams("view=maps"))).toBe("/scenes/maps");
    expect(redirectForRetiredPath("/scenes", new URLSearchParams())).toBeNull();
    expect(redirectForRetiredPath("/table", new URLSearchParams())).toBeNull();
    expect(redirectForRetiredPath("/codex/pages", new URLSearchParams())).toBeNull();
  });
});

describe("Which addresses exist (D3)", () => {
  it("knows the codex sections, and rejects a section that does not exist", () => {
    expect(isKnownPath("/codex")).toBe(true);
    for (const section of ["pages", "atlas", "graph", "sessions", "quests", "journal", "calendar", "downtime", "audit", "backup", "settings"]) {
      expect(isKnownPath(`/codex/${section}`)).toBe(true);
    }
    expect(isKnownPath("/codex/relationships")).toBe(false);   // the retired name
    expect(isKnownPath("/codex/notebook")).toBe(false);        // the retired word
  });

  it("allows a record id only on the sections that HAVE records", () => {
    expect(isKnownPath("/codex/pages/p1")).toBe(true);
    expect(isKnownPath("/codex/sessions/s1")).toBe(true);
    expect(isKnownPath("/codex/quests/q1")).toBe(true);
    expect(isKnownPath("/codex/atlas/m1")).toBe(true);
    // The journal focuses an entry with `?entry=`, not with a path segment — one shape per record, and
    // the other shape must not quietly also work.
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
   * **"Does this address exist" and "what does it render" must be the same answer.**
   *
   * They were two implementations and they disagreed. `isKnownPath` counted segments; `codexSectionOf`
   * looked only at `segments[1]`. So `/codex/tags` was unknown to the router and "the tag view" to the
   * shell, and `/codex/journal/j1` was unknown to the router and "the journal" to the shell — each
   * rendering a live, working surface underneath an app-shell not-found card. `isKnownPath` now asks
   * `codexSectionOf`, and this pins the two together over the whole space.
   */
  it("answers 'exists' and 'renders' identically for every codex address shape", () => {
    const addresses = [
      "/codex", "/codex/pages", "/codex/pages/p1", "/codex/pages/p1/edit",
      "/codex/atlas", "/codex/atlas/m1", "/codex/sessions/s1", "/codex/quests/q1",
      "/codex/journal", "/codex/journal/j1", "/codex/calendar", "/codex/calendar/x",
      "/codex/downtime", "/codex/graph", "/codex/graph/g1",
      "/codex/audit", "/codex/backup", "/codex/settings", "/codex/settings/anything",
      "/codex/tags", "/codex/tags/dark-gift", "/codex/tags/a/b",
      "/codex/lore", "/codex/notebook", "/codex/relationships"
    ];
    for (const address of addresses) {
      const renders = codexSectionOf(address.split("/").filter(Boolean)) !== null;
      expect(isKnownPath(address), `${address} — router says ${isKnownPath(address)}, shell says ${renders}`).toBe(renders);
    }
  });
});

describe("Which addresses a player may reach (viewer safety, D3)", () => {
  /**
   * This list is the client half of invariant §1. The server is still the authority — a player token on
   * `GET /codex/settings` is refused there — but a player who *reaches* the address has already been told
   * the surface exists, and the not-found view is what keeps that from happening.
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
   * D29 shrinks the GM-only list. These five addresses are player-REACHABLE; whether a player may see
   * the thing at one of them is a data guard (their claim, the GM's share, the builder policy) that
   * renders the same not-found view on failure. The distinction matters: an address the router refuses
   * can never be a player's, while an address whose DATA refuses can be theirs tomorrow.
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
   * Ruling 61 — the API reference becomes a real address, and the head cannot decide who may have it:
   * `/settings` is shared (a player gets the Mine group) while `/settings/api` is the GM's alone. A
   * player asking for it gets the not-found view, indistinguishable from an unknown address.
   */
  it("keeps /settings shared and /settings/api GM-only", () => {
    expect(isGmOnlyPath("/settings")).toBe(false);
    expect(isGmOnlyPath("/settings/api")).toBe(true);
  });

  /**
   * D9's mirror: the one address a GM may not reach. The My Character tab is about the character you
   * claimed, and the GM claims nobody — so it is player-only rather than merely "not GM-only", which
   * is what every shared address is.
   */
  it("marks the My Character tab player-only, and nothing else", () => {
    expect(isPlayerOnlyPath("/me")).toBe(true);
    for (const path of ["/table", "/settings", "/settings/api", "/codex", "/replays", "/characters/a1", "/builder", "/"]) {
      expect(isPlayerOnlyPath(path), `${path} must not be player-only`).toBe(false);
    }
    // It is not GM-only either: the two answers are independent, and a player must not be refused it.
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
    expect(isKnownPath("/replays")).toBe(true);
    expect(isKnownPath("/replays/12")).toBe(true);
    // D9's tab and ruling 61's reference — the two addresses round 2 added.
    expect(isKnownPath("/me")).toBe(true);
    expect(isKnownPath("/settings/api")).toBe(true);
    expect(litGmTab("/settings/api")).toBe("settings");

    // Shapes that are NOT addresses: a sheet with no id, a third segment that is not the level flow,
    // a builder with a tail, and a replay id that is not an archive row id.
    expect(isKnownPath("/characters")).toBe(false);
    expect(isKnownPath("/characters/a1/edit")).toBe(false);
    expect(isKnownPath("/builder/new")).toBe(false);
    expect(isKnownPath("/replays/abc")).toBe(false);
    expect(isKnownPath("/settings/table")).toBe(false);
    // `/settings/api` is the ONE two-segment settings address; a length check would have opened all of them.
    expect(isKnownPath("/settings/api/keys")).toBe(false);
    expect(isKnownPath("/me/anything")).toBe(false);
    // The two addresses that retired stop existing, so a stale stored location self-heals.
    expect(isKnownPath("/encounter")).toBe(false);
    expect(isKnownPath("/setup")).toBe(false);
  });
});

describe("Navigating", () => {
  it("pushes a history entry and republishes the address", async () => {
    goTo("/codex");
    navigate("/codex/pages/p1");
    // `navigate` is fire-and-forget by design (guards may prompt), so the address lands on a microtask.
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

describe("Navigation guards (D6 — autosave off, draft dirty)", () => {
  /**
   * **Flush past the guard chain before asserting a non-navigation.**
   *
   * `mayLeave()` awaits each guard, so the `.then` that actually pushes lands three microtasks after
   * `navigate()` returns. A test that awaited a single `Promise.resolve()` resumed at microtask two —
   * unconditionally before the push, whether or not the guard's answer was honoured. Three assertions
   * were written that way and all three passed against a `navigate` mutated to ignore the veto. A
   * macrotask boundary is past every microtask the chain can queue, so the absence it asserts is real.
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
    // A vetoed navigation must not half-apply: the address stands, so the editor stays mounted with the
    // draft in it.
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
    off1(); off2();
  });

  it("unregisters cleanly, so an unmounted editor cannot veto anything", async () => {
    goTo("/codex/pages/p1");
    registerNavigationGuard(() => false)();
    navigate("/codex/journal");
    await vi.waitFor(() => expect(window.location.pathname).toBe("/codex/journal"));
  });
});

/**
 * **Back is a navigation.** The guards were wired into `navigate()` and nowhere else, so with autosave
 * off the browser Back button and the Android back gesture left a dirty editor with no prompt and the
 * draft gone — reproduced in Chromium at 1280x900 and at 375x780, the only way this app loses work.
 *
 * These use jsdom's real `history.back()`, not a synthetic `popstate`: the fiction cannot show that the
 * address was put back, because nothing moved it in the first place.
 */
describe("Back and forward are guarded too (D6, mobile parity)", () => {
  // Released in `afterEach`, not at the end of the body: a guard left registered by a FAILING assertion
  // silently vetoes the next test, which is how one real failure becomes three misleading ones.
  const registered: Array<() => void> = [];
  const guardWith = (answer: boolean) => {
    const guard = vi.fn(() => answer);
    registered.push(registerNavigationGuard(guard));
    return guard;
  };
  afterEach(() => { for (const release of registered.splice(0)) release(); });

  it("asks the guard before honouring a Back, and puts the address back when it says no", async () => {
    goTo("/codex/pages/p1");
    navigate("/codex/journal");
    await vi.waitFor(() => expect(window.location.pathname).toBe("/codex/journal"));

    const guard = guardWith(false);
    window.history.back();

    await vi.waitFor(() => expect(guard).toHaveBeenCalledTimes(1));
    // The pop has already moved the browser by the time we hear about it, so "vetoed" means "put back".
    await vi.waitFor(() => expect(window.location.pathname).toBe("/codex/journal"));
    // And it STAYS put back — a restore that is itself undone one task later is not a restore.
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
    // Not just the URL: the store has to publish, or the app keeps rendering the section it already left.
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
    // The point of the whole mechanism: the address is untouched.
    expect(window.location.pathname).toBe("/codex/pages");
  });

  it("withdraws its entry when the drawer is closed by its own X, so back still means back", () => {
    goTo("/codex/pages");
    const onPop = vi.fn();
    pushTransient("nav-drawer", onPop);
    popTransient("nav-drawer");
    // Withdrawn, so the next pop is a real navigation and the handler is not called a second time.
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    expect(onPop).not.toHaveBeenCalled();
  });

  it("ignores popTransient for a key that was never pushed", () => {
    goTo("/codex/pages");
    expect(() => popTransient("never-opened")).not.toThrow();
  });

  /**
   * `discardTransient` exists because `popTransient` cannot serve a caller that is about to navigate.
   * In a real browser `history.back()` is a task and `navigate`'s push lands on a microtask, so
   * closing-then-navigating pushed the destination and immediately went back off it — every tap in the
   * phone nav drawer went nowhere. This pins the contract that fixed it.
   */
  it("discardTransient forgets the entry WITHOUT going back, and says one was stranded", () => {
    goTo("/codex/pages");
    const onPop = vi.fn();
    pushTransient("nav-drawer", onPop);
    const at = window.location.pathname;

    expect(discardTransient("nav-drawer")).toBe(true);
    // No history movement: the caller is going to overwrite the entry itself.
    expect(window.location.pathname).toBe(at);
    // And the handler is gone, so a later pop is a real navigation rather than a phantom drawer close.
    window.dispatchEvent(new PopStateEvent("popstate", { state: null }));
    expect(onPop).not.toHaveBeenCalled();
  });

  it("discardTransient reports false when nothing was open, so the caller does not replace by mistake", () => {
    // The laptop case: no drawer, so the navigation must PUSH. Replacing here would silently eat the
    // entry the GM came from, which is the same class of bug in the other direction.
    goTo("/codex/pages");
    expect(discardTransient("nav-drawer")).toBe(false);
  });
});

describe("Resume-last-location (D2)", () => {
  beforeEach(() => { localStorage.clear(); });
  afterEach(() => { localStorage.clear(); });

  it("resumes only from the bare root — a deep link always wins", () => {
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
    // A stored `/codex/notebook` from before the recut must not strand the GM on the not-found view
    // every time they open the app.
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
   * **The half of D2 that the dominant case actually needs.**
   *
   * "The Codex reopens exactly where the GM last was (section + selected record)" was implemented only
   * for a cold sign-in landing on `/`. Every in-app return navigated to the bare tab head, so a GM
   * editing a page who tapped Encounter to check initiative and tapped Codex again landed on the
   * dashboard with nothing selected — the exact round trip intake 04 named as the cost of having no
   * router at all. Remembering per TAB is what makes the tab bar honour the decision.
   */
  describe("per tab", () => {
    it("returns to the record that was open in that tab, not to the tab's front door", () => {
      rememberLocation("gm", "/codex/pages/p1?tag=x");
      rememberLocation("gm", "/table");
      expect(lastLocationForTab("gm", "codex")).toBe("/codex/pages/p1?tag=x");
      expect(lastLocationForTab("gm", "table")).toBe("/table");
    });

    it("keeps the tabs apart — leaving one does not overwrite where you were in another", () => {
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
