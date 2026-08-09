/**
 * Tap-target audit — the reproducible form of acceptance criterion **A-3**, grown to the
 * play shell: the Codex in both roles (its original scope) plus the shell's phase-A
 * surfaces (table, scenes, maps, roster, replays, settings, builder — GM and player).
 *
 * THE RUNNER IS PER-SURFACE ROOT/READY AWARE. A surface entry may carry `root` (the
 * measurement root, default the pass's rootSelector) and `ready` (the selector awaited
 * before measuring, default `<root> .codex-shell-content` — the codex gate). That is what
 * makes design-language.md §6b step 4's "a new address is one line" true for play routes,
 * which have no `.codex-shell-content`. Play surfaces measure the app as the server has it
 * (a live fight if one is running) — like the codex passes, this audits a dev server's
 * state, it does not create one.
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
 * It also OPENS the two codex character choosers ("Who played" and downtime's "Who"): their option rows
 * are the densest cluster on either surface and do not exist until the box is tapped. That was worth 4
 * rows apiece at the seed's party size — session-editor 46 controls to 50, downtime 30 to 34.
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
 *
 * THE LAYER SPLIT, and why a reachability number needs one. The column now printed as "unreachable in
 * the active layer" used to read "unresolved" and stood at 184 across nine surfaces (2026-08-05, 375px,
 * `node scripts/tap-audit.mjs 375`) with no per-row detail under it, so nobody could tell whether it
 * named a defect. Driving each of those 184 in a browser and recording, per control, what
 * `elementFromPoint` returned at its centre and which subtree that element belonged to, every one of
 * them turned out to be one of two things and NEITHER is a control a user can fail to tap:
 *
 *   - 130 lay under an overlay the audit had deliberately opened — 56 under a modal `<dialog>`
 *     (quick-create 28, palette 28), which the platform makes inert by spec, and 74 under an open
 *     `Drawer` painting over the shell (nav-drawer 28, session-prep 27, player-drawer 19).
 *   - 54 sat inside a `<details>` that was closed: `Menu`'s popover (pages 10, play-scenes 34,
 *     play-replays 6) and the maps wizard's coordinate disclosure (play-maps 4). Chromium lays those
 *     out — they have real rects, which is why the zero-box guard never dropped them — but skips them
 *     for paint and hit-testing, so `elementFromPoint` correctly answers with whatever is painted there.
 *
 * Zero were real. Reach is therefore judged in the active layer only, and the other two layers are
 * printed by name on a LAYER line per surface and in the run footer rather than dropped — a control
 * that stops being reported is a control nobody re-checks. Sizes are unaffected in all three layers:
 * see the ratchet note at the report assembly for why that boundary is where it is.
 *
 * IT MAKES EXACTLY ONE FIXTURE, and puts it back. See `ensureLinkedPin` below. Nothing else here
 * writes to the server.
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
  // WHICH LAYER a control is in — computed once per measurement, because nothing opens or closes
  // while the walk runs. See the "THE LAYER SPLIT" note in the docblock for why \`reach\` is only a
  // verdict in the active layer. The two overlay mechanisms are named rather than inferred, because
  // they are \`packages/ui\` PRIMITIVES and not app-specific markup: \`Modal\` is <dialog>.showModal()
  // (Modal.tsx:37), which puts the rest of the document in the inert layer by spec, and \`Drawer\` is
  // a non-modal <aside> that carries \`inert\` while closed (Drawer.tsx:60) and paints over the shell
  // while open. A THIRD mechanism arriving later lands a control in "active" and is reported as a
  // real defect — the safe direction for a check whose job is to fail loudly.
  const modal = document.querySelector("dialog:modal");
  const openDrawers = [...document.querySelectorAll(".nh-drawer")].filter((d) => !d.hasAttribute("inert"));
  // THE THIRD MECHANISM, arriving exactly as the docblock said it would. \`Combobox\`'s listbox is an
  // absolutely-positioned popover at z-index 40 (\`Combobox.css\`) that paints over whatever the field
  // sits above - so a run that deliberately opens one (see \`play-homebrew-picker\`) reported the four
  // fields beneath it as unreachable, which is in the EXIT GATE and would have failed the run for
  // four controls nobody's finger is anywhere near. Same predicate as the drawer case above, and it
  // is a statement about the same thing: reach is judged where there is a finger. Its OWN option rows
  // are excluded by \`!list.contains(el)\`, which is the measurement that matters here - they are the
  // 44px route-1 rows the picker surface exists to check.
  const openPopovers = [...document.querySelectorAll(".nh-combobox-list")];
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
    // The layer, in the order the mechanisms stack: a closed disclosure INSIDE a modal is still closed.
    // \`checkVisibility()\` with no options is the whole test for "closed" — Chromium lays a closed
    // <details>'s popover out (it has a real rect, so the r.width/r.height guard above does not drop it)
    // but skips it for paint and hit-testing, and checkVisibility() reports exactly that. Verified
    // 2026-08-05 on six surfaces: it returns false for all 57 closed-<details> children and true for all
    // 15 of their own <summary> elements, which are on screen and tappable. \`checkOpacity\` is
    // deliberately NOT passed — it changed no row on this tree (0 of 320 controls across those six
    // surfaces), so it would be an untested widening of what counts as unrendered.
    let layer = "active";
    if (!el.checkVisibility()) layer = "closed";
    else if (modal && !modal.contains(el)) layer = "overlaid";
    else if (openDrawers.some((d) => !d.contains(el) && d.contains(document.elementFromPoint(cx, cy)))) layer = "overlaid";
    else if (openPopovers.some((l) => !l.contains(el) && l.contains(document.elementFromPoint(cx, cy)))) layer = "overlaid";
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className && el.className.baseVal !== undefined ? el.className.baseVal : String(el.className || "")).slice(0, 60),
      label: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 34),
      h: Math.round(h * 10) / 10, w: Math.round(w * 10) / 10, reach, layer
    });
  }
  return { out };
})`;

/**
 * Open the FIRST record a rail lists, whichever record that is, and prove the editor rendered.
 *
 * The openers this replaces named seed titles — `hasText: "Strahd"` for the page editor and
 * `hasText: "Missing Bones"` for the quest editor, both rows that only exist if
 * `scripts/seed-codex.mjs` has been run against this server. Neither is in the dev database this
 * ran against on 2026-08-05 (7 pages, none named Strahd; 2 quests, neither named Missing Bones), so
 * both clicks waited out their 10s timeout and both surfaces reported NOT MEASURED — the audit
 * calling a stale fixture reference an app failure. Nothing was wrong with either editor: clicking
 * the first row of each rail opens `.codex-editor` and `.codex-quest-editor` respectively, measured
 * in a browser the same day. The docblock's own rule is that this script audits a dev server's
 * state rather than creating one, and a hardcoded title is the opposite of that.
 *
 * TWO row selectors for pages, because the GM rail has two renderings: `NotebookTree`'s
 * `.codex-tree-page` by default and `.codex-list-item` while a type/tag filter is applied
 * (`PagesView.tsx:214` vs `:226`). The player rail renders only the latter.
 *
 * `expect` is required, not optional: a click that lands on nothing would otherwise leave the empty
 * "Select a page" state on screen and measure THAT under an editor's heading — the substitution
 * failure the docblock's third paragraph is about.
 */
/**
 * Tap a `Combobox` open and wait for its listbox, so the option rows are measured rather than the
 * closed box. Throws when there is nothing to open — a picker that silently failed to open would
 * report its surface clean on the strength of the controls around it.
 */
async function openCombobox(page, selector, missing) {
  const box = page.locator(`${selector}[role=combobox]`).first();
  if (await box.count() === 0) throw new Error(missing);
  await box.scrollIntoViewIfNeeded();
  await box.click({ timeout: 8_000 });
  await page.waitForSelector(".nh-combobox-list", { timeout: 8_000 });
  await page.waitForTimeout(600);
}

async function openFirstRecord(page, { rows, expect, what }) {
  const row = page.locator(rows).first();
  if (await row.count() === 0) throw new Error(`no ${what} row in the rail to open the editor with`);
  await row.click({ timeout: 10_000 });
  await page.waitForSelector(expect, { timeout: 10_000 });
  await page.waitForTimeout(1200);
}

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
/**
 * Select a pin whose panel carries a linked-page row, trying each pin in turn.
 *
 * The old openers took `.first()`, and the seed's first pin has no linked page — so
 * `.codex-marker-link-open` (a class that renders in BOTH shells and had no `min-height`) was never on
 * screen when the measurement ran, and "the pin inspector: 0 below the floor" was a statement about a
 * pin inspector missing its densest row.
 */
async function openPinWithLinks(page) {
  const count = await page.locator("[data-marker-id]").count();
  if (count === 0) throw new Error("no pins painted on the map");
  for (let index = 0; index < count; index++) {
    // The pointer sequence is DISPATCHED on the marker rather than clicked at its bounding-box centre.
    // A marker's `<g>` contains its wide `<text>` label, so the centre of that box is usually not on the
    // glyph at all and the topmost element there is a neighbouring pin's label — every coordinate click
    // at 375px resolved to the same wrong marker. MapSurface listens on the `<svg>` and reads
    // `event.target.closest("[data-marker-id]")`, so a bubbling dispatch is exactly the real path minus
    // the hit-test. Whether a finger can hit a pin is browser-verify's job; this script MEASURES panels.
    await page.evaluate((idx) => {
      const marker = document.querySelectorAll("[data-marker-id]")[idx];
      const box = marker.getBoundingClientRect();
      const options = { bubbles: true, cancelable: true, composed: true, pointerId: 1, pointerType: "touch", isPrimary: true, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
      marker.dispatchEvent(new PointerEvent("pointerdown", options));
      marker.dispatchEvent(new PointerEvent("pointerup", options));
    }, index);
    await page.waitForTimeout(900);
    if (await page.locator(".codex-marker-link-open").count() > 0) return true;
  }
  return false;
}

/**
 * THE ONE FIXTURE THIS SCRIPT PROVISIONS, and the only write it makes.
 *
 * `pin-inspector` and `player-pin` both require a pin carrying a LINKED PAGE, because
 * `.codex-marker-link-open` is the row they exist to measure and it renders for no other pin
 * (`MarkerInspector.tsx:175`, `PinDetails.tsx:50`). On 2026-08-05 both surfaces reported NOT
 * MEASURED against the dev server — its three markers all carry `pageIds: []` — which cost the run
 * every control on two surfaces, not just the one row. `scripts/seed-codex.mjs:278-285` does create
 * four such pins, so the seed is not the gap; the gap is that this script audits WHATEVER database
 * the dev server is holding, and most of them were not built by that seed.
 *
 * So it makes the fixture it needs, through the same authenticated GM endpoint the client's own
 * `atlasApi.updateMarker` calls (`codex/api.ts:514`) — no server bypass, no state the app could not
 * reach itself — and puts it back afterwards. It writes ONLY when no pin already has a link, and it
 * prints what it touched either way, so a run that mutated the database says so. Set
 * AUDIT_NO_FIXTURE=1 to forbid the write; the two surfaces then report NOT MEASURED as before,
 * which is the honest outcome rather than a quiet one.
 */
async function ensureLinkedPin() {
  const api = async (path, init = {}) => {
    const response = await fetch(`${BASE}api/${path.replace(/^\//, "")}`, {
      ...init,
      headers: { "content-type": "application/json", ...(init.headers ?? {}) }
    });
    if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${response.status}`);
    const body = await response.json();
    return body && typeof body === "object" && "data" in body ? body.data : body;
  };
  const { token } = await api("gm/login", { method: "POST", body: JSON.stringify({ password: PASSWORD }) });
  const auth = { authorization: `Bearer ${token}` };
  const get = (path) => api(`v1/codex${path}`, { headers: auth });
  const { maps } = await get("/maps");
  // Revealed only, on both the map and the pin: the same fixture has to satisfy the GM pass and the
  // PLAYER pass, and a player is shown neither a secret pin nor a pin on a secret map
  // (`MarkerInspector.tsx:126` is the warning the app itself raises about that pairing).
  const shownMaps = maps.filter((map) => map.revealedToPlayers);
  const candidates = [];
  for (const map of shownMaps) {
    const { markers } = await get(`/maps/${map.id}/markers`);
    for (const marker of markers) {
      if (marker.pageIds.length > 0 && marker.revealedToPlayers) return { note: `pin fixture: already present (marker ${marker.id})`, undo: async () => {} };
      if (marker.revealedToPlayers) candidates.push(marker);
    }
  }
  if (process.env.AUDIT_NO_FIXTURE) return { note: "pin fixture: ABSENT and AUDIT_NO_FIXTURE set - the two pin surfaces will report NOT MEASURED", undo: async () => {} };
  const marker = candidates[0];
  if (!marker) return { note: "pin fixture: ABSENT and unprovisionable - no revealed pin on any revealed map", undo: async () => {} };
  const { pages } = await get("/pages");
  const page = pages.find((candidate) => candidate.revealedToPlayers);
  if (!page) return { note: "pin fixture: ABSENT and unprovisionable - no page is shown to players", undo: async () => {} };
  const before = [...marker.pageIds];
  const patch = (pageIds) => api(`v1/codex/markers/${marker.id}`, { method: "PATCH", headers: auth, body: JSON.stringify({ pageIds }) });
  await patch([page.id]);
  return {
    note: `pin fixture: LINKED page "${page.title}" to pin "${marker.label ?? marker.id}" (${marker.id}) for this run; restored at the end. Undo by hand if the run dies: PATCH /api/v1/codex/markers/${marker.id} {"pageIds":${JSON.stringify(before)}}`,
    undo: () => patch(before)
  };
}

const SURFACES = [
  { name: "home", path: "/codex" },
  { name: "pages", path: "/codex/pages" },
  // The page editor is the single densest surface in the Codex: a toolbar, a field grid, the tag input,
  // the connections list and its per-row controls. A section-only audit measures none of them.
  { name: "page-editor", path: "/codex/pages", open: (page) => openFirstRecord(page, {
      rows: ".codex-shell-content button.codex-tree-page, .codex-shell-content button.codex-list-item",
      expect: ".codex-editor", what: "page"
    }) },
  { name: "atlas", path: "/codex/atlas" },
  { name: "pin-inspector", path: "/codex/atlas", open: async (page) => {
      await page.waitForTimeout(1200);
      // A pin with a LINKED PAGE, not just the first pin: `.codex-marker-link-open` only renders for one,
      // and it is the row this surface most needs measured. Walking until the row appears is what makes
      // "the pin inspector is clean" a statement about the pin inspector a GM actually opens.
      if (!(await openPinWithLinks(page))) throw new Error("no pin on this map opens an inspector with a linked page");
      await page.waitForTimeout(600);
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
  // Was `hasText: /^Session \d/`, which is not a fixture reference but is the same coupling one step
  // weaker: it passes only while `sessionTitle()` is falling back to its numbered default, and a
  // campaign whose sessions carry real names would have reported this surface unmeasured.
  { name: "session-editor", path: "/codex/sessions", open: async (page) => {
      await openFirstRecord(page, {
        rows: ".codex-shell-content button.codex-session-row", expect: ".codex-session-editor", what: "session"
      });
      // …with "Who played" OPEN (`5a`). Since it became a `TagInput pick` chooser, its option rows are
      // the densest control cluster on this surface and they do not exist until the box is tapped —
      // a closed picker measures one 44px input and reports the party's rows as if they were not there.
      // Same shape as `play-homebrew-picker`; the run's third overlay mechanism excludes the fields
      // BENEATH the open list from the reach verdict while still measuring the list's own rows.
      await openCombobox(page, "#s-attendees", 'the session editor has no "Who played" chooser to open');
    } },
  { name: "quests", path: "/codex/quests" },
  { name: "quest-editor", path: "/codex/quests", open: (page) => openFirstRecord(page, {
      rows: ".codex-shell-content button.codex-quest-row", expect: ".codex-quest-editor", what: "quest"
    }) },
  { name: "journal", path: "/codex/journal" },
  { name: "calendar", path: "/codex/calendar" },
  // …with the "Who" chooser OPEN (`5e.3`): same reason as `session-editor` above. The list carries one
  // row per character page, marked "Archived" where the table has retired one, and a closed box shows
  // none of them.
  { name: "downtime", path: "/codex/downtime", open: (page) =>
      openCombobox(page, "#codex-downtime-who", 'the downtime composer has no "Who" chooser to open') },
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
    } },
  // ---- The play shell + its phase-A surfaces. `root: "main"` measures the whole shell
  // (tab bar included); each `ready` is the surface's own render root, since none of these
  // has a `.codex-shell-content`. One line per address, as §6b step 4 wants. ----
  { name: "play-table", path: "/table", root: "main", ready: ".table-layout" },
  { name: "play-scenes", path: "/scenes", root: "main", ready: ".scene-gallery-hub" },
  { name: "play-maps", path: "/scenes/maps", root: "main", ready: ".scenes-maps-view" },
  { name: "play-roster", path: "/roster", root: "main", ready: ".party-heading-actions" },
  { name: "play-replays", path: "/replays", root: "main", ready: ".replay-panel" },
  { name: "play-settings", path: "/settings", root: "main", ready: ".settings-group" },
  // Ruling 61 — the API reference as a real GM-only address, full window width.
  { name: "play-api-reference", path: "/settings/api", root: "main", ready: ".api-reference-page" },
  { name: "play-builder", path: "/builder", root: "main", ready: ".cb-page, .builder-gate" },
  /**
   * `/homebrew` — a GM-only address this audit has never loaded, on a tab whose whole job is dense
   * forms. Two entries because the library and the editor share almost no controls: the rail is rows
   * and filters, and every field a GM actually authors is inside `RecordDetail`. Measuring only the
   * first would report "the homebrew tab is clean" about a screen containing no fields.
   *
   * The editor entry opens whatever record the rail lists first, the same way the page and quest
   * editors do here — never a named fixture, which is what made two Codex surfaces report NOT
   * MEASURED against a database the seed had not built. A homebrew library with nothing in it
   * therefore reports NOT MEASURED rather than measuring the empty state twice.
   */
  { name: "play-homebrew", path: "/homebrew", root: "main", ready: ".hb-root" },
  { name: "play-homebrew-record", path: "/homebrew", root: "main", ready: ".hb-root", open: (page) => openFirstRecord(page, {
      rows: ".hb-rail button.hb-row", expect: ".hb-detail", what: "homebrew"
    }) },
  /**
   * ...and one with a CHOOSER OPEN, on the same reasoning as the pin inspector's Appearance
   * disclosure above: `Combobox`'s option rows take the 44px floor as real paint (route 1,
   * `min-height: var(--tap-min)` on `.nh-combobox-option`), and a closed picker has no rows at all.
   * The editor measured with every picker shut says nothing about the densest cluster on it — which
   * is precisely the thirteen damage types and seven rarities this audit exists to check.
   *
   * Separate from the entry above rather than folded into it so a library whose first record has no
   * open-slug picker (a spell list, say) reports THIS surface unmeasured and still measures the
   * editor. Substituting one for the other is the failure this file's docblock is about.
   */
  { name: "play-homebrew-picker", path: "/homebrew", root: "main", ready: ".hb-root", open: async (page) => {
      // Only if a record is not ALREADY open. `walk` navigates by pushing the same address the
      // previous surface used, which the router correctly treats as a no-op — so the editor the
      // entry above opened is still on screen, and at 375px the rail it would be re-opened from is
      // the half of the master-detail that is currently hidden. This is not the "measure the previous
      // surface" substitution the docblock forbids: the surface still ends at a homebrew editor with
      // a chooser open, and still fails loudly below if there is no chooser to open.
      if (await page.locator(".hb-detail").count() === 0) {
        await openFirstRecord(page, { rows: ".hb-rail button.hb-row", expect: ".hb-detail", what: "homebrew" });
      }
      const chooser = page.locator(".hb-detail .nh-combobox input[role=combobox]").first();
      if (await chooser.count() === 0) throw new Error("the first homebrew record has no open-slug chooser to open");
      await chooser.click({ timeout: 8_000 });
      await page.waitForSelector(".nh-combobox-list", { timeout: 8_000 });
      await page.waitForTimeout(600);
    } },
  // The sheet LAYER (`/characters/:id`) — a parameterised address, so it resolves its id from the
  // table's own tokens the way the no-scroll audit does, then navigates. Its page actions live
  // inside the sheet frame now, which is exactly the row this measurement should see.
  { name: "play-sheet", path: "/table", root: "main", ready: ".table-layout", open: async (page) => {
      const id = await page.evaluate(() => document.querySelector("[data-token-id]")?.getAttribute("data-token-id") ?? null);
      if (!id) throw new Error("no character token on the table to open a sheet from");
      await page.evaluate((target) => {
        history.pushState(null, "", target);
        dispatchEvent(new PopStateEvent("popstate", { state: null }));
        dispatchEvent(new PopStateEvent("popstate", { state: null }));
      }, `/characters/${id}`);
      await page.waitForSelector(".sheet-standalone", { timeout: 10_000 });
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
      if (!(await openPinWithLinks(page))) throw new Error("no revealed pin opens a sheet with a linked page");
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
    } },
  // ---- The player's own play shell (see the GM `play-*` block above). ----
  { name: "player-play-table", path: "/table", root: "main", ready: ".table-layout" },
  // D9 — MY CHARACTER, the player's first tab and the only player-ONLY address in the app. It
  // carries the release verb and the builder doors the deleted character bar used to hold, so it is
  // exactly the kind of dense control cluster this audit exists to measure.
  { name: "player-my-character", path: "/me", root: "main", ready: ".my-character" },
  { name: "player-play-replays", path: "/replays", root: "main", ready: ".replay-panel" },
  { name: "player-play-settings", path: "/settings", root: "main", ready: ".settings-group" }
];

const report = [];
let totalControls = 0, totalBad = 0, unmeasured = 0;
let totalUnreachable = 0, totalOverlaid = 0, totalClosed = 0;

async function walk(page, surfaces, rootSelector) {
  for (const surface of surfaces) {
    if (surface.narrowOnly && width >= 761) { report.push(`### ${surface.name}: not present at ${width}px (>=761)`); continue; }
    // Per-surface root/ready: codex surfaces keep the pass default (`rootSelector` and its
    // `.codex-shell-content` gate); a play surface names its own root and render gate.
    const root = surface.root ?? rootSelector;
    const ready = surface.ready ?? `${root} .codex-shell-content`;
    // Addresses, not tabs. A hard `goto` would drop the memory-only GM token, so this drives the router
    // the way the address bar does inside a live SPA. The popstate is dispatched TWICE on purpose:
    // router.ts's transient mechanism absorbs the first pop whenever a transient overlay (nav drawer,
    // palette) is still registered — it closes the overlay and the route stands — so a single dispatch
    // right after such a surface navigates nowhere. The second dispatch finds no transient and routes;
    // with none registered, it re-routes to the same path, which the router treats as a no-op.
    await page.evaluate((target) => {
      history.pushState(null, "", target);
      dispatchEvent(new PopStateEvent("popstate", { state: null }));
      dispatchEvent(new PopStateEvent("popstate", { state: null }));
    }, surface.path);
    try { await page.waitForSelector(ready, { timeout: 15_000 }); }
    catch { report.push(`### ${surface.name}: ${surface.path} DID NOT RENDER - NOT MEASURED`); unmeasured += 1; continue; }
    await page.waitForTimeout(900);
    if (surface.open) {
      // Never measure a surface we did not actually reach: a silent zero is worse than a loud failure,
      // and silently measuring the PREVIOUS surface again is worse than either.
      try { await surface.open(page); }
      catch (error) { report.push(`### ${surface.name}: could not open - NOT MEASURED - ${String(error).split("\n")[0].slice(0, 90)}`); unmeasured += 1; continue; }
    }
    // A string `pageFunction` is evaluated as an EXPRESSION and never receives `arg`, so the call is
    // built into the expression instead of passed alongside it.
    const { out, error } = await page.evaluate(`${MEASURE}(${JSON.stringify(root)})`);
    if (error) { report.push(`### ${surface.name}: ${error} - NOT MEASURED`); unmeasured += 1; continue; }
    // SIZE IS MEASURED IN EVERY LAYER; REACH IS JUDGED IN ONE. `bad` deliberately keeps the whole
    // population, closed disclosures included: a menu item's box is laid out whether or not its
    // <details> is open, so its size is a real measurement of a real tap target, and dropping those
    // rows would have moved the A-3 number 124 -> 121 (2026-08-05, 375px: two `.action-row-static`
    // rows at 39.9px inside play-table's "Traits & reference" disclosure, and one 19px
    // `/api/v1/openapi.json` link inside a play-settings disclosure) by narrowing scope rather than by
    // fixing anything. Reachability is the opposite case — it is a statement about what is under the finger
    // RIGHT NOW, and for a control the browser is not hit-testing, or one lying under an open modal
    // or drawer, there is no finger and no answer. Those are reported by name below, never dropped.
    const bad = out.filter((c) => c.h < 44 || c.w < 44);
    const judged = out.filter((c) => c.layer === "active");
    const stolen = judged.filter((c) => c.h >= 44 && c.w >= 44 && c.reach > 0 && c.reach < c.h - 2);
    const unreachable = judged.filter((c) => c.h >= 44 && c.w >= 44 && c.reach === 0);
    const overlaid = out.filter((c) => c.layer === "overlaid");
    const closed = out.filter((c) => c.layer === "closed");
    totalControls += out.length; totalBad += bad.length;
    totalUnreachable += unreachable.length; totalOverlaid += overlaid.length; totalClosed += closed.length;
    report.push(`### ${surface.name} (${surface.path}) - ${out.length} controls, ${bad.length} below 44px, ${stolen.length} with taps stolen, ${unreachable.length} unreachable in the active layer`);
    // Counted over controls of EVERY size, unlike the three metrics above, which are >=44 questions:
    // reach goes unjudged for a 20px control in a closed menu exactly as it does for a 44px one.
    if (overlaid.length + closed.length > 0)
      report.push(`  LAYER reach not judged for ${overlaid.length + closed.length} of ${out.length}: ${overlaid.length} behind an open overlay (a modal, a Drawer, or a Combobox listbox), ${closed.length} inside a closed disclosure - sizes above still count them`);
    for (const c of bad) report.push(`  SIZE  ${c.h}x${c.w} reach=${c.reach}  ${c.tag}.${c.cls}  "${c.label}"`);
    for (const c of stolen) report.push(`  STEAL ${c.h}x${c.w} reach=${c.reach}  ${c.tag}.${c.cls}  "${c.label}"`);
    // Printed per row, unlike the count this replaces: `unresolved` was a header number with no
    // detail under it, so the 184 it reported on 2026-08-05 could not be read without re-deriving
    // them by hand. A row here is a control in the layer the user is actually touching whose own
    // centre resolves to something else — a real tap theft, and part of the exit gate below.
    for (const c of unreachable) report.push(`  UNREACH ${c.h}x${c.w} reach=0  ${c.tag}.${c.cls}  "${c.label}"`);
    await page.screenshot({ path: `${OUT}/tap-${surface.name}-${width}.png`, fullPage: false });
    // Leave no overlay open behind us, or the next surface measures this one's controls too.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }
}

// Before the walk, not during it: the atlas reads its markers when the route renders, and the player
// pass opens a second context later that has to see the same pin.
let fixture = { note: "", undo: async () => {} };
try { fixture = await ensureLinkedPin(); }
catch (error) { fixture = { note: `pin fixture: FAILED - ${String(error).split("\n")[0].slice(0, 90)}`, undo: async () => {} }; }
report.push(fixture.note, "");

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

// Leave the database as it was found. A failure here is reported rather than thrown: the measurement
// is already taken, and losing the whole report to a failed cleanup would be the worse trade.
try { await fixture.undo(); }
catch (error) { report.push(`### PIN FIXTURE NOT RESTORED - ${String(error).split("\n")[0].slice(0, 120)}`); }

console.log(`===== Codex tap-target audit @ ${width}px =====`);
console.log(report.join("\n"));
console.log(`\n${totalControls} interactive controls measured, ${totalBad} below the 44px floor, ${totalUnreachable} unreachable in the active layer, ${unmeasured} surfaces NOT MEASURED.`);
console.log(`Reach not judged for ${totalOverlaid + totalClosed}: ${totalOverlaid} behind an open overlay (a modal <dialog> or an open Drawer), ${totalClosed} inside a closed disclosure. Both are sized and counted in the total above.`);
await b.close();
// `totalUnreachable` JOINED THE GATE on 2026-08-05, at 0. It was never gated before because the number
// it replaces (`unresolved`) stood at 184 and could not be read: every one of those 184 was a control
// in a layer with no finger on it, so gating on it would have failed every run for a reason that was
// not a defect. Judged in the active layer it is a defect - the control is on screen, the user's thumb
// lands on its centre, and something else answers - so it fails the run like a sub-floor control does.
// `stolen` stays out of the gate: the docblock's over-reporting note still holds for it.
process.exit(totalBad === 0 && totalUnreachable === 0 && unmeasured === 0 ? 0 : 1);
