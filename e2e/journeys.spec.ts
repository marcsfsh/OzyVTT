/**
 * The journeys a table depends on, in the order a first evening runs them. They share one server per
 * viewport, so the first one meets a server with no GM password.
 */
import { randomUUID } from "node:crypto";
import {
  GM_PASSWORD,
  PARTY,
  battleMap,
  drag,
  ensureGmPassword,
  expect,
  expectPageFits,
  fillIn,
  joinAndClaim,
  pinchDuringDrag,
  positionOf,
  press,
  signInAsGm,
  test
} from "./smoke";

const MAP_NAME = "Smoke cavern";

test("the GM sets a password on a fresh server, then signs in with it", async ({ open }) => {
  const gm = await open("/");
  await expectPageFits(gm);
  await press(gm.getByRole("button", { name: "Enter as GM" }));
  await expect(gm.getByRole("heading", { name: "Set up the GM password" })).toBeVisible();
  await fillIn(gm.getByPlaceholder("GM password"), GM_PASSWORD);
  await press(gm.getByRole("button", { name: "Set GM password" }));
  await expect(gm.getByText("GM password set. Enter it to begin.")).toBeVisible();
  await expectPageFits(gm);

  await fillIn(gm.getByPlaceholder("GM password"), "not-the-password");
  await press(gm.getByRole("button", { name: "Enter table" }));
  await expect(gm.getByText("Invalid GM password.")).toBeVisible();
  await expectPageFits(gm);

  await fillIn(gm.getByPlaceholder("GM password"), GM_PASSWORD);
  await press(gm.getByRole("button", { name: "Enter table" }));
  await expect(gm.getByRole("tablist", { name: "GM sections" })).toBeVisible();
  await expect(gm.getByRole("tab", { name: "Table", selected: true })).toBeVisible();
  await expectPageFits(gm);
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

  // A scene with a freshly uploaded battle map, made live.
  await press(gm.getByRole("button", { name: "Prepare a scene" }));
  const newScene = gm.getByRole("dialog", { name: "New scene" });
  await press(newScene.getByRole("button", { name: "Pick a map" }));
  const chooser = gm.waitForEvent("filechooser");
  await press(newScene.getByRole("button", { name: /Upload a map/ }));
  await (await chooser).setFiles({ name: `${MAP_NAME}.png`, mimeType: "image/png", buffer: battleMap() });
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
  await expect(gm.getByText("Round 1")).toBeVisible();
  await expectPageFits(gm);

  // A move off the mover's turn goes to the GM, so if the goblin won initiative the GM ends its turn first.
  await expect(player.getByText("Round 1")).toBeVisible();
  const yourTurn = player.getByText("Your turn - act, then end it below");
  if (!(await yourTurn.isVisible())) await press(gm.getByRole("button", { name: "Next turn" }));
  await expect(yourTurn).toBeVisible();

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

test("the GM pairs the table viewer and presents the map", async ({ open, request }) => {
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

  const viewer = await open("/viewer.html");
  await expect(viewer.getByRole("heading", { name: "Pair this screen" })).toBeVisible();
  await expectPageFits(viewer);

  const gm = await open("/");
  await signInAsGm(gm);
  await press(gm.getByRole("tab", { name: "Shared screen" }));
  await expect(gm.getByRole("heading", { name: "Table viewer" })).toBeVisible();
  await press(gm.getByRole("button", { name: "Create pairing code" }));
  const code = (await gm.getByRole("status").filter({ hasText: "Pairing code" }).locator("strong").textContent())!;
  await expectPageFits(gm);

  await fillIn(viewer.getByLabel("Display name"), "Living room TV");
  await fillIn(viewer.getByLabel("Pairing code"), code);
  await press(viewer.getByRole("button", { name: "Pair viewer" }));
  await expect(viewer.getByRole("heading", { name: "Presentation paused" })).toBeVisible();
  await expect(gm.getByText("1 connected")).toBeVisible();

  await press(gm.getByRole("button", { name: `Present ${MAP_NAME}` }));
  await expect(viewer.getByRole("img", { name: MAP_NAME })).toBeVisible();
  await expect(gm.getByRole("button", { name: "Pause presentation" })).toBeVisible();
  await expectPageFits(viewer);
  await expectPageFits(gm);
});
