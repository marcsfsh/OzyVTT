/**
 * The no-scroll audit — the reproducible form of §7's law (design-language.md): THE PAGE
 * NEVER SCROLLS. It drives the app's route × role table at eight viewports — three laptop
 * shapes and five phone ones, portrait AND LANDSCAPE — and FAILS (exit non-zero) on any
 * route whose document scrolls, either axis, or that it could not measure at all.
 *
 * IT ALSO MEASURES THE PANE, NOT ONLY THE DOCUMENT, and it docks. Both are here because
 * the document probe alone missed three CRITICAL defects and one regression that shipped
 * past it:
 *  - The document check is weak evidence and this repo's own history proves it: a phone
 *    `/table` whose `.table-layout` scrolled several THOUSAND pixels inside an 800px pane
 *    passed it green, because the overflow lived inside the pane. So `/table` now also
 *    asserts `.table-layout.scrollHeight - clientHeight` against its own overflow budget
 *    and HIT-TESTS the dock's tab bar (and a Claim button when the picker is up):
 *    `document.elementFromPoint` at the control's own centre must return that control.
 *    A 0px dock body under a tab bar that responds to nothing is invisible to any
 *    height-only probe — it was measured at 0 in every landscape phone cell.
 *  - It never docked, because `dockPosition` defaults to `sidebar`. The docked arm at ≥980
 *    is a different composition, and it scrolled the PAGE by 114-429px on every laptop
 *    width. Two cells now seed `localStorage['vtt.dock-position']` before load.
 *  - It had no landscape and no short pane. A phone in landscape (or portrait with the
 *    soft keyboard up) is where the frame's floors stop fitting, and it is the state the
 *    whole table went unusable in.
 *
 * Same terms as `tap-audit.mjs`: it needs a browser and a running dev server, so it is a
 * scripted manual audit, deliberately NOT wired into `npm test`. `playwright-core` is
 * intentionally not a repo dependency — install it outside the tree or point
 * PLAYWRIGHT_CORE at any install:
 *
 *   npm i --no-save playwright-core     # ...or set PLAYWRIGHT_CORE
 *   npm run dev                         # in another shell
 *   node scripts/no-scroll-audit.mjs
 *
 * WHAT IT COVERS. Three passes: the landing (`/`, unauthenticated) and the standalone
 * shared-screen entry (`/viewer.html`, its pairing screen); a real GM session (login
 * borrowed from tap-audit — the GM token is memory-only, so navigation is pushState, never
 * a hard goto); and a real player session (Join as Player). Parameterized routes
 * (`/replays/:id`, `/characters/:id`, `/characters/:id/level`) resolve their ids from the
 * live app — the first Watch button, the first player-character token on the map — and a
 * route that cannot resolve is reported NOT MEASURED and fails the run, never skipped
 * silently.
 *
 * IT SEEDS AN IN-COMBAT TABLE. The census measured `/table` in combat — an empty table
 * under-tests it — so the GM pass starts a fight if none is running (the party stages
 * itself; the first battle map is picked if none is). That MUTATES the dev server's state
 * (the fight is left running), the same class of side effect as tap-audit's created page.
 * Point DATA_DIR at a throwaway copy if that matters for the run.
 *
 * HOW IT MEASURES. Y is `scrollHeight > innerHeight` on the document, with the px delta
 * reported. X is an ATTEMPTED SCROLL (instant `scrollTo(1e6)` + readback), NOT a
 * `scrollWidth` comparison, because of a measured false-positive class: a closed codex
 * session-console drawer (`position: fixed; translate: 100%`) inflates
 * `document.body.scrollWidth` while being completely user-inert — known-bugs.md, the
 * "[codex/ui] closed session-console drawer" entry. A readback only reports scroll that a
 * user could actually perform. No equivalent inert stretch is known on the Y axis.
 *
 * READING THE OUTPUT: the shell lock (refresh A1) took the whole table green — the document
 * cannot scroll anywhere, because scrolling belongs to REGIONS inside the locked frame and
 * never to the page. Phase A1 bought that with one temporary staged scroller per unconverted
 * surface (`.pane-stage`); Phase C drained the last of them, so every surface now owns a real
 * frame and the staging class is gone. Any red cell is therefore a REGRESSION now, and what
 * still polices the shape of those frames is the (g)/(h) ratchets in
 * design-conventions.test.ts, not this table.
 *
 * WHAT A GREEN RUN IS STILL NOT WORTH. It proves the document does not scroll, that the
 * table's own frame stays inside its budget, and that two named controls hit-test — at the
 * viewports and in the states a route list opens. It remains blind to occlusion in general,
 * to every control behind a collapsed tab or a closed disclosure, and to any state this
 * script cannot reach (a claimed player, a populated replays shelf). Read it as a floor.
 *
 * THE RUN IS RED ON ITS FIRST EXTENDED PASS (2026-08-05), and the red is the point rather
 * than a broken script: adding landscape and short-pane cells found 14 of them, on five
 * surfaces none of which is `/table` — `/scenes`, `/scenes/maps`, `/roster`, `/homebrew`,
 * `/replays/:id` and the player's `/replays` scroll the DOCUMENT by 1-92px somewhere in
 * 844×390 / 667×375 / 390×400 / 320×568. Those are §7 violations that were simply never
 * looked for. **Do not delete a viewport to go green** — the widths and heights here are a
 * claim about what the app supports (ADR-0014), and narrowing the claim to fit the code is
 * the one move this file exists to prevent.
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const EXEC = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.AUDIT_URL ?? "http://localhost:5173/";
const PASSWORD = process.env.AUDIT_PASSWORD ?? "testpassword123";

/**
 * Four laptop shapes, two phone portraits, three short panes. The short ones are the point:
 * 844×390 and 667×375 are a 14-Pro and an SE ROTATED, and 390×400 stands in for the same phone
 * with the Android soft keyboard up (the layout viewport shrinks and the frame gets a ~400px
 * pane). Every one of those was a state no audit opened, and every one of them was broken.
 * The first four are ≥980 — the docked pass below uses exactly those, because below the rung
 * there is nowhere to dock and `phoneTable` forces `sidebar`.
 */
const VIEWPORTS = [[1920, 1080], [1280, 900], [1280, 720], [1024, 667], [390, 844], [320, 568], [844, 390], [667, 375], [390, 400]];
/** How many leading VIEWPORTS columns sit above the 980 rung. */
const LAPTOP_CELLS = 4;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"], timeout: 60_000 });
const at = (path) => `${BASE}${path.replace(/^\//, "")}`.replace(/([^:])\/\//g, "$1/");

/** Kill smooth scrolling and animation so a measurement is never taken mid-transition. */
const settle = (page) => page.addStyleTag({ content: "html, * { scroll-behavior: auto !important; animation: none !important; transition: none !important; }" });

/** The measurement. Y per the doc's stated rule; X by attempted scroll (docblock above). */
const MEASURE = `(() => {
  const doc = document.documentElement;
  const yDelta = doc.scrollHeight - window.innerHeight;
  const x0 = window.scrollX;
  window.scrollTo({ left: 1e6, top: window.scrollY, behavior: "instant" });
  const xMax = Math.round(window.scrollX);
  window.scrollTo({ left: x0, top: window.scrollY, behavior: "instant" });
  return { yDelta, xMax };
})()`;

/**
 * THE PANE PROBE — the half the document check cannot see (docblock at the top).
 *
 * Three structural assertions about `/table`'s own frame, none of which depends on what this
 * dev server happens to hold:
 *  (1) overflow must be REACHABLE. A frame shorter than its content is fine — a landscape
 *      phone genuinely cannot hold the rows — but only if the user can scroll to it. Content
 *      behind an `overflow: hidden` is not content.
 *  (2) the dock's tab bar, when it renders, must HIT-TEST: `elementFromPoint` at its own
 *      centre returns it, at rest or once the frame is scrolled to the bottom.
 *  (3) the dock's BODY must not be 0px while its bar is up — a tab bar that responds and
 *      shows nothing is the defect no height-only probe catches.
 * The claim picker gets (2) as well when it is on screen: an unclaimed player whose Claim
 * button is clipped out of existence cannot join the table at all.
 */
const PANE = `(() => {
  const tl = document.querySelector(".table-layout");
  if (!tl) return null;
  const over = tl.scrollHeight - tl.clientHeight;
  const oy = getComputedStyle(tl).overflowY;
  const scrollable = oy === "auto" || oy === "scroll";
  const hit = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return "-";
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return "ZERO-BOX";
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return "OFFSCREEN";
    const at = document.elementFromPoint(x, y);
    if (!at) return "NULL";
    return (el.contains(at) || at.contains(el)) ? "OK" : "BLOCKED";
  };
  // "Reachable" means reachable THE WAY A THUMB REACHES IT: scrollIntoView walks every
  // scrollable ancestor, which is the frame here and the picker's own .scroll-y region one
  // level in. What it cannot rescue is the failure this probe exists for - a box with no
  // height, or content behind a clip - because no scroll position reveals those.
  const both = (sel) => {
    const rest = hit(sel);
    if (rest === "OK" || rest === "-") return rest;
    const el = document.querySelector(sel);
    const restore = [];
    for (let n = el.parentElement; n; n = n.parentElement) restore.push([n, n.scrollTop]);
    el.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
    const after = hit(sel);
    for (const [n, top] of restore) n.scrollTop = top;
    return after === "OK" ? "OK-SCROLLED" : after;
  };
  const body = document.querySelector(".dock-tabs-body");
  return {
    over, scrollable,
    reached: over > 0 ? (tl.scrollTop = 1e6, tl.scrollTop > 0 ? (tl.scrollTop = 0, true) : false) : true,
    tab: both(".dock-tabs-bar"),
    claim: both(".claim-card-action"),
    body: document.querySelector(".dock-tabs-bar") ? (body ? body.clientHeight : -1) : null
  };
})()`;

/** Reads a PANE result into a cell fragment plus a pass/fail verdict. */
function paneVerdict(p) {
  if (!p) return { text: "", bad: [] };
  const bad = [];
  if (p.over > 0 && !(p.scrollable && p.reached)) bad.push(`pane+${p.over} UNREACHABLE`);
  if (p.tab !== "OK" && p.tab !== "OK-SCROLLED" && p.tab !== "-") bad.push(`tabbar ${p.tab}`);
  if (p.claim !== "OK" && p.claim !== "OK-SCROLLED" && p.claim !== "-") bad.push(`claim ${p.claim}`);
  if (p.body !== null && p.body <= 0) bad.push(`dock body ${p.body}px`);
  return { text: p.over > 0 ? ` pane+${p.over}` : "", bad };
}

async function newPage(width = 1280, height = 900, storage) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.setDefaultTimeout(20_000);
  // Seeded BEFORE any script runs, so the app boots with the preference already in place —
  // which is the only way to reach the docked composition (`dockPosition` defaults to sidebar).
  if (storage) await page.addInitScript((kv) => { for (const [k, v] of Object.entries(kv)) localStorage.setItem(k, v); }, storage);
  return page;
}

/** SPA navigation the address bar's way — a hard goto would drop the memory-only GM token.
    The popstate is dispatched TWICE: router.ts's transient mechanism absorbs the first pop
    whenever a transient overlay (drawer, palette) is registered — it closes the overlay and
    the route stands — so the second dispatch is the one that routes. With no transient, the
    second is a same-path no-op. */
async function go(page, path, ready) {
  await page.evaluate((target) => {
    history.pushState(null, "", target);
    dispatchEvent(new PopStateEvent("popstate", { state: null }));
    dispatchEvent(new PopStateEvent("popstate", { state: null }));
  }, path);
  if (ready) await page.waitForSelector(ready, { timeout: 15_000 });
  await page.waitForTimeout(900);
}

/** GM login at /table (tap-audit's flow: auth lands on the address that asked for it). */
async function gmPage(storage) {
  const page = await newPage(1280, 900, storage);
  await page.goto(at("table"), { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByText("Enter as GM").click({ timeout: 15_000 });
  const pw = page.locator('input[type="password"]').first();
  await pw.waitFor({ state: "visible", timeout: 10_000 });
  await pw.fill(PASSWORD);
  await pw.press("Enter");
  await page.waitForSelector(".table-layout", { timeout: 25_000 });
  await settle(page);
  return page;
}

/** A real player session — the landing's Join door, not any GM preview. */
async function playerPage(storage) {
  const page = await newPage(1280, 900, storage);
  await page.goto(at("/"), { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByText("Join as Player").click({ timeout: 15_000 });
  await page.waitForSelector(".player-view-tabs, .table-layout", { timeout: 25_000 });
  await settle(page);
  return page;
}

/** The census measured /table IN COMBAT; an empty table under-tests the lock. */
async function ensureFight(page) {
  await go(page, "/table", ".table-layout");
  if (await page.locator(".encounter-panel.combat-active").count()) return;
  const start = page.getByRole("button", { name: "Start the fight" });
  if ((await start.count()) === 0) throw new Error("no fight running and no start control on /table");
  if (!(await start.isEnabled())) {
    // The party stages itself; a battle map may still need picking.
    const map = page.locator(".map-picker-grid button").first();
    if (await map.count()) { await map.click(); await page.waitForTimeout(600); }
  }
  await start.click({ timeout: 8_000 });
  await page.waitForSelector(".encounter-panel.combat-active", { timeout: 20_000 });
}

/** The first player character's actor id, read off the table's own tray/map tokens. */
async function pcActorId(page) {
  await go(page, "/table", ".table-layout");
  return await page.evaluate(() =>
    document.querySelector(".tray-token.player-character, .encounter-token.player-character")?.getAttribute("data-token-id") ?? null);
}

const GM_ROUTES = [
  { path: "/table", ready: ".table-layout" },
  { path: "/scenes", ready: ".scene-gallery-hub" },
  { path: "/scenes/maps", ready: ".scenes-maps-view" },
  { path: "/roster", ready: ".party-heading-actions" },
  { path: "/codex", ready: ".codex-root" },
  { path: "/homebrew", ready: ".hb-root" },
  { path: "/viewer-controls", ready: ".viewer-controls" },
  { path: "/replays", ready: ".replay-panel" },
  {
    path: "/replays/:id", ready: ".replay-panel",
    /** The first shared archive's Watch button knows the id; the audit reads the address it lands on. */
    resolve: async (page) => {
      await go(page, "/replays", ".replay-panel");
      const watch = page.getByRole("button", { name: "Watch" }).first();
      if ((await watch.count()) === 0) return null;
      await watch.click({ timeout: 8_000 });
      await page.waitForTimeout(900);
      return await page.evaluate(() => location.pathname);
    }
  },
  { path: "/settings", ready: ".settings-group" },
  { path: "/builder", ready: ".cb-page, .builder-gate" },
  {
    path: "/characters/:id", ready: null,
    /** A player character's sheet: the id comes off the in-combat map's own tokens. */
    resolve: async (page) => {
      const id = await pcActorId(page);
      return id ? `/characters/${id}` : null;
    }
  },
  {
    path: "/characters/:id/level", ready: null,
    resolve: async (page) => {
      const id = await pcActorId(page);
      return id ? `/characters/${id}/level` : null;
    }
  }
];

const PLAYER_ROUTES = [
  { path: "/table", ready: ".table-layout" },
  { path: "/codex", ready: ".codex-root" },
  // The player-/replays row doubles as the regression check for the list-stacks-under-the-table anomaly.
  { path: "/replays", ready: ".replay-panel" },
  { path: "/settings", ready: ".settings-group" }
];

const rows = [];
let failures = 0;
let unmeasured = 0;

const cellOf = (m) => {
  const parts = [];
  if (m.yDelta > 0) parts.push(`Y+${m.yDelta}`);
  if (m.xMax > 0) parts.push(`X+${m.xMax}`);
  return parts.length === 0 ? "PASS" : `FAIL ${parts.join(" ")}`;
};

async function auditRoutes(page, role, routes) {
  for (const route of routes) {
    // Resolution runs at the widest viewport so the controls it clicks are laid out for a laptop.
    await page.setViewportSize({ width: 1280, height: 900 });
    let target = route.path;
    if (route.resolve) {
      try {
        target = await route.resolve(page);
        if (!target) throw new Error("no target to resolve the address from");
      } catch (error) {
        rows.push({ route: route.path, role, cells: VIEWPORTS.map(() => "NOT MEASURED") });
        unmeasured += 1;
        console.error(`  ${route.path} (${role}): NOT MEASURED - ${String(error).split("\n")[0].slice(0, 90)}`);
        continue;
      }
    }
    try {
      await go(page, target, route.ready);
    } catch (error) {
      rows.push({ route: route.path, role, cells: VIEWPORTS.map(() => "NOT MEASURED") });
      unmeasured += 1;
      console.error(`  ${route.path} (${role}): DID NOT RENDER - ${String(error).split("\n")[0].slice(0, 90)}`);
      continue;
    }
    const cells = [];
    for (const [w, h] of VIEWPORTS) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(500);
      const m = await page.evaluate(MEASURE);
      // The pane probe rides the same cell, and only `/table` has a `.table-layout` to probe.
      const verdict = paneVerdict(await page.evaluate(PANE));
      const doc = cellOf(m);
      const cell = doc === "PASS" && verdict.bad.length === 0
        ? `PASS${verdict.text}`
        : `FAIL ${[doc === "PASS" ? null : doc.replace("FAIL ", ""), ...verdict.bad].filter(Boolean).join(" ")}`;
      if (cell.startsWith("FAIL")) failures += 1;
      cells.push(cell);
    }
    rows.push({ route: route.path, role, cells });
  }
}

/**
 * THE DOCKED COMPOSITION. `dockPosition` is a persisted preference the route list never sets,
 * so the arm the GM actually uses mid-fight — panels docked into the map, the sidebar holding a
 * bare dice+log stack — was audited exactly never. It scrolled the PAGE at every width ≥980
 * (114-429px) with `localStorage` making it stick to the device. Both roles, both sides.
 */
async function auditDocked() {
  for (const [role, side] of [["gm", "left"], ["player", "right"]]) {
    let page;
    try {
      page = await (role === "gm" ? gmPage : playerPage)({ "vtt.dock-position": side });
      await go(page, "/table", ".table-layout");
      const out = [];
      for (const [w, h] of VIEWPORTS.slice(0, LAPTOP_CELLS)) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(600);
        const m = await page.evaluate(MEASURE);
        const docked = await page.evaluate(() => document.querySelector(".table-layout.docked") !== null);
        const verdict = paneVerdict(await page.evaluate(PANE));
        const doc = cellOf(m);
        // A cell that never reached the docked composition proves nothing — say so rather than pass.
        // (It needs a live map: `showDocked` is gated on `combat.mapAssetId`, which is what the
        // in-combat seed above provides.)
        const cell = !docked ? "NOT MEASURED" : (doc === "PASS" && verdict.bad.length === 0 ? `PASS${verdict.text}` : `FAIL ${[doc === "PASS" ? null : doc.replace("FAIL ", ""), ...verdict.bad].filter(Boolean).join(" ")}`);
        if (cell === "NOT MEASURED") unmeasured += 1; else if (cell.startsWith("FAIL")) failures += 1;
        out.push(cell);
      }
      rows.push({ route: `/table docked-${side}`, role, cells: VIEWPORTS.map((v, i) => (i < LAPTOP_CELLS ? out[i] : "-")) });
    } catch (error) {
      rows.push({ route: `/table docked-${side}`, role, cells: VIEWPORTS.map(() => "NOT MEASURED") });
      unmeasured += 1;
      console.error(`  /table docked ${side} (${role}): NOT MEASURED - ${String(error).split("\n")[0].slice(0, 90)}`);
    } finally {
      if (page) await page.close();
    }
  }
}

/** The two non-SPA measurements: the landing and the standalone viewer entry. */
async function auditEntry(label, url, ready) {
  const cells = [];
  for (const [w, h] of VIEWPORTS) {
    const page = await newPage(w, h);
    try {
      // domcontentloaded, not networkidle: the viewer entry keeps a feed connection open,
      // so networkidle never fires there.
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      if (ready) await page.waitForSelector(ready, { timeout: 15_000 });
      await settle(page);
      await page.waitForTimeout(900);
      const m = await page.evaluate(MEASURE);
      const cell = cellOf(m);
      if (cell !== "PASS") failures += 1;
      cells.push(cell);
    } catch (error) {
      cells.push("NOT MEASURED");
      unmeasured += 1;
      console.error(`  ${label}: NOT MEASURED at ${w}x${h} - ${String(error).split("\n")[0].slice(0, 90)}`);
    } finally {
      await page.close();
    }
  }
  rows.push({ route: label, role: "-", cells });
}

await auditEntry("/", at("/"), ".landing");
await auditEntry("/viewer.html", at("viewer.html"), null);

try {
  const gm = await gmPage();
  try { await ensureFight(gm); }
  catch (error) { console.error(`  in-combat seed failed (the /table rows measure the out-of-combat state): ${String(error).split("\n")[0].slice(0, 90)}`); }
  await auditRoutes(gm, "gm", GM_ROUTES);
  await gm.close();
} catch (error) {
  console.error(`GM PASS FAILED - ${String(error).split("\n")[0].slice(0, 120)}`);
  unmeasured += GM_ROUTES.length;
}

try {
  const player = await playerPage();
  await auditRoutes(player, "player", PLAYER_ROUTES);
  await player.close();
} catch (error) {
  console.error(`PLAYER PASS FAILED - ${String(error).split("\n")[0].slice(0, 120)}`);
  unmeasured += PLAYER_ROUTES.length;
}

await auditDocked();

await browser.close();

const headers = ["route", "role", ...VIEWPORTS.map(([w, h]) => `${w}x${h}`)];
const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (i === 0 ? r.route : i === 1 ? r.role : r.cells[i - 2]).length)));
const line = (cols) => cols.map((c, i) => c.padEnd(widths[i])).join("  ");
console.log(`\n===== no-scroll audit (the page never scrolls - design-language.md §7) =====`);
console.log(line(headers));
for (const r of rows) console.log(line([r.route, r.role, ...r.cells]));
console.log(`\nA cell reads PASS when the DOCUMENT does not scroll on either axis AND the table's own`);
console.log(`frame keeps every overflow reachable, its dock body non-zero and its named controls`);
console.log(`hit-testable. "pane+N" on a PASS is a frame that overflows by N and can be scrolled to.`);
console.log(`\n${rows.length} route rows; ${failures} failing viewport cells; ${unmeasured} NOT MEASURED.`);
process.exit(failures === 0 && unmeasured === 0 ? 0 : 1);
