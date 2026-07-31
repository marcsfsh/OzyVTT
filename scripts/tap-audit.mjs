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
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const EXEC = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const OUT = process.env.AUDIT_OUT ?? ".";
const width = Number(process.argv[2] || 375);
// The URL and password are OVERRIDABLE because they were hardcoded to one developer's dev server, and
// a tool that has to be hand-edited before every run cannot serve its purpose - which is letting the
// next session re-check the A-3 number rather than trust it. Defaults stay `npm run dev`, so the
// documented invocation is unchanged; `npm run start` on :3001 now works with two env vars.
const BASE = process.env.AUDIT_URL ?? "http://localhost:5173/";
const PASSWORD = process.env.AUDIT_PASSWORD ?? "testpassword123";

const b = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"], timeout: 60_000 });
const p = await b.newPage({ viewport: { width, height: 900 }, hasTouch: true, isMobile: width < 700 });
// D2/D3: the GM token is memory-only, so a cold load of ANY address shows the login screen at that
// address and auth lands on what was asked for. Logging in at /codex is therefore both the shortest
// route to the surface under test and a small check that the behaviour still holds.
await p.goto(`${BASE}codex`.replace(/([^:])\/\//g, "$1/"), { waitUntil: "domcontentloaded", timeout: 30_000 });
await p.getByText("Enter as GM").click({ timeout: 15_000 });
const pw = p.locator('input[type="password"]').first();
await pw.waitFor({ state: "visible", timeout: 10_000 });
await pw.fill(PASSWORD);
await pw.press("Enter");
await p.waitForSelector(".codex-shell-content", { timeout: 25_000 });
// The app sets `html { scroll-behavior: smooth }`; leave it on and every scrolled measurement is stale.
// Animations off for the same reason: a control mid-transition reports a transitional box.
await p.addStyleTag({ content: "html, * { scroll-behavior: auto !important; animation: none !important; transition: none !important; }" });

const MEASURE = `(() => {
  const SEL = 'button, summary, a[href], input, select, textarea, [role="button"], [role="tab"], [role="switch"], [tabindex]:not([tabindex="-1"])';
  const root = document.querySelector(".codex-root");
  if (!root) return { error: "no .codex-root" };
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
})()`;

/**
 * Every address the sidebar lists, plus the record-level surfaces that a section address alone does not
 * reach. `open` runs after the address lands and is where the dense clusters get opened.
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
      if (await pin.count() > 0) { await pin.click({ force: true, timeout: 10_000 }); await page.waitForTimeout(1200); }
    } },
  { name: "graph", path: "/codex/graph" },
  { name: "sessions", path: "/codex/sessions" },
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
  { name: "palette", path: "/codex", open: async (page) => {
      await page.keyboard.press("Control+k");
      await page.waitForTimeout(700);
      const input = page.locator('dialog[open][aria-label="Codex command palette"] input');
      if (await input.count() > 0) { await input.fill("a"); await page.waitForTimeout(1200); }
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

const report = [];
let totalControls = 0, totalBad = 0;
for (const surface of SURFACES) {
  if (surface.narrowOnly && width >= 761) { report.push(`### ${surface.name}: not present at ${width}px (>=761)`); continue; }
  // Addresses, not tabs. A hard `goto` would drop the memory-only GM token, so this drives the router
  // the way the address bar does inside a live SPA.
  await p.evaluate((target) => { history.pushState(null, "", target); dispatchEvent(new PopStateEvent("popstate", { state: null })); }, surface.path);
  try { await p.waitForSelector(".codex-shell-content", { timeout: 15_000 }); }
  catch { report.push(`### ${surface.name}: ${surface.path} DID NOT RENDER - not measured`); continue; }
  await p.waitForTimeout(900);
  if (surface.open) {
    // Never measure a surface we did not actually reach: a silent zero is worse than a loud failure.
    try { await surface.open(p); } catch (error) { report.push(`### ${surface.name}: could not open - ${String(error).split("\n")[0].slice(0, 90)}`); continue; }
  }
  const { out, error } = await p.evaluate(MEASURE);
  if (error) { report.push(`### ${surface.name}: ${error}`); continue; }
  const bad = out.filter((c) => c.h < 44 || c.w < 44);
  const stolen = out.filter((c) => c.h >= 44 && c.w >= 44 && c.reach > 0 && c.reach < c.h - 2);
  const unresolved = out.filter((c) => c.h >= 44 && c.w >= 44 && c.reach === 0);
  totalControls += out.length; totalBad += bad.length;
  report.push(`### ${surface.name} (${surface.path}) - ${out.length} controls, ${bad.length} below 44px, ${stolen.length} with taps stolen, ${unresolved.length} unresolved`);
  for (const c of bad) report.push(`  SIZE  ${c.h}x${c.w} reach=${c.reach}  ${c.tag}.${c.cls}  "${c.label}"`);
  for (const c of stolen) report.push(`  STEAL ${c.h}x${c.w} reach=${c.reach}  ${c.tag}.${c.cls}  "${c.label}"`);
  await p.screenshot({ path: `${OUT}/tap-${surface.name}-${width}.png`, fullPage: false });
  // Leave no overlay open behind us, or the next surface measures this one's controls too.
  await p.keyboard.press("Escape");
  await p.waitForTimeout(250);
}

console.log(`===== Codex tap-target audit @ ${width}px =====`);
console.log(report.join("\n"));
console.log(`\n${totalControls} interactive controls measured, ${totalBad} below the 44px floor.`);
await b.close();
