/**
 * The journeys a table depends on, in the order a first evening runs them. They share one server per
 * viewport, so the first one meets a server with no GM password.
 */
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import {
  GM_PASSWORD,
  PARTY,
  battleMap,
  drag,
  expectTokenUncovered,
  expectUncovered,
  ensureGmPassword,
  expect,
  expectPageFits,
  fillIn,
  joinAndClaim,
  openGmSection,
  pageScale,
  pinch,
  pinchDuringDrag,
  positionOf,
  press,
  signInAsGm,
  test,
  toneWav
} from "./smoke";

const MAP_NAME = "Smoke cavern";

/** Where an image point of the calibration preview is on screen: the preview svg maps image pixels to the page. */
async function onPreview(page: Page, point: { x: number; y: number }) {
  return page.locator(".map-preview svg").evaluate((svg: SVGSVGElement, { x, y }) => {
    const matrix = svg.getScreenCTM()!;
    return { x: matrix.a * x + matrix.c * y + matrix.e, y: matrix.b * x + matrix.d * y + matrix.f };
  }, point);
}

/** From a scene's step, Next through the steps named, then Make live and the table. */
async function makeLiveFromSteps(gm: Page, steps: readonly string[]) {
  for (const step of steps) await press(gm.getByRole("button", { name: `Next: ${step}` }));
  await expect(gm.getByRole("heading", { name: "Review and make live" })).toBeVisible();
  await expectPageFits(gm);
  await press(gm.getByRole("button", { name: "Make live" }));
  // With a fight running, making another scene live parks it, which the GM confirms.
  const confirm = gm.getByRole("dialog", { name: "Make scene live?" });
  const table = gm.getByRole("button", { name: "Go to the table" });
  await expect(confirm.or(table)).toBeVisible();
  if (await confirm.isVisible()) await press(confirm.getByRole("button", { name: "Make live" }));
  await press(table);
}

/** A new scene on a freshly uploaded map, made from the Scenes tab's steps and made live; the GM ends at the table. */
async function liveSceneOnNewMap(gm: Page, file: string, buffer: Buffer) {
  await openGmSection(gm, "Scenes");
  // The bar's New scene on a laptop, the tab bar's New on a phone.
  await press(gm.getByRole("button", { name: /^New( scene)?$/ }).first());
  await expect(gm.getByRole("heading", { name: "New scene" })).toBeVisible();
  const chooser = gm.waitForEvent("filechooser");
  await press(gm.getByRole("button", { name: /Upload a map/ }));
  await (await chooser).setFiles({ name: file, mimeType: "image/png", buffer });
  await expect(gm.getByText("Map uploaded.")).toBeVisible();
  await expectPageFits(gm);
  await press(gm.getByRole("button", { name: "Continue" }));
  await expect(gm.getByRole("heading", { name: "Tokens and monsters" })).toBeVisible();
  await makeLiveFromSteps(gm, ["Light", "Sound", "Review"]);
}

test("the first evening: the GM password, the join address, a player, the table screen and a live scene", async ({
  open,
  hasTouch
}) => {
  // The GM password, set once on the host.
  const gm = await open("/");
  await expectPageFits(gm);
  await press(gm.getByRole("button", { name: "Enter as GM" }));
  await expect(gm.getByRole("heading", { name: "Set up the GM password" })).toBeVisible();
  await fillIn(gm.getByPlaceholder("GM password"), "short");
  await press(gm.getByRole("button", { name: "Set GM password" }));
  await expect(gm.getByText("Use a GM password of at least 12 characters.")).toBeVisible();
  // The label on the sun frame is readable: light ink on the dark plate.
  const label = await gm
    .getByRole("button", { name: "Set GM password" })
    .evaluate((button) => getComputedStyle(button).color);
  expect(label, "primary label colour").not.toBe("rgb(4, 20, 28)");
  await press(gm.getByRole("button", { name: "Show password" }));
  await expect(gm.getByPlaceholder("GM password")).toHaveAttribute("type", "text");
  await fillIn(gm.getByPlaceholder("GM password"), GM_PASSWORD);
  await press(gm.getByRole("button", { name: "Set GM password" }));
  await expect(gm.getByText("GM password set. Enter it to begin.")).toBeVisible();
  // The rejected attempt's error went when the next one started.
  await expect(gm.getByText("Use a GM password of at least 12 characters.")).toBeHidden();
  await expectPageFits(gm);

  await fillIn(gm.getByPlaceholder("GM password"), "not-the-password");
  await press(gm.getByRole("button", { name: "Enter table" }));
  await expect(gm.getByText("That is not the GM password. Check it and try again.")).toBeVisible();
  await press(gm.getByRole("button", { name: "Forgot the password" }));
  const reset = gm.getByRole("dialog", { name: "Reset the GM password" });
  await expect(reset.getByText("apps/server/data/auth.json")).toBeVisible();
  await expectPageFits(gm);
  await press(reset.getByRole("button", { name: "Close" }));
  await fillIn(gm.getByPlaceholder("GM password"), GM_PASSWORD);
  await press(gm.getByRole("button", { name: "Enter table" }));
  await expect(gm.getByRole("tab", { name: "Table", selected: true })).toBeVisible();
  // A reload keeps the GM signed in.
  await gm.reload();
  await expect(gm.getByRole("tab", { name: "Table", selected: true })).toBeVisible();
  await expectPageFits(gm);

  // The address players open, from the Table's empty state, with Copy and a QR code drawn here.
  const join = gm.getByRole("region", { name: "Join address" });
  await expect(join.getByText("Players join at")).toBeVisible();
  // One network address shows as text; several as a choice, the first already chosen.
  const choice = join.getByRole("combobox", { name: "Join address" });
  const address = (await choice.isVisible()) ? await choice.inputValue() : await join.locator("code").textContent();
  expect(address).toMatch(/^http:\/\/[\d.]+:\d+$/);
  await gm.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await press(join.getByRole("button", { name: "Copy" }));
  await expect(gm.getByText("Join address copied.")).toBeVisible();
  expect(await gm.evaluate(() => navigator.clipboard.readText())).toBe(address);
  if (hasTouch) await press(join.getByRole("button", { name: "Show QR code" }));
  await expect(join.getByRole("img", { name: `QR code for ${address}` })).toBeVisible();
  await expectPageFits(gm);

  // A player opens that address, sees who each character is, claims one and lands on My character.
  const player = await open(address!);
  await press(player.getByRole("button", { name: "Join as Player" }));
  await expect(player.getByRole("heading", { name: "Choose your character" })).toBeVisible();
  // The later journeys play the other two.
  const card = player.getByRole("listitem").filter({ hasText: PARTY[2] });
  await expect(card.getByText(/^Elf Wizard 7 · HP \d+$/)).toBeVisible();
  await expectPageFits(player);
  await press(card.getByRole("button", { name: "Claim" }));
  await press(player.getByRole("dialog", { name: `Claim ${PARTY[2]}?` }).getByRole("button", { name: "Claim" }));
  await expect(player.getByRole("tab", { name: "My character", selected: true })).toBeVisible();
  await expectPageFits(player);

  // The table screen shows a code, and the GM types it: nothing is typed with a remote.
  const screen = await open("/viewer.html");
  await expect(screen.getByRole("heading", { name: "Pair this screen" })).toBeVisible();
  const code = (await screen.locator(".viewer-screen-code").textContent())!.replace(/\D/g, "");
  expect(code).toMatch(/^\d{6}$/);
  await openGmSection(gm, "Shared screen");
  await fillIn(gm.getByLabel("Code on the screen"), code);
  await fillIn(gm.getByLabel("Screen name"), "Living room TV");
  await press(gm.getByRole("button", { name: "Pair screen" }));
  await expect(gm.getByText("Living room TV is paired. It shows the table in a moment.")).toBeVisible();
  await expect(screen.getByRole("heading", { name: "Pair this screen" })).toBeHidden();
  await expect(gm.getByText("1 screen connected")).toBeVisible();
  await expectPageFits(gm);

  // A scene on a new map, from the table's own start: its steps run on the Scenes tab. The map has no grid, which the
  // picker says, and the scene's Map step leads to it.
  await press(gm.getByRole("tab", { name: "Table" }));
  await press(gm.getByRole("button", { name: "Prepare a scene" }));
  await expect(gm.getByRole("heading", { name: "New scene" })).toBeVisible();
  const chooser = gm.waitForEvent("filechooser");
  await press(gm.getByRole("button", { name: /Upload a map/ }));
  await (await chooser).setFiles({ name: `${MAP_NAME}.png`, mimeType: "image/png", buffer: battleMap() });
  await expect(gm.getByText("Map uploaded.")).toBeVisible();
  await expect(gm.getByText(/has no grid yet/).first()).toBeVisible();
  await expectPageFits(gm);
  await press(gm.getByRole("button", { name: "Continue" }));
  await expect(gm.getByRole("heading", { name: "Tokens and monsters" })).toBeVisible();
  await press(gm.getByRole("button", { name: "Back", exact: true }));
  await expect(gm.getByRole("heading", { name: "Map", exact: true })).toBeVisible();
  await expectPageFits(gm);
  await press(gm.getByRole("button", { name: "Set the grid" }));

  // The grid: a printed square grid, a 3 x 3 drag from one intersection to the opposite one, then confirm.
  await expect(gm.getByRole("heading", { name: "Grid", exact: true })).toBeVisible();
  await press(gm.getByRole("button", { name: "Continue" }));
  const from = await onPreview(gm, { x: 64, y: 64 });
  const to = await onPreview(gm, { x: 256, y: 256 });
  await drag(gm, gm.locator(".map-preview"), { x: to.x - from.x, y: to.y - from.y }, from);
  await press(gm.getByRole("button", { name: "Measure this area" }));
  await press(gm.getByRole("button", { name: "Looks right" }));
  await expect(gm.getByRole("heading", { name: "Check the alignment" })).toBeVisible();
  await press(gm.getByRole("button", { name: "Confirm grid" }));
  await expect(gm.getByText(`The grid for ${MAP_NAME} is set. Tokens on it snap to its squares.`)).toBeVisible();
  await expectPageFits(gm);

  // Back to the scene, now with a grid, through its steps to live: the table screen shows it.
  await press(gm.getByRole("button", { name: "Back to the scene" }));
  await expect(gm.getByRole("heading", { name: "Map", exact: true })).toBeVisible();
  await expect(gm.getByRole("button", { name: "Set the grid" })).toBeHidden();
  await makeLiveFromSteps(gm, ["Tokens", "Light", "Sound", "Review"]);
  await expect(gm.getByLabel(`Scenes · ${MAP_NAME} is live`)).toBeVisible();
  await expect(screen.getByRole("img", { name: MAP_NAME })).toBeVisible();
  await expectPageFits(gm);
  await expectPageFits(screen);
});

test("a player joins and claims a character", async ({ open }) => {
  const player = await open("/");
  await ensureGmPassword(player.request);
  await press(player.getByRole("button", { name: "Join as Player" }));
  await expect(player.getByRole("heading", { name: "Choose your character" })).toBeVisible();
  await expectPageFits(player);

  const card = player.getByRole("listitem").filter({ hasText: PARTY[0] });
  await press(card.getByRole("button", { name: "Claim" }));
  await press(player.getByRole("dialog", { name: `Claim ${PARTY[0]}?` }).getByRole("button", { name: "Claim" }));
  await expect(player.getByText(`You're playing ${PARTY[0]}.`)).toBeVisible();
  await expectPageFits(player);

  // My character is the character's sheet; Release is in its menu.
  await press(player.getByRole("tab", { name: "My character" }));
  await expect(player.getByRole("region", { name: `${PARTY[0]} character sheet` })).toBeVisible();
  await press(player.getByLabel(`Sheet menu for ${PARTY[0]}`));
  await expect(player.getByRole("menuitem", { name: `Release ${PARTY[0]}` })).toBeVisible();
  await player.keyboard.press("Escape");
  await expectPageFits(player);

  // After a reload, joining again resumes the same session: their character, on the page they left.
  await player.reload();
  await press(player.getByRole("button", { name: "Join as Player" }));
  await expect(player.getByRole("tab", { name: "My character", selected: true })).toBeVisible();
  await expect(player.getByRole("region", { name: `${PARTY[0]} character sheet` })).toBeVisible();
});

test("a stray pinch on a phone leaves the page at its size, and a finger still scrolls", async ({
  open,
  hasTouch,
  request
}) => {
  test.skip(!hasTouch, "A laptop has no touch screen to pinch.");
  await ensureGmPassword(request);
  const gm = await open("/");
  await signInAsGm(gm);
  await openGmSection(gm, "Roster");
  const roster = gm.locator(".party-roster-body");
  await expect(roster.getByRole("heading", { name: PARTY[0] })).toBeVisible();

  await drag(gm, roster, { x: 0, y: -240 });
  await expect.poll(() => roster.evaluate((list) => list.scrollTop)).toBeGreaterThan(0);
  await pinch(gm, roster);
  expect(await pageScale(gm)).toBe(1);
  await expectPageFits(gm);

  // This device can let two fingers zoom the page.
  await gm.goto("/settings/device");
  const allow = gm.getByRole("switch", { name: "Let pinch zoom the page" });
  await press(allow);
  await expect(allow).toHaveAttribute("aria-checked", "true");
  await pinch(gm, gm.getByRole("heading", { name: "Device", level: 2 }));
  await expect.poll(() => pageScale(gm)).toBeGreaterThan(1);
});

test("the GM runs a fight on a new scene and the player moves their token", async ({ open, hasTouch }) => {
  const hero = PARTY[1];
  const player = await open("/");
  await joinAndClaim(player, hero);
  const gm = await open("/");
  await signInAsGm(gm);

  // A scene with a freshly uploaded battle map, made live. A different image from the first evening's, which the
  // library would recognise and reuse with its grid.
  await liveSceneOnNewMap(gm, "Smoke crossing.png", battleMap(700, 504));
  await expect(gm.getByRole("heading", { name: "Start a fight" })).toBeVisible();

  // The fight: the player's character and one monster.
  for (const other of PARTY.filter((name) => name !== hero)) {
    const remove = gm.getByRole("button", { name: `Remove ${other} from this list` });
    await press(remove);
    await expect(remove).toBeHidden();
  }
  await press(gm.getByRole("button", { name: "Add monsters" }));
  const bestiary = gm.getByRole("dialog", { name: "Add monsters from the bestiary" });
  await fillIn(bestiary.getByRole("searchbox", { name: "Search monsters" }), "Goblin Minion");
  await press(bestiary.getByRole("listitem").filter({ hasText: "Goblin Minion" }).getByRole("button", { name: "Add" }));
  await expect(bestiary.getByText("Goblin Minion is in the staging tray.")).toBeVisible();
  await expectPageFits(gm);
  await press(bestiary.getByRole("button", { name: "Close" }));
  await press(gm.getByRole("button", { name: "Start the fight" }));
  await expect(gm.getByRole("tablist", { name: "The fight · round 1" })).toBeVisible();
  await expectPageFits(gm);
  // The one primary sits in the panel's footer, inside the viewport and uncovered.
  await expectUncovered(gm.getByRole("button", { name: "Next turn" }));

  // A move off the mover's turn goes to the GM, so if the goblin won initiative the GM ends its turn first.
  await expect(player.getByRole("tablist", { name: "The fight · round 1" })).toBeVisible();
  const yourTurn = player.getByRole("heading", { name: "Your turn" });
  if (!(await yourTurn.isVisible())) await press(gm.getByRole("button", { name: "Next turn" }));
  await expect(yourTurn).toBeVisible();
  await expectUncovered(player.getByRole("button", { name: "End turn" }));
  if (hasTouch) {
    // On a phone a divider splits the map pane from the panel; the keys move it as well as a finger.
    const divider = player.getByRole("separator", { name: "Map and panel split" });
    const before = Number(await divider.getAttribute("aria-valuenow"));
    await divider.focus();
    await player.keyboard.press("ArrowUp");
    await expect(divider).toHaveAttribute("aria-valuenow", String(before - 5));
    await player.keyboard.press("ArrowDown");
    await expectPageFits(player);
  }

  // The player places their own token from the tray, then drags it across the map.
  await press(player.getByLabel("Staging tray").getByRole("button", { name: hero }));
  const token = player.getByRole("button", { name: new RegExp(`^${hero}.*Drag to move`) });
  await expect(token).toBeVisible();
  const placed = await token.getAttribute("transform");
  // The map holds still while the move saves: every DOM change during the drag re-measures it.
  await player.locator(".encounter-map-stage").evaluate((stage) => {
    const boxes = new Set<string>();
    const measure = () => boxes.add(JSON.stringify(stage.getBoundingClientRect()));
    measure();
    new MutationObserver(measure).observe(document.body, { subtree: true, childList: true, attributes: true });
    Object.assign(window, { stageBoxes: boxes });
  });
  await drag(player, token, { x: 60, y: 30 });
  await expect(token).not.toHaveAttribute("transform", placed!);
  const moved = (await token.getAttribute("transform"))!;
  const stageBoxes = await player.evaluate(() => [...(window as unknown as { stageBoxes: Set<string> }).stageBoxes]);
  expect(stageBoxes, "map stage boxes seen during the move").toHaveLength(1);
  await expectPageFits(player);

  // The GM sees the move the server accepted.
  const tokenId = await token.getAttribute("data-token-id");
  await expect(gm.locator(`g.encounter-token[data-token-id="${tokenId}"]`)).toHaveAttribute("transform", moved);
  // Nothing covers the acting token, on either screen.
  await expectTokenUncovered(player, tokenId!);
  await expectTokenUncovered(gm, tokenId!);

  if (hasTouch) {
    // A second finger turns the drag into a pinch: the map zooms in and the drag commits nothing.
    const map = player.getByRole("group", { name: /Interactive tokens are layered above this map/ });
    const viewWidth = async () => Number((await map.getAttribute("viewBox"))!.split(/\s+/)[2]);
    const before = await viewWidth();
    await pinchDuringDrag(player, token, map);
    await expect.poll(viewWidth).toBeLessThan(before);
    // An arrow-key step lands after anything the abandoned drag sent, which would have moved it down.
    const start = await positionOf(token);
    await token.focus();
    await player.keyboard.press("ArrowRight");
    await expect.poll(async () => (await positionOf(token)).x).toBeGreaterThan(start.x);
    expect((await positionOf(token)).y).toBe(start.y);
  }
});

test("a save on the player's own turn leaves the bar under the thumb on screen", async ({ open }) => {
  const hero = PARTY[1];
  const player = await open("/");
  await ensureGmPassword(player.request);
  // The GM's side is the API: this journey is about the player's panel.
  const { token } = (
    await (await player.request.post("/api/v1/host/gm/sign-in", { data: { password: GM_PASSWORD } })).json()
  ).data;
  const headers = { authorization: `Bearer ${token}` };
  const gm = async (path: string, data: Record<string, unknown>) => {
    const reply = await player.request.post(path, { headers, data: { commandId: randomUUID(), ...data } });
    expect(reply.ok(), `${path}: ${await reply.text()}`).toBe(true);
  };
  const game = async () => (await (await player.request.get("/api/v1/game", { headers })).json()).data.game;
  let state = await game();
  const { id: actorId, ownerSessionId } = state.actors.find((actor: { name: string }) => actor.name === hero);
  if (ownerSessionId) await gm(`/api/v1/game/claims/${actorId}/force-release`, { actorId, inFight: true });
  // The fight journey leaves this character's fight running. On its own this journey starts one: on the live
  // scene's map when a scene is live, else on a map of its own.
  if (
    !state.combat.initiative.some((entry: { actorId: string }) => entry.actorId === actorId) ||
    !state.combat.active
  ) {
    if (state.combat.active) await gm("/api/v1/game/encounter/end", {});
    let mapAssetId = state.combat.activeSceneId ? state.combat.mapAssetId : null;
    if (!mapAssetId) {
      const upload = await player.request.post(`/api/v1/map-assets?name=Smoke%20yard&kind=battlemap`, {
        headers: { ...headers, "content-type": "image/png" },
        data: battleMap()
      });
      expect(upload.ok(), await upload.text()).toBe(true);
      mapAssetId = (await upload.json()).data.asset.id;
    }
    await gm("/api/v1/game/encounter/start", { mapAssetId, entries: [{ actorId, score: 20 }] });
  }
  for (let step = 0; step < 4 && (await game()).combat.turnActorId !== actorId; step += 1)
    await gm("/api/v1/game/initiative/next", {});
  state = await game();
  expect(state.combat.turnActorId).toBe(actorId);
  await joinAndClaim(player, hero);
  await press(player.getByRole("tab", { name: "Turn" }));
  await expect(player.getByRole("heading", { name: "Your turn" })).toBeVisible();

  // A saving throw for this character on its own turn: the GM's ruling stands in for whatever forced it.
  await gm("/api/v1/game/actions/resolve", {
    actorId,
    actionId: "spell-sacred-flame",
    targetIds: [actorId],
    override: { reason: "A save on the character's own turn" }
  });
  const slot = player.getByRole("region", { name: "Answer now" });
  await expect(slot.getByRole("heading", { name: /Dexterity saving throw/ })).toBeVisible();
  // The prompt throws the die as it opens and shows a disabled Roll until the server answers. A new Confirm button
  // then takes its place, so the check waits for Confirm, the button the player presses.
  const confirm = slot.getByRole("button", { name: "Confirm" });
  await expect(confirm).toBeVisible();
  // The save's own button leads the view, and the bar with End turn stays inside the viewport, uncovered.
  await expectUncovered(confirm);
  await expectUncovered(player.getByRole("button", { name: "End turn" }));
  await expectPageFits(player);
  // Answered, the prompt leaves the slot.
  await press(confirm);
  await expect(slot.getByRole("heading", { name: /Dexterity saving throw/ })).toBeHidden();
});

test("a player takes a turn on a phone: a tile, its cast, a target and the roll", async ({ open, hasTouch }) => {
  test.skip(!hasTouch, "The turn card is a phone's.");
  const hero = PARTY[1];
  const player = await open("/");
  await ensureGmPassword(player.request);
  // The GM's setup is the API's: this journey is about the player's turn card.
  const { token } = (
    await (await player.request.post("/api/v1/host/gm/sign-in", { data: { password: GM_PASSWORD } })).json()
  ).data;
  const headers = { authorization: `Bearer ${token}` };
  const api = (path: string, data: Record<string, unknown> = {}) =>
    player.request.post(path, { headers, data: { commandId: randomUUID(), ...data } });
  const { game } = (await (await player.request.get("/api/v1/game", { headers })).json()).data;
  // An earlier journey's fight ends, and its player's hold on the character goes.
  if (game.combat.active) expect((await api("/api/v1/game/encounter/end")).ok()).toBe(true);
  const { id: actorId, ownerSessionId } = game.actors.find((actor: { name: string }) => actor.name === hero);
  if (ownerSessionId) expect((await api(`/api/v1/game/claims/${actorId}/force-release`, { actorId })).ok()).toBe(true);
  await joinAndClaim(player, hero);

  // A fight with the hero and one monster, on a scene of its own.
  const gm = await open("/");
  await signInAsGm(gm);
  await liveSceneOnNewMap(gm, "Smoke ford.png", battleMap(700, 490));
  await expect(gm.getByRole("heading", { name: "Start a fight" })).toBeVisible();
  for (const other of PARTY.filter((name) => name !== hero)) {
    const remove = gm.getByRole("button", { name: `Remove ${other} from this list` });
    await press(remove);
    await expect(remove).toBeHidden();
  }
  await press(gm.getByRole("button", { name: "Add monsters" }));
  const bestiary = gm.getByRole("dialog", { name: "Add monsters from the bestiary" });
  await fillIn(bestiary.getByRole("searchbox", { name: "Search monsters" }), "Goblin Minion");
  await press(bestiary.getByRole("listitem").filter({ hasText: "Goblin Minion" }).getByRole("button", { name: "Add" }));
  await expect(bestiary.getByText("Goblin Minion is in the staging tray.")).toBeVisible();
  await press(bestiary.getByRole("button", { name: "Close" }));
  await press(gm.getByRole("button", { name: "Start the fight" }));
  await expect(player.getByRole("tablist", { name: "The fight · round 1" })).toBeVisible();
  const yourTurn = player.getByRole("heading", { name: "Your turn" });
  if (!(await yourTurn.isVisible())) await press(gm.getByRole("button", { name: "Next turn" }));
  await expect(yourTurn).toBeVisible();

  // The Turn tab is the turn card alone: the favourite tiles, each saying what it costs.
  const card = player.getByRole("region", { name: "Your turn" });
  await expect(card.getByText("Action · cantrip").first()).toBeVisible();
  await expectPageFits(player);
  // Every option is a tap away. A levelled spell opens its cast card in place with its top in view, however far down
  // the list was scrolled, and Back gives the card back the same way.
  const allOptions = card.getByRole("button", { name: /^All \d+ options$/ });
  await press(allOptions);
  await press(card.getByRole("button", { name: /Guiding Bolt/ }).first());
  const cast = player.getByRole("region", { name: "Cast Guiding Bolt" });
  await expect(cast.getByRole("button", { name: "Back" })).toBeInViewport({ ratio: 1 });
  await press(cast.getByRole("button", { name: "Back" }));
  await expect(yourTurn).toBeInViewport({ ratio: 1 });
  // A favourite tile opens the same cast card.
  const tile = card.getByRole("button", { name: /Guiding Bolt/ }).first();
  if (!(await tile.isVisible())) await press(allOptions);
  await press(card.getByRole("button", { name: /Guiding Bolt/ }).first());
  await expect(cast.getByRole("button", { name: /^Level 1/ })).toHaveAttribute("aria-pressed", "true");
  await expectPageFits(player);
  await press(cast.getByRole("button", { name: "Cast at level 1" }));

  // Targeting, as the table builds it: one target, then the roll from the bar under the thumb.
  const picker = player.getByRole("group", { name: "Targets for Guiding Bolt" });
  await expect(picker).toBeVisible();
  await press(picker.getByRole("radio").first());
  await press(player.getByRole("button", { name: "Roll Guiding Bolt" }));
  await expect(player.locator(".action-result").getByText("Guiding Bolt").first()).toBeVisible();
  await expectPageFits(player);
});

test("a player answers the GM's call with a physical die, then rerolls it with Heroic Inspiration", async ({
  open
}) => {
  const hero = PARTY[2];
  const player = await open("/");
  await ensureGmPassword(player.request);
  // The GM's side is the API: this journey is about the player's card.
  const { token } = (
    await (await player.request.post("/api/v1/host/gm/sign-in", { data: { password: GM_PASSWORD } })).json()
  ).data;
  const headers = { authorization: `Bearer ${token}` };
  const { game } = (await (await player.request.get("/api/v1/game", { headers })).json()).data;
  const { id: actorId, ownerSessionId } = game.actors.find((actor: { name: string }) => actor.name === hero);
  const gm = (path: string, data: Record<string, unknown>) =>
    player.request.post(path, { headers, data: { commandId: randomUUID(), ...data } });
  // An earlier journey's player may still hold the character: the GM frees it for this player.
  if (ownerSessionId)
    expect((await gm(`/api/v1/game/claims/${actorId}/force-release`, { actorId, inFight: true })).ok()).toBe(true);
  await joinAndClaim(player, hero);
  expect((await gm(`/api/v1/game/actors/${actorId}/heroic-inspiration`, { actorId, has: true })).ok()).toBe(true);
  const call = { kind: "check", ability: "wis", skill: "perception", dc: 10, actorIds: [actorId] };
  expect((await gm("/api/v1/game/roll-calls", call)).ok()).toBe(true);

  const card = player.getByRole("article", { name: `Wisdom (Perception) check for ${hero}` });
  const face = card.getByLabel("Your d20 for the Wisdom (Perception) check");
  await expect(player.getByText("The GM calls for a Wisdom (Perception) check (DC 10).")).toBeVisible();
  // The toast announcing the call never covers the field the die is typed into.
  expect(
    await face.evaluate((field) => {
      const box = field.getBoundingClientRect();
      return document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) === field;
    })
  ).toBe(true);
  await expectPageFits(player);
  await fillIn(face, "18");
  await press(card.getByRole("button", { name: "Use" }));
  await expect(card).toContainText("(d20 18, typed) vs DC 10 · success");

  // The reroll is typed too, and its button keeps its whole label on a phone.
  const reroll = card.getByRole("button", { name: "Reroll · Heroic Inspiration" });
  const fits = await reroll.evaluate((button) => {
    const outer = button.closest("article")!.getBoundingClientRect();
    const box = button.getBoundingClientRect();
    // A pixel of rounding between the two widths is not a cut-off label.
    return button.scrollWidth <= button.clientWidth + 2 && box.right <= outer.right + 1;
  });
  expect(fits, "the reroll button fits its label inside the card").toBe(true);
  await fillIn(card.getByLabel("The rerolled d20"), "2");
  await press(reroll);
  await expect(card).toContainText("(d20 2, typed)");
  await expectPageFits(player);
  await press(card.getByRole("button", { name: "Done" }));
  await expect(card).toBeHidden();
});

test("the GM paints darkness over part of the live map, and bright light that is sunlight", async ({
  open,
  request
}) => {
  await ensureGmPassword(request);
  const gm = await open("/");
  await signInAsGm(gm);
  await liveSceneOnNewMap(gm, "Smoke cellar.png", battleMap(700, 518));

  const rail = gm.getByRole("toolbar", { name: "Map tools" });
  await press(rail.getByRole("button", { name: "Light" }));
  const light = gm.getByRole("group", { name: "Light" });
  await expect(light.getByRole("switch", { name: "Sunlight" })).toBeVisible();
  await expectPageFits(gm);
  await press(light.getByRole("switch", { name: "Sunlight" }));
  await expect(light.getByRole("switch", { name: "Sunlight" })).toBeChecked();
  await light.getByLabel("Area to paint").selectOption("dark");
  await press(light.getByRole("button", { name: "Paint area" }));
  await expect(light.getByRole("button", { name: "Paint area" })).toHaveAttribute("aria-pressed", "true");
  await gm.keyboard.press("Escape");

  // A drag over the map paints it, drawn for the GM in violet.
  const map = gm.getByRole("group", { name: /Interactive tokens are layered above this map/ });
  await drag(gm, map, { x: 90, y: 60 });
  await expect(gm.locator("[data-area-id] .vision-area-dark")).toHaveCount(1);
  await expectPageFits(gm);
});

test("the GM draws a door on the live map and locks it from the door's menu", async ({ open, request, hasTouch }) => {
  await ensureGmPassword(request);
  const gm = await open("/");
  await signInAsGm(gm);
  await liveSceneOnNewMap(gm, "Smoke vault.png", battleMap(700, 532));

  const rail = gm.getByRole("toolbar", { name: "Map tools" });
  await press(rail.getByRole("button", { name: "Walls" }));
  await press(gm.getByRole("group", { name: "Walls" }).getByRole("button", { name: "Door" }));
  await gm.keyboard.press("Escape");
  const map = gm.getByRole("group", { name: /Interactive tokens are layered above this map/ });
  await drag(gm, map, { x: 0, y: 70 });
  const handle = gm.locator("[data-door-id]");
  await expect(handle).toHaveCount(1);

  // With Select, the handle opens the door's menu. The handle is a map mark, so its size follows the zoom.
  await press(rail.getByRole("button", { name: "Select" }));
  if (hasTouch) await handle.tap();
  else await handle.click();
  const menu = gm.getByRole("menu", { name: "Door" });
  await expect(menu.getByRole("menuitem", { name: "Open the door" })).toBeVisible();
  await expectPageFits(gm);
  await press(menu.getByRole("menuitem", { name: "Edit lock and strength" }));
  await press(menu.getByRole("switch", { name: "Locked" }));
  await expectPageFits(gm);
  await press(menu.getByRole("button", { name: "Save door" }));
  await expect(menu).toBeHidden();
  // The GM sees the door held shut and its hit points; players get neither.
  await expect(gm.locator("[data-door-id] .vision-door-lock")).toHaveCount(1);
  await expect(gm.locator(".vision-object-hp")).toHaveText("18/18 HP");
  await expectPageFits(gm);
});

test("the GM presents a map on a paired table screen", async ({ open, request }) => {
  // Start from a paused presentation of an uploaded map, whichever journeys ran before this one.
  await ensureGmPassword(request);
  const { token } = (await (await request.post("/api/v1/host/gm/sign-in", { data: { password: GM_PASSWORD } })).json())
    .data;
  const headers = { authorization: `Bearer ${token}` };
  const upload = await request.post(`/api/v1/map-assets?name=${encodeURIComponent(MAP_NAME)}&kind=battlemap`, {
    headers: { ...headers, "content-type": "image/png" },
    data: battleMap()
  });
  expect(upload.ok(), await upload.text()).toBe(true);
  const { data } = await (await request.get("/api/v1/viewer/presentation", { headers })).json();
  const pause = await request.post("/api/v1/viewer/presentation/commands", {
    headers,
    data: {
      id: randomUUID(),
      expectedRevision: data.presentation.revision,
      payload: { type: "viewer.enabled.set", enabled: false }
    }
  });
  expect(pause.ok(), await pause.text()).toBe(true);

  // A screen paired through the API: the first evening pairs one through the app.
  const viewer = await open("/viewer.html");
  const pairing = await request.post("/api/v1/viewer/pairings", { headers, data: {} });
  const code = (await pairing.json()).data.pairing.code as string;
  expect((await viewer.request.post("/api/v1/viewer/pairings/exchange", { data: { code, name: "Den TV" } })).ok()).toBe(
    true
  );
  await viewer.reload();
  await expect(viewer.getByRole("heading", { name: "Presentation paused" })).toBeVisible();
  await expectPageFits(viewer);

  const gm = await open("/");
  await signInAsGm(gm);
  await openGmSection(gm, "Shared screen");
  await expect(gm.getByRole("heading", { name: "Shared screen", level: 2 })).toBeVisible();
  await expect(gm.getByText("Den TV", { exact: false }).first()).toBeVisible();

  // The Shared screen offers the GM's current map: the live scene's, when an earlier journey left one.
  const present = gm.getByRole("button", { name: /^Present / });
  const shown = (await present.textContent())!.replace(/^Present /, "");
  await press(present);
  await expect(viewer.getByRole("img", { name: shown })).toBeVisible();
  await expect(gm.getByRole("button", { name: "Pause presentation" })).toBeVisible();
  await expectPageFits(viewer);
  await expectPageFits(gm);
});

// The table's sound: the paired screen plays it for real while the GM's devices stay silent and show whether the
// room can hear it.
test("the GM plays music on the table screen and sees that the room hears it", async ({ open, request }) => {
  await ensureGmPassword(request);
  const { token } = (await (await request.post("/api/v1/host/gm/sign-in", { data: { password: GM_PASSWORD } })).json())
    .data;

  // A paired table screen, before any sound is on the board.
  const pairing = await request.post("/api/v1/viewer/pairings", {
    headers: { authorization: `Bearer ${token}` },
    data: {}
  });
  const code = (await pairing.json()).data.pairing.code as string;
  const screen = await open("/viewer.html");
  const paired = await screen.request.post("/api/v1/viewer/pairings/exchange", { data: { code, name: "Smoke TV" } });
  expect(paired.ok()).toBe(true);
  await screen.reload();

  const gm = await open("/");
  await signInAsGm(gm);
  await openGmSection(gm, "Shared screen");
  await press(gm.getByRole("button", { name: "Sound" }));
  await expect(gm.getByRole("heading", { name: "Sound", level: 2 })).toBeVisible();
  await expectPageFits(gm);

  // Upload through the library's own file button, then put the sound on the playlist and play it.
  const chooser = gm.waitForEvent("filechooser");
  await press(gm.getByRole("button", { name: "Add sounds…" }));
  await (await chooser).setFiles({ name: "Smoke Tone.wav", mimeType: "audio/wav", buffer: toneWav(30) });
  await expect(gm.getByText("Smoke Tone.wav added to the library.")).toBeVisible();
  await press(gm.getByRole("button", { name: "Add Smoke Tone to the playlist" }));
  await expect(gm.getByRole("button", { name: "Play Smoke Tone" })).toBeVisible();
  await press(gm.getByRole("button", { name: "Play music" }));
  await expect(gm.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
  await expectPageFits(gm);

  // The table screen plays it. Where the browser holds sound back, the screen asks for the tap a person would give.
  const unlock = screen.getByRole("button", { name: "Tap to turn on sound" });
  if (await unlock.isVisible()) await press(unlock);
  const music = screen.locator('audio[data-kind="music"]');
  await expect(music).toHaveCount(1);
  await expect
    .poll(() => music.evaluate((element: HTMLAudioElement) => !element.paused && element.currentTime > 0.2))
    .toBe(true);
  await expect(gm.getByText("Smoke TV · Sound on")).toBeVisible();
  // Only the table screen makes sound: the GM's page has no audio at all.
  await expect(gm.locator("audio")).toHaveCount(0);

  // Mid-fight, the Table tab's control pauses it.
  await press(gm.getByRole("tab", { name: "Table" }));
  const control = gm.getByRole("region", { name: "Sound" });
  await expect(control.getByText("Smoke Tone")).toBeVisible();
  await expectPageFits(gm);
  await press(control.getByRole("button", { name: "Pause sound" }));
  await expect.poll(() => music.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  await press(control.getByRole("button", { name: "Resume sound" }));
  await expect.poll(() => music.evaluate((element: HTMLAudioElement) => element.paused)).toBe(false);

  // Leave the board silent for whatever runs next.
  await openGmSection(gm, "Shared screen");
  await press(gm.getByRole("button", { name: "Stop all" }));
  await expect(music).toHaveCount(0);
});

test("a player turns on the situation their Crowbar names and rolls a Strength check it fits", async ({ open }) => {
  const hero = PARTY[0];
  const player = await open("/");
  await ensureGmPassword(player.request);
  // The GM's side is the API: it hands the character an equipped Crowbar.
  const { token } = (
    await (await player.request.post("/api/v1/host/gm/sign-in", { data: { password: GM_PASSWORD } })).json()
  ).data;
  const headers = { authorization: `Bearer ${token}` };
  const { game } = (await (await player.request.get("/api/v1/game", { headers })).json()).data;
  const { id: actorId, ownerSessionId } = game.actors.find((actor: { name: string }) => actor.name === hero);
  const gm = (path: string, data: Record<string, unknown>) =>
    player.request.post(path, { headers, data: { commandId: randomUUID(), ...data } });
  // An earlier journey's player may still hold the character: the GM frees it for this player.
  if (ownerSessionId)
    expect((await gm(`/api/v1/game/claims/${actorId}/force-release`, { actorId, inFight: true })).ok()).toBe(true);
  const crowbar = { id: "crowbar", name: "Crowbar", category: "adventuring-gear", quantity: 1, equipped: true };
  expect((await gm(`/api/v1/game/actors/${actorId}/inventory`, { actorId, item: crowbar })).ok()).toBe(true);
  await joinAndClaim(player, hero);

  await press(player.getByRole("tab", { name: "My character" }));
  const sheet = player.getByRole("region", { name: `${hero} character sheet` });
  // On a phone the checks are a tab of their own; on a laptop they are the sheet's left column.
  const checksTab = sheet.getByRole("tab", { name: "Checks" });
  if (await checksTab.isVisible()) await press(checksTab);
  const prying = sheet.getByRole("button", { name: "Prying with the Crowbar (Advantage)" });
  await expect(prying).toBeVisible();
  await expectPageFits(player);
  await press(prying);
  await expect(prying).toHaveAttribute("aria-pressed", "true");
  await press(sheet.getByRole("button", { name: /^Roll Athletics,/ }).first());
  // The roll names the situation for the GM, and the toggle is spent.
  await expect(player.getByText(/Strength \(Athletics\), prying with the Crowbar/).first()).toBeVisible();
  await expect(prying).toHaveAttribute("aria-pressed", "false");
  await expectPageFits(player);
});
