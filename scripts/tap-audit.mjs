/**
 * Codex tap-target audit — the reproducible form of acceptance criterion **A-3**.
 *
 * WHY THIS FILE EXISTS. A-3 asks that every interactive Codex control meet the 44px floor, and the
 * spec's own preamble wants that "countable, not asserted". It was first downgraded to a source-level
 * check on the grounds that the repo has no browser runner, then measured anyway with a throwaway script
 * — which left the number in the ledger unverifiable by anyone who came later. This file closes that:
 * the measurement is now repeatable, and a future session can disprove the claim rather than trust it.
 *
 * IT IS DELIBERATELY NOT WIRED INTO `npm test`. It needs a browser and a running dev server, so it is a
 * manual audit, not a unit test. `playwright-core` is intentionally NOT a repo dependency — install it
 * outside the tree and point EXEC at any Chromium build:
 *
 *   npm i --no-save playwright-core          # ...or set PLAYWRIGHT_CORE to an existing install
 *   npm run dev                              # in another shell
 *   node scripts/tap-audit.mjs 375           # 375 = the phone width the floor is judged at
 *
 * Screenshots land in `verify-shots/` (gitignored). Override with AUDIT_OUT.
 *
 * IT COVERS BOTH ROLES. The GM's addresses, and then a real PLAYER session on its own context — not
 * the GM's "Preview as player" modal. D4/D14 gave the player their own `.codex-root`, top bar, drawer,
 * `PinDetails` and reader markup, and until this pass none of it contributed a single control to the
 * number this script prints, on the surface a phone actually holds. It also opens the pin inspector's
 * collapsed Appearance disclosure (about sixty icon buttons that had no rendered box), the quick-create
 * dialog, the session editor and the cross-type tag view — surfaces the plan named and the audit missed.
 *
 * A SURFACE IT CANNOT REACH IS REPORTED, NEVER SUBSTITUTED. Two openers used to be
 * `if (await x.count() > 0) { … }` with no else, so a missing pin measured the plain Atlas a second time
 * and added its controls to the total under the pin-inspector heading. The exit code is now non-zero if
 * anything is below the floor OR any surface went unmeasured, so a run that quietly covered less than it
 * claims cannot be read as a pass.
 *
 * ROUTE-DRIVEN SINCE THE D1/D3 RECUT. It used to walk five MODE TABS, which is now impossible in two
 * ways: the tab bar is gone, and five modes never covered the surface anyway — the Calendar, the reveal
 * audit, the backup panel and the settings panel were reachable only by having pressed the right button
 * on the right mode, so a tab-driven audit could not reach them and never reported a single control from
 * any of them. It now walks the ADDRESSES, from the same table the sidebar renders, and additionally
 * opens the record-level surfaces (a page editor, a pin inspector, the palette, the nav drawer) that
 * carry the densest control clusters in the app.
 *
 * THE MEASUREMENT IS THE AUTHORITATIVE ONE from `docs/ai-context/design-language.md` §4:
 *   size = max(rect.<dim>, getComputedStyle(el, "::after").<dim>)
 * `getBoundingClientRect()` alone is wrong here — it misses the `.tap-target` ::after box entirely,
 * which is route 2's whole mechanism.
 *
 * READING THE OUTPUT. "below 44px" is the A-3 number. The "taps stolen" column is a heuristic for §4's
 * gap budget and is KNOWN TO OVER-REPORT: a 44px control legitimately walks to 43 (the interior span),
 * and anything not scrolled into view reports 0. Treat it as a pointer to investigate, never as a verdict
 * — confirm real tap theft by tapping, as `docs/ai-ledger/current-state.md` records for the M5 pass.
 */
// Resolved at runtime, not statically imported: `playwright-core` is deliberately not a repo
// dependency, so point PLAYWRIGHT_CORE at an out-of-tree install (or install it here with --no-save).
//
// `createRequire` rather than `await import`: a global npm install is a DIRECTORY path, and ESM refuses
// a directory import outright (ERR_UNSUPPORTED_DIR_IMPORT) even though the package has a valid main.
// CommonJS resolution reads the package.json and finds it, which is what makes an out-of-tree install
// usable at all — and out-of-tree is the whole point of not depending on it.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const EXEC = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
// `verify-shots/` because it is GITIGNORED (.gitignore:16). The default used to be "." — running the
// script exactly as its own docblock instructs dropped ~18 PNGs into the repository root, where they
// show up in `git status` and can be committed by a careless `git add -A`.
const OUT = process.env.AUDIT_OUT ?? "verify-shots";
const width = Number(process.argv[2] || 375);
mkdirSync(OUT, { recursive: true });
// The URL and password are OVERRIDABLE because they were hardcoded to one developer's dev server, and
// a tool that has to be hand-edited before every run cannot serve its purpose - which is letting the
// next session re-check the A-3 number rather than trust it. Defaults stay `npm run dev`, so the
// documented invocation is unchanged; `npm run start` on :3001 now works with two env vars.
const BASE = process.env.AUDIT_URL ?? "http://localhost:5173/";
const PASSWORD = process.env.AUDIT_PASSWORD ?? "testpassword123";

const b = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"], timeout: 60_000 });
const at = (path) => `${BASE}${path.replace(/^\//, "")}`.replace(/([^:])\/\//g, "$1/");

/** A fresh context with the viewport under test. Two are used: the GM's, and the player's. */
async function newPage() {
  const page = await b.newPage({ viewport: { width, height: 900 }, hasTouch: true, isMobile: width < 700 });
  page.setDefaultTimeout(20_000);
  return page;
}

/** The app sets `html { scroll-behavior: smooth }` — leave it on and every scrolled measurement is
    stale. Animations off for the same reason: a control mid-transition reports a transitional box. */
const settle = (page) => page.addStyleTag({ content: "html, * { scroll-behavior: auto !important; animation: none !important; transition: none !important; }" });

const p = await newPage();
// D2/D3: the GM token is memory-only, so a cold load of ANY address shows the login screen at that
// address and auth lands on what was asked for. Logging in at /codex is therefore both the shortest
// route to the surface under test and a small check that the behaviour still holds.
await p.goto(at("codex"), { waitUntil: "domcontentloaded", timeout: 30_000 });
await p.getByText("Enter as GM").click({ timeout: 15_000 });
const pw = p.locator('input[type="password"]').first();
await pw.waitFor({ state: "visible", timeout: 10_000 });
await pw.fill(PASSWORD);
await pw.press("Enter");
await p.waitForSelector(".codex-shell-content", { timeout: 25_000 });
await settle(p);

/**
 * The PLAYER's own app, on a real player session — not the GM's "Preview as player" modal.
 *
 * D4/D14 gave the player their own `.codex-root` (`codex-root codex-player codex-shell`), their own top
 * bar and drawer, and markup the GM shell never renders at all: `PinDetails` (`.codex-pindetails`), the
 * reader (`.codex-reader-*`), and `.codex-player`-scoped map sizing. None of it contributed a single
 * control to the number this script prints, on the surface phones actually use.
 */
async function playerPage() {
  const page = await newPage();
  await page.goto(at("/"), { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByText("Join as Player").click({ timeout: 15_000 });
  await page.waitForSelector(".player-view-tabs, .codex-root", { timeout: 25_000 });
  await settle(page);
  return page;
}

const MEASURE = `((rootSelector) => {
  const SEL = 'button, summary, a[href], input, select, textarea, [role="button"], [role="tab"], [role="switch"], [tabindex]:not([tabindex="-1"])';
  const root = document.querySelector(rootSelector);
  if (!root) return { error: "no " + rootSelector };
  const out = [];
  for (const el of root.querySelectorAll(SEL)) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;               // not rendered
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") continue;
    const af = getComputedStyle(el, "::after");
    const ah = parseFloat(af.height), aw = parseFloat(af.width);
    // A control WRAPPED IN A LABEL is tapped through the label, so the label's box IS its hit area -
    // clicking anywhere inside it activates the control. Measuring only the input's own rect reports a
    // 20x20 checkbox as sub-floor when its label is a full 44x44, which is a false violation, and a
    // false violation is worse than none: it sends the next session to "fix" working code. Found when
    // M10's objective checklist became the first label-wrapped control in the Codex; verified by walking
    // elementFromPoint outward, which reached 44px in both axes.
    const owner = el.closest("label") ?? el;
    const or_ = owner === el ? r : owner.getBoundingClientRect();
    const h = Math.max(r.height, or_.height, Number.isFinite(ah) && af.content !== "none" ? ah : 0);
    const w = Math.max(r.width, or_.width, Number.isFinite(aw) && af.content !== "none" ? aw : 0);
    // reachability: walk outward vertically from the centre until elementFromPoint leaves the control
    // Scroll into view first: elementFromPoint reads VIEWPORT coordinates, so a control below the fold
    // returns whatever is painted at that point and reports a false reach=0.
    el.scrollIntoView({ block: "center", behavior: "instant" });
    const r2 = el.getBoundingClientRect();
    const cx = r2.left + r2.width / 2, cy = r2.top + r2.height / 2;
    // The walk must be able to reach the control's OWN size, or every control taller than the cap is
    // flagged unconditionally. The old fixed d <= 30 capped reach at 30*2+1 = 61, so a 64px type card
    // and a 72px composer textarea could never demonstrate their full height and were reported as having
    // taps stolen on every run - 7 false positives against a populated database. A false steal is the
    // same disease as a false sub-floor: it sends the next reader to fix working code. Walk far enough
    // to prove the control's own extent, and no further.
    const maxD = Math.ceil(Math.max(44, h) / 2) + 1;
    let reach = 0;
    for (let d = 1; d <= maxD; d++) {
      const up = document.elementFromPoint(cx, cy - d), dn = document.elementFromPoint(cx, cy + d);
      // owner: a wrapping label counts as the control (see the size note above).
      const isOwn = (node) => node === el || el.contains(node) || node === owner || owner.contains(node);
      const okUp = isOwn(up), okDn = isOwn(dn);
      if (!okUp && !okDn) break;
      reach = d * 2 + 1;
    }
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className && el.className.baseVal !== undefined ? el.className.baseVal : String(el.className || "")).slice(0, 60),
      label: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 34),
      h: Math.round(h * 10) / 10, w: Math.round(w * 10) / 10, reach
    });
  }
  return { out };
})`;

/**
 * Every address the sidebar lists, plus the record-level surfaces that a section address alone does not
 * reach. `open` runs after the address lands and is where the dense clusters get opened.
 *
 * **A surface whose target is missing is UNMEASURED, never re-measured.** `pin-inspector` and `palette`
 * used to open with `if (await x.count() > 0) { … }` and no else, so a missing pin silently measured the
 * plain Atlas a SECOND time and added its controls to the total under the pin-inspector heading. That is
 * how a printed total can be both larger than the surface it names and missing the surface it claims —
 * an `open` that cannot reach its target now throws, and the runner reports the surface as not measured.
 */
const SURFACES = [
  { name: "home", path: "/codex" },
  { name: "pages", path: "/codex/pages" },
  // The page editor is the single densest surface in the Codex: a toolbar, a field grid, the tag input,
  // the connections list and its per-row controls. A section-only audit measures none of them.
  { name: "page-editor", path: "/codex/pages", open: async (page) => {
      await page.locator(".codex-shell-content button").filter({ hasText: "Strahd" }).first().click({ timeout: 10_000 });
      await page.waitForTimeout(1600);
    } },
  { name: "atlas", path: "/codex/atlas" },
  { name: "pin-inspector", path: "/codex/atlas", open: async (page) => {
      await page.waitForTimeout(1200);
      const pin = page.locator("[data-marker-id], .codex-map-marker, .codex-marker").first();
      if (await pin.count() === 0) throw new Error("no pin on the map to open the inspector with");
      await pin.click({ force: true, timeout: 10_000 });
      await page.waitForTimeout(1200);
      // The icon-and-colour grid lives inside a CLOSED <details> (D25/G16 put it there), so its swatch
      // and ~60 icon buttons have zero rendered boxes until it is opened — the densest cluster of small
      // controls in the Codex, and every previous run skipped all of it.
      const appearance = page.locator("details.codex-marker-appearance").first();
      if (await appearance.count() === 0) throw new Error("no Appearance disclosure in the pin inspector");
      await appearance.locator("summary").click({ timeout: 8_000 });
      await page.waitForTimeout(600);
    } },
  { name: "graph", path: "/codex/graph" },
  { name: "sessions", path: "/codex/sessions" },
  // The session EDITOR, not just the list: it carries the shared markdown toolbar twice (prep + recap)
  // and two TagInputs, none of which a list-only measurement sees.
  { name: "session-editor", path: "/codex/sessions", open: async (page) => {
      const row = page.locator(".codex-shell-content button").filter({ hasText: /^Session \d/ }).first();
      if (await row.count() === 0) throw new Error("no session row to open the editor with");
      await row.click({ timeout: 10_000 });
      await page.waitForTimeout(1400);
    } },
  { name: "quests", path: "/codex/quests" },
  { name: "quest-editor", path: "/codex/quests", open: async (page) => {
      await page.locator(".codex-shell-content button").filter({ hasText: "Missing Bones" }).first().click({ timeout: 10_000 });
      await page.waitForTimeout(1400);
    } },
  { name: "journal", path: "/codex/journal" },
  { name: "calendar", path: "/codex/calendar" },
  { name: "downtime", path: "/codex/downtime" },
  { name: "audit", path: "/codex/audit" },
  { name: "backup", path: "/codex/backup" },
  { name: "settings", path: "/codex/settings" },
  // D10's cross-type tag view. A live surface (`CodexShell` renders it, the sidebar links into it from
  // every tag chip in the app) that no verification pass has ever loaded.
  { name: "tag-view", path: "/codex/tags/dungeon" },
  // D7's one create dialog — the door every create path in the Codex goes through, never opened here.
  { name: "quick-create", path: "/codex", open: async (page) => {
      await page.keyboard.press("Control+k");
      await page.waitForTimeout(700);
      const palette = page.locator('dialog[open][aria-label="Codex command palette"]');
      const input = palette.locator("input").first();
      if (await input.count() === 0) throw new Error("the palette did not open");
      await input.fill(`Audit ${Date.now() % 100000}`);
      await page.waitForTimeout(900);
      const create = palette.locator(".codex-palette-item").filter({ hasText: "New page" }).first();
      if (await create.count() === 0) throw new Error("the palette offered no New page verb");
      await create.click({ timeout: 8_000 });
      const sheet = page.locator("dialog[open]").filter({ hasText: /New page/i }).first();
      await sheet.waitFor({ state: "visible", timeout: 8_000 });
      await page.waitForTimeout(600);
    } },
  { name: "palette", path: "/codex", open: async (page) => {
      await page.keyboard.press("Control+k");
      await page.waitForTimeout(700);
      const input = page.locator('dialog[open][aria-label="Codex command palette"] input');
      if (await input.count() === 0) throw new Error("the palette did not open");
      await input.fill("a");
      await page.waitForTimeout(1200);
    } },
  // The nav drawer only exists below 761px; measured there because it is the phone's whole navigation.
  { name: "nav-drawer", path: "/codex", narrowOnly: true, open: async (page) => {
      const opener = page.locator('button[aria-label="Codex sections"]').first();
      await opener.scrollIntoViewIfNeeded();
      try { await opener.click({ timeout: 4_000 }); } catch { await opener.dispatchEvent("click"); }
      await page.waitForTimeout(700);
    } },
  { name: "session-prep", path: "/codex", open: async (page) => {
      const prep = page.getByRole("button", { name: "Session prep" }).first();
      await prep.scrollIntoViewIfNeeded();
      try { await prep.click({ timeout: 4_000 }); } catch { await prep.dispatchEvent("click"); }
      await page.waitForTimeout(700);
    } }
];

/**
 * The PLAYER's surfaces. Same addresses, a different app: `PlayerCodex` renders its own root, its own
 * top bar and drawer, `PinDetails`, and the `.codex-reader-*` markup the GM shell has no equivalent of.
 * This is the surface a phone actually holds, and none of it was in the number before.
 */
const PLAYER_SURFACES = [
  { name: "player-home", path: "/codex" },
  { name: "player-pages", path: "/codex/pages" },
  { name: "player-page", path: "/codex/pages", open: async (page) => {
      const row = page.locator(".codex-rail button.codex-list-item").first();
      if (await row.count() === 0) throw new Error("the player can see no pages to open");
      await row.click({ timeout: 10_000 });
      await page.waitForTimeout(1200);
    } },
  { name: "player-atlas", path: "/codex/atlas" },
  // D14/G24: a pin tap opens PinDetails — `.codex-marker-link-open` rows and a close button that exist
  // nowhere in the GM shell.
  { name: "player-pin", path: "/codex/atlas", open: async (page) => {
      await page.waitForTimeout(1400);
      const pin = page.locator("[data-marker-id], .codex-map-marker, .codex-marker").first();
      if (await pin.count() === 0) throw new Error("no revealed pin on the player's map");
      await pin.click({ force: true, timeout: 10_000 });
      await page.waitForSelector(".codex-pindetails", { timeout: 8_000 });
      await page.waitForTimeout(600);
    } },
  { name: "player-graph", path: "/codex/graph" },
  { name: "player-sessions", path: "/codex/sessions" },
  { name: "player-quests", path: "/codex/quests" },
  { name: "player-journal", path: "/codex/journal" },
  { name: "player-calendar", path: "/codex/calendar" },
  { name: "player-downtime", path: "/codex/downtime" },
  { name: "player-tag", path: "/codex/tags/dungeon" },
  { name: "player-drawer", path: "/codex", narrowOnly: true, open: async (page) => {
      const opener = page.locator('button[aria-label="Codex sections"]').first();
      await opener.scrollIntoViewIfNeeded();
      try { await opener.click({ timeout: 4_000 }); } catch { await opener.dispatchEvent("click"); }
      await page.waitForTimeout(700);
    } }
];

const report = [];
let totalControls = 0, totalBad = 0, unmeasured = 0;

async function walk(page, surfaces, rootSelector) {
  for (const surface of surfaces) {
    if (surface.narrowOnly && width >= 761) { report.push(`### ${surface.name}: not present at ${width}px (>=761)`); continue; }
    // Addresses, not tabs. A hard `goto` would drop the memory-only GM token, so this drives the router
    // the way the address bar does inside a live SPA.
    await page.evaluate((target) => { history.pushState(null, "", target); dispatchEvent(new PopStateEvent("popstate", { state: null })); }, surface.path);
    try { await page.waitForSelector(`${rootSelector} .codex-shell-content`, { timeout: 15_000 }); }
    catch { report.push(`### ${surface.name}: ${surface.path} DID NOT RENDER - NOT MEASURED`); unmeasured += 1; continue; }
    await page.waitForTimeout(900);
    if (surface.open) {
      // Never measure a surface we did not actually reach: a silent zero is worse than a loud failure,
      // and silently measuring the PREVIOUS surface again is worse than either.
      try { await surface.open(page); }
      catch (error) { report.push(`### ${surface.name}: could not open - NOT MEASURED - ${String(error).split("\n")[0].slice(0, 90)}`); unmeasured += 1; continue; }
    }
    const { out, error } = await page.evaluate(MEASURE, rootSelector);
    if (error) { report.push(`### ${surface.name}: ${error} - NOT MEASURED`); unmeasured += 1; continue; }
    const bad = out.filter((c) => c.h < 44 || c.w < 44);
    const stolen = out.filter((c) => c.h >= 44 && c.w >= 44 && c.reach > 0 && c.reach < c.h - 2);
    const unresolved = out.filter((c) => c.h >= 44 && c.w >= 44 && c.reach === 0);
    totalControls += out.length; totalBad += bad.length;
    report.push(`### ${surface.name} (${surface.path}) - ${out.length} controls, ${bad.length} below 44px, ${stolen.length} with taps stolen, ${unresolved.length} unresolved`);
    for (const c of bad) report.push(`  SIZE  ${c.h}x${c.w} reach=${c.reach}  ${c.tag}.${c.cls}  "${c.label}"`);
    for (const c of stolen) report.push(`  STEAL ${c.h}x${c.w} reach=${c.reach}  ${c.tag}.${c.cls}  "${c.label}"`);
    await page.screenshot({ path: `${OUT}/tap-${surface.name}-${width}.png`, fullPage: false });
    // Leave no overlay open behind us, or the next surface measures this one's controls too.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }
}

await walk(p, SURFACES, ".codex-root");

report.push("");
try {
  const player = await playerPage();
  await walk(player, PLAYER_SURFACES, ".codex-root.codex-player");
  await player.close();
} catch (error) {
  report.push(`### PLAYER PASS FAILED - NOT MEASURED - ${String(error).split("\n")[0].slice(0, 120)}`);
  unmeasured += PLAYER_SURFACES.length;
}

console.log(`===== Codex tap-target audit @ ${width}px =====`);
console.log(report.join("\n"));
console.log(`\n${totalControls} interactive controls measured, ${totalBad} below the 44px floor, ${unmeasured} surfaces NOT MEASURED.`);
await b.close();
process.exit(totalBad === 0 && unmeasured === 0 ? 0 : 1);
