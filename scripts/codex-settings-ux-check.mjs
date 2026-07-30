/**
 * Real-browser check of the Codex settings screen (owner decisions, 2026-07-30), at a phone width.
 *
 * WHY THIS IS COMMITTED, and why the jsdom suite is not enough for it. The confirms are native `<dialog>`
 * (`test/setup.ts` shims `show()` semantics, not `showModal()`); the 44px floor and the route-1/route-2
 * distinction are layout; and the fenced danger area's wrapping at 320px is CSS, which no stylesheet is
 * loaded for under jsdom. Same reasoning and same conventions as `tap-audit.mjs`.
 *
 *   npm i --no-save playwright-core       # ...or point PLAYWRIGHT_CORE at an existing install
 *   npm run dev                           # in another shell
 *   node scripts/codex-settings-ux-check.mjs 375
 *   node scripts/codex-settings-ux-check.mjs 320
 *
 * IT SEEDS ITS OWN FIXTURE and needs to: the run itself changes settings and can delete history, so a second
 * run would inherit the first one's state and read as a failure where the behaviour is right.
 *
 * TWO MEASUREMENT TRAPS IT AVOIDS, both of which produced a false PASS in the sibling script first:
 *  - `isMobile: true` lets Chrome WIDEN the layout viewport to fit overflowing content, so
 *    `body.scrollWidth <= window.innerWidth` compares equal and passes vacuously. Fixed viewport instead,
 *    and overflow is measured by walking elements against the real viewport.
 *  - `getBoundingClientRect()` alone misses `.tap-target`'s `::after`, which is route 2's whole mechanism.
 *    §4's measurement is max(paint, ::after).
 *
 * Playwright will not click through the `<dialog>` top layer even where `elementFromPoint` returns the
 * button, so dialog clicks are forced and the check asserts the OUTCOME.
 */
const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const EXEC = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.AUDIT_URL ?? "http://localhost:5173/";
const API = process.env.AUDIT_API ?? "http://localhost:3001/api/v1";
const PASSWORD = process.env.AUDIT_PASSWORD ?? "testpassword123";
const W = Number(process.argv[2] || 375);
const log = (...a) => console.log(...a);
let failures = 0;
const ok = (cond, label, extra = "") => { log(`${cond ? "  PASS" : "  FAIL"}  ${label}${extra ? ` — ${extra}` : ""}`); if (!cond) failures += 1; };

// ---- Seed: history ON at a 90-minute window, with rows to report and delete.
const token = (await (await fetch(BASE.replace(/:\d+\/?$/, ":3001") + "api/gm/login", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: PASSWORD })
}).catch(() => fetch("http://localhost:3001/api/gm/login", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: PASSWORD })
}))).json()).token;
const gm = (path, init = {}) => fetch(`${API}${path}`, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
const putSettings = (enabled, windowMinutes) => gm("/codex/settings", { method: "PUT", body: JSON.stringify({ revisionHistory: { enabled, windowMinutes } }) });
await putSettings(true, 0);
for (let n = 0; n < 2; n += 1) {
  const page = (await (await gm("/codex/pages", { method: "POST", body: JSON.stringify({ title: `UX seed ${n}`, playerBody: "v0" }) })).json()).data.page;
  let rev = page.rev;
  for (let e = 1; e <= 2; e += 1) {
    rev = (await (await gm(`/codex/pages/${page.id}`, { method: "PATCH", body: JSON.stringify({ playerBody: `v${e}`, expectedRev: rev }) })).json()).data.page.rev;
  }
}
await putSettings(true, 90);
const seeded = (await (await gm("/codex/settings")).json()).data.settings.revisionHistory;
log(`  seeded: history on, 90-minute window, ${seeded.versionCount} versions`);

const b = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const p = await b.newPage({ viewport: { width: W, height: 820 }, hasTouch: true, isMobile: false });
p.on("pageerror", (e) => { log("  !! PAGE ERROR:", e.message); failures += 1; });

await p.goto(BASE, { waitUntil: "networkidle" });
await p.getByText("Enter as GM").click();
await p.waitForTimeout(500);
const pw = p.locator('input[type="password"]').first();
await pw.fill(PASSWORD);
await pw.press("Enter");
await p.waitForTimeout(2500);
await p.getByRole("tab", { name: "Codex", exact: true }).click({ force: true });
await p.waitForTimeout(1200);

/** §4's authoritative measurement: the paint OR the ::after box, whichever is bigger. */
const tapFloor = async (root) => p.$$eval(`${root} button, ${root} [role="switch"], ${root} input, ${root} a[href]`, (els) => els
  .filter((el) => el.getClientRects().length > 0)
  .map((el) => {
    const r = el.getBoundingClientRect(), a = getComputedStyle(el, "::after");
    return { text: (el.textContent || el.getAttribute("aria-label") || el.id || "?").trim().slice(0, 34),
             w: Math.round(Math.max(r.width, parseFloat(a.width) || 0)),
             h: Math.round(Math.max(r.height, parseFloat(a.height) || 0)) };
  })).then((sizes) => sizes.filter((s) => s.w > 0 && (s.w < 44 || s.h < 44)));
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

log(`\n=== ${W}px — Codex settings ===`);
// ---- 1. It is reachable from the ops row, and opening it closes the other destinations.
const opener = p.getByRole("button", { name: "Codex settings", exact: true });
ok(await opener.isVisible(), "reachable from the ops row");
await opener.click();
await p.waitForTimeout(1200);
ok(await p.locator(".codex-settings").isVisible(), "the screen opens");
ok(await p.getByRole("heading", { name: "Codex settings" }).isVisible(), "and names itself");
ok(await p.locator(".codex-audit").count() === 0 && await p.locator(".codex-sessions").count() === 0,
   "the other destinations are not stacked behind it");

// ---- 2. The settings read from the live server, not from a default.
const toggle = p.getByRole("switch", { name: "Keep version history" });
ok(await toggle.getAttribute("aria-checked") === "true", "reads the live enabled state");
ok(await p.getByLabel(/Save a version at most once every/).inputValue() === "90", "reads the live window");
ok(await p.getByText(/up to 90 minutes behind it/).isVisible(), "explains how far behind the newest version can be");
ok(await p.getByText(new RegExp(`${seeded.versionCount} saved versions?`)).isVisible(), "reports the real version count");
await noOverflow("settings screen");

// ---- 3. Every control clears the 44px floor.
const under = await tapFloor(".codex-settings");
ok(under.length === 0, "every control meets the 44px floor", under.map((u) => `${u.text} ${u.w}x${u.h}`).join("; "));

// ---- 4. Writing a setting round-trips to the server.
const field = p.getByLabel(/Save a version at most once every/);
await field.fill("45");
await p.waitForTimeout(1200);
const stored = (await (await gm("/codex/settings")).json()).data.settings.revisionHistory;
ok(stored.windowMinutes === 45, "a changed window reaches the server", `server holds ${stored.windowMinutes}`);
ok(await p.getByText(/up to 45 minutes behind it/).isVisible(), "and the note follows it");

// ---- 5. Turning history off hides the frequency and says the kept versions survive.
await toggle.click();
await p.waitForTimeout(1200);
ok((await (await gm("/codex/settings")).json()).data.settings.revisionHistory.enabled === false, "the switch reaches the server");
ok(await p.getByText(/New versions are not being saved/).isVisible(), "says nothing new is being saved");
ok(await p.getByText(/can still be restored from a page's History/).isVisible(), "and that the kept ones survive");
ok(await p.getByLabel(/Save a version at most once every/).count() === 0, "the frequency field is gone while off");
await toggle.click();
await p.waitForTimeout(1000);

// ---- 6. The destructive area: fenced, confirmed, and it names the count.
await noOverflow("with the danger area on screen");
const trimBtn = p.getByRole("button", { name: /^Delete versions older than \d+ days?$/ });
ok(await trimBtn.isVisible(), "offers a bounded delete");
const allBtn = p.getByRole("button", { name: "Delete all version history" });
ok(await allBtn.isVisible(), "offers delete-all as its own control");
// The day field floors at 1: winding it down must not become a route to deleting everything.
await p.getByLabel(/Delete versions older than/).fill("0");
await p.waitForTimeout(400);
ok(await p.getByRole("button", { name: "Delete versions older than 1 day" }).isVisible(),
   "the day field floors at 1, so delete-all is not reachable by winding it down");

await allBtn.click();
await p.waitForTimeout(800);
const dialog = p.locator("dialog[open]").first();
ok(await dialog.isVisible(), "delete-all confirms first");
const dialogText = (await dialog.textContent()) ?? "";
ok(new RegExp(`Delete all ${seeded.versionCount.toLocaleString()} saved versions?`).test(dialogText), "the confirm names the real count", dialogText.slice(0, 80));
ok(/pages themselves are not touched/.test(dialogText), "and says the pages are safe");
const dialogUnder = await tapFloor("dialog[open]");
ok(dialogUnder.length === 0, "the confirm's controls meet the 44px floor", dialogUnder.map((u) => `${u.text} ${u.w}x${u.h}`).join("; "));
await noOverflow("delete-all confirm open");

// Declining deletes nothing — asserted against the SERVER, not the screen.
await p.getByRole("button", { name: "Cancel" }).click({ force: true });
await p.waitForTimeout(900);
ok((await (await gm("/codex/settings")).json()).data.settings.revisionHistory.versionCount === seeded.versionCount,
   "declining the confirm deletes nothing");

// Proceeding does, and the pages survive it.
const pagesBefore = (await (await gm("/codex/pages")).json()).data.pages.length;
await allBtn.click();
await p.waitForTimeout(700);
await p.getByRole("button", { name: "Delete all versions" }).click({ force: true });
await p.waitForTimeout(1500);
const after = (await (await gm("/codex/settings")).json()).data.settings.revisionHistory;
ok(after.versionCount === 0, "confirming deletes the history", `server holds ${after.versionCount}`);
ok(await p.getByText(/Deleted .* saved versions?\./).isVisible(), "and says how many went");
ok((await (await gm("/codex/pages")).json()).data.pages.length === pagesBefore, "the pages themselves survive");
// The BADGE specifically: "Deleted 10 saved versions." also contains this text, and matching that instead
// would assert the acknowledgement rather than the re-read count.
ok(await p.locator(".codex-settings-usage").getByText("0 saved versions", { exact: true }).isVisible(), "the count on screen is re-read, not stale");
ok(await allBtn.isDisabled(), "with nothing left, the delete is disabled rather than lying");

log(`\n=== ${W}px: ${failures === 0 ? "all checks passed" : `${failures} FAILURE(S)`} ===`);
await b.close();
process.exit(failures === 0 ? 0 : 1);
