/**
 * Real-browser check of the 2026-07-30 owner-decision changes, at a phone width.
 *
 * WHY THIS IS COMMITTED. Four of these behaviours are unprovable in the jsdom suite — the reveal warning is
 * a native `<dialog>` (`test/setup.ts` shims `show()` semantics, not `showModal()`), the 44px floor and the
 * route-1/route-2 distinction are layout, and `scrollIntoView` is a no-op there. Measuring them in a
 * throwaway script would leave the claim unverifiable by whoever comes next; this makes it re-runnable.
 * Same reasoning, and the same conventions, as `tap-audit.mjs`.
 *
 *   npm i --no-save playwright-core       # ...or point PLAYWRIGHT_CORE at an existing install
 *   npm run dev                           # in another shell
 *   node scripts/prep-clock-ux-check.mjs 375
 *   node scripts/prep-clock-ux-check.mjs 320
 *
 * IT SEEDS ITS OWN FIXTURE, and has to. The run publishes the clock and flips reveal switches, so a second
 * run would inherit the first one's state and read as a failure where the behaviour is exactly right — both
 * happened while this was being written. It expects a codex already holding the six chronicle records named
 * below (a milestone dated at the prep clock, three deadlines, a downtime, and an entry with GM-only prose).
 *
 * TWO MEASUREMENT TRAPS IT AVOIDS, both of which produced false PASSes here first:
 *  - `isMobile: true` lets Chrome WIDEN the layout viewport to fit overflowing content, so
 *    `body.scrollWidth <= window.innerWidth` compares 734 to 734 and passes vacuously. Fixed viewport, and
 *    overflow is measured by walking elements against the real viewport instead.
 *  - `getBoundingClientRect()` alone misses `.tap-target`'s `::after` box, which is route 2's whole
 *    mechanism — it reported a compliant control as 32px. §4's measurement is max(paint, ::after).
 *
 * Playwright will not click through the `<dialog>` top layer even where `elementFromPoint` returns the
 * button, so dialog clicks are forced and the check asserts the OUTCOME. That the buttons are genuinely
 * reachable is asserted separately, by `elementFromPoint` plus an in-viewport bounds check.
 */
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const EXEC = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium/chrome-linux/chrome";
const BASE = process.env.AUDIT_URL ?? "http://localhost:5173/";
const PASSWORD = process.env.AUDIT_PASSWORD ?? "testpassword123";
const W = Number(process.argv[2] || 375);
const log = (...a) => console.log(...a);
let failures = 0;
const ok = (cond, label, extra = "") => { log(`${cond ? "  PASS" : "  FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`); if (!cond) failures += 1; };

/**
 * Re-seed the two clocks before every run. Step 4 below PUBLISHES, which makes them agree — so a second
 * run would find nothing to warn about and read as a failure when the behaviour is exactly right.
 * Published behind current is the only state the warning exists for, and it takes three writes to reach:
 * set current, publish it, then move current ahead.
 */
const API = "http://localhost:3001/api/v1";
const token = (await (await fetch("http://localhost:3001/api/gm/login", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: PASSWORD })
})).json()).token;
const cal = (day, month) => ({ yearName: "DR", months: [{ name: "Hammer", days: 30 }, { name: "Alturiak", days: 30 }], weekdays: ["Mon", "Tue"], currentDate: { year: 1492, month, day } });
const put = (body) => fetch(`${API}/codex/calendar`, { method: "PUT", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
await put(cal(10, 0));
await fetch(`${API}/codex/calendar/publish`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
await put(cal(28, 1));

/**
 * Reveal state is seeded EXPLICITLY too, for the same reason: the run itself flips switches, so a second
 * run inherits the first one's reveals and every assertion drifts. Each record below is set to the state
 * one check needs, so the checks do not compete for it.
 */
const reveal = (id, revealed) => fetch(`${API}/codex/journal/${id}/reveal`, {
  method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ revealed })
});
const records = (await (await fetch(`${API}/codex/timeline`, { headers: { authorization: `Bearer ${token}` } })).json()).data.records;
for (const r of records) {
  //  revealed: the deadline, so the audit has a chronicle row whose kind badge can be read
  //  hidden:   everything else — the ahead-dated milestone (the warning) and the GM-text entry (the pills)
  await reveal(r.id, r.text.startsWith("The duke"));
}
log(`  seeded: GM clock Alturiak 28, 1492 · players on Hammer 10, 1492 · ${records.length} records, 1 revealed`);

const b = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const p = await b.newPage({ viewport: { width: W, height: 780 }, hasTouch: true, isMobile: false });
p.on("pageerror", (e) => { log("  !! PAGE ERROR:", e.message); failures += 1; });

await p.goto(BASE, { waitUntil: "networkidle" });
await p.getByText("Enter as GM").click();
await p.waitForTimeout(500);
const pw = p.locator('input[type="password"]').first();
await pw.fill(PASSWORD);
await pw.press("Enter");
await p.waitForTimeout(2500);

const codexTab = p.getByRole("tab", { name: "Codex", exact: true });
await codexTab.waitFor({ state: "visible", timeout: 20_000 });
await codexTab.click({ force: true });
await p.waitForTimeout(1000);
await p.getByRole("tab", { name: "Journal", exact: true }).click({ force: true });
await p.waitForTimeout(1500);
log(`\n=== ${W}px — Journal ===`);

/** §4's authoritative measurement: the paint OR the ::after box, whichever is bigger. */
const tapFloor = async (root) => {
  const sizes = await p.$$eval(`${root} button, ${root} [role="switch"], ${root} a[href]`, (els) => els
    .filter((el) => el.getClientRects().length > 0)
    .map((el) => {
      const r = el.getBoundingClientRect();
      const a = getComputedStyle(el, "::after");
      return { text: (el.textContent || el.getAttribute("aria-label") || "?").trim().slice(0, 34),
               w: Math.round(Math.max(r.width, parseFloat(a.width) || 0)),
               h: Math.round(Math.max(r.height, parseFloat(a.height) || 0)) };
    }));
  return sizes.filter((s) => s.w > 0 && (s.w < 44 || s.h < 44));
};
const noOverflow = async (label) => {
  const wide = await p.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("*")) {
      const r = el.getBoundingClientRect();
      if (r.width > window.innerWidth + 1) out.push(`${Math.round(r.width)}px ${el.tagName}.${String(el.className).slice(0, 40)}`);
    }
    return out.slice(0, 6);
  });
  ok(wide.length === 0, `nothing wider than the viewport — ${label}`, wide.join("; "));
};

// ---- 1. The downtime confirm names the deadline count, and the row does not overflow.
const proposal = p.locator(".codex-downtime-proposal").first();
await proposal.waitFor({ state: "visible", timeout: 10_000 });
const proposalText = (await proposal.textContent()) ?? "";
log(`  proposal reads: "${proposalText}"`);
ok(/this passes 2 deadlines\.$/.test(proposalText), "downtime confirm names the deadline count (expects 2)");
await noOverflow("journal with the downtime confirm");

// ---- 2. The record axis says "Hidden from players"; the content pill still says "GM only".
const entryRow = p.locator(".codex-entry").filter({ hasText: "The party crossed the mists." }).first();
await entryRow.scrollIntoViewIfNeeded();
ok(await entryRow.getByText("Hidden from players").isVisible(), 'record axis reads "Hidden from players"');
ok(await entryRow.locator(".codex-gm-pill").first().isVisible(), 'content pill still reads "GM only"');

// ---- 3. Revealing the ahead-dated milestone warns, names both dates, and gates the reveal.
const milestoneRow = p.locator(".codex-entry").filter({ hasText: "The party reached 5." }).first();
await milestoneRow.scrollIntoViewIfNeeded();
await milestoneRow.getByRole("switch").click();
await p.waitForTimeout(800);
const dialog = p.locator("dialog[open]").first();
ok(await dialog.isVisible(), "reveal-ahead warning opens");
ok(await p.evaluate(() => { const d = document.querySelector("dialog[open]"); const c = [...d.querySelectorAll("button")].find((el) => el.textContent.trim() === "Cancel"); const r = c.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) === c && r.bottom <= window.innerHeight; }), "its buttons are on screen and nothing overlaps them");
const dialogText = (await dialog.textContent()) ?? "";
ok(/Alturiak 28, 1492 DR/.test(dialogText), "warning names the record's date");
ok(/Hammer 10, 1492 DR/.test(dialogText), "warning names what players are still on");
const under = await tapFloor("dialog[open]");
ok(under.length === 0, "every control in the warning meets the 44px floor", under.map((u) => `${u.text} ${u.w}x${u.h}`).join("; "));
await noOverflow("reveal-ahead warning open");
const dw = await dialog.evaluate((el) => el.getBoundingClientRect().width);
ok(dw <= W, "the warning fits the viewport", `dialog ${Math.round(dw)} vs ${W}`);
await p.getByRole("button", { name: "Cancel" }).click({ force: true });
await p.waitForTimeout(700);
ok(await milestoneRow.getByRole("switch").getAttribute("aria-checked") === "false", "cancelling leaves the switch off");

// ---- 3b. The owner's disable setting, and the way back on — the full round trip in a real browser.
log("  -- the warning's own switch --");
await milestoneRow.getByRole("switch").click();
await p.waitForTimeout(700);
const suppress = p.locator("dialog[open]").getByRole("switch", { name: "Stop warning me about this" });
ok(await suppress.isVisible(), "the dialog offers a way to stop the warnings");
await suppress.click({ force: true });
await p.getByRole("button", { name: "Reveal anyway" }).click({ force: true });
await p.waitForTimeout(1000);
ok(await p.evaluate(() => localStorage.getItem("codex.warn-reveal-ahead")) === "off", "the preference persists");
// A second ahead-dated reveal now goes straight through, with no dialog.
const otherAhead = p.locator(".codex-entry").filter({ hasText: "A quiet tenday in Daggerford." }).first();
await otherAhead.scrollIntoViewIfNeeded();
await otherAhead.getByRole("switch").click();
await p.waitForTimeout(900);
ok(await p.locator("dialog[open]").count() === 0, "a suppressed warning does not reopen");
ok(await otherAhead.getByRole("switch").getAttribute("aria-checked") === "true", "and the reveal actually happened");
// The way back on, where the owner asked for it: on the prep-clock row.
const backOn = p.getByRole("button", { name: "Warn me again on reveal" });
ok(await backOn.isVisible(), "the way back on is offered on the prep-clock row");
const backOnBox = await backOn.evaluate((el) => {
  const r = el.getBoundingClientRect(), a = getComputedStyle(el, "::after");
  return { paintH: Math.round(r.height), afterH: Math.round(parseFloat(a.height) || 0), hasAfter: a.content !== "none" && (parseFloat(a.height) || 0) > 0 };
});
ok(Math.max(backOnBox.paintH, backOnBox.afterH) >= 44, "the way-back control meets the 44px floor", JSON.stringify(backOnBox));
// This row sits above the composer's field stack, so §4 route 1 is required: the paint itself must reach
// 44px and there must be no ::after overhanging into the fields below.
ok(backOnBox.paintH >= 44 && !backOnBox.hasAfter, "and takes route 1, so nothing overhangs the composer", JSON.stringify(backOnBox));
await backOn.click();
await p.waitForTimeout(600);
ok(await p.evaluate(() => localStorage.getItem("codex.warn-reveal-ahead")) === "on", "turning it back on persists too");
ok(await p.getByRole("button", { name: "Warn me again on reveal" }).count() === 0, "and the way-back control goes away once used");
// Re-armed without a reload. A THIRD record, still hidden: the milestone and the downtime above were both
// revealed by this point, and clicking their switches now HIDES them — which never warns, by design.
const thirdAhead = p.locator(".codex-entry").filter({ hasText: "The caravan leaves." }).first();
await thirdAhead.scrollIntoViewIfNeeded();
await thirdAhead.getByRole("switch").click();
await p.waitForTimeout(800);
ok(await p.locator("dialog[open]").count() === 1, "the warning is re-armed without a reload");
await p.getByRole("button", { name: "Cancel" }).click({ force: true });
await p.waitForTimeout(600);

// ---- 4. Publishing acknowledges and names the date.
await p.getByRole("button", { name: "Publish the date" }).click();
await p.waitForTimeout(1500);
const notice = p.locator(".notice").first();
ok(await notice.isVisible(), "publishing acknowledges");
const noticeText = ((await notice.textContent()) ?? "").trim();
log(`  acknowledgement reads: "${noticeText}"`);
ok(/Players now see Alturiak 28, 1492 DR\./.test(noticeText), "acknowledgement names the published date");
await noOverflow("after publishing");

// ---- 5. The whole Journal's tap floor, with the new controls on screen.
const journalUnder = await tapFloor(".codex-journal");
ok(journalUnder.length === 0, "every Journal control meets the 44px floor", journalUnder.map((u) => `${u.text} ${u.w}x${u.h}`).join("; "));

// ---- 6. The reveal audit badges a chronicle row's kind.
log(`\n=== ${W}px — Reveal audit ===`);
const opsButtons = await p.locator(".codex-workspace button, header button").allTextContents().catch(() => []);
log(`  ops-row buttons: ${JSON.stringify(opsButtons.filter((t) => t.trim()).slice(0, 20))}`);
const auditBtn = p.getByRole("button", { name: /shared with players|reveal audit|what players can see|players can see/i }).first();
if (await auditBtn.isVisible().catch(() => false)) {
  await auditBtn.click();
  await p.waitForTimeout(1500);
  const chronicleSection = p.locator(".codex-audit-section").filter({ hasText: "Chronicle records" }).first();
  const badges = await chronicleSection.locator("[class*=badge]").allTextContents().catch(() => []);
  log(`  chronicle-row badges: ${JSON.stringify(badges)}`);
  ok(badges.some((t) => /Entry|Deadline|Downtime|Milestone|Standing|Battle/.test(t)), "an audit chronicle row badges its kind");
  await noOverflow("reveal audit");
  const auditUnder = await tapFloor(".codex-audit");
  ok(auditUnder.length === 0, "every audit control meets the 44px floor", auditUnder.map((u) => `${u.text} ${u.w}x${u.h}`).join("; "));
} else {
  log("  SKIP  reveal audit — could not find its opener");
}

log(`\n=== ${W}px: ${failures === 0 ? "all checks passed" : `${failures} FAILURE(S)`} ===`);
await b.close();
process.exit(failures === 0 ? 0 : 1);
