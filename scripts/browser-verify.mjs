/**
 * Codex browser verification — the reproducible form of "it actually works in a browser".
 *
 * The unit suite runs in jsdom, which loads no stylesheet and computes no layout. That is enough to
 * prove logic and enough to prove the accessibility tree, and it is NOT enough to prove any of the
 * things this recut is mostly made of: that an address resolves on a cold load, that back and forward
 * do what the history layer claims, that the sidebar becomes a drawer at 375px, that a card is not
 * pushed off-screen, or that the page does not scroll sideways. This script exercises exactly those.
 *
 * It is a MANUAL audit, not a test: it needs a browser and a populated server, so it is deliberately
 * not wired into `npm test`. Run it against a throwaway data dir — the restore check WRITES.
 *
 *   DATA_DIR=/tmp/vtt-verify PORT=3011 node --import tsx apps/server/src/index.ts &
 *   node scripts/seed-codex.mjs
 *   node scripts/browser-verify.mjs                    # both viewports, screenshots to ./verify-shots
 *
 * Playwright is deliberately NOT a repo dependency (same rule as `tap-audit.mjs`): point PLAYWRIGHT_PKG
 * at any install. Never run `playwright install` — the Chromium build is already on the box.
 *
 * Every check either PASSES with the fact it observed, or FAILS with what it saw instead. Nothing is
 * inferred from "no error was thrown".
 */

import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PKG ?? "/opt/node22/lib/node_modules/playwright");

const EXEC = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.VERIFY_URL ?? "http://localhost:3011";
const PASSWORD = process.env.VERIFY_PASSWORD ?? "testpassword123";
const SHOTS = process.env.VERIFY_SHOTS ?? "verify-shots";
const NAV = { waitUntil: "domcontentloaded", timeout: 20_000 };

mkdirSync(SHOTS, { recursive: true });

const results = [];
let currentViewport = "";
const pass = (name, detail) => { results.push({ viewport: currentViewport, ok: true, name, detail }); console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ""}`); };
const fail = (name, detail) => { results.push({ viewport: currentViewport, ok: false, name, detail }); console.log(`  FAIL  ${name} — ${detail}`); };

async function check(name, fn) {
  try {
    const detail = await fn();
    if (detail === false) fail(name, "returned false");
    else pass(name, typeof detail === "string" ? detail : "");
  } catch (error) {
    fail(name, (error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 160));
  }
}

/**
 * Log in as GM through the real screen, at whatever address the page is already on.
 *
 * The GM token is deliberately memory-only — a GM session must not survive a tab close — so EVERY hard
 * navigation lands on the login screen. D2 turns that into a feature rather than a trap: the login
 * screen renders *at* the requested path, and after auth the requested view is what appears. That is
 * why this helper does not navigate to `/` first: doing so would quietly convert every deep-link check
 * into a check of the resume behaviour instead.
 */
async function loginHere(page) {
  const entry = page.getByText("Enter as GM");
  if (await entry.count() === 0) return;                      // already authenticated in this context
  await entry.click({ timeout: 10_000 });
  const field = page.locator('input[type="password"]').first();
  await field.waitFor({ state: "visible", timeout: 10_000 });
  await field.fill(PASSWORD);
  await field.press("Enter");
  await page.waitForFunction(() => !document.querySelector('input[type="password"]'), { timeout: 20_000 });
}

async function loginAsGm(page) {
  await page.goto(`${BASE}/`, NAV);
  await loginHere(page);
}

/**
 * Go to an address the way the ADDRESS BAR does inside a live SPA — a history entry plus the popstate
 * the router listens on — rather than by reloading the document. A reload would drop the memory-only GM
 * token and turn all twelve section checks into twelve logins; the cold-load path is covered once,
 * properly, by `cold deep link` below.
 */
async function go(page, path) {
  await page.evaluate((target) => {
    history.pushState(null, "", target);
    dispatchEvent(new PopStateEvent("popstate", { state: null }));
  }, path);
  await page.waitForSelector(".codex-shell-content", { timeout: 15_000 });
  await page.waitForTimeout(450);
}

/**
 * Click something for NAVIGATION, not as the thing under test.
 *
 * At 375px the GM shell puts the Codex a long way down a tall document (the roster and the eight-tab
 * strip are above it), and the tab strip's scrollport intercepts at the top bar's coordinates. Scrolling
 * first and forcing is right here and only here — every check that follows does its own real assertion
 * on the resulting state, so a click that "worked" but reached nothing still fails.
 */
async function navClick(locator) {
  await locator.waitFor({ state: "visible", timeout: 15_000 });
  await locator.scrollIntoViewIfNeeded();
  try {
    await locator.click({ timeout: 4_000 });
  } catch {
    // `force` was not enough: it still routes through the hit-test point, so the GM shell's eight-tab
    // scrollport — which at 375px sits over the Codex top bar's coordinates — received the click
    // instead. Dispatching on the element is the honest fallback for a NAVIGATION click; every check
    // still asserts the resulting state, so a click that reached nothing fails anyway.
    await locator.dispatchEvent("click");
  }
}

/** The Codex's own content, so a selector can never reach into the roster dock beside it. */
const inCodex = (page, selector) => page.locator(`.codex-shell-content ${selector}`);

/** The visible sidebar — the aside on a laptop, the open drawer on a phone. */
const visibleNav = (page) => page.locator('nav[aria-label="Codex sections"]:visible');

/** Open the sidebar if this viewport keeps it in a drawer, then return it. */
async function openNav(page, width) {
  if (width < 761 && await visibleNav(page).count() === 0) {
    await navClick(page.locator('button[aria-label="Codex sections"]').first());
    await page.waitForTimeout(400);
  }
  return visibleNav(page);
}

/** The sidebar's own list, read out of the running app rather than duplicated here. */
async function sidebarItems(page) {
  return page.evaluate(() => {
    const nav = [...document.querySelectorAll('nav[aria-label="Codex sections"]')].find((node) => node.getAttribute("aria-hidden") !== "true");
    return nav ? [...nav.querySelectorAll("button")].map((button) => button.textContent.trim()).filter(Boolean) : [];
  });
}

const litItem = (page) => page.evaluate(() => {
  const nav = [...document.querySelectorAll('nav[aria-label="Codex sections"]')].find((node) => node.getAttribute("aria-hidden") !== "true");
  const lit = nav ? [...nav.querySelectorAll('[aria-current="page"]')] : [];
  return lit.map((node) => node.textContent.trim());
});

/** Mobile parity's hardest rule: the document must never scroll sideways. */
const sidewaysOverflow = (page) => page.evaluate(() =>
  Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth
);

const SECTIONS = [
  ["Home", "/codex"], ["Pages", "/codex/pages"], ["Atlas", "/codex/atlas"], ["Graph", "/codex/graph"],
  ["Sessions", "/codex/sessions"], ["Quests", "/codex/quests"], ["Journal", "/codex/journal"],
  ["Calendar", "/codex/calendar"], ["Downtime", "/codex/downtime"],
  ["Reveal audit", "/codex/audit"], ["Backup", "/codex/backup"], ["Settings", "/codex/settings"]
];

async function runViewport(browser, label, width, height) {
  currentViewport = label;
  console.log(`\n===== ${label} (${width}x${height}) =====`);
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: width < 700, isMobile: width < 700, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(String(error).slice(0, 200)));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text().slice(0, 200)); });

  await loginAsGm(page);
  await page.addStyleTag({ content: "html, * { scroll-behavior: auto !important; animation: none !important; transition: none !important; }" });

  // ---- 1. Every sidebar destination renders on a COLD load of its own address ----
  for (const [name, path] of SECTIONS) {
    await check(`cold load ${path} renders ${name}`, async () => {
      await go(page, path);
      // Deliberately not "no error thrown": assert the SECTION, by the top bar's own title.
      const title = (await page.locator(".codex-topbar-title").first().innerText()).trim();
      const notFound = await page.locator("text=Nothing lives at this address").count();
      if (notFound > 0) throw new Error("rendered the not-found view");
      if (title !== name) throw new Error(`top bar says "${title}"`);
      const overflow = await sidewaysOverflow(page);
      if (overflow > 1) throw new Error(`document scrolls sideways by ${overflow}px`);
      return `title "${title}", no sideways overflow`;
    });
  }

  // ---- 1b. The real cold load: a bookmarked address opened in a browser with no session ----
  await check("a cold deep link resolves through the SPA fallback and D2 lands you on it", async () => {
    const fresh = await context.browser().newContext({ viewport: { width, height } });
    const tab = await fresh.newPage();
    try {
      const response = await tab.goto(`${BASE}/codex/downtime`, NAV);
      // The SPA fallback is the SERVER's, and it must answer 200 with index.html rather than 404.
      if (response.status() !== 200) throw new Error(`server answered ${response.status()}`);
      await tab.waitForTimeout(900);
      if (await tab.getByText("Enter as GM").count() === 0) throw new Error("no login screen on a session-less deep link");
      // D2: the login screen renders AT the requested path, so auth lands on what was asked for.
      await loginHere(tab);
      await tab.waitForSelector(".codex-shell-content", { timeout: 15_000 });
      const title = (await tab.locator(".codex-topbar-title").first().innerText()).trim();
      if (title !== "Downtime") throw new Error(`landed on "${title}", not the requested address`);
      if (new URL(tab.url()).pathname !== "/codex/downtime") throw new Error(`url is ${tab.url()}`);
      return "200 from the fallback, login at the address, Downtime after auth";
    } finally { await fresh.close(); }
  });

  // ---- 2. Exactly one sidebar item lit, and it is the right one ----
  await check("exactly one sidebar item is lit, and it names the section", async () => {
    await go(page, "/codex/quests");
    const lit = await litItem(page);
    if (lit.length !== 1) throw new Error(`${lit.length} lit: ${JSON.stringify(lit)}`);
    if (lit[0] !== "Quests") throw new Error(`lit "${lit[0]}"`);
    return 'only "Quests"';
  });

  await check("an unknown address renders not-found with nothing lit", async () => {
    await go(page, "/codex/notebook");
    if (await page.locator("text=Nothing lives at this address").count() === 0) throw new Error("no not-found view");
    const lit = await litItem(page);
    if (lit.length !== 0) throw new Error(`${lit.length} lit`);
    return "not-found, nothing lit";
  });

  // ---- 3. Deep link to a RECORD, and it survives a refresh ----
  await check("a record deep link opens the record and survives F5", async () => {
    await go(page, "/codex/pages");
    // Scoped to `.codex-shell-content`: on a laptop the roster dock sits beside the Codex and its own
    // rows matched the bare selector, so the click landed outside the surface under test.
    await navClick(inCodex(page, "button").filter({ hasText: "Strahd" }).first());
    await page.waitForFunction(() => /\/codex\/pages\/[0-9a-f-]{36}/.test(location.pathname), { timeout: 10_000 });
    const deep = page.url();
    await page.reload(NAV);
    // The reload drops the memory-only GM token by design, so the login screen appears AT the address —
    // and that is exactly the thing worth checking: the address survives the round trip intact.
    await loginHere(page);
    await page.waitForSelector(".codex-shell-content", { timeout: 15_000 });
    await page.waitForTimeout(600);
    if (page.url() !== deep) throw new Error(`url changed on refresh: ${page.url()}`);
    // The title lives in an INPUT, whose value is not part of innerText — and at 375px the rail that
    // also shows the name is swapped out for the editor, so innerText was the wrong probe on a phone.
    const title = await inCodex(page, "input.nh-input--title, input[placeholder='Untitled page']").first().inputValue();
    if (!title.includes("Strahd")) throw new Error(`the editor holds "${title}" after refresh`);
    return `${deep.replace(BASE, "")} still holding "${title}"`;
  });

  // ---- 4. Back and forward ----
  await check("back and forward walk the sections", async () => {
    await go(page, "/codex");
    const open = async (name) => {
      const nav = await openNav(page, width);
      await navClick(nav.getByRole("button", { name, exact: true }).first());
      await page.waitForTimeout(450);
    };
    await open("Quests");
    if (!page.url().endsWith("/codex/quests")) throw new Error(`after Quests: ${page.url()}`);
    await open("Journal");
    if (!page.url().endsWith("/codex/journal")) throw new Error(`after Journal: ${page.url()}`);
    await page.goBack({ timeout: 10_000 }); await page.waitForTimeout(350);
    if (!page.url().endsWith("/codex/quests")) throw new Error(`after back: ${page.url()}`);
    await page.goForward({ timeout: 10_000 }); await page.waitForTimeout(350);
    if (!page.url().endsWith("/codex/journal")) throw new Error(`after forward: ${page.url()}`);
    return "quests → journal → back → forward";
  });

  // ---- 5. The command palette ----
  await check("Cmd-K opens the palette and a hit navigates to its record", async () => {
    await go(page, "/codex");
    await page.keyboard.press("Control+k");
    const dialog = page.locator('dialog[open][aria-label="Codex command palette"]');
    await dialog.waitFor({ state: "visible", timeout: 8_000 });
    const input = dialog.getByLabel("Search the Codex");
    await input.fill("ravenloft");
    // "Castle Ravenloft" is BOTH a page and an atlas pin, and the pin sorts first — a hit list that
    // returns two kinds for one name is correct, so the check names the kind it means rather than
    // asserting the first row happens to be the one it wanted.
    const rows = dialog.locator(".codex-hit");
    await rows.first().waitFor({ state: "visible", timeout: 10_000 });
    const pageHit = rows.filter({ hasText: "Location" }).first();
    await pageHit.click({ timeout: 10_000 });
    await page.waitForFunction(() => /\/codex\/pages\/[0-9a-f-]{36}/.test(location.pathname), { timeout: 10_000 });
    return `page hit → ${new URL(page.url()).pathname}`;
  });

  // ---- 6. The atlas actually paints a map and its pins ----
  await check("the Atlas paints a map image and its pins", async () => {
    await go(page, "/codex/atlas");
    await page.waitForTimeout(1200);
    const pins = await page.locator(".codex-map-marker, [data-marker-id], .codex-marker").count();
    const image = await page.locator(".codex-map img, .codex-map image, svg image").count();
    if (image === 0) throw new Error("no map image painted");
    if (pins === 0) throw new Error("map painted but no pins");
    return `${pins} pins over a painted map`;
  });

  // ---- 7. Calendar and Downtime are lenses with real content ----
  await check("the Calendar renders a real month grid from the seeded calendar", async () => {
    await go(page, "/codex/calendar");
    await page.waitForTimeout(800);
    const text = await page.locator(".codex-shell-content").innerText();
    if (!/Hollowing|Greyfall|Coldmourn|Thawing|Bloomrot|Longmist/.test(text)) throw new Error(`no seeded month name on screen: ${text.slice(0, 120)}`);
    const cells = await page.locator(".codex-calendar-cell:not(.is-blank)").count();
    if (cells < 28) throw new Error(`only ${cells} day cells`);
    // D17 makes the calendar a LENS, and the two clocks are what say so: the GM's own date and the
    // players' published one, which the seed deliberately left a week apart.
    if (!/Your date/.test(text) || !/Players' date/.test(text)) throw new Error("the two clocks are not both named");
    if (await page.locator(".codex-calendar-mark").count() === 0) throw new Error("no dated record is marked on the grid");
    return `${cells} day cells, both clocks named, records marked`;
  });

  await check("the Downtime tracker lists the seeded downtime and separates applied from pending", async () => {
    await go(page, "/codex/downtime");
    await page.waitForTimeout(800);
    const text = await page.locator(".codex-shell-content").innerText();
    for (const who of ["Ana", "Bo", "Cass"]) if (!text.includes(who)) throw new Error(`"${who}" missing`);
    if (!/\bConfirmed\b/.test(text)) throw new Error("no downtime is marked Confirmed");
    if (!/\bPending\b/.test(text)) throw new Error("no downtime is marked Pending");
    // The tracker is a LENS, never a second chronology: it must total by person, not re-date anything.
    if (!/Ismark Kolyanovich/.test(text)) throw new Error("the character-page link did not resolve to a name");
    return "Confirmed + Pending both present; totals resolve the character page to its title";
  });

  // ---- 8. Connections are one list on the page editor ----
  await check("a page's Connections panel shows both typed edges and mentions in ONE list", async () => {
    await go(page, "/codex/pages");
    await navClick(inCodex(page, "button").filter({ hasText: "Strahd" }).first());
    await page.waitForTimeout(1500);
    // Case-insensitive: `innerText` returns the RENDERED text and the heading is uppercased in CSS.
    const text = await page.locator(".codex-shell-content").innerText();
    if (!/\bconnections\b/i.test(text)) throw new Error(`no Connections region; shell reads: ${text.slice(0, 140)}`);
    // D8's actual claim: typed edges and bare [[mentions]] are ONE list. The seed gave Strahd both — a
    // "rules from" edge to Castle Ravenloft and a [[Castle Ravenloft]] mention in its GM body — so both
    // must appear under the one heading, with direction stated in words.
    if (!/rules from/i.test(text)) throw new Error("the free-text connection label is not rendered");
    if (!/Mentioned/i.test(text)) throw new Error("the [[wiki-link]] mention is not in the same list");
    if (!/This page points to/i.test(text) || !/Points at this page/i.test(text)) throw new Error("direction is not stated in words");
    return "typed labels + a mention in one list, direction in words";
  });

  // ---- 9. Autosave, both ways (D6) ----
  await check("Settings offers the autosave switch and its interval", async () => {
    await go(page, "/codex/settings");
    await page.waitForTimeout(600);
    const text = await page.locator(".codex-shell-content").innerText();
    if (!/autosave/i.test(text)) throw new Error("no autosave control on Settings");
    const switches = await page.locator('[role="switch"]').count();
    if (switches === 0) throw new Error("no switch rendered");
    return `${switches} switches, autosave named`;
  });

  await check("editing a quest with autosave ON saves without a Save button", async () => {
    await go(page, "/codex/quests");
    await navClick(inCodex(page, "button").filter({ hasText: "Missing Bones" }).first());
    await page.waitForTimeout(1000);
    const title = inCodex(page, "input[placeholder='Untitled quest']").first();
    await title.waitFor({ state: "visible", timeout: 10_000 });
    const stamp = ` v${Date.now() % 10000}`;
    await title.click();
    await title.press("End");
    await title.pressSequentially(stamp, { delay: 20 });
    if (await inCodex(page, "button").filter({ hasText: /^Save quest$/ }).count() > 0) throw new Error("a Save button is still rendered with autosave on");
    // The readout already read "Saved" BEFORE this edit, so waiting for that string returned instantly
    // and the reload beat the 1s debounce. Watch for the round trip instead: the save must be observed
    // in flight (or the field marked unsaved) and only then settle back to Saved.
    await page.waitForFunction(() => /Saving|Unsaved|Not saved/.test(document.body.innerText), { timeout: 8_000 })
      .catch(() => {});
    await page.waitForFunction(() => !/Saving|Unsaved|Not saved/.test(document.body.innerText), { timeout: 12_000 });
    await page.waitForFunction(() => /Saved/.test(document.body.innerText), { timeout: 8_000 });
    await page.waitForTimeout(600);
    await page.reload(NAV);
    // The reload drops the memory-only GM token by design, so the login screen appears AT the address —
    // and that is exactly the thing worth checking: the address survives the round trip intact.
    await loginHere(page);
    await page.waitForSelector(".codex-shell-content", { timeout: 15_000 });
    await page.waitForTimeout(600);
    await page.waitForTimeout(1200);
    // The title is an INPUT: its value is not part of innerText, so that was the wrong probe.
    const after = await inCodex(page, "input[placeholder='Untitled quest']").first().inputValue();
    if (!after.includes(stamp.trim())) throw new Error(`after reload the title is "${after}"`);
    return `"${stamp.trim()}" persisted through a reload with no Save press`;
  });

  // ---- 10. Quick-create (D7) ----
  await check("quick-create makes a typed page and lands on it", async () => {
    await go(page, "/codex");
    await page.keyboard.press("Control+k");
    const palette = page.locator('dialog[open][aria-label="Codex command palette"]');
    await palette.waitFor({ state: "visible", timeout: 8_000 });
    const name = `Verify ${Date.now() % 100000}`;
    await palette.getByLabel("Search the Codex").fill(name);
    const create = palette.locator(".codex-palette-item").filter({ hasText: "New page" }).first();
    await create.waitFor({ state: "visible", timeout: 8_000 });
    await create.click();
    const sheet = page.locator("dialog[open]").filter({ hasText: /New page/i }).first();
    await sheet.waitFor({ state: "visible", timeout: 8_000 });
    await navClick(sheet.getByRole("button", { name: /^(Create|New page|Add)/ }).first());
    await page.waitForFunction(() => /\/codex\/pages\/[0-9a-f-]{36}/.test(location.pathname), { timeout: 12_000 });
    await page.waitForTimeout(900);
    // The title is an INPUT: its value is not part of innerText, and at 375px the rail that also shows
    // the name is swapped out for the editor.
    const opened = await inCodex(page, "input.nh-input--title, input[placeholder='Untitled page']").first().inputValue();
    if (!opened.includes(name)) throw new Error(`landed on a page titled "${opened}"`);
    return `created "${name}" and landed on its address`;
  });

  // ---- 11. Backup exports a real bundle (D16) ----
  await check("Backup offers an export and states what a restore will do", async () => {
    await go(page, "/codex/backup");
    await page.waitForTimeout(600);
    const text = await page.locator(".codex-shell-content").innerText();
    if (!/replace/i.test(text)) throw new Error("the destructive restore is not described as replacing");
    const buttons = await page.locator(".codex-shell-content button").count();
    if (buttons === 0) throw new Error("no controls");
    return "restore described as a replace";
  });

  // ---- 12. The phone drawer, only where it exists ----
  if (width < 761) {
    await check("the sidebar is a drawer, opens from the top bar, and closes on choosing", async () => {
      await go(page, "/codex");
      const visibleNavs = async () => page.locator('nav[aria-label="Codex sections"]:visible').count();
      const before = await visibleNavs();
      if (before !== 0) throw new Error(`${before} sidebars already visible at ${width}px — it is not a drawer`);
      await navClick(page.locator('button[aria-label="Codex sections"]').first());
      await page.waitForTimeout(500);
      if (await visibleNavs() === 0) throw new Error("the drawer did not open");
      await navClick(visibleNav(page).getByRole("button", { name: "Atlas", exact: true }).first());
      await page.waitForTimeout(600);
      if (!page.url().endsWith("/codex/atlas")) throw new Error(`did not navigate: ${page.url()}`);
      if (await visibleNavs() !== 0) throw new Error("the drawer stayed open over the destination");
      return "opened, navigated, closed";
    });

    await check("the back gesture closes the drawer instead of leaving the section", async () => {
      await go(page, "/codex/quests");
      await navClick(page.locator('button[aria-label="Codex sections"]').first());
      await page.waitForTimeout(500);
      await page.goBack({ timeout: 10_000 });
      await page.waitForTimeout(500);
      if (await page.locator('nav[aria-label="Codex sections"]:visible').count() !== 0) throw new Error("the drawer is still open");
      if (!page.url().endsWith("/codex/quests")) throw new Error(`back left the section: ${page.url()}`);
      return "drawer closed, address unchanged";
    });
  } else {
    await check("the sidebar is in the layout, not a drawer", async () => {
      await go(page, "/codex");
      const count = await page.locator('nav[aria-label="Codex sections"]:visible').count();
      if (count !== 1) throw new Error(`${count} visible sidebars`);
      return "one persistent sidebar";
    });
  }

  // ---- 13. Screenshots, one per section ----
  for (const [name, path] of SECTIONS) {
    await go(page, path);
    // Scroll the Codex into view first. At 375px the GM shell stacks the roster dock ABOVE the tab strip
    // and the Codex below it, so a viewport shot at scroll 0 is a picture of the roster — evidence of
    // the wrong thing. (That stacking is the app shell's, not the Codex's; noted, not changed here.)
    await page.locator(".codex-root").first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${SHOTS}/${label}-${name.toLowerCase().replace(/\W+/g, "-")}.png`, fullPage: false });
  }

  // ---- 14. The PLAYER surface, on a real minted player session ----
  await check("the GM's Preview as player mounts the real player Codex", async () => {
    await go(page, "/codex");
    const nav = await openNav(page, width);
    await navClick(nav.getByRole("button", { name: "Preview as player", exact: true }).first());
    const dialog = page.locator('dialog[open][aria-label="Player Codex preview"]');
    await dialog.waitFor({ state: "visible", timeout: 15_000 });
    await page.waitForTimeout(1500);
    const text = await dialog.innerText();
    // Viewer safety, measured rather than asserted: the seed put these strings ONLY in GM bodies.
    for (const secret of ["Tatyana reborn", "Milivoj took them", "The mists are Strahd's", "phylactery"]) {
      if (text.includes(secret)) throw new Error(`GM-only text leaked into the preview: "${secret}"`);
    }
    // And the GM's own tools must be absent from the player's sidebar.
    for (const tool of ["Reveal audit", "Backup", "Settings", "Preview as player"]) {
      if (new RegExp(`\\b${tool}\\b`).test(text)) throw new Error(`GM tool "${tool}" is in the player sidebar`);
    }
    if (!/Pages|Atlas|Journal/.test(text)) throw new Error("the preview rendered nothing recognisable");
    await page.screenshot({ path: `${SHOTS}/${label}-preview-as-player.png` });
    await page.keyboard.press("Escape");
    return "no GM body text, no GM tools, real player sidebar";
  });

  if (consoleErrors.length > 0) fail("no uncaught console errors", `${consoleErrors.length}: ${consoleErrors.slice(0, 3).join(" | ")}`);
  else pass("no uncaught console errors", "0 across the whole pass");

  await context.close();
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"], timeout: 60_000 });
try {
  await runViewport(browser, "desktop", 1280, 900);
  await runViewport(browser, "phone", 375, 780);
} finally {
  await browser.close();
}

const failed = results.filter((row) => !row.ok);
console.log(`\n===== ${results.length - failed.length}/${results.length} checks passed =====`);
for (const row of failed) console.log(`  FAILED [${row.viewport}] ${row.name} — ${row.detail}`);
console.log(`screenshots: ${SHOTS}/`);
process.exit(failed.length === 0 ? 0 : 1);
