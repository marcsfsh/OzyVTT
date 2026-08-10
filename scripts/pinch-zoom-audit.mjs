/**
 * The pinch-zoom audit — `4f`, and the thing `4f` can break.
 *
 * TWO FACTS, and neither can be settled anywhere but a browser with a real touch device.
 *
 * PASS 1: TWO FINGERS ZOOM THE BATTLE MAP. It drives a real GM session on a real fight at phone
 * viewports, pinches with two genuine touch points, and reads the camera off the SVG's own
 * `viewBox` — spreading must narrow it (zoom in), pinching must widen it (zoom out), and the image
 * point that was between the fingers must still be between them afterwards.
 *
 * PASS 2: A SECOND FINGER ABORTS WHATEVER GESTURE WAS IN FLIGHT, AND COMMITS NOTHING. This is the
 * half that can do damage. `EncounterMap` runs seven gesture kinds through one pointer machine, and
 * six of them END IN A WRITE: a token move, a measurement, a shape, a fog stroke, a shape move, a
 * shape resize. A second finger landing mid-drag must not drop the token somewhere, must not leave a
 * half-drawn annotation, and must not paint fog — while the pinch it started still zooms.
 *
 * WHY A TOUCH-DRIVEN BROWSER AND NOT A UNIT TEST. Three separate reasons, all of them structural:
 *   - jsdom has no layout. Every `getBoundingClientRect()` there is zero, so `imagePointFromClient`
 *     (which needs `getScreenCTM`, deliberately NOT shimmed — see `apps/client/test/setup.ts`) has no
 *     geometry to work from and no gesture can be positioned at all.
 *   - jsdom has no pointer capture. `test/setup.ts` shims `hasPointerCapture` to return **false**,
 *     and `continueGesture`'s first guard is exactly that call — so every non-pinch gesture is inert
 *     under the shim and a test could not tell an abort from a gesture that never started.
 *   - Multi-touch is not a Playwright API. Two simultaneous pointers come from CDP
 *     `Input.dispatchTouchEvent`, which is what this script drives.
 *
 * THE CONTROL IS THE POINT. Every abort case runs TWICE — once uninterrupted, once with the second
 * finger — and the uninterrupted run MUST COMMIT. A suite that only asserts "nothing was written"
 * passes just as green when the touch driving does nothing at all, which is the failure mode this
 * script would otherwise have. A case whose control does not commit is reported NOT MEASURED and
 * fails the run; it is never quietly counted as a pass.
 *
 * HOW A COMMIT IS DETECTED. Two independent captures that have to agree:
 *   - THE WIRE. Every outbound socket.io frame is recorded (WebSocket and the XHR polling transport
 *     both, since the frame is the same either way), and the case names the command it must not see.
 *     This is authoritative: it is what the client actually asked the server to do.
 *   - THE DOM. The token's own transform, the annotation count, the fog rectangle count. Slower and
 *     round-trip-dependent, but it is evidence about the rendered result rather than about the call.
 *
 * Same terms as `map-stability-audit.mjs`, `tap-audit.mjs` and `no-scroll-audit.mjs`: it needs a
 * browser and a running dev server, so it is a scripted manual audit, deliberately NOT wired into
 * `npm test`. `playwright-core` is intentionally not a repo dependency — install it outside the tree
 * or point PLAYWRIGHT_CORE at any install:
 *
 *   npm i --no-save playwright-core     # ...or set PLAYWRIGHT_CORE
 *   npm run dev                         # in another shell, against a THROWAWAY DATA_DIR
 *   node scripts/pinch-zoom-audit.mjs
 *
 * IT MUTATES THE SERVER, heavily and on purpose: the control runs move tokens, add measurements and
 * shapes, and paint fog on the live fight. That is what makes them controls. Point DATA_DIR at a copy.
 *
 * IT NEEDS A FIGHT ON A CALIBRATED MAP WITH A PLACED TOKEN, and it will start the fight itself if the
 * party is staged and a battle map exists. It will NOT upload a map, calibrate one, or invent a
 * roster — measure, the four shapes and the ruler all require a grid, so an uncalibrated map makes
 * five of the seven kinds unstartable. A state it cannot reach is reported NOT MEASURED and fails the
 * run, never skipped silently.
 *
 * WHAT A GREEN RUN IS NOT WORTH. It runs in Chromium's touch EMULATION, on the desktop engine with a
 * touch device attached — not on a phone. No physical iOS or Android pass exists in this repo
 * (BUILD_PLAN GAP-001) and this script does not create one: it cannot see Safari's gesture handling,
 * a real digitizer's timing and jitter, palm rejection, or what the OS does with a two-finger drag
 * that starts at the edge of the screen. It measures the GM; a player sees the same gesture machine
 * (`beginGesture` is role-blind apart from the fog branch) but can only move a character they have
 * claimed, and this audit claims none.
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
const EXEC = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.AUDIT_URL ?? "http://localhost:5173/";
const PASSWORD = process.env.AUDIT_PASSWORD ?? "testpassword123";

/**
 * The two phone shapes the brief names, and they are not redundant: 320x568 is `body`'s stated
 * minimum width (`mobile-ux.md`), where the stage's height is STATED rather than flexed and where two
 * fingers a comfortable distance apart are a large fraction of the whole map.
 */
const VIEWPORTS = [
  { label: "375x667", w: 375, h: 667 },
  { label: "320x568", w: 320, h: 568 }
];

/** Record every outbound socket.io frame. Installed before any app script runs. */
const RECORD_SENT = `
  window.__sent = [];
  const record = (data) => { if (typeof data === "string") window.__sent.push(data.slice(0, 300)); };
  const wsSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) { record(data); return wsSend.call(this, data); };
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (data) { record(data); return xhrSend.call(this, data); };
`;

/** The camera, read off the thing that renders it. `viewBox` IS `{center, zoom}` after the maths. */
const CAMERA = `(() => {
  const svg = document.querySelector(".encounter-map-stage > svg");
  if (!svg) return null;
  const [x, y, w, h] = (svg.getAttribute("viewBox") || "").split(/\\s+/).map(Number);
  const box = svg.getBoundingClientRect();
  return { x, y, w, h, box: { left: box.left, top: box.top, width: box.width, height: box.height } };
})()`;

/** What the map is showing right now, in the terms each abort case has to compare. */
const SHAPE_OF_THINGS = `(() => ({
  tokens: [...document.querySelectorAll(".encounter-token")].map((el) => el.getAttribute("transform")),
  annotations: [...document.querySelectorAll("[data-annotation-id]")].map((el) => el.getAttribute("data-annotation-id")).sort(),
  measurements: document.querySelectorAll(".annotation-measurement.expiring").length,
  fog: document.querySelectorAll(".fog-shape, .encounter-map-stage > svg [class*='fog-rect']").length,
  fogPaths: [...document.querySelectorAll(".encounter-map-stage > svg mask rect, .encounter-map-stage > svg mask path")].length,
  dragging: document.querySelectorAll(".encounter-token.dragging").length,
  livePreview: document.querySelectorAll(".annotation-shape.live").length,
  liveMeasure: document.querySelectorAll(".annotation-measurement:not(.expiring)").length,
  fogPreview: document.querySelectorAll(".fog-stroke-preview").length,
  handles: document.querySelectorAll("[data-annotation-handle]").length,
  saving: document.querySelectorAll(".encounter-map-saving").length
}))()`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"], timeout: 60_000 });
const at = (path) => `${BASE}${path.replace(/^\//, "")}`.replace(/([^:])\/\//g, "$1/");

async function gmPage(viewport) {
  const page = await browser.newPage({ viewport, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  page.setDefaultTimeout(20_000);
  await page.addInitScript(RECORD_SENT);
  await page.goto(at("table"), { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.getByText("Enter as GM").click({ timeout: 15_000 });
  const password = page.locator('input[type="password"]').first();
  await password.waitFor({ state: "visible", timeout: 10_000 });
  await password.fill(PASSWORD);
  await password.press("Enter");
  await page.waitForSelector(".table-layout", { timeout: 25_000 });
  await page.addStyleTag({ content: "html, * { scroll-behavior: auto !important; animation: none !important; transition: none !important; }" });
  await page.waitForTimeout(1200);
  return page;
}

/** A fight with a calibrated map is the state this audit measures; it starts one rather than measure an empty table. */
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

/** Tapping a tray chip drops it at the centre — the touch route, and this audit's fixture. */
async function ensurePlacedToken(page) {
  if (await page.locator(".encounter-token.movable").count()) return;
  const chip = page.locator(".tray-token").first();
  if ((await chip.count()) === 0) throw new Error("no token on the map and none in the tray to place");
  await chip.click();
  await page.waitForTimeout(1800);
}

/**
 * Five of the seven kinds refuse to start without a grid (`beginGesture` guards them on
 * `calibration`), so an uncalibrated map is NOT MEASURED rather than five silent NOT-STARTEDs. The
 * toolbar says so itself: it disables Measure and prints its own note.
 */
async function requireCalibration(page) {
  await openRail(page);
  const blocked = await page.evaluate(() => {
    const row = [...document.querySelectorAll(".map-toolbar-row")].find((el) => el.textContent?.includes("Measure distance"));
    return { missing: !row, disabled: Boolean(row?.disabled) };
  });
  await page.locator(".map-toolbar-toggle").click({ timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(250);
  if (blocked.missing) throw new Error("no map toolbar on this page");
  if (blocked.disabled) throw new Error("this map has no grid — measure, the shapes and the ruler cannot start");
}

/**
 * Put the camera back where it started. Without this the zoom ACCUMULATES across cases — every abort
 * case pinches 1.6x and MAX_ZOOM is 6, so by the fifth case the pinch is saturated and reads 1.000x
 * while working perfectly. Measured before this existed: 1.61, 1.60, 1.60, 1.38, 1.000.
 */
async function resetView(page) {
  await openRail(page);
  await page.locator(".map-toolbar-rail-head", { hasText: "View" }).first().click({ timeout: 10_000 });
  await page.getByRole("button", { name: "Reset view" }).first().click({ timeout: 10_000 });
  await page.waitForTimeout(300);
  await page.locator(".map-toolbar-toggle").click({ timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(300);
}

/**
 * Sweep the map back to bare image, through the toolbar's own Clean up and Reveal-the-whole-map. The
 * control runs are writes — every pass leaves another shape, another measurement and another fog
 * stroke — and after two runs the accumulated ink covers the token and every clear point on the
 * stage, so the NEXT case reports "nothing to aim at" for a reason that has nothing to do with pinch.
 * An audit that degrades the state it measures has to undo itself between cases.
 */
async function clearMap(page) {
  await openRail(page);
  await page.locator(".map-toolbar-rail-head", { hasText: "Draw" }).first().click({ timeout: 10_000 });
  await page.getByRole("button", { name: "Remove all shapes", exact: true }).first().click({ timeout: 10_000 });
  await page.waitForTimeout(900);
  await openRail(page);
  await page.locator(".map-toolbar-rail-head", { hasText: "Fog" }).first().click({ timeout: 10_000 });
  await page.getByRole("button", { name: "Reveal the whole map" }).first().click({ timeout: 10_000 });
  await page.waitForTimeout(900);
  await page.locator(".map-toolbar-toggle").click({ timeout: 5_000 }).catch(() => {});
  await page.waitForTimeout(300);
}

/**
 * Draw one shape with one finger, so the move/resize cases have exactly one thing to grab — and keep
 * shrinking it toward the top-left until BOTH of its handles hit-test to themselves.
 *
 * Selecting a shape opens `.encounter-shape-editor` over the map, and a handle underneath that panel
 * cannot start a gesture at all (`beginGesture` returns early for it). Measured at 375x667: an editor
 * spanning x 160..352 of a 355px stage, with the resize handle at x=193 — inside it. At 320x568 the
 * panel takes an even larger share, so a fixed shape is a coin toss and this is not.
 */
async function drawOneShape(page) {
  const targets = [{ to: [0.34, 0.72] }, { to: [0.26, 0.66] }, { to: [0.2, 0.6] }];
  for (const [attempt, target] of targets.entries()) {
    await pickTool(page, "circle");
    const from = await clearPoint(page, 0.1, 0.46);
    const to = await clearPoint(page, target.to[0], target.to[1], from, 30);
    if (!from || !to) throw new Error("nowhere clear on the stage to draw the shape these cases grab");
    const cdp = await page.context().newCDPSession(page);
    const touch = touchDriver(cdp);
    try {
      await touch.start({ ...from, id: 9 });
      await page.waitForTimeout(60);
      await glide(page, touch, 9, from, to);
      await touch.liftAll();
      await page.waitForTimeout(1500);
    } finally { await touch.liftAll().catch(() => {}); await cdp.detach().catch(() => {}); }
    if ((await page.locator("[data-annotation-id]").count()) === 0) throw new Error("the fixture shape was not created");
    if (await handlesAreReachable(page)) return;
    if (attempt < targets.length - 1) await clearMap(page);
  }
  throw new Error("every fixture shape put a handle under .encounter-shape-editor — unreachable at this width");
}

/** Select the shape and ask whether each handle's own centre hit-tests back to that handle. */
async function handlesAreReachable(page) {
  const handles = await grabHandles(page);
  if (!handles?.move || !handles?.resize) return false;
  return page.evaluate(() => ["move", "resize"].every((which) => {
    const el = document.querySelector(`[data-annotation-handle="${which}"]`);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return Boolean(hit && hit.closest("[data-annotation-handle]") === el);
  }));
}

/* ── touch ───────────────────────────────────────────────────────────────────────────────────── */

/**
 * Two real touch points. `Input.dispatchTouchEvent` generates one pointer event per CHANGED point, so
 * a `touchStart` carrying an already-down finger plus a new one raises exactly one new `pointerdown`
 * — which is the sequence a second finger actually makes, and the sequence `beginGesture` has to
 * recognise. `touchEnd` with a list releases those points; with an empty list it releases everything
 * still down (verified against a live page before this script was written, not assumed).
 */
function touchDriver(cdp) {
  let down = new Map();
  const dispatch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y), id: p.id })) });
  return {
    async start(point) { down.set(point.id, point); await dispatch("touchStart", [...down.values()]); },
    async move(points) { for (const p of points) down.set(p.id, p); await dispatch("touchMove", [...down.values()]); },
    async liftAll() { if (down.size) await dispatch("touchEnd", []); down = new Map(); }
  };
}

/** Walk a finger from a to b in `steps` samples, pausing so React renders between them. */
async function glide(page, touch, id, from, to, steps = 6) {
  for (let step = 1; step <= steps; step += 1) {
    await touch.move([{ id, x: from.x + (to.x - from.x) * step / steps, y: from.y + (to.y - from.y) * step / steps }]);
    await page.waitForTimeout(28);
  }
}

/**
 * Spread or squeeze two fingers about their own midpoint, and report the span they actually achieved.
 *
 * BOTH HALVES MATTER. A finger pushed outside `.encounter-map-interaction` stops delivering
 * pointermove to the handlers, so its position freezes and the span stops growing — measured on the
 * shape-resize case, where the only clear band is a narrow strip beside the shape editor and a
 * commanded 1.60x arrived as 1.145x. Clamping keeps the fingers where the app can hear them, and
 * returning the real span lets the caller assert the CONTRACT — zoom tracks the fingers — instead of
 * a constant that encodes the harness's own geometry.
 */
async function pinch(page, touch, first, second, factor, bounds, steps = 8) {
  const mid = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  const clamp = (point) => bounds
    ? { ...point, x: Math.min(bounds.right - 6, Math.max(bounds.left + 6, point.x)), y: Math.min(bounds.bottom - 6, Math.max(bounds.top + 6, point.y)) }
    : point;
  const startDist = Math.hypot(first.x - second.x, first.y - second.y);
  let a = first, b = second;
  for (let step = 1; step <= steps; step += 1) {
    const scale = 1 + (factor - 1) * (step / steps);
    a = clamp({ id: first.id, x: mid.x + (first.x - mid.x) * scale, y: mid.y + (first.y - mid.y) * scale });
    b = clamp({ id: second.id, x: mid.x + (second.x - mid.x) * scale, y: mid.y + (second.y - mid.y) * scale });
    await touch.move([a, b]);
    await page.waitForTimeout(28);
  }
  return { startDist, endDist: Math.hypot(a.x - b.x, a.y - b.y) };
}

/** The box a pointermove has to stay inside to reach `EncounterMap`'s handlers at all. */
const gestureBounds = (page) => page.evaluate(() => {
  const root = document.querySelector(".encounter-map-interaction");
  if (!root) return null;
  const r = root.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
});

/* ── geometry ────────────────────────────────────────────────────────────────────────────────── */

/**
 * A point on the map that is really the map. The toolbar, the scene cluster and the tray all float
 * over the stage and `beginGesture` returns early for them, so a gesture aimed under one of them
 * measures nothing while looking like a pass — the same trap `map-stability-audit.mjs` records for
 * tokens parked under a control.
 */
const CLEAR_GRID = `(() => {
  const stage = document.querySelector(".encounter-map-stage");
  const svg = document.querySelector(".encounter-map-stage > svg");
  if (!stage || !svg) return [];
  const box = stage.getBoundingClientRect();
  const out = [];
  for (let gy = 0; gy <= 20; gy += 1) for (let gx = 0; gx <= 20; gx += 1) {
    const ux = 0.04 + 0.92 * gx / 20, uy = 0.04 + 0.92 * gy / 20;
    const x = box.left + box.width * ux, y = box.top + box.height * uy;
    if (y < box.top + 8 || y > box.bottom - 8) continue;
    const hit = document.elementFromPoint(x, y);
    if (!hit) continue;
    if (hit.closest(".encounter-map-overlay, .encounter-map-zoom, .encounter-shape-editor, .encounter-map-dock, .encounter-token-tray, .encounter-target-bar")) continue;
    if (!hit.closest("svg")) continue;
    out.push({ x, y, ux, uy });
  }
  return out;
})()`;

/**
 * Nearest point to the fraction asked for that is really the map. A phone stage is mostly OTHER
 * THINGS — measured at 375x667 with a shape selected, the tray owns the top three rows, the shape
 * editor the right seven columns, the toolbar the bottom-left and the scene cluster the bottom-right,
 * leaving a band about 112x140 — so a fixed fraction is a coin toss and a scan is not.
 */
async function clearPoint(page, fx, fy, away = null, minimum = 0) {
  const grid = await page.evaluate(CLEAR_GRID);
  // `away`/`minimum` exist because a drag shorter than `TAP_SLOP` is a TAP, not a drag: a token
  // already sitting on the fraction the target was written as produced a 20px drag that correctly
  // committed nothing, which reads exactly like a broken control.
  const usable = away ? grid.filter((p) => Math.hypot(p.x - away.x, p.y - away.y) >= minimum) : grid;
  if (!usable.length) return null;
  return usable.reduce((best, p) => (Math.hypot(p.ux - fx, p.uy - fy) < Math.hypot(best.ux - fx, best.uy - fy) ? p : best));
}

/** Somewhere clear to land the SECOND finger: as far from the first as the clear band allows. */
async function farthestClearFrom(page, origin, minimum = 55) {
  const grid = await page.evaluate(CLEAR_GRID);
  if (!grid.length) return null;
  const best = grid.reduce((far, p) => (Math.hypot(p.x - origin.x, p.y - origin.y) > Math.hypot(far.x - origin.x, far.y - origin.y) ? p : far));
  return Math.hypot(best.x - origin.x, best.y - origin.y) >= minimum ? best : null;
}

/** The centre of a token that hit-tests to itself. */
async function tokenPoint(page) {
  return page.evaluate(() => {
    for (const el of document.querySelectorAll(".encounter-token.movable")) {
      const r = el.getBoundingClientRect();
      const p = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      const hit = document.elementFromPoint(p.x, p.y);
      if (hit && hit.closest(".encounter-token") === el) return { ...p, id: el.getAttribute("data-token-id") };
    }
    return null;
  });
}

/* ── tools ───────────────────────────────────────────────────────────────────────────────────── */

/** Both phone widths are under the 560 rung, so the toolbar is the compact rail: one Tools button. */
async function openRail(page) {
  const toggle = page.locator(".map-toolbar-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click({ timeout: 10_000 });
  await page.waitForSelector(".map-toolbar-rail", { timeout: 10_000 });
}

async function pickTool(page, tool) {
  if (tool === "select" || tool === "measure") {
    await openRail(page);
    await page.locator(".map-toolbar-row", { hasText: tool === "select" ? "Select and move" : "Measure distance" }).first().click({ timeout: 10_000 });
  } else if (tool === "circle") {
    await openRail(page);
    await page.locator(".map-toolbar-rail-head", { hasText: "Draw" }).first().click({ timeout: 10_000 });
    await page.locator(".map-toolbar-choice", { hasText: "Circle" }).first().click({ timeout: 10_000 });
  } else if (tool === "fog-reveal") {
    await openRail(page);
    await page.locator(".map-toolbar-rail-head", { hasText: "Fog" }).first().click({ timeout: 10_000 });
    const fogSwitch = page.getByRole("switch", { name: /Fog of war/i }).first();
    if ((await fogSwitch.count()) && (await fogSwitch.getAttribute("aria-checked")) !== "true") {
      await fogSwitch.click({ timeout: 10_000 });
      await page.waitForTimeout(1500);
      await openRail(page);
      await page.locator(".map-toolbar-rail-head", { hasText: "Fog" }).first().click({ timeout: 10_000 });
    }
    // Reveal is a TOGGLE (`onPickTool(tool === "fog-reveal" ? "select" : "fog-reveal")`), unlike every
    // other tool control here — clicking it while it is already the tool turns the tool OFF. Measured:
    // the second of two consecutive runs silently gestured in select mode and painted no fog at all.
    const reveal = page.locator(".map-toolbar-choice", { hasText: "Reveal" }).first();
    if ((await reveal.getAttribute("aria-pressed")) !== "true") await reveal.click({ timeout: 10_000 });
    else await page.locator(".map-toolbar-toggle").click({ timeout: 5_000 }).catch(() => {});
  }
  await page.waitForTimeout(400);
  // The rail is `.encounter-map-overlay`, which `beginGesture` refuses — it must be shut before a gesture.
  if (await page.locator(".map-toolbar-rail").count()) {
    await page.locator(".map-toolbar-toggle").click({ timeout: 5_000 }).catch(() => {});
    await page.waitForTimeout(300);
  }
}

/* ── the seven kinds ─────────────────────────────────────────────────────────────────────────── */

/**
 * One entry per gesture kind that `EncounterMap`'s union declares. `commands` is what the wire must
 * NOT carry when the gesture is aborted (and MUST carry when it is not); `live` is how the script
 * proves the gesture really started before the second finger arrived, which is what stops an abort
 * case from passing because nothing happened.
 */
const KINDS = [
  { id: "token", label: "token drag", tool: "select", commands: ["token:move"], live: (s) => s.dragging > 0 },
  { id: "pan", label: "pan", tool: "select", commands: [], live: null },
  { id: "measure", label: "measure", tool: "measure", commands: ["annotation:add"], live: (s) => s.liveMeasure > 0 },
  { id: "shape", label: "shape (circle)", tool: "circle", commands: ["annotation:add"], live: (s) => s.livePreview > 0 },
  { id: "fog", label: "fog stroke", tool: "fog-reveal", commands: ["fog:paint"], live: (s) => s.fogPreview > 0 },
  { id: "annotation-move", label: "shape move", tool: "select", commands: ["annotation:move"], live: (s) => s.livePreview > 0 },
  { id: "annotation-resize", label: "shape resize", tool: "select", commands: ["annotation:move"], live: (s) => s.livePreview > 0 }
];

const shapeOf = (page) => page.evaluate(SHAPE_OF_THINGS);
const cameraOf = (page) => page.evaluate(CAMERA);
const sentSince = (page, mark, names) => page.evaluate(([from, wanted]) =>
  window.__sent.slice(from).filter((frame) => wanted.some((name) => frame.includes(`"${name}"`))), [mark, names]);
const sentCount = (page) => page.evaluate(() => window.__sent.length);

/** Select an existing shape so its move/resize handles are on screen, and hand back both handles. */
async function grabHandles(page) {
  const shape = await page.evaluate(() => {
    const el = document.querySelector("[data-annotation-id]");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, id: el.getAttribute("data-annotation-id") };
  });
  if (!shape) return null;
  await page.mouse.click(shape.x, shape.y);
  await page.waitForTimeout(500);
  return page.evaluate(() => {
    const read = (which) => {
      const el = document.querySelector(`[data-annotation-handle="${which}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    return { move: read("move"), resize: read("resize") };
  });
}

/**
 * ONE CASE. `interrupt: false` is the control — the same gesture with one finger, which must write.
 * `interrupt: true` is the requirement — a second finger lands mid-gesture, pinches, and the whole
 * thing must be abandoned with nothing written, while the pinch still moves the camera.
 */
async function runKind(page, kind, { interrupt }) {
  await clearMap(page);
  await resetView(page);
  if (kind.id === "annotation-move" || kind.id === "annotation-resize") await drawOneShape(page);
  await pickTool(page, kind.tool);
  let from = null, to = null, second = null;

  if (kind.id === "token") {
    const token = await tokenPoint(page);
    if (!token) throw new Error("no token on the map hit-tests to itself");
    from = token;
    to = await clearPoint(page, 0.5, 0.62, from, 55);
  } else if (kind.id === "annotation-move" || kind.id === "annotation-resize") {
    const handles = await grabHandles(page);
    if (!handles) throw new Error("no shape on the map to move or resize");
    from = kind.id === "annotation-move" ? handles.move : handles.resize;
    if (!from) throw new Error("the selected shape shows no handles");
    // Aim relative to the handle, not at a fixed corner of the stage: selecting the shape opens
    // `.encounter-shape-editor` over the map, and on a 320px column that panel owns most of it.
    const at = await page.evaluate(([x, y]) => {
      const box = document.querySelector(".encounter-map-stage").getBoundingClientRect();
      return { x: (x - box.left) / box.width, y: (y - box.top) / box.height };
    }, [from.x, from.y]);
    to = await clearPoint(page, at.x + 0.16, at.y + 0.12, from, 45);
  } else {
    from = await clearPoint(page, 0.3, 0.38);
    to = await clearPoint(page, 0.62, 0.58, from, 45);
  }
  if (!from || !to) throw new Error("no clear point on the stage that is not under one of the map's own controls");
  if (Math.hypot(to.x - from.x, to.y - from.y) < 24) throw new Error("the drag would be shorter than the tap threshold — nothing would move");
  second = await farthestClearFrom(page, from);
  if (!second) throw new Error("nowhere clear to land the second finger far enough from the first");

  const before = await shapeOf(page);
  const cameraBefore = await cameraOf(page);
  const mark = await sentCount(page);
  const bounds = await gestureBounds(page);
  const cdp = await page.context().newCDPSession(page);
  const touch = touchDriver(cdp);
  let live = null;
  let span = null;

  try {
    await touch.start({ ...from, id: 1 });
    await page.waitForTimeout(60);
    await glide(page, touch, 1, from, to);
    live = await shapeOf(page);
    if (!interrupt) {
      await touch.liftAll();
      await page.waitForTimeout(1800);
    } else {
      await touch.start({ ...second, id: 2 });
      await page.waitForTimeout(60);
      span = await pinch(page, touch, { ...to, id: 1 }, { ...second, id: 2 }, 1.6, bounds);
      await touch.liftAll();
      await page.waitForTimeout(1800);
    }
  } finally {
    await touch.liftAll().catch(() => {});
    await cdp.detach().catch(() => {});
  }

  const after = await shapeOf(page);
  const cameraAfter = await cameraOf(page);
  const frames = await sentSince(page, mark, kind.commands.length ? kind.commands : ["token:move", "annotation:add", "annotation:move", "fog:paint"]);
  return { before, live, after, cameraBefore, cameraAfter, frames, span };
}

/* ── the run ─────────────────────────────────────────────────────────────────────────────────── */

async function measurePinch(page) {
  await clearMap(page);
  await resetView(page);
  await pickTool(page, "select");
  const first = await clearPoint(page, 0.28, 0.4);
  const second = await clearPoint(page, 0.72, 0.62);
  if (!first || !second) throw new Error("no clear pair of points on the stage");
  const span = Math.hypot(first.x - second.x, first.y - second.y);
  if (span < 40) throw new Error(`the two clear points are only ${span.toFixed(0)}px apart — too close to pinch with`);
  const bounds = await gestureBounds(page);
  const cdp = await page.context().newCDPSession(page);
  const touch = touchDriver(cdp);
  const mid = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  /** The image point under a client point, read through the live viewBox and the svg's own box. */
  const imageUnder = (camera, point) => ({
    x: camera.x + camera.w * ((point.x - camera.box.left) / camera.box.width),
    y: camera.y + camera.h * ((point.y - camera.box.top) / camera.box.height)
  });
  try {
    const start = await cameraOf(page);
    const anchorStart = imageUnder(start, mid);
    await touch.start({ ...first, id: 1 });
    await touch.start({ ...second, id: 2 });
    await page.waitForTimeout(60);
    await pinch(page, touch, { ...first, id: 1 }, { ...second, id: 2 }, 1.9, bounds);
    const spread = await cameraOf(page);
    const anchorSpread = imageUnder(spread, mid);
    await touch.liftAll();
    await page.waitForTimeout(300);

    await touch.start({ ...first, id: 3 });
    await touch.start({ ...second, id: 4 });
    await page.waitForTimeout(60);
    await pinch(page, touch, { ...first, id: 3 }, { ...second, id: 4 }, 0.55, bounds);
    const squeeze = await cameraOf(page);
    await touch.liftAll();
    await page.waitForTimeout(300);
    return {
      start, spread, squeeze, span, first, second,
      // Spreading NARROWS the viewBox (more zoom, less map on screen); squeezing widens it. Both
      // ratios are written so that "> 1" means "the gesture did what its name says".
      spreadRatio: start.w / spread.w,
      squeezeRatio: squeeze.w / spread.w,
      anchorDrift: Math.hypot(anchorSpread.x - anchorStart.x, anchorSpread.y - anchorStart.y),
      anchorTolerance: start.w * 0.02
    };
  } finally {
    await touch.liftAll().catch(() => {});
    await cdp.detach().catch(() => {});
  }
}

const zoomRows = [];
const abortRows = [];
let failures = 0;
let unmeasured = 0;

// One warm-up page at a laptop width: it starts the fight and places a token, so a phone cell never
// has to drive the map picker in a 320px column to reach the state it is supposed to measure.
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  try {
    await page.addInitScript(RECORD_SENT);
    await page.goto(at("table"), { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByText("Enter as GM").click({ timeout: 15_000 });
    const password = page.locator('input[type="password"]').first();
    await password.waitFor({ state: "visible", timeout: 10_000 });
    await password.fill(PASSWORD);
    await password.press("Enter");
    await page.waitForSelector(".table-layout", { timeout: 25_000 });
    await page.waitForTimeout(1500);
    await ensureFight(page);
    await ensurePlacedToken(page);
  } finally { await page.close(); }
}

for (const viewport of VIEWPORTS) {
  let page = null;
  try {
    page = await gmPage({ width: viewport.w, height: viewport.h });
    await ensureFight(page);
    await ensurePlacedToken(page);
    await requireCalibration(page);
  } catch (error) {
    unmeasured += 1;
    zoomRows.push({ label: viewport.label, verdict: "NOT MEASURED", detail: String(error).split("\n")[0].slice(0, 110) });
    if (page) await page.close();
    continue;
  }

  try {
    const result = await measurePinch(page);
    const problems = [];
    if (!(result.spreadRatio > 1.15)) problems.push(`spreading two fingers changed the zoom by ${result.spreadRatio.toFixed(3)}x`);
    if (!(result.squeezeRatio > 1.15)) problems.push(`squeezing them widened the viewBox by only ${result.squeezeRatio.toFixed(3)}x`);
    if (result.anchorDrift > result.anchorTolerance) problems.push(`the point between the fingers moved ${result.anchorDrift.toFixed(1)} image px (budget ${result.anchorTolerance.toFixed(1)})`);
    if (problems.length) failures += 1;
    zoomRows.push({
      label: viewport.label,
      verdict: problems.length ? "FAIL" : "PASS",
      detail: problems.length ? `${problems.join(" · ")} · fingers ${result.span.toFixed(0)}px apart at (${result.first.x.toFixed(0)},${result.first.y.toFixed(0)}) and (${result.second.x.toFixed(0)},${result.second.y.toFixed(0)})`
        : `viewBox w ${result.start.w.toFixed(0)} -> ${result.spread.w.toFixed(0)} -> ${result.squeeze.w.toFixed(0)}`
          + ` · spread ${result.spreadRatio.toFixed(2)}x in, squeeze ${result.squeezeRatio.toFixed(2)}x back out`
          + ` · anchor held to ${result.anchorDrift.toFixed(1)} image px`
    });
  } catch (error) {
    unmeasured += 1;
    zoomRows.push({ label: viewport.label, verdict: "NOT MEASURED", detail: String(error).split("\n")[0].slice(0, 110) });
  }

  for (const kind of KINDS) {
    const label = `${viewport.label} ${kind.label}`;
    try {
      // THE CONTROL FIRST, always: an abort case is only evidence if the same gesture writes without
      // the second finger. A control that does not write makes the pair NOT MEASURED, not a pass.
      const control = await runKind(page, kind, { interrupt: false });
      const controlWrote = kind.commands.length
        ? control.frames.length > 0
        : Math.abs(control.cameraAfter.x - control.cameraBefore.x) + Math.abs(control.cameraAfter.y - control.cameraBefore.y) > 1;
      if (kind.live && !kind.live(control.live)) throw new Error(`the ${kind.label} never started (no live preview mid-drag)`);
      if (!controlWrote) throw new Error(`the control ${kind.label} committed nothing, so an abort proves nothing`);

      const aborted = await runKind(page, kind, { interrupt: true });
      const problems = [];
      if (kind.live && !kind.live(aborted.live)) problems.push(`the ${kind.label} never started, so the abort was vacuous`);
      if (aborted.frames.length) problems.push(`${aborted.frames.length} command(s) went out: ${aborted.frames.map((f) => (f.match(/"([a-z]+:[a-z-]+)"/) ?? [])[1] ?? "?").join(", ")}`);
      if (kind.id === "token" && JSON.stringify(aborted.after.tokens) !== JSON.stringify(aborted.before.tokens)) problems.push("a token moved");
      if (kind.id !== "token" && JSON.stringify(aborted.after.annotations) !== JSON.stringify(aborted.before.annotations)) problems.push("an annotation appeared or moved");
      if (aborted.after.saving > 0) problems.push('"Saving move…" was up after the pinch');
      /* THE PINCH ITSELF MUST STILL WORK — an abort that also killed the zoom would pass every
         assertion above and be the wrong feature. Measured against the span the fingers ACTUALLY
         reached, not a constant: the clear band next to the shape editor is narrow enough that a
         commanded 1.60x arrives as 1.15x, and the contract is "zoom tracks the fingers", not "1.6". */
      const zoomed = aborted.cameraBefore.w / aborted.cameraAfter.w;
      const fingers = aborted.span ? aborted.span.endDist / aborted.span.startDist : null;
      if (!fingers || fingers < 1.1) throw new Error(`the fingers only spread ${fingers ? fingers.toFixed(2) : "?"}x — too little for the zoom to be readable here`);
      if (Math.abs(zoomed - fingers) / fingers > 0.12) problems.push(`the zoom did not track the fingers: they spread ${fingers.toFixed(2)}x, the map zoomed ${zoomed.toFixed(2)}x`);
      if (problems.length) failures += 1;
      abortRows.push({
        label, verdict: problems.length ? "FAIL" : "PASS",
        detail: problems.length ? problems.join(" · ")
          : `control wrote ${control.frames.length || "camera"} · aborted wrote 0 · gesture was live mid-drag · fingers spread ${fingers.toFixed(2)}x, map zoomed ${zoomed.toFixed(2)}x`
      });
    } catch (error) {
      unmeasured += 1;
      abortRows.push({ label, verdict: "NOT MEASURED", detail: String(error).split("\n")[0].slice(0, 130) });
    }
  }
  await page.close();
}

await browser.close();

const width = Math.max(...[...zoomRows, ...abortRows].map((r) => r.label.length));
const table = (title, list) => {
  console.log(`\n===== ${title} =====`);
  for (const row of list) console.log(`${row.label.padEnd(width)}  ${row.verdict.padEnd(12)}  ${row.detail}`);
};
table("two fingers zoom the map (4f)", zoomRows);
console.log(`\nA cell reads PASS when spreading two fingers narrowed the SVG's viewBox, squeezing them`);
console.log(`widened it, and the image point between the fingers stayed between them within 2%.`);
table("a second finger aborts the gesture underneath and commits nothing (4f)", abortRows);
console.log(`\nA cell reads PASS when the SAME gesture committed with one finger (the control), was`);
console.log(`demonstrably live mid-drag, wrote NOTHING once a second finger landed, left the map`);
console.log(`unchanged — and the pinch that interrupted it still zoomed.`);
console.log(`\n${zoomRows.length + abortRows.length} checks; ${failures} failing; ${unmeasured} NOT MEASURED.`);
console.log(`Chromium touch EMULATION only — no physical device pass exists here (BUILD_PLAN GAP-001).`);
process.exit(failures === 0 && unmeasured === 0 ? 0 : 1);
