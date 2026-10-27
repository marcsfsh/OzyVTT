// Screenshots app pages at the smoke suite's phone and laptop sizes, from a throwaway server on a
// temporary data directory, so a UI change can be looked at without touching the GM's campaign.
//
//   node .claude/skills/verify/screens.mjs [--as gm|player] [--theme dusk|dawn|both] [--reduce-transparency]
//     [--scenario table|fight] [--tv] <path>...
//
// Each page is captured in each theme asked for (both by default), after the self-hosted fonts load. `--scenario table`
// makes a scene live on a drawn battle map with the party and four goblins on it, one hidden from players;
// `--scenario fight` also starts the fight. Both add a Codex page with a hidden field and a hidden block. A path's
// `{scene}` is that scene's id, as in `/scenes/{scene}`, and `{page}` that page's, as in `/codex/pages/{page}`.
// `--tv` pairs each browser as a table screen instead of signing in, presents the scenario's map, and captures
// /viewer.html at 1920x1080, a 1280x720 screen and a portrait tablet.
// Build the client first (`npm run build`). Pictures land in e2e/test-results/screens/.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const asAt = args.indexOf("--as");
const role = asAt === -1 ? "gm" : args.splice(asAt, 2)[1];
const themeAt = args.indexOf("--theme");
const themeArg = themeAt === -1 ? "both" : args.splice(themeAt, 2)[1];
const themes = themeArg === "both" ? ["dusk", "dawn"] : [themeArg];
const reduceAt = args.indexOf("--reduce-transparency");
const reduce = reduceAt !== -1;
if (reduce) args.splice(reduceAt, 1);
const scenarioAt = args.indexOf("--scenario");
const scenario = scenarioAt === -1 ? null : args.splice(scenarioAt, 2)[1];
if (scenario !== null && scenario !== "table" && scenario !== "fight")
  throw new Error(`--scenario takes table or fight, not ${scenario}`);
const tvAt = args.indexOf("--tv");
const tv = tvAt !== -1;
if (tv) args.splice(tvAt, 1);
const paths = tv ? ["/viewer.html"] : args.length > 0 ? args : ["/"];
const root = fileURLToPath(new URL("../../../", import.meta.url));
const out = join(root, "e2e", "test-results", "screens");
const port = Number(process.env.SCREENS_PORT ?? 3299);
const base = `http://localhost:${port}`;
const password = "screens-password";
const sizes = tv
  ? [
      { name: "tv", viewport: { width: 1920, height: 1080 }, hasTouch: false },
      { name: "small-tv", viewport: { width: 1280, height: 720 }, hasTouch: false },
      { name: "portrait", viewport: { width: 768, height: 1024 }, hasTouch: true }
    ]
  : [
      { name: "phone", viewport: { width: 390, height: 844 }, hasTouch: true },
      { name: "laptop", viewport: { width: 1280, height: 800 }, hasTouch: false }
    ];

if (role !== "gm" && role !== "player") throw new Error(`--as takes gm or player, not ${role}`);
if (!themes.every((theme) => theme === "dusk" || theme === "dawn"))
  throw new Error(`--theme takes dusk, dawn or both, not ${themeArg}`);

const server = spawn(process.execPath, ["--import", "tsx", "e2e/start-server.mts"], {
  cwd: root,
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "ignore", "inherit"]
});

async function serverReady() {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (server.exitCode !== null) throw new Error("The server stopped. Is the client built (`npm run build`)?");
    try {
      if ((await fetch(`${base}/api/v1/host/setup`)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No server on ${base} after 30 seconds.`);
}

/** Pairs this browser as a table screen through the API, as the GM's Pair a screen does, and presents the map. */
async function pairScreen(context) {
  const { token } = await (
    await fetch(`${base}/api/v1/host/gm/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password })
    })
  )
    .json()
    .then((body) => body.data);
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const pairing = await (await fetch(`${base}/api/v1/viewer/pairings`, { method: "POST", headers, body: "{}" })).json();
  const exchange = await context.request.post("/api/v1/viewer/pairings/exchange", {
    data: { code: pairing.data.pairing.code, name: "Screens TV" }
  });
  if (!exchange.ok()) throw new Error(`Pairing failed: ${await exchange.text()}`);
  if (!mapAssetId) return;
  const command = async (payload) => {
    const { data } = await (await fetch(`${base}/api/v1/viewer/presentation`, { headers })).json();
    await fetch(`${base}/api/v1/viewer/presentation/commands`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: crypto.randomUUID(), expectedRevision: data.presentation.revision, payload })
    });
  };
  await command({ type: "viewer.enabled.set", enabled: true });
  await command({
    type: "viewer.presentation.begin",
    assetId: mapAssetId,
    altText: "Goblin warren",
    camera: { center: { x: 700, y: 500 }, zoom: 1 }
  });
}

async function signIn(page) {
  if (tv) {
    await pairScreen(page.context());
    return page.goto("/viewer.html");
  }
  await page.goto("/");
  if (role === "gm") {
    await page.getByRole("button", { name: "Enter as GM" }).click();
    await page.getByPlaceholder("GM password").fill(password);
    await page.getByRole("button", { name: "Enter table" }).click();
    await page.getByRole("tablist", { name: "GM sections" }).waitFor();
  } else {
    await page.getByRole("button", { name: "Join as Player" }).click();
    await page.getByRole("radio").first().click();
    await page.getByRole("button", { name: /^Play as / }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Claim" }).click();
    await page.getByText(/^You're playing /).waitFor();
  }
}

/** A drawn battle map: two stone rooms joined by a corridor, on a 50px grid, as a PNG. */
async function drawnMap(browser) {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  await page.setContent(`<body style="margin:0;background:#141210">
    <div style="position:absolute;left:100px;top:250px;width:450px;height:550px;background:#5b5346"></div>
    <div style="position:absolute;left:550px;top:450px;width:250px;height:150px;background:#5b5346"></div>
    <div style="position:absolute;left:800px;top:150px;width:500px;height:650px;background:#5b5346"></div>
    <div style="position:absolute;inset:0;background-image:linear-gradient(#0003 1px,transparent 1px),
      linear-gradient(90deg,#0003 1px,transparent 1px);background-size:50px 50px"></div></body>`);
  const png = await page.screenshot();
  await page.close();
  return png;
}

/** The scenario's live scene and Codex page, for a path that names `{scene}` or `{page}`. */
let sceneId = null;
let pageId = null;
let mapAssetId = null;

/** Makes the scenario's scene live through the API, as the GM would from Prep. */
async function seed(browser) {
  const json = async (response) => {
    const body = await response.json();
    if (!response.ok) throw new Error(`${response.url}: ${JSON.stringify(body)}`);
    return body.data;
  };
  const { token } = await json(
    await fetch(`${base}/api/v1/host/gm/sign-in`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password })
    })
  );
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const post = async (path, data) =>
    json(
      await fetch(`${base}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ commandId: crypto.randomUUID(), ...data })
      })
    );
  const { asset } = await json(
    await fetch(`${base}/api/v1/map-assets?name=Goblin%20warren&kind=battlemap`, {
      method: "POST",
      headers: { ...headers, "content-type": "image/png" },
      body: await drawnMap(browser)
    })
  );
  const monsters = (await json(await fetch(`${base}/api/v1/content/monsters`, { headers }))).monsters;
  const find = (name) => monsters.find((monster) => monster.name === name)?.id;
  for (const [name, visibility] of [
    ["Goblin Boss", "public"],
    ["Goblin Warrior", "public"],
    ["Goblin Warrior", "public"],
    ["Goblin Warrior", "gm-only"]
  ])
    await post("/api/v1/game/actors", { definitionId: find(name), visibility });
  const { game } = await json(await fetch(`${base}/api/v1/game`, { headers }));
  mapAssetId = asset.id;
  const ids = game.actors.filter((actor) => !actor.archived).map((actor) => actor.id);
  await post("/api/v1/game/scenes", { name: "Goblin warren", mapAssetId: asset.id, combatantIds: ids, activate: true });
  const spots = [
    [275, 525],
    [525, 525],
    [225, 625],
    [625, 475],
    [725, 325],
    [775, 575],
    [825, 275]
  ];
  for (const [index, actorId] of ids.entries()) {
    const [x, y] = spots[index % spots.length];
    await post(`/api/v1/game/tokens/${actorId}/move`, { actorId, position: { x, y } });
  }
  sceneId = (await json(await fetch(`${base}/api/v1/game`, { headers }))).game.combat.activeSceneId;
  // A Codex page with a link, a hidden field and a hidden block, so the page has each part to show.
  await post("/api/v1/codex/pages", {
    title: "Thornwood",
    entityType: "location",
    playerBody: "Old oaks and older paths.",
    revealedToPlayers: true
  });
  const warren = await post("/api/v1/codex/pages", {
    title: "The Goblin Warren",
    entityType: "location",
    fields: { region: "Thornwood", ruler: "The goblin boss" },
    hiddenFields: ["ruler"],
    playerBody:
      "A sinkhole in the [[Thornwood]] opens into a warren of low tunnels.\n\nThe warren answers to its boss, who rarely leaves the east chamber.",
    blocks: [{ text: "The boss keeps the stolen reliquary under the bedrolls in the east chamber.", anchor: 1 }],
    revealedToPlayers: true
  });
  pageId = warren.id ?? warren.page?.id ?? null;
  if (scenario === "fight") {
    await post("/api/v1/game/encounter/start", { mapAssetId: asset.id, entries: ids.map((actorId) => ({ actorId })) });
    // A few rolls shown to players, so the log has cards to show.
    for (const formula of ["1d20+5", "2d6+3", "1d8"])
      await post("/api/v1/game/rolls", { formula, purpose: "manual", visibility: "public" });
  }
}

const browser = await chromium.launch();
try {
  await serverReady();
  await fetch(`${base}/api/v1/host/setup`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password })
  });
  if (scenario) await seed(browser);
  mkdirSync(out, { recursive: true });
  for (const size of sizes) {
    const context = await browser.newContext({ baseURL: base, viewport: size.viewport, hasTouch: size.hasTouch });
    const page = await context.newPage();
    page.on("pageerror", (error) => console.error(`${size.name} ${page.url()}: ${error.message}`));
    await signIn(page);
    // One person per size, so a player keeps the character it claimed; each theme is a saved device choice that the
    // next load reads before it paints.
    for (const theme of themes) {
      await page.evaluate(
        ({ theme, reduce }) => {
          localStorage.setItem("vtt.theme", theme);
          localStorage.setItem("vtt.reduce-transparency", reduce ? "on" : "off");
        },
        { theme, reduce }
      );
      for (const path of paths) {
        await page.goto(path.replace("{scene}", sceneId ?? "").replace("{page}", pageId ?? ""));
        // A player rejoins with the stored token after a load; the address they asked for wins. The title screen can
        // take a moment to offer the rejoin, so wait for it or for the shell, whichever comes first.
        if (tv) {
          await page.waitForLoadState("networkidle").catch(() => {});
          await page.evaluate(() => document.fonts.ready);
          await page.waitForTimeout(800);
          const file = join(out, `tv-${size.name}-${theme}${reduce ? "-solid" : ""}.png`);
          await page.screenshot({ path: file });
          console.log(file);
          continue;
        }
        const rejoin = page.getByRole("button", { name: "Join as Player" });
        const shell = page.getByRole("tablist", { name: role === "gm" ? "GM sections" : "Player sections" });
        await rejoin.or(shell).first().waitFor({ timeout: 10_000 });
        if (role === "player" && (await rejoin.isVisible())) {
          await rejoin.click();
          await shell.waitFor({ timeout: 10_000 });
        }
        // The entry drive fades the title screen over the app for a moment; capture after it has gone.
        await page
          .locator(".landing")
          .waitFor({ state: "detached", timeout: 5_000 })
          .catch(() => {});
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(500);
        const slug = path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home";
        const variant = `${theme}${reduce ? "-solid" : ""}`;
        const file = join(out, `${role}-${slug}-${size.name}-${variant}.png`);
        await page.screenshot({ path: file });
        console.log(file);
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
  server.kill("SIGTERM");
}
