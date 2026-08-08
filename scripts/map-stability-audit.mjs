/**
 * The map-stability audit — the reproducible form of one sentence: THE BATTLE MAP DOES NOT MOVE
 * WHEN YOU LET GO OF A TOKEN. It drives a real GM session on a real fight, drags a real token with
 * real pointer events, and records `.encounter-map-stage.getBoundingClientRect()` before
 * pointer-down, during the drag, and — the frame that matters — while `.encounter-map-saving`
 * ("Saving move…") is mounted. `top` and `height` must be identical across all three, to the pixel.
 *
 * WHY THIS FILE EXISTS AT ALL. This is `4h`, and `4h` has been reported twice. It was fixed once
 * (22f04ed / 868ac16, 2026-07-22) by floating the token tray and the saving line out of flow in
 * enlarged mode, because a status line mounting in-flow on token release steals height from the
 * `flex: 1` stage and bounces the map. The table-frame lane later made the enlarged shape the
 * NORMAL shape — and carried over the tray's float but not the saving line's, so the same defect
 * came back on the arm everybody actually uses. Nothing caught it, because nothing could:
 *
 *   A DOM-ONLY UNIT TEST CANNOT SEE THIS. It is a layout fact. jsdom has no layout — every
 *   `getBoundingClientRect()` there is zero — so no test in `apps/client`'s `dom` project can
 *   distinguish a stage that holds its height from one that loses 28px. The regression is invisible
 *   to `npm test` by construction, which is why it shipped twice.
 *
 * Same terms as `tap-audit.mjs` and `no-scroll-audit.mjs`: it needs a browser and a running dev
 * server, so it is a scripted manual audit, deliberately NOT wired into `npm test`.
 * `playwright-core` is intentionally not a repo dependency — install it outside the tree or point
 * PLAYWRIGHT_CORE at any install:
 *
 *   npm i --no-save playwright-core     # ...or set PLAYWRIGHT_CORE
 *   npm run dev                         # in another shell, against a THROWAWAY DATA_DIR
 *   node scripts/map-stability-audit.mjs
 *
 * IT MUTATES THE SERVER: it moves tokens on the live fight, which is the only way to measure the
 * thing. Point DATA_DIR at a copy.
 *
 * IT NEEDS A FIGHT WITH A MAP AND A PLACED TOKEN, and it will start the fight itself if the party
 * is staged and a battle map exists. It will NOT upload a map or invent a roster — a state it
 * cannot reach is reported NOT MEASURED and fails the run, never skipped silently.
 *
 * HOW IT HOLDS THE MOMENT STILL. "Saving move…" is up for one server round-trip, which on localhost
 * is tens of milliseconds — too short to photograph and too short to trust a poll with. Chromium's
 * `Network.emulateNetworkConditions` does not reach socket.io's WebSocket (measured: latency 2500ms
 * changed nothing), so the audit delays inbound socket frames in the page instead, uniformly and
 * therefore in order, for the length of one measurement. Two independent captures then have to
 * agree: a MutationObserver that measures synchronously the instant the node is added — that is the
 * capture that would still work with no delay at all — and rAF samples across the held window.
 *
 * WHAT IT COVERS. The three compositions the CSS actually distinguishes, at the two rungs the
 * layout distinguishes: undocked, docked left and docked right at 1280x900 and 1024x667 (the stage
 * is `flex: 1` and the saving line is out of flow), 390x844 and 320x568 (the stage's height is
 * STATED and the line folds back in flow), and enlarged (`position: fixed` over the page). Every
 * cell asserts the same thing, because the requirement does not vary: the map holds still.
 *
 * WHAT A GREEN RUN IS NOT WORTH. It measures the GM. A player sees the same CSS and the same
 * markup — the arm is chosen by viewport and dock preference, not by role — but a player can only
 * move a character they have claimed, and this audit does not claim one. It also measures one drag
 * per cell, not every gesture kind.
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const EXEC = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.AUDIT_URL ?? "http://localhost:5173/";
const PASSWORD = process.env.AUDIT_PASSWORD ?? "testpassword123";

/**
 * The compositions, and why each is here. The first three are the `flex: 1` column above the 979
 * rung — the arm `4h` broke on — in the three dock states, because `.encounter-map-dock` changes
 * what shares the stage. 1024x667 is a short laptop, where a stage that loses 28px loses a larger
 * fraction of itself. The two phones are the arm where `encounter-map.css` states the stage's
 * height, which is why `4h` was never reproducible there and why it still must not be. Enlarged is
 * the arm the original fix was written for; if it ever regresses, it regresses here.
 */
const CASES = [
  { label: "1280x900 undocked", w: 1280, h: 900, dock: null },
  { label: "1280x900 dock-left", w: 1280, h: 900, dock: "left" },
  { label: "1280x900 dock-right", w: 1280, h: 900, dock: "right" },
  { label: "1024x667 undocked", w: 1024, h: 667, dock: null },
  { label: "1280x900 enlarged", w: 1280, h: 900, dock: null, enlarged: true },
  { label: "390x844 phone", w: 390, h: 844, dock: null },
  { label: "320x568 phone", w: 320, h: 568, dock: null }
];

/**
 * Delay every inbound socket frame while `__holdSocket` is set, so "Saving move…" stays mounted long
 * enough to sample. Uniform delay means FIFO order is preserved — the app sees the same messages in
 * the same order, just later. Installed before any app script runs, because socket.io assigns
 * `onmessage` during connect.
 */
const HOLD_SOCKET = `
  const proto = WebSocket.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "onmessage");
  Object.defineProperty(proto, "onmessage", {
    configurable: true,
    get() { return desc.get.call(this); },
    set(fn) {
      const socket = this;
      desc.set.call(this, typeof fn === "function" ? function (event) {
        if (window.__holdSocket) setTimeout(() => fn.call(socket, event), window.__holdSocket);
        else fn.call(socket, event);
      } : fn);
    }
  });
`;

/**
 * THE MEASUREMENT. `top` and `height` of the stage, tagged with whether the saving line was mounted
 * when it was taken. The MutationObserver arm is the one that does not depend on the socket hold:
 * it measures inside the same task that added the node, before paint, which is exactly the frame a
 * human sees the map jump in.
 */
const INSTRUMENT = `(() => {
  const stage = document.querySelector(".encounter-map-stage");
  const interaction = document.querySelector(".encounter-map-interaction");
  if (!stage || !interaction) return false;
  const log = { samples: [], mounts: 0 };
  window.__mapStability = log;
  const rect = () => { const b = stage.getBoundingClientRect(); return { top: Math.round(b.top * 100) / 100, height: Math.round(b.height * 100) / 100 }; };
  log.push = (phase) => log.samples.push({ phase, saving: Boolean(document.querySelector(".encounter-map-saving")), ...rect() });
  const isSaving = (n) => n.nodeType === 1 && n.classList && n.classList.contains("encounter-map-saving");
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) if (isSaving(node)) { log.mounts += 1; log.push("saving-mounted"); }
      for (const node of record.removedNodes) if (isSaving(node)) log.push("saving-unmounted");
    }
  });
  observer.observe(interaction, { childList: true, subtree: true });
  log.stop = () => observer.disconnect();
  return true;
})()`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"], timeout: 60_000 });
const at = (path) => `${BASE}${path.replace(/^\//, "")}`.replace(/([^:])\/\//g, "$1/");

/** GM login at /table (tap-audit's flow: auth lands on the address that asked for it). */
async function gmPage(viewport, dock) {
  const page = await browser.newPage({ viewport, hasTouch: viewport.width < 980 });
  page.setDefaultTimeout(20_000);
  await page.addInitScript(HOLD_SOCKET);
  if (dock) await page.addInitScript((side) => localStorage.setItem("vtt.dock-position", side), dock);
  await page.goto(at("table"), { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByText("Enter as GM").click({ timeout: 15_000 });
  const password = page.locator('input[type="password"]').first();
  await password.waitFor({ state: "visible", timeout: 10_000 });
  await password.fill(PASSWORD);
  await password.press("Enter");
  await page.waitForSelector(".table-layout", { timeout: 25_000 });
  // No transitions, so a rect is never read mid-animation.
  await page.addStyleTag({ content: "html, * { scroll-behavior: auto !important; animation: none !important; transition: none !important; }" });
  await page.waitForTimeout(1500);
  return page;
}

/** A fight with a map is the state this audit measures; it starts one rather than measure an empty table. */
async function ensureFight(page) {
  if (await page.locator(".encounter-panel.combat-active").count()) return;
  const pick = page.getByRole("button", { name: /Pick a map/i }).first();
  if (await pick.count()) {
    await pick.click();
    await page.waitForSelector(".map-picker-grid", { timeout: 15_000 });
    const tile = page.locator(".map-tile:not(.map-tile--upload)").first();
    if ((await tile.count()) === 0) throw new Error("no battle map on this server to fight on");
    await tile.click({ timeout: 15_000 });
    await page.waitForTimeout(2000);
  }
  const start = page.getByRole("button", { name: /Start the fight/i }).first();
  if ((await start.count()) === 0) throw new Error("no fight running and no start control on /table");
  await start.click({ timeout: 10_000 });
  await page.waitForSelector(".encounter-panel.combat-active", { timeout: 20_000 });
}

/** Tapping a tray chip drops it at the centre — the keyboard/touch route, and the audit's fixture. */
async function ensurePlacedToken(page) {
  if (await page.locator(".encounter-token.movable").count()) return;
  const chip = page.locator(".tray-token").first();
  if ((await chip.count()) === 0) throw new Error("no token on the map and none in the tray to place");
  await chip.click();
  await page.waitForTimeout(1500);
}

/**
 * A token whose own centre hit-tests to itself. The map's controls (`.encounter-map-zoom`, the
 * toolbar) sit over the stage and `beginGesture` returns early for them, so a token parked under the
 * Scenes button is not draggable and would measure nothing while looking like a pass.
 */
const CLEAR_TOKEN = `(() => [...document.querySelectorAll(".encounter-token.movable")].findIndex((el) => {
  const r = el.getBoundingClientRect();
  const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return Boolean(at && at.closest(".encounter-token") === el);
}))()`;

async function measure(testCase) {
  const page = await gmPage({ width: testCase.w, height: testCase.h }, testCase.dock);
  try {
    await ensureFight(page);
    await ensurePlacedToken(page);
    if (testCase.enlarged) {
      // `.map-toolbar-group` is the bar's own View button; the panel it opens repeats the label.
      await page.locator(".map-toolbar-group", { hasText: "View" }).first().click({ timeout: 10_000 });
      await page.getByRole("button", { name: "Enlarge map" }).click({ timeout: 10_000 });
      await page.waitForSelector(".encounter-map-interaction.enlarged", { timeout: 10_000 });
      await page.keyboard.press("Escape");
      await page.waitForTimeout(700);
    }
    if (testCase.dock && !(await page.evaluate(() => document.querySelector(".table-layout.docked") !== null))) {
      throw new Error("the docked composition never rendered");
    }
    const index = await page.evaluate(CLEAR_TOKEN);
    if (index < 0) throw new Error("every token is parked under one of the map's own controls");

    const box = await page.locator(".encounter-token.movable").nth(index).boundingBox();
    const stage = await page.locator(".encounter-map-stage").boundingBox();
    if (!box || !stage) throw new Error("the token or the stage has no box");
    await page.evaluate(INSTRUMENT);
    await page.evaluate(() => window.__mapStability.push("before-pointerdown"));

    // Aim at the stage's centre from an edge, or a comfortable step away from the middle: far enough
    // that the move is not read as "stayed in the same space", inside the stage either way.
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const centre = { x: stage.x + stage.width / 2, y: stage.y + stage.height / 2 };
    const to = {
      x: Math.abs(from.x - centre.x) > stage.width / 4 ? centre.x : from.x + Math.min(80, stage.width / 5),
      y: Math.abs(from.y - centre.y) > stage.height / 4 ? centre.y : from.y + Math.min(60, stage.height / 5)
    };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    for (let step = 1; step <= 8; step += 1) {
      await page.mouse.move(from.x + (to.x - from.x) * step / 8, from.y + (to.y - from.y) * step / 8);
      await page.evaluate(() => window.__mapStability.push("drag"));
      await page.waitForTimeout(20);
    }
    await page.evaluate(() => { window.__holdSocket = 2500; });
    await page.mouse.up();

    await page.waitForSelector(".encounter-map-saving", { state: "attached", timeout: 8_000 });
    for (let sample = 0; sample < 12; sample += 1) {
      await page.evaluate(() => window.__mapStability.push("saving-held"));
      await page.waitForTimeout(60);
    }
    await page.evaluate(() => { window.__holdSocket = 0; });
    await page.waitForSelector(".encounter-map-saving", { state: "detached", timeout: 10_000 });
    await page.evaluate(() => { window.__mapStability.push("settled"); window.__mapStability.stop(); });

    const log = await page.evaluate(() => window.__mapStability);
    if (log.mounts === 0) throw new Error("the saving line never mounted — the move did not submit");
    const held = log.samples.filter((s) => s.saving);
    if (held.length === 0) throw new Error("never sampled the stage while the saving line was up");
    const base = log.samples[0];
    const worst = (key) => held.reduce((max, s) => Math.max(max, Math.abs(s[key] - base[key])), 0);
    const drift = { top: worst("top"), height: worst("height") };
    const finish = log.samples[log.samples.length - 1];
    return {
      base, drift, held: held.length, mounts: log.mounts,
      settledDrift: { top: Math.abs(finish.top - base.top), height: Math.abs(finish.height - base.height) }
    };
  } finally {
    await page.close();
  }
}

const rows = [];
let failures = 0;
let unmeasured = 0;

for (const testCase of CASES) {
  try {
    const result = await measure(testCase);
    // TO THE PIXEL. There is no budget here: the stage either kept its box or the map moved. A
    // tolerance would be a place for the next 28px to hide.
    const bad = result.drift.top !== 0 || result.drift.height !== 0
      || result.settledDrift.top !== 0 || result.settledDrift.height !== 0;
    if (bad) failures += 1;
    rows.push({
      label: testCase.label,
      verdict: bad ? "FAIL" : "PASS",
      detail: `stage top ${result.base.top} h ${result.base.height} · while saving Δtop ${result.drift.top} Δh ${result.drift.height}`
        + ` · settled Δtop ${result.settledDrift.top} Δh ${result.settledDrift.height} · ${result.held} samples held, ${result.mounts} mount(s)`
    });
  } catch (error) {
    unmeasured += 1;
    rows.push({ label: testCase.label, verdict: "NOT MEASURED", detail: String(error).split("\n")[0].slice(0, 110) });
  }
}

await browser.close();

const width = Math.max(...rows.map((r) => r.label.length));
console.log(`\n===== map-stability audit (the map does not move when you let go of a token — 4h) =====`);
for (const row of rows) console.log(`${row.label.padEnd(width)}  ${row.verdict.padEnd(12)}  ${row.detail}`);
console.log(`\nA cell reads PASS when .encounter-map-stage kept its exact top and height from before`);
console.log(`pointer-down, through the drag, while "Saving move…" was mounted, and after it cleared.`);
console.log(`\n${rows.length} compositions; ${failures} failing; ${unmeasured} NOT MEASURED.`);
process.exit(failures === 0 && unmeasured === 0 ? 0 : 1);
