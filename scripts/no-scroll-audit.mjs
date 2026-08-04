import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("/opt/node22/lib/node_modules/playwright");
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox"] });
for (const [w, h] of [[1280, 900], [390, 844], [1280, 700]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const m = await page.evaluate(() => ({
    scrollableY: document.documentElement.scrollHeight > window.innerHeight,
    delta: document.documentElement.scrollHeight - window.innerHeight,
    scrollableX: document.documentElement.scrollWidth > window.innerWidth
  }));
  console.log(`${w}x${h}`, JSON.stringify(m));
  await page.close();
}
await browser.close();
