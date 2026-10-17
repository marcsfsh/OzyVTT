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
  await expect(reset.getByText("data/auth.json")).toBeVisible();
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
  await expect(gm.getByText("1 connected")).toBeVisible();
  await expectPageFits(gm);

  // A scene on a new map. The map has no grid, which the picker and the staging header say, with the way to set it.
  await press(gm.getByRole("tab", { name: "Table" }));
  await press(gm.getByRole("button", { name: "Prepare a scene" }));
  const newScene = gm.getByRole("dialog", { name: "New scene" });
  await press(newScene.getByRole("button", { name: "Pick a map" }));
  const chooser = gm.waitForEvent("filechooser");
  await press(newScene.getByRole("button", { name: /Upload a map/ }));
  await (await chooser).setFiles({ name: `${MAP_NAME}.png`, mimeType: "image/png", buffer: battleMap() });
  await expect(gm.getByText("Map uploaded.")).toBeVisible();
  await expect(newScene.getByText(/has no grid yet/)).toBeVisible();
  await expect(newScene.getByRole("button", { name: "Set the grid" })).toBeVisible();
  await press(newScene.getByRole("button", { name: "Prepare scene" }));
  const staging = gm.getByRole("group", { name: "Staged scene" });
  await expect(staging.getByRole("button", { name: "Set the grid" })).toBeVisible();
  await expectPageFits(gm);
  await press(staging.getByRole("button", { name: "Set the grid" }));

  // The grid: a printed square grid, a 3 x 3 drag from one intersection to the opposite one, then confirm.
  await expect(gm.getByRole("region", { name: `Calibrate ${MAP_NAME}` })).toBeVisible();
  await press(gm.getByRole("button", { name: "Continue" }));
  const from = await onPreview(gm, { x: 64, y: 64 });
  const to = await onPreview(gm, { x: 256, y: 256 });
  await drag(gm, gm.locator(".map-preview"), { x: to.x - from.x, y: to.y - from.y }, from);
  await press(gm.getByRole("button", { name: "Measure this area" }));
  await press(gm.getByRole("button", { name: "Looks right" }));
  await press(gm.getByRole("button", { name: "Confirm grid" }));
  await expect(gm.getByText(`The grid for ${MAP_NAME} is set. Tokens on it snap to its squares.`)).toBeVisible();
  await expectPageFits(gm);

  // Back to the staged scene, now with a grid, and live: the table screen shows it.
  await press(gm.getByRole("button", { name: "Back to the table" }));
  await expect(staging.getByRole("button", { name: "Set the grid" })).toBeHidden();
  await press(staging.getByRole("button", { name: "Make live" }));
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

  await press(player.getByRole("tab", { name: "My character" }));
  await expect(player.getByRole("img", { name: PARTY[0] })).toBeVisible();
  await expect(player.getByRole("button", { name: "Release" })).toBeVisible();
  await expectPageFits(player);

  // After a reload, joining again resumes the same session: their character, on the page they left.
  await player.reload();
  await press(player.getByRole("button", { name: "Join as Player" }));
  await expect(player.getByRole("tab", { name: "My character", selected: true })).toBeVisible();
  await expect(player.getByRole("button", { name: "Release" })).toBeVisible();
});

test("the GM runs a fight on a new scene and the player moves their token", async ({ open, hasTouch }) => {
  const hero = PARTY[1];
  const player = await open("/");
  await joinAndClaim(player, hero);
  const gm = await open("/");
  await signInAsGm(gm);

  // A scene with a freshly uploaded battle map, made live. From Scenes, since an earlier journey may have left a
  // scene live on the Table.
  await press(gm.getByRole("tab", { name: "Scenes" }));
  await press(gm.getByRole("button", { name: "New scene" }).first());
  const newScene = gm.getByRole("dialog", { name: "New scene" });
  // The live scene's map comes preselected; the new scene gets a map of its own.
  await press(newScene.getByRole("button", { name: /^(Pick a map|Change)$/ }));
  const chooser = gm.waitForEvent("filechooser");
  await press(newScene.getByRole("button", { name: /Upload a map/ }));
  // A different image from the first evening's, which the library would recognise and reuse with its grid.
  await (await chooser).setFiles({ name: "Smoke crossing.png", mimeType: "image/png", buffer: battleMap(700, 504) });
  await expect(gm.getByText("Map uploaded.")).toBeVisible();
  await expectPageFits(gm);
  await press(newScene.getByRole("button", { name: "Prepare scene" }));
  await press(gm.getByRole("button", { name: "Make live" }));
  await expect(gm.getByRole("heading", { name: "Start a fight" })).toBeVisible();

  // The fight: the player's character and one monster.
  for (const other of PARTY.filter((name) => name !== hero)) {
    const remove = gm.getByRole("button", { name: `Remove ${other} from this list` });
    await press(remove);
    await expect(remove).toBeHidden();
  }
  await press(gm.getByRole("button", { name: "Add monsters" }));
  const bestiary = gm.getByRole("dialog", { name: "Add monsters from the SRD bestiary" });
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

test("a player answers the GM's call with a physical die, then rerolls it with Heroic Inspiration", async ({
  open
}) => {
  const hero = PARTY[2];
  const player = await open("/");
  await joinAndClaim(player, hero);
  // The GM's side is the API: this journey is about the player's card.
  const { token } = (
    await (await player.request.post("/api/v1/host/gm/sign-in", { data: { password: GM_PASSWORD } })).json()
  ).data;
  const headers = { authorization: `Bearer ${token}` };
  const { game } = (await (await player.request.get("/api/v1/game", { headers })).json()).data;
  const actorId = game.actors.find((actor: { name: string }) => actor.name === hero).id;
  const gm = (path: string, data: Record<string, unknown>) =>
    player.request.post(path, { headers, data: { commandId: randomUUID(), ...data } });
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
  await expect(card).toContainText("(d20 18) · success");

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
  await expect(card).toContainText("(d20 2)");
  await expectPageFits(player);
  await press(card.getByRole("button", { name: "Done" }));
  await expect(card).toBeHidden();
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
  await expect(gm.getByRole("heading", { name: "Table viewer" })).toBeVisible();
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
