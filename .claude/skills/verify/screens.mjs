// Screenshots app pages at the smoke suite's phone and laptop sizes, from a throwaway server on a
// temporary data directory, so a UI change can be looked at without touching the GM's campaign.
//
//   node .claude/skills/verify/screens.mjs [--as gm|player] [--theme dusk|dawn|both] [--reduce-transparency] <path>...
//
// Each page is captured in each theme asked for (both by default), after the self-hosted fonts load.
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
const paths = args.length > 0 ? args : ["/"];
const root = fileURLToPath(new URL("../../../", import.meta.url));
const out = join(root, "e2e", "test-results", "screens");
const port = Number(process.env.SCREENS_PORT ?? 3299);
const base = `http://localhost:${port}`;
const password = "screens-password";
const sizes = [
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

async function signIn(page) {
  await page.goto("/");
  if (role === "gm") {
    await page.getByRole("button", { name: "Enter as GM" }).click();
    await page.getByPlaceholder("GM password").fill(password);
    await page.getByRole("button", { name: "Enter table" }).click();
    await page.getByRole("tablist", { name: "GM sections" }).waitFor();
  } else {
    await page.getByRole("button", { name: "Join as Player" }).click();
    await page.getByRole("listitem").getByRole("button", { name: "Claim" }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Claim" }).click();
    await page.getByText(/^You're playing /).waitFor();
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
        await page.goto(path);
        // A player rejoins with the stored token after a load; the address they asked for wins. The title screen can
        // take a moment to offer the rejoin, so wait for it or for the shell, whichever comes first.
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
