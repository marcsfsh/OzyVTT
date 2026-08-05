/**
 * The no-scroll audit — the reproducible form of §7's law (design-language.md): THE PAGE
 * NEVER SCROLLS. It drives the app's route × role table at three viewports — 1280×900,
 * 1280×720 (the "1280×720-class" floor §6b names) and 390×844 — and FAILS (exit non-zero)
 * on any route whose document scrolls, either axis, or that it could not measure at all.
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
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const EXEC = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.AUDIT_URL ?? "http://localhost:5173/";
const PASSWORD = process.env.AUDIT_PASSWORD ?? "testpassword123";

const VIEWPORTS = [[1280, 900], [1280, 720], [390, 844]];

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

async function newPage(width = 1280, height = 900) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.setDefaultTimeout(20_000);
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
async function gmPage() {
  const page = await newPage();
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
async function playerPage() {
  const page = await newPage();
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
      const cell = cellOf(m);
      if (cell !== "PASS") failures += 1;
      cells.push(cell);
    }
    rows.push({ route: route.path, role, cells });
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

await browser.close();

const headers = ["route", "role", ...VIEWPORTS.map(([w, h]) => `${w}x${h}`)];
const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (i === 0 ? r.route : i === 1 ? r.role : r.cells[i - 2]).length)));
const line = (cols) => cols.map((c, i) => c.padEnd(widths[i])).join("  ");
console.log(`\n===== no-scroll audit (the page never scrolls - design-language.md §7) =====`);
console.log(line(headers));
for (const r of rows) console.log(line([r.route, r.role, ...r.cells]));
console.log(`\n${rows.length} route rows; ${failures} viewport cells with document scroll; ${unmeasured} NOT MEASURED.`);
process.exit(failures === 0 && unmeasured === 0 ? 0 : 1);
