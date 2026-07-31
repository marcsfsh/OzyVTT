import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  currentHref, discardTransient, gmTabForPath, isGmOnlyPath, isKnownPath, lastLocation, navigate, pathForGmTab,
  popTransient, pushTransient, registerNavigationGuard, rememberLocation, replaceQuery, resumeTarget, withQuery
} from "./router";
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
    for (const tab of ["scenes", "table", "roster", "codex", "homebrew", "viewer", "replay", "setup"] as const) {
      expect(gmTabForPath(pathForGmTab(tab))).toBe(tab);
    }
  });

  it("reads the tab off the FIRST segment, so a deep link inside a tab still resolves to it", () => {
    expect(gmTabForPath("/codex/pages/abc")).toBe("codex");
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

  it("marks every non-Codex GM tab GM-only — the Codex is the one tab a player shares", () => {
    expect(isGmOnlyPath("/encounter")).toBe(true);
    expect(isGmOnlyPath("/scenes")).toBe(true);
    expect(isGmOnlyPath("/roster")).toBe(true);
    expect(isGmOnlyPath("/viewer-controls")).toBe(true);
    expect(isGmOnlyPath("/codex")).toBe(false);
    expect(isGmOnlyPath("/table")).toBe(false);
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
    // draft in it. Awaiting a tick first, because the guard is allowed to be async.
    await Promise.resolve();
    expect(window.location.pathname).toBe("/codex/pages/p1");
    unregister();
  });

  it("stops at the FIRST refusal rather than prompting twice", async () => {
    goTo("/codex/pages/p1");
    const second = vi.fn(() => true);
    const off1 = registerNavigationGuard(() => false);
    const off2 = registerNavigationGuard(second);
    navigate("/codex/journal");
    await Promise.resolve();
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
    expect(resumeTarget("gm", "/")).toBe("/encounter");
    expect(resumeTarget("player", "/")).toBe("/table");
  });

  it("refuses to resume onto an address that no longer exists", () => {
    // A stored `/codex/notebook` from before the recut must not strand the GM on the not-found view
    // every time they open the app.
    rememberLocation("gm", "/codex/notebook");
    expect(resumeTarget("gm", "/")).toBe("/encounter");
  });

  it("resumes an address WITH its query, and validates only the path half", () => {
    rememberLocation("gm", "/codex/atlas/m1?pin=k9");
    expect(resumeTarget("gm", "/")).toBe("/codex/atlas/m1?pin=k9");
  });

  it("never resumes to `/`, which would be a loop", () => {
    rememberLocation("gm", "/");
    expect(resumeTarget("gm", "/")).toBe("/encounter");
  });
});
