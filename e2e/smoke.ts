/**
 * What every journey shares: a fixture that opens one browser context per person and fails the test
 * on any uncaught page error, and the checks a journey runs on the pages and controls it touches.
 */
import { deflateSync } from "node:zlib";
import {
  test as base,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Locator,
  type Page
} from "@playwright/test";

export { expect };

export const GM_PASSWORD = "smoke-test-password";
/** The party the server seeds into a fresh table. */
export const PARTY = ["Borin Stoneguard", "Mirena Dawnbright", "Lyra Emberwise"] as const;
/** The `--tap-min` floor in docs/DESIGN.md. */
const TAP_MIN = 44;

/** Pages opened in a touch project; they are tapped and dragged with a finger. */
const touchPages = new WeakSet<Page>();

export const test = base.extend<{
  /** Opens `path` in a new browser context: another person at the project's viewport. */
  open: (path: string) => Promise<Page>;
}>({
  open: async ({ browser, baseURL, viewport, hasTouch }, use) => {
    const errors: string[] = [];
    const contexts: BrowserContext[] = [];
    await use(async (path) => {
      const context = await browser.newContext({ baseURL, viewport, hasTouch });
      contexts.push(context);
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(`${page.url()}: ${error.message}`));
      if (hasTouch) touchPages.add(page);
      await page.goto(path);
      return page;
    });
    await Promise.all(contexts.map((context) => context.close()));
    expect(errors, "uncaught page errors").toEqual([]);
  }
});

/**
 * The control's hit area in layout pixels (an entrance animation's scale is not the control's size):
 * its box, grown by the `.tap-target` `::after` layer or by the label that wraps a form control.
 */
function hitArea(control: Locator) {
  return control.evaluate((element: HTMLElement) => {
    let width = element.offsetWidth;
    let height = element.offsetHeight;
    const after = getComputedStyle(element, "::after");
    if (after.content !== "none" && after.position === "absolute") {
      width = Math.max(width, parseFloat(after.width) || 0);
      height = Math.max(height, parseFloat(after.height) || 0);
    }
    const label = element.closest("label");
    if (label && label !== element) {
      width = Math.max(width, label.offsetWidth);
      height = Math.max(height, label.offsetHeight);
    }
    return { width: Math.round(width), height: Math.round(height) };
  });
}

async function expectTapTarget(control: Locator) {
  await expect(control).toBeVisible();
  const area = await hitArea(control);
  expect
    .soft(Math.min(area.width, area.height), `${control} hit area ${area.width}x${area.height}`)
    .toBeGreaterThanOrEqual(TAP_MIN);
}

/** Taps (or clicks, without touch) a control after checking its hit area meets the floor. */
export async function press(control: Locator) {
  await expectTapTarget(control);
  if (touchPages.has(control.page())) await control.tap();
  else await control.click();
}

/** Fills a field after checking its hit area meets the floor. */
export async function fillIn(field: Locator, value: string) {
  await expectTapTarget(field);
  await field.fill(value);
}

/**
 * The page never scrolls (docs/DESIGN.md): the document fits the viewport, no `.scroll-y` region can
 * scroll sideways, and nothing outside those regions has been scrolled. A box that clips its overflow
 * still scrolls when focus lands in its hidden part, which pushes the page out of place.
 */
export async function expectPageFits(page: Page) {
  const found = await page.evaluate(() => {
    const root = document.documentElement;
    const name = (element: Element) => `${element.tagName.toLowerCase()}.${[...element.classList].join(".")}`;
    const scrolls = (overflow: string) => overflow === "auto" || overflow === "scroll";
    const regions = [...document.querySelectorAll<HTMLElement>(".scroll-y")];
    const sideways = regions
      .filter((region) => scrolls(getComputedStyle(region).overflowX) && region.scrollWidth > region.clientWidth)
      .map((region) => `${name(region)} is ${region.scrollWidth}px wide in ${region.clientWidth}px`);
    const shifted = [...document.querySelectorAll<HTMLElement>("body *")]
      .filter((element) => (element.scrollLeft !== 0 || element.scrollTop !== 0) && !regions.includes(element))
      .filter((element) => {
        const style = getComputedStyle(element);
        return (
          (element.scrollLeft !== 0 && !scrolls(style.overflowX)) ||
          (element.scrollTop !== 0 && !scrolls(style.overflowY))
        );
      })
      .map((element) => `${name(element)} scrolled to ${element.scrollLeft},${element.scrollTop}`);
    return {
      size: `${root.scrollWidth}x${root.scrollHeight}`,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      sideways,
      shifted
    };
  });
  expect.soft(found.size, "page size").toBe(found.viewport);
  expect.soft(found.sideways, "scroll regions that scroll sideways").toEqual([]);
  expect.soft(found.shifted, "clipped boxes scrolled out of place").toEqual([]);
}

/**
 * A control sits wholly inside the viewport and nothing covers its centre: `elementFromPoint` there lands on the
 * control itself. The bar under the thumb pads itself by the device's safe area, so this holds on a notched phone.
 */
export async function expectUncovered(control: Locator) {
  await expect(control).toBeVisible();
  const measure = () =>
    control.evaluate((element: HTMLElement) => {
      const box = element.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      const hit = document.elementFromPoint(x, y);
      return {
        connected: element.isConnected,
        inside: box.top >= 0 && box.left >= 0 && box.bottom <= window.innerHeight && box.right <= window.innerWidth,
        hit: hit !== null && (hit === element || element.contains(hit)),
        at: hit ? `${hit.tagName.toLowerCase()}.${[...hit.classList].join(".")}` : "nothing"
      };
    });
  // Playwright finds the control and measures it in two calls, and a render between them can replace it. A detached
  // node measures as an empty box at the page's top-left corner, so the control is found and measured again.
  let found = await measure();
  for (let attempt = 1; !found.connected && attempt < 5; attempt++) found = await measure();
  expect.soft(found.connected, `${control} stays in the page while it is measured`).toBe(true);
  expect.soft(found.inside, `${control} inside the viewport`).toBe(true);
  expect.soft(found.hit, `${control} is uncovered (the centre hits ${found.at})`).toBe(true);
}

/** Nothing covers a token on the map: `elementFromPoint` at its centre lands on the token. */
export async function expectTokenUncovered(page: Page, tokenId: string) {
  const token = page.locator(`g.encounter-token[data-token-id="${tokenId}"]`);
  await expect(token).toBeVisible();
  const found = await token.evaluate((element: SVGGElement) => {
    const box = element.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return {
      hit: hit !== null && element.contains(hit),
      at: hit ? `${hit.tagName.toLowerCase()}.${[...hit.classList].join(".")}` : "nothing"
    };
  });
  expect.soft(found.hit, `the token's centre hits ${found.at}`).toBe(true);
}

/**
 * Sets the GM password from loopback unless the first journey already did (409), so any journey can
 * run on its own with `--grep`. Players cannot join before it is set.
 */
export async function ensureGmPassword(request: APIRequestContext) {
  const response = await request.post("/api/v1/host/setup", { data: { password: GM_PASSWORD } });
  expect([201, 409]).toContain(response.status());
}

export async function signInAsGm(page: Page) {
  await ensureGmPassword(page.request);
  await press(page.getByRole("button", { name: "Enter as GM" }));
  await fillIn(page.getByPlaceholder("GM password"), GM_PASSWORD);
  await press(page.getByRole("button", { name: "Enter table" }));
  await expect(page.getByRole("tablist", { name: "GM sections" })).toBeVisible();
}

/** Joins, claims `name`, and goes from My character (where a claim lands) to the Table. */
export async function joinAndClaim(page: Page, name: string) {
  await ensureGmPassword(page.request);
  await press(page.getByRole("button", { name: "Join as Player" }));
  await press(page.getByRole("listitem").filter({ hasText: name }).getByRole("button", { name: "Claim" }));
  await press(page.getByRole("dialog").getByRole("button", { name: "Claim" }));
  await expect(page.getByText(`You're playing ${name}.`)).toBeVisible();
  await expect(page.getByRole("tab", { name: "My character", selected: true })).toBeVisible();
  await press(page.getByRole("tab", { name: "Table" }));
}

/**
 * Opens a section of the GM's app: its tab, or on a narrow screen the More menu's item for it (the tab bar
 * keeps every section one tap away without scrolling sideways).
 */
export async function openGmSection(page: Page, name: string) {
  const tab = page.getByRole("tab", { name, exact: true });
  if (await tab.isVisible()) {
    await press(tab);
    return;
  }
  await press(page.getByLabel(/more sections$/i));
  await press(page.getByRole("menuitem", { name, exact: true }));
}

type Point = { x: number; y: number };

/**
 * Raw touch points sent to Chromium (Playwright can tap but cannot move a finger), a frame apart so
 * React renders between them. A touchStart that repeats a finger already down adds only the new one.
 */
async function fingers(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  return {
    async send(type: "touchStart" | "touchMove" | "touchEnd", points: Point[]) {
      await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map((point, id) => ({ ...point, id })) });
      await page.evaluate(() => new Promise(requestAnimationFrame));
    },
    detach: () => cdp.detach()
  };
}

/** Drags with one finger on a touch project, or the mouse otherwise: from `start` (by default the middle of
 *  `target`) by `by`. */
export async function drag(page: Page, target: Locator, by: Point, start?: Point) {
  const box = (await target.boundingBox())!;
  const from = start ?? { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const steps = 8;
  if (touchPages.has(page)) {
    const touch = await fingers(page);
    await touch.send("touchStart", [from]);
    for (let step = 1; step <= steps; step++)
      await touch.send("touchMove", [{ x: from.x + (by.x * step) / steps, y: from.y + (by.y * step) / steps }]);
    await touch.send("touchEnd", []);
    await touch.detach();
  } else {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + by.x, from.y + by.y, { steps });
    await page.mouse.up();
  }
}

/** A token's position in map pixels, read from its `translate(x y)`. */
export async function positionOf(token: Locator) {
  const [x, y] = (await token.getAttribute("transform"))!.match(/-?[\d.]+/g)!.map(Number);
  return { x, y };
}

/**
 * One finger starts dragging `target`, a second lands on a clear part of `map`, and the two spread
 * apart and lift: the touch sequence the map must read as a pinch that abandons the drag.
 */
export async function pinchDuringDrag(page: Page, target: Locator, map: Locator) {
  const box = (await target.boundingBox())!;
  const first = { x: box.x + box.width / 2, y: box.y + box.height / 2 + 12 };
  // The farthest point from the first finger where a touch reaches the map itself.
  const second = await map.evaluate((svg, from) => {
    const area = svg.getBoundingClientRect();
    let best: Point | null = null;
    for (let fx = 0.05; fx < 1; fx += 0.1)
      for (let fy = 0.05; fy < 1; fy += 0.1) {
        const point = { x: area.left + area.width * fx, y: area.top + area.height * fy };
        const hit = document.elementFromPoint(point.x, point.y);
        if (!hit || !svg.contains(hit) || hit.closest("[data-token-id]")) continue;
        const distance = Math.hypot(point.x - from.x, point.y - from.y);
        if (!best || distance > Math.hypot(best.x - from.x, best.y - from.y)) best = point;
      }
    return best;
  }, first);
  if (!second) throw new Error("no clear spot on the map for a second finger");
  const touch = await fingers(page);
  await touch.send("touchStart", [{ x: first.x, y: first.y - 12 }]);
  await touch.send("touchMove", [first]);
  await touch.send("touchStart", [first, second]);
  const away = { x: (second.x - first.x) / 8, y: (second.y - first.y) / 8 };
  for (let step = 1; step <= 4; step++)
    await touch.send("touchMove", [
      { x: first.x - away.x * step, y: first.y - away.y * step },
      { x: second.x + away.x * step, y: second.y + away.y * step }
    ]);
  await touch.send("touchEnd", []);
  await touch.detach();
}

/** A PNG battle map: a checkerboard of 64px squares, built here so the suite carries no binary. */
export function battleMap(width = 700, height = 500): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc32 = (bytes: Buffer) => {
    let c = 0xffffffff;
    for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour RGB
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const shade = ((x >> 6) + (y >> 6)) % 2 ? 70 : 130;
      rows.fill(shade, y * (width * 3 + 1) + 1 + x * 3, y * (width * 3 + 1) + 4 + x * 3);
    }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    signature,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/** A WAV of a soft 440 Hz tone, built here so the suite carries no binary. */
export function toneWav(seconds: number, sampleRate = 22_050): Buffer {
  const samples = Math.round(seconds * sampleRate);
  const file = Buffer.alloc(44 + samples * 2);
  file.write("RIFF", 0, "latin1");
  file.writeUInt32LE(36 + samples * 2, 4);
  file.write("WAVEfmt ", 8, "latin1");
  file.writeUInt32LE(16, 16);
  file.writeUInt16LE(1, 20);
  file.writeUInt16LE(1, 22);
  file.writeUInt32LE(sampleRate, 24);
  file.writeUInt32LE(sampleRate * 2, 28);
  file.writeUInt16LE(2, 32);
  file.writeUInt16LE(16, 34);
  file.write("data", 36, "latin1");
  file.writeUInt32LE(samples * 2, 40);
  for (let index = 0; index < samples; index++)
    file.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 6_000), 44 + index * 2);
  return file;
}
