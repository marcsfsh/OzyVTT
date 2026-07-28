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
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const EXEC = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const OUT = process.env.AUDIT_OUT ?? ".";
const width = Number(process.argv[2] || 375);

const b = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const p = await b.newPage({ viewport: { width, height: 900 }, hasTouch: true, isMobile: width < 700 });
await p.goto("http://localhost:5173/", { waitUntil: "networkidle" });
await p.getByText("Enter as GM").click();
await p.waitForTimeout(400);
const pw = p.locator('input[type="password"]').first();
await pw.fill("testpassword123");
await pw.press("Enter");
await p.waitForTimeout(2400);
await p.locator("text=Codex").first().click();
await p.waitForTimeout(1600);

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
    const h = Math.max(r.height, Number.isFinite(ah) && af.content !== "none" ? ah : 0);
    const w = Math.max(r.width, Number.isFinite(aw) && af.content !== "none" ? aw : 0);
    // reachability: walk outward vertically from the centre until elementFromPoint leaves the control
    // Scroll into view first: elementFromPoint reads VIEWPORT coordinates, so a control below the fold
    // returns whatever is painted at that point and reports a false reach=0.
    el.scrollIntoView({ block: "center" });
    const r2 = el.getBoundingClientRect();
    const cx = r2.left + r2.width / 2, cy = r2.top + r2.height / 2;
    let reach = 0;
    for (let d = 1; d <= 30; d++) {
      const up = document.elementFromPoint(cx, cy - d), dn = document.elementFromPoint(cx, cy + d);
      const okUp = up === el || el.contains(up), okDn = dn === el || el.contains(dn);
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

const MODES = ["Pages", "Campaign", "Atlas", "Journal", "Graph"];
const report = [];
for (const mode of MODES) {
  const tab = p.getByRole("tab", { name: mode });
  if (await tab.count() === 0) { report.push(`### ${mode}: TAB NOT FOUND`); continue; }
  await tab.first().click();
  await p.waitForTimeout(1300);
  const { out, error } = await p.evaluate(MEASURE);
  if (error) { report.push(`### ${mode}: ${error}`); continue; }
  const bad = out.filter((c) => c.h < 44 || c.w < 44);
  // §4 gap budget: a control can BE 44px and still lose taps to a later sibling whose ::after overhangs
  // it. `reach` is the vertically reachable span at the centre; under 44 means something is on top.
  const stolen = out.filter((c) => c.h >= 44 && c.w >= 44 && c.reach < 44);
  report.push(`### ${mode} — ${out.length} controls, ${bad.length} below 44px, ${stolen.length} with taps stolen`);
  for (const c of bad) report.push(`  SIZE  ${c.h}x${c.w} reach=${c.reach}  ${c.tag}.${c.cls}  "${c.label}"`);
  for (const c of stolen) report.push(`  STEAL ${c.h}x${c.w} reach=${c.reach}  ${c.tag}.${c.cls}  "${c.label}"`);
  await p.screenshot({ path: `${OUT}/tap-${mode.toLowerCase()}-${width}.png`, fullPage: false });
}

console.log(`===== Codex tap-target audit @ ${width}px =====`);
console.log(report.join("\n"));
await b.close();
