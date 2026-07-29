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
// The URL and password are OVERRIDABLE because they were hardcoded to one developer's dev server, and
// a tool that has to be hand-edited before every run cannot serve its purpose - which is letting the
// next session re-check the A-3 number rather than trust it. Defaults stay `npm run dev`, so the
// documented invocation is unchanged; `npm run start` on :3001 now works with two env vars.
const BASE = process.env.AUDIT_URL ?? "http://localhost:5173/";
const PASSWORD = process.env.AUDIT_PASSWORD ?? "testpassword123";

const b = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const p = await b.newPage({ viewport: { width, height: 900 }, hasTouch: true, isMobile: width < 700 });
await p.goto(BASE, { waitUntil: "networkidle" });
await p.getByText("Enter as GM").click();
await p.waitForTimeout(400);
const pw = p.locator('input[type="password"]').first();
await pw.fill(PASSWORD);
await pw.press("Enter");
await p.waitForTimeout(2400);
// By ROLE, not by text. `locator("text=Codex")` matches any node containing the word, so it resolved to
// an ancestor and every click timed out with "<main> intercepts pointer events" - which is why this tool
// could not be run as committed. The GM tab strip is a real tablist; ask for the tab.
//
// `force` because the app plays an entrance transition after login (`.anim-view`), during which the
// roster section still intercepts pointer events at the tab's coordinates. Waiting it out is timing
// roulette on a slower machine. Forcing is right HERE and only here: this click is navigation to the
// surface under test, not part of what is being measured - the measurement below does its own
// elementFromPoint walk and would catch a genuinely unreachable control.
const codexTab = p.getByRole("tab", { name: "Codex", exact: true });
await codexTab.waitFor({ state: "visible", timeout: 15_000 });
await codexTab.scrollIntoViewIfNeeded();
await codexTab.click({ force: true });
await p.waitForTimeout(1600);
if ((await codexTab.getAttribute("aria-selected")) !== "true") {
  // Fail loudly rather than measuring the wrong surface and reporting a reassuring zero.
  throw new Error("tap-audit: the Codex tab did not become selected - the audit would measure the wrong surface.");
}
// The app sets `html { scroll-behavior: smooth }`; leave it on and every scrolled measurement is stale.
await p.addStyleTag({ content: "html, * { scroll-behavior: auto !important; }" });

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

const MODES = ["Pages", "Campaign", "Atlas", "Journal", "Graph"];
const report = [];
for (const mode of MODES) {
  const tab = p.getByRole("tab", { name: mode }).first();
  if (await tab.count() === 0) { report.push(`### ${mode}: TAB NOT FOUND`); continue; }
  // `force` for the same reason as the Codex tab above: the combat roster sits over these coordinates
  // and intercepts, so a plain click times out. Switching modes is navigation, not the measurement.
  await tab.scrollIntoViewIfNeeded();
  await tab.click({ force: true });
  await p.waitForTimeout(1300);
  if ((await tab.getAttribute("aria-selected")) !== "true") {
    // Never measure a surface we did not actually reach - a silent zero is worse than a loud failure.
    report.push(`### ${mode}: TAB DID NOT ACTIVATE - not measured`);
    continue;
  }
  const { out, error } = await p.evaluate(MEASURE);
  if (error) { report.push(`### ${mode}: ${error}`); continue; }
  const bad = out.filter((c) => c.h < 44 || c.w < 44);
  // §4 gap budget: a control can BE 44px and still lose taps to a later sibling whose ::after overhangs
  // it. `reach` is the vertically reachable span at the centre; under 44 means something is on top.
  // Real occlusion = the reachable span is materially shorter than the control's own height. Comparing
  // against a flat 44 was wrong: the ±d walk measures the interior span, so a correct 44px control reads
  // 43 and every one of them got flagged. `reach === 0` means "never resolved" (e.g. an SVG element, or
  // one that could not be scrolled into view) — reported separately rather than silently counted as theft.
  const stolen = out.filter((c) => c.h >= 44 && c.w >= 44 && c.reach > 0 && c.reach < c.h - 2);
  const unresolved = out.filter((c) => c.h >= 44 && c.w >= 44 && c.reach === 0);
  report.push(`### ${mode} — ${out.length} controls, ${bad.length} below 44px, ${stolen.length} with taps stolen, ${unresolved.length} unresolved`);
  for (const c of bad) report.push(`  SIZE  ${c.h}x${c.w} reach=${c.reach}  ${c.tag}.${c.cls}  "${c.label}"`);
  for (const c of stolen) report.push(`  STEAL ${c.h}x${c.w} reach=${c.reach}  ${c.tag}.${c.cls}  "${c.label}"`);
  await p.screenshot({ path: `${OUT}/tap-${mode.toLowerCase()}-${width}.png`, fullPage: false });
}

console.log(`===== Codex tap-target audit @ ${width}px =====`);
console.log(report.join("\n"));
await b.close();
